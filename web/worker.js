import { semanticRoute } from './server/semantic.js';
import { publicURL, readLimited, metadata, metadataStream } from './server/link-preview.js';

function json(value,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
const DEPLOYMENT_CHECK = 'assets-check-2026-10-24';
function hasAssets(env){return typeof env?.ASSETS?.fetch==='function';}
function assetFailure(code,error){
    // Keep upstream exception details in server logs, never in a public response.
    console.error({event:'static-assets-failure',code,...(error?{message:String(error.message||error)}:{})});
    return new Response(`心裁暂时无法加载。\n诊断代码：${code}\n`,{status:503,headers:{
        'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','X-XinCai-Error':code
    }});
}
async function deploymentStatus(request,env){
    if(request.method!=='GET')return json({error:'仅支持 GET'},405);
    const result={revision:DEPLOYMENT_CHECK,assetsBinding:hasAssets(env)};
    if(!result.assetsBinding)return json({...result,ok:false,code:'assets-binding-missing'},503);
    try{
        // Fetch through the binding, not the public hostname (which would recurse).
        // Do not forward browser credentials, query strings or user content.
        const response=await env.ASSETS.fetch(new Request(new URL('/',request.url)));
        result.homepageStatus=response.status;
        await response.body?.cancel();
        return json({...result,ok:response.status===200,...(response.status===200?{}:{code:'assets-homepage-unavailable'})},response.status===200?200:503);
    }catch(error){
        console.error({event:'deployment-check-failure',message:String(error.message||error)});
        return json({...result,ok:false,code:'assets-fetch-failed'},503);
    }
}
export default {
    async fetch(request,env) {
        const here=new URL(request.url);
        if(!here.pathname.startsWith('/api/')) {
            // Never publish deployment source as an asset, even if exclusions are misconfigured.
            if(here.pathname.startsWith('/server/')||/^\/(?:worker\.js|wrangler\.(?:jsonc?|toml)|\.assetsignore|package(?:-lock)?\.json|\.dev\.vars(?:\..*)?)$/.test(here.pathname))return new Response('Not found',{status:404});
            if(!hasAssets(env))return assetFailure('assets-binding-missing');
            try{return await env.ASSETS.fetch(request);}
            catch(error){return assetFailure('assets-fetch-failed',error);}
        }
        if(here.pathname==='/api/deployment-status')return deploymentStatus(request,env);
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
            if(data.stream===true){
                const known=Array.isArray(data.knownIcons)?data.knownIcons.filter(value=>typeof value==='string'&&value.length<=2048).slice(0,8):[];
                return metadataStream(url.href,here.hostname,request.signal,known);
            }
            return json(await metadata(url.href,here.hostname,request.signal));
        }catch{return json({error:'未能获取网页信息，可能是访问限制、超时或地址不受支持'},422);}
    }
};
