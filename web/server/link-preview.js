// Public-page metadata only. Never forward cookies, authorization, or upstream HTML.
export function publicURL(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('不支持的地址');
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host) || /\.(localhost|local|internal|lan|home|test|invalid|example)$/.test(host) ||
        host.endsWith('.') || host.split('.').some(part=>!part||part.startsWith('-')||part.endsWith('-'))) throw new Error('仅支持公网域名');
    url.hash='';
    if(url.href.length>2048)throw new Error('地址过长');
    return url;
}
export function publicIP(address) {
    if (address.includes(':')) {
        // Fail closed for non-global IPv6, mapped IPv4 and special-purpose 2001 ranges.
        return /^[23][0-9a-f]{3}:/i.test(address) && !/^200[12]:/i.test(address);
    }
    const parts=address.split('.');
    if(parts.length!==4||!parts.every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255))return false;
    const [a,b,c]=parts.map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||
        (a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===88&&c===99))||
        (a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
}
async function checkDNS(host, signal) {
    const records=await Promise.all(['A','AAAA'].map(async type=>{
        const response=await fetch('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type,
            {headers:{Accept:'application/dns-json'},signal});
        if(!response.ok)throw new Error('域名检查失败');
        const data=await response.json();
        if(data.Status!==0)throw new Error('域名解析失败');
        return (data.Answer||[]).filter(answer=>answer.type===1||answer.type===28).map(answer=>answer.data);
    }));
    const addresses=records.flat();
    if(!addresses.length||addresses.some(address=>!publicIP(address)))throw new Error('地址未通过公网检查');
}
async function safeFetch(value, signal, ownHost, accept, checked = new Map()) {
    let url=publicURL(value);
    for(let hop=0;hop<4;hop++) {
        if(url.hostname===ownHost)throw new Error('不获取本站地址');
        if (!checked.has(url.hostname)) checked.set(url.hostname, checkDNS(url.hostname, signal));
        await checked.get(url.hostname);
        const response=await fetch(url.href,{redirect:'manual',signal,headers:{Accept:accept,'User-Agent':'ImageQRPreview/1.0'}});
        if([301,302,303,307,308].includes(response.status)) {
            const location=response.headers.get('location');await response.body?.cancel();
            if(!location)throw new Error('重定向地址缺失');
            url=publicURL(new URL(location,url).href);continue;
        }
        if(!response.ok){await response.body?.cancel();throw new Error('目标网站拒绝访问');}
        return {response,url};
    }
    throw new Error('重定向次数过多');
}
export async function readLimited(response, limit, truncate=false) {
    const reader=response.body?.getReader();if(!reader)return new Uint8Array();
    const chunks=[];let size=0;
    try {
        while(true){const {done,value}=await reader.read();if(done)break;
            if(size+value.length>limit){if(!truncate)throw new Error('响应过大');chunks.push(value.subarray(0,limit-size));size=limit;await reader.cancel();break;}
            chunks.push(value);size+=value.length;
        }
    } catch(error){await reader.cancel().catch(()=>{});throw error;}
    finally{reader.releaseLock();}
    const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
function imageType(bytes) {
    if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
    if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
    const ascii=String.fromCharCode(...bytes.subarray(0,12));
    if(ascii.startsWith('GIF87a')||ascii.startsWith('GIF89a'))return 'image/gif';
    if(ascii.startsWith('RIFF')&&ascii.slice(8)==='WEBP')return 'image/webp';
    if(bytes.length>=6&&bytes[0]===0&&bytes[1]===0&&bytes[2]===1&&bytes[3]===0&&(bytes[4]||bytes[5]))return 'image/x-icon';
    return null;
}

const headers = {'Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff'};
const ICON_PATTERN = /^data:image\/(?:png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/=]+$/;

export async function readMetadata(response) {
    let title='',ogTitle='',icon='',finished=false,size=0;
    const reader=response.body?.getReader();
    if(!reader)throw new Error('网页没有内容');
    const cancel=()=>{void reader.cancel().catch(()=>{});};
    // Parse as bytes arrive. Closing head/body stops upstream reads; the cap
    // remains for malformed documents with no usable head boundary.
    const limited=new ReadableStream({
        async pull(controller){
            if(finished||size>=384*1024){cancel();controller.close();return;}
            try{
                const chunk=await reader.read();
                if(chunk.done){controller.close();return;}
                const part=chunk.value.subarray(0,384*1024-size);size+=part.length;
                controller.enqueue(part);
            }catch(error){controller.error(error);}
        },
        cancel(){cancel();}
    },{highWaterMark:0});
    const parsed=new HTMLRewriter()
        .on('head',{element(el){el.onEndTag(()=>{finished=true;});}})
        .on('body',{element(){finished=true;}})
        .on('title',{text(chunk){if(title.length<1200)title+=chunk.text;}})
        .on('meta',{element(el){if((el.getAttribute('property')||'').toLowerCase()==='og:title'&&!ogTitle)ogTitle=el.getAttribute('content')||'';}})
        .on('link',{element(el){const rel=(el.getAttribute('rel')||'').toLowerCase().split(/\s+/);if(!icon&&rel.includes('icon'))icon=el.getAttribute('href')||'';}})
        .transform(new Response(limited,{headers:{'content-type':response.headers.get('content-type')}}));
    const output=parsed.body.getReader();
    try{
        while(true){const chunk=await output.read();if(chunk.done)break;if(finished){await output.cancel();break;}}
    }finally{output.releaseLock();cancel();}
    title=(title.trim()||ogTitle).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
    return {title,icon};
}

async function loadTitle(value,ownHost,checked,signal){
    const started=Date.now();
    const {response,url}=await safeFetch(value,signal,ownHost,'text/html,application/xhtml+xml',checked);
    if(!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw new Error('目标不是网页');}
    const received=Date.now(),info=await readMetadata(response);
    let iconURL=null;
    try{iconURL=publicURL(new URL(info.icon||'/favicon.ico',url).href).href;}catch{}
    return {title:info.title||url.hostname,hostname:url.hostname,iconURL,timing:{fetchMs:received-started,parseMs:Date.now()-received}};
}

async function loadIcon(value,ownHost,checked,signal){
    if(!value)return null;
    const {response}=await safeFetch(value,signal,ownHost,'image/png,image/jpeg,image/gif,image/webp,image/x-icon',checked);
    const bytes=await readLimited(response,64*1024),mime=imageType(bytes);
    if(!mime)return null;
    const icon='data:'+mime+';base64,'+btoa(String.fromCharCode(...bytes));
    return ICON_PATTERN.test(icon)?icon:null;
}

function deadline(milliseconds,parent){
    const controller=new AbortController(),abort=()=>controller.abort();
    const timer=setTimeout(abort,milliseconds);
    parent?.addEventListener('abort',abort,{once:true});
    if(parent?.aborted)abort();
    return {signal:controller.signal,close(){clearTimeout(timer);parent?.removeEventListener('abort',abort);controller.abort();}};
}

export function metadataStream(value,ownHost,requestSignal,knownIcons=[]){
    const encoder=new TextEncoder(),lifetime=new AbortController(),checked=new Map();
    const abort=()=>lifetime.abort();requestSignal?.addEventListener('abort',abort,{once:true});
    if(requestSignal?.aborted)abort();
    const body=new ReadableStream({
        start(controller){
            const send=event=>{if(!lifetime.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
            void (async()=>{
                const started=Date.now();
                try{
                    const titleDeadline=deadline(9000,lifetime.signal);
                    let info;
                    try{info=await loadTitle(value,ownHost,checked,titleDeadline.signal);}finally{titleDeadline.close();}
                    send({type:'metadata',...info,icon:null,timing:{...info.timing,titleMs:Date.now()-started}});
                    if(info.iconURL&&knownIcons.includes(info.iconURL))send({type:'icon',iconURL:info.iconURL,cached:true,status:'cached',timing:{iconMs:0,totalMs:Date.now()-started}});
                    else{
                        const iconStarted=Date.now(),iconDeadline=deadline(2000,lifetime.signal);
                        let icon=null,status='unavailable';
                        try{icon=await loadIcon(info.iconURL,ownHost,checked,iconDeadline.signal);if(icon)status='loaded';}catch{if(iconDeadline.signal.aborted)status='timeout';}finally{iconDeadline.close();}
                        send({type:'icon',iconURL:info.iconURL,icon,status,timing:{iconMs:Date.now()-iconStarted,totalMs:Date.now()-started}});
                    }
                }catch{send({type:'error',error:'未能获取网页信息，可能是访问限制、超时或地址不受支持'});}
                finally{
                    requestSignal?.removeEventListener('abort',abort);
                    if(!lifetime.signal.aborted)controller.close();
                }
            })();
        },
        cancel(){lifetime.abort();requestSignal?.removeEventListener('abort',abort);}
    });
    return new Response(body,{headers:{...headers,'Content-Type':'application/x-ndjson; charset=utf-8','Content-Encoding':'identity'}});
}

// Keep the JSON response for old tabs during deployment.
export async function metadata(value,ownHost,signal){
    const checked=new Map(),titleDeadline=deadline(9000,signal);
    let info;
    try{info=await loadTitle(value,ownHost,checked,titleDeadline.signal);}finally{titleDeadline.close();}
    const iconDeadline=deadline(2000,signal);
    let icon=null;
    try{icon=await loadIcon(info.iconURL,ownHost,checked,iconDeadline.signal);}catch{}finally{iconDeadline.close();}
    return {title:info.title,hostname:info.hostname,icon};
}
