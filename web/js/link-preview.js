const cache=new Map();
let active=0;
const waiting=[];
let generation=0;
const controllers=new Set();
export function cancelLinkPreviews(){generation++;cache.clear();for(const controller of controllers)controller.abort();}
export function parseWebURL(value) {
    if(typeof value!=='string')return null;
    const text=value.trim();if(!text||text.length>2048||/\s/.test(text))return null;
    const explicit=/^https?:\/\//i.test(text);
    if(!explicit&&!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#]|$)/i.test(text))return null;
    try {const url=new URL(explicit?text:'https://'+text);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;return url;}catch{return null;}
}
async function requestInfo(url) {
    // Browser cache is session-only: no URL is stored in localStorage or a shared server cache.
    const taskGeneration=generation;
    if(active>=2)await new Promise(resolve=>waiting.push(resolve));else active++;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
    controllers.add(controller);
    try {
        if(taskGeneration!==generation)throw new Error('已取消');
        const response=await fetch('/api/link-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:controller.signal,credentials:'same-origin'});
        if(!response.ok)throw new Error('获取失败');const data=await response.json();
        return {title:String(data.title||'').slice(0,200),icon:typeof data.icon==='string'&&/^data:image\/(?:png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/=]+$/.test(data.icon)&&data.icon.length<90000?data.icon:null};
    }finally{clearTimeout(timer);controllers.delete(controller);if(waiting.length)waiting.shift()();else active--;}
}
export function getLinkInfo(url) {
    const normalized=new URL(url);normalized.hash='';const key=normalized.href;
    if(cache.get(key)?.expires<Date.now())cache.delete(key);
    if(!cache.has(key)){
        if(cache.size>=200)cache.delete(cache.keys().next().value);
        const entry={expires:Infinity,promise:null};
        entry.promise=requestInfo(key).catch(()=>{entry.expires=Date.now()+60000;return null;});cache.set(key,entry);
    }
    return cache.get(key).promise;
}
export function createLinkPreview(url, enabled) {
    const row=document.createElement('div');row.className='link-preview';
    const fallback=document.createElement('span');fallback.className='site-monogram';fallback.textContent=url.hostname.replace(/^www\./,'').charAt(0).toUpperCase();fallback.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.className='site-title';title.textContent=url.hostname;
    row.append(fallback,title);
    if(enabled){title.textContent=url.hostname+' · 正在获取…';getLinkInfo(url.href).then(data=>{
        if(!data){title.textContent=url.hostname+' · 未获取到网页标题';return;}
        title.textContent=data.title||url.hostname;
        if(data.icon){const icon=document.createElement('img');icon.className='site-icon';icon.alt='';icon.width=icon.height=22;icon.onerror=()=>icon.replaceWith(fallback);icon.src=data.icon;fallback.replaceWith(icon);}
    });}else title.title='开启联网获取后显示网页标题和图标';
    return row;
}
