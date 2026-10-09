let worker=null,sequence=0;
const pending=new Map();
function getWorker(){
 if(worker)return worker;
 if(typeof Worker==='undefined')throw new Error('此浏览器不支持后台分割，请使用新版浏览器');
 worker=new Worker(new URL('./inference-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  const job=pending.get(data.id);if(!job)return;
  if(data.type==='progress'){job.report?.(data.text);return;}
  pending.delete(data.id);
  data.type==='error'?job.reject(new Error(data.error)):job.resolve(data.result);
 };
 const fail=()=>{
  for(const job of pending.values())job.reject(new Error('分割后台线程加载失败或内存不足，请刷新后重试'));
  pending.clear();worker?.terminate();worker=null;
 };
 worker.onerror=fail;worker.onmessageerror=fail;
 return worker;
}
function request(type,data={},transfers=[],report){
 return new Promise((resolve,reject)=>{
  const id=++sequence;
  try{const target=getWorker();pending.set(id,{resolve,reject,report});target.postMessage({id,type,...data},transfers);}
  catch(error){pending.delete(id);reject(error);}
 });
}
export function encodeImage(canvas,report){
 const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
 return request('encode',{width:canvas.width,height:canvas.height,pixels:pixels.buffer},[pixels.buffer],report);
}
export function segmentBox(encoded,box,points,width,height){
 return request('segment',{handle:encoded.handle,box,points,width,height});
}
export function releaseEncoding(encoded){
 if(encoded&&worker)request('release',{handle:encoded.handle}).catch(error=>console.warn('[释放分割编码]',error));
}
