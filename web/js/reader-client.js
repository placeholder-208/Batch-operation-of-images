let worker=null,disabled=false,sequence=0;
const pending=new Map();
function stop(message){
 worker?.terminate();worker=null;
 for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error(message));}pending.clear();
}
function request(image,options){
 return new Promise((resolve,reject)=>{
  const id=++sequence;
  try{
   if(!worker){
    worker=new Worker(new URL('./reader-worker.js',import.meta.url));
    worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);data.error?job.reject(new Error(data.error)):job.resolve(data.result);};
    worker.onerror=()=>stop('后台 ZXing 加载失败');worker.onmessageerror=()=>stop('后台 ZXing 通信失败');
   }
   // Keep the caller's pixels intact: fallback and geometry refinement may still need them.
   const pixels=image.data.slice().buffer;
   const timer=setTimeout(()=>stop('后台 ZXing 解码响应超时'),120000);
   pending.set(id,{resolve,reject,timer});worker.postMessage({id,width:image.width,height:image.height,pixels,options},[pixels]);
  }catch(error){const job=pending.get(id);if(job)clearTimeout(job.timer);pending.delete(id);reject(error);}
 });
}
export function getReaderBackend(){return !disabled&&typeof Worker!=='undefined'?'worker':'main';}
export async function readBarcodes(image,options){
 if(getReaderBackend()==='worker')try{return await request(image,options);}catch(error){
  disabled=true;stop(error.message);console.warn('[后台 ZXing] 切换兼容解码：',error);
 }
 if(!window.ZXingWASM?.readBarcodes)throw new Error('ZXing 解码接口不可用');
 return window.ZXingWASM.readBarcodes(image,options);
}
