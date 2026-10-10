import {iterateDecodeVariants,clonePointMapper} from './preprocess.js';
import {report} from './runtime-status.js';
let worker=null,disabled=false,sequence=0,owner=null;
const pending=new Map();
function stop(message){
 worker?.terminate();worker=null;
 for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error(message));}pending.clear();
}
function request(type,extra={},transfers=[]){
 return new Promise((resolve,reject)=>{
  const id=++sequence;
  try{
   if(!worker){
    worker=new Worker(new URL('./preprocess-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);data.error?job.reject(new Error(data.error)):job.resolve(data.result);};
    worker.onerror=()=>stop('图像预处理后台线程加载失败');worker.onmessageerror=()=>stop('图像预处理后台线程通信失败');
   }
   const timer=setTimeout(()=>stop('图像预处理后台线程响应超时'),60000);
   pending.set(id,{resolve,reject,timer});worker.postMessage({id,type,...extra},transfers);
  }catch(error){const job=pending.get(id);if(job)clearTimeout(job.timer);pending.delete(id);reject(error);}
 });
}
export function iterateBackgroundVariants(canvas,{curved=true}={}){
 const token={};
 function* compatibility(){for(const variant of iterateDecodeVariants(canvas,{curved})){variant.preprocessBackend='main';yield variant;}}
 async function* generate(){
  let acquired=false;
  // One pipeline at a time. UI normally serializes tasks; concurrent callers use the compatibility path.
  if(disabled||owner||typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'){
   yield* compatibility();return;
  }
  owner=token;
  try{
   const image=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
   await request('init',{width:canvas.width,height:canvas.height,curved,pixels:image.data.buffer},[image.data.buffer]);acquired=true;
   while(true){
    const result=await request('next',{sourceWidth:canvas.width,sourceHeight:canvas.height});if(result.done)break;
    const variant={name:result.name,imageData:new ImageData(new Uint8ClampedArray(result.pixels),result.width,result.height),scaleX:result.scaleX,scaleY:result.scaleY,releaseAfterDecode:true,preprocessBackend:'worker'};
    if(result.mapping){const m=result.mapping;variant.mapPoint=clonePointMapper(m.width,m.height,m.direction,m.curvature);}
    yield variant;
   }
  }catch(error){
   disabled=true;stop(error.message);acquired=false;
   console.warn('[后台预处理] 切换兼容模式：',error);
   report('zxing','后台预处理不可用，改用兼容模式');
   // Restart all transforms: existing decoder deduplication handles any completed passes.
   yield* compatibility();
  }finally{
   if(acquired&&worker)try{await request('release');}catch(error){stop(error.message);}
   if(owner===token)owner=null;
  }
 }
 const iterator=generate();iterator.length=curved?7:5;return iterator;
}
