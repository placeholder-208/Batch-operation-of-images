import { semanticRoute } from './server/semantic.js';

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
async function safeFetch(value, signal, ownHost, accept) {
    let url=publicURL(value);
    for(let hop=0;hop<4;hop++) {
        if(url.hostname===ownHost)throw new Error('不获取本站地址');
        await checkDNS(url.hostname,signal);
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
async function metadata(value, ownHost) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),10000);
    try {
        const {response,url}=await safeFetch(value,controller.signal,ownHost,'text/html,application/xhtml+xml');
        if(!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw new Error('目标不是网页');}
        const bytes=await readLimited(response,384*1024,true);
        let title='',ogTitle='',icon='';
        await new HTMLRewriter()
            .on('title',{text(chunk){if(title.length<1200)title+=chunk.text;}})
            .on('meta',{element(el){if((el.getAttribute('property')||'').toLowerCase()==='og:title'&&!ogTitle)ogTitle=el.getAttribute('content')||'';}})
            .on('link',{element(el){const rel=(el.getAttribute('rel')||'').toLowerCase().split(/\s+/);if(!icon&&rel.includes('icon'))icon=el.getAttribute('href')||'';}})
            .transform(new Response(bytes,{headers:{'content-type':response.headers.get('content-type')}})).arrayBuffer();
        title=(title.trim()||ogTitle).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
        let iconData=null;
        try {
            const iconURL=icon?new URL(icon,url):new URL('/favicon.ico',url);
            const fetched=await safeFetch(iconURL.href,controller.signal,ownHost,'image/png,image/jpeg,image/gif,image/webp,image/x-icon');
            const iconBytes=await readLimited(fetched.response,64*1024),mime=imageType(iconBytes);
            if(mime)iconData='data:'+mime+';base64,'+btoa(String.fromCharCode(...iconBytes));
        }catch{/* A missing or blocked icon does not invalidate the title. */}
        return {title:title||url.hostname,hostname:url.hostname,icon:iconData};
    }finally{clearTimeout(timer);controller.abort();}
}
function json(value,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export default {
    async fetch(request,env) {
        const here=new URL(request.url);
        if(!here.pathname.startsWith('/api/')) {
            // Never publish deployment source as an asset, even if exclusions are misconfigured.
            if(here.pathname.startsWith('/server/')||/^\/(?:worker\.js|wrangler\.(?:jsonc?|toml)|\.assetsignore|package(?:-lock)?\.json|\.dev\.vars(?:\..*)?)$/.test(here.pathname))return new Response('Not found',{status:404});
            return env.ASSETS.fetch(request);
        }
        if(here.pathname==='/api/semantic-detect')return semanticRoute(request,env);
        if(here.pathname!=='/api/link-preview')return json({error:'接口不存在'},404);
        if(request.method!=='POST')return json({error:'仅支持 POST'},405);
        if(request.headers.get('origin')!==here.origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'仅接受本站请求'},403);
        if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return json({error:'需要 JSON 请求'},415);
        if(env.LINK_PREVIEW_LIMITER){const result=await env.LINK_PREVIEW_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});if(!result.success)return json({error:'请求较多，请稍后重试'},429);}
        try {
            const input=new TextDecoder().decode(await readLimited(request,4096));
            const data=JSON.parse(input);if(typeof data.url!=='string')return json({error:'缺少网址'},400);
            const url=publicURL(data.url);
            return json(await metadata(url.href,here.hostname));
        }catch{return json({error:'未能获取网页信息，可能是访问限制、超时或地址不受支持'},422);}
    }
};
