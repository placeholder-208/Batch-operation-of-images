const cache=new Map(),iconCache=new Map(),siteIcons=new Map(),pending=new Set(),waiting=[];
let active=0,generation=0;
const SUCCESS_TTL=15*60*1000,FAILURE_TTL=60*1000,MAX_ENTRIES=200;
const validIcon=value=>typeof value==='string'&&/^data:image\/(?:png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/=]+$/.test(value)&&value.length<90000?value:null;
function priority(entry){
    if(entry.direct)return 1;
    return Math.max(-1,...Array.from(entry.priorities,read=>read()));
}
function acquire(entry){
    if(entry.generation!==generation)return Promise.resolve(false);
    if(active<3){active++;return Promise.resolve(true);}
    return new Promise(resolve=>waiting.push({entry,resolve}));
}
function release(){
    active--;
    while(active<3&&waiting.length){
        let next=0,best=-Infinity;
        for(let index=0;index<waiting.length;index++){const score=priority(waiting[index].entry);if(score>best){best=score;next=index;}}
        const [job]=waiting.splice(next,1);
        if(job.entry.generation!==generation){job.resolve(false);continue;}
        if(best<0){job.resolve(false);continue;}
        active++;job.resolve(true);
    }
}
function notify(entry){
    for(const listener of entry.listeners)listener(entry.data);
}
function publish(entry,data){
    entry.data=data;entry.resolve(data);notify(entry);
}
function rememberIcon(origin,url,icon){
    if(iconCache.size>=MAX_ENTRIES&&!iconCache.has(url))iconCache.delete(iconCache.keys().next().value);
    iconCache.set(url,{icon,expires:Date.now()+(icon?SUCCESS_TTL:FAILURE_TTL)});
    if(!siteIcons.has(origin)){
        if(siteIcons.size>=MAX_ENTRIES)siteIcons.delete(siteIcons.keys().next().value);
        siteIcons.set(origin,new Set());
    }
    const known=siteIcons.get(origin);known.add(url);
    if(known.size>8)known.delete(known.values().next().value);
}
function knownIcons(url){
    const origin=new URL(url).origin,known=[];
    for(const icon of siteIcons.get(origin)||[]){
        if((iconCache.get(icon)?.expires||0)<=Date.now()){iconCache.delete(icon);continue;}
        if(JSON.stringify({url,stream:true,knownIcons:[...known,icon]}).length>3500)break;
        known.push(icon);
    }
    return known;
}
export function cancelLinkPreviews(){
    generation++;
    for(const entry of pending){
        entry.cancelled=true;entry.controller?.abort();entry.listeners.clear();entry.priorities.clear();
        if(entry.data){entry.complete=true;entry.expires=Date.now()+SUCCESS_TTL;}
        else{entry.resolve(null);if(cache.get(entry.key)===entry)cache.delete(entry.key);}
    }
    for(const job of waiting.splice(0))job.resolve(false);
}
export function parseWebURL(value) {
    if(typeof value!=='string')return null;
    const text=value.trim();if(!text||text.length>2048||/\s/.test(text))return null;
    const explicit=/^https?:\/\//i.test(text);
    if(!explicit&&!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#]|$)/i.test(text))return null;
    try {const url=new URL(explicit?text:'https://'+text);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;return url;}catch{return null;}
}

function cleanTiming(value){
    const clean={};
    for(const key of ['fetchMs','parseMs','titleMs','iconMs','totalMs'])if(Number.isFinite(value?.[key])&&value[key]>=0&&value[key]<=60000)clean[key]=Math.round(value[key]);
    return clean;
}
function acceptEvent(entry,event,url){
    if(entry.cancelled||entry.generation!==generation)return;
    if(event.type==='error')throw new Error('获取失败');
    if(event.type==='metadata'){
        const iconURL=typeof event.iconURL==='string'&&event.iconURL.length<=2048?event.iconURL:null;
        publish(entry,{title:String(event.title||'').slice(0,200),icon:null,iconURL,
            timing:{...cleanTiming(event.timing),queueMs:entry.queueMs,titleWaitMs:Date.now()-entry.startedAt}});
    }else if(event.type==='icon'&&entry.data){
        const iconURL=entry.data.iconURL;
        const cached=iconURL?iconCache.get(iconURL):null;
        const icon=event.cached&&cached?.expires>Date.now()?cached.icon:validIcon(event.icon);
        if(iconURL)rememberIcon(new URL(url).origin,iconURL,icon);
        publish(entry,{...entry.data,icon,iconStatus:['loaded','cached','timeout','unavailable'].includes(event.status)?event.status:icon?'loaded':'unavailable',
            timing:{...entry.data.timing,...cleanTiming(event.timing)}});
    }
}
async function readStream(response,entry,url){
    if(!response.body)throw new Error('缺少响应内容');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='',lines=0;
    function consume(final=false){
        let end;
        while((end=buffer.indexOf('\n'))!==-1){
            const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
            if(line.trim()){if(++lines>8)throw new Error('响应事件过多');acceptEvent(entry,JSON.parse(line),url);}
        }
        if(final&&buffer.trim())acceptEvent(entry,JSON.parse(buffer),url);
        if(buffer.length>128*1024)throw new Error('响应过大');
    }
    try{
        while(true){
            const chunk=await reader.read();
            if(chunk.done){buffer+=decoder.decode();consume(true);break;}
            buffer+=decoder.decode(chunk.value,{stream:true});consume();
        }
    }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function requestInfo(entry,url){
    if(!await acquire(entry)){
        entry.resolve(entry.data);pending.delete(entry);entry.complete=true;entry.listeners.clear();entry.priorities.clear();
        if(!entry.data&&cache.get(entry.key)===entry)cache.delete(entry.key);
        return;
    }
    entry.startedAt=Date.now();entry.queueMs=entry.startedAt-entry.createdAt;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12500);
    entry.controller=controller;
    try{
        if(entry.cancelled||entry.generation!==generation)throw new Error('已取消');
        const response=await fetch('/api/link-preview',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson, application/json'},body:JSON.stringify({url,stream:true,knownIcons:knownIcons(url)}),signal:controller.signal,credentials:'same-origin'});
        if(!response.ok)throw new Error('获取失败');
        if((response.headers.get('content-type')||'').includes('application/x-ndjson'))await readStream(response,entry,url);
        else{
            // Support an older Worker while frontend/backend rollout completes.
            const data=await response.json();
            if(!entry.cancelled&&entry.generation===generation)publish(entry,{title:String(data.title||'').slice(0,200),icon:validIcon(data.icon),iconURL:null});
        }
        if(!entry.data)throw new Error('未获取到网页信息');
        entry.expires=Date.now()+SUCCESS_TTL;
    }catch{
        if(!entry.cancelled){entry.expires=Date.now()+(entry.data?SUCCESS_TTL:FAILURE_TTL);entry.resolve(entry.data);if(!entry.data)notify(entry);}
    }finally{
        clearTimeout(timer);entry.controller=null;entry.complete=true;entry.listeners.clear();entry.priorities.clear();pending.delete(entry);release();
    }
}
export function getLinkInfo(url,onUpdate,options={}){
    // Session memory only: no full URLs in persistent or shared server caches.
    const normalized=new URL(url);normalized.hash='';const key=normalized.href;
    let entry=cache.get(key);
    if(entry?.expires<Date.now()){cache.delete(key);entry=null;}
    if(!entry){
        if(cache.size>=MAX_ENTRIES){
            const oldest=[...cache].find(([,value])=>value.complete);
            if(oldest)cache.delete(oldest[0]);else return Promise.resolve(null);
        }
        entry={key,generation,createdAt:Date.now(),expires:Infinity,complete:false,cancelled:false,data:null,listeners:new Set(),priorities:new Set(),direct:false};
        entry.promise=new Promise(resolve=>{entry.resolve=resolve;});
        cache.set(key,entry);pending.add(entry);void requestInfo(entry,key);
    }
    if(typeof options.priority==='function'){if(!entry.complete)entry.priorities.add(options.priority);}
    else entry.direct=true;
    if(typeof onUpdate==='function'){
        if(!entry.complete)entry.listeners.add(onUpdate);
        if(entry.data)onUpdate(entry.data);
    }
    return entry.promise;
}
export function createLinkPreview(url,enabled){
    const row=document.createElement('div');row.className='link-preview';
    const fallback=document.createElement('span');fallback.className='site-monogram';fallback.textContent=url.hostname.replace(/^www\./,'').charAt(0).toUpperCase();fallback.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.className='site-title';title.textContent=url.hostname;
    row.append(fallback,title);
    let iconNode=null;
    const render=data=>{
        if(!data){title.textContent=url.hostname+' · 未获取到网页标题';return;}
        title.textContent=data.title||url.hostname;
        if(data.timing){
            const seconds=ms=>(ms/1000).toFixed(2)+' 秒',timing=data.timing,details=[];
            if(Number.isFinite(timing.titleWaitMs))details.push('首次标题等待 '+seconds(timing.titleWaitMs));
            if(Number.isFinite(timing.queueMs))details.push('排队 '+seconds(timing.queueMs));
            if(Number.isFinite(timing.fetchMs))details.push('域名检查与网页响应 '+seconds(timing.fetchMs));
            if(Number.isFinite(timing.parseMs))details.push('头部读取与解析 '+seconds(timing.parseMs));
            if(Number.isFinite(timing.iconMs))details.push('图标 '+seconds(timing.iconMs));
            if(data.iconStatus==='cached')details.push('图标复用本页缓存');
            if(data.iconStatus==='timeout')details.push('图标超时，已保留标题');
            row.title=details.join('；');
        }
        if(data.icon&&!iconNode){
            iconNode=document.createElement('img');iconNode.className='site-icon';iconNode.alt='';iconNode.width=iconNode.height=22;
            iconNode.onerror=()=>{iconNode.replaceWith(fallback);iconNode=null;};iconNode.src=data.icon;fallback.replaceWith(iconNode);
        }
    };
    if(enabled){
        title.textContent=url.hostname+' · 正在获取…';
        const readPriority=()=>{
            if(row.isConnected===false||row.closest?.('[hidden]'))return -1;
            if(!row.getBoundingClientRect)return 1;
            const bounds=row.getBoundingClientRect(),height=globalThis.innerHeight||document.documentElement?.clientHeight||Infinity;
            return bounds.bottom>0&&bounds.top<height?2:0;
        };
        void getLinkInfo(url.href,render,{priority:readPriority}).then(render);
    }
    else title.title='开启联网获取后显示网页标题和图标';
    return row;
}
