// Compressed mask cache. Persistence adapters export blobs, never model encodings.
export function createMaskCache(maxBytes=128*1024*1024){
 const entries=new Map(),pending=new Map();let bytes=0;
 function insert(id,entry){
  const existing=entries.get(id);
  if(bytes-(existing?.blob.size||0)+entry.blob.size>maxBytes)throw new Error('批次蒙版缓存超过 128 MiB，请先导出并移除部分图片');
  entries.set(id,entry);bytes=bytes-(existing?.blob.size||0)+entry.blob.size;
 }
 return {
  async put(id,result){
   const existing=entries.get(id);if(existing?.revision===result.cacheRevision)return existing;
   const inflight=pending.get(id);if(inflight?.revision===result.cacheRevision)return inflight.promise;
   const raw=new Blob(result.candidates.map(c=>new Uint8Array(c.logits.buffer,c.logits.byteOffset,c.logits.byteLength)));
   const gzip=typeof CompressionStream!=='undefined'&&typeof DecompressionStream!=='undefined';
   const metadata=structuredClone({...result,candidates:result.candidates.map(({logits,...rest})=>rest)});
   const job={revision:result.cacheRevision};pending.set(id,job);
   job.promise=(async()=>{
    try{
     const blob=gzip?await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob():raw;
     const entry={revision:result.cacheRevision,metadata,blob,gzip};
     // A removed image or a newer generation must not be resurrected by an old compression.
     if(pending.get(id)===job)insert(id,entry);
     return entry;
    }finally{if(pending.get(id)===job)pending.delete(id);}
   })();
   return job.promise;
  },
  async get(id){
   const entry=entries.get(id);if(!entry)return null;
   const data=entry.gzip?await new Response(entry.blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():await entry.blob.arrayBuffer();
   const count=entry.metadata.width*entry.metadata.height;
   if(data.byteLength!==count*entry.metadata.candidates.length*4)throw new Error('批次蒙版缓存尺寸无效');
   return {...entry.metadata,candidates:entry.metadata.candidates.map((candidate,index)=>({...candidate,logits:new Float32Array(data,index*count*4,count)}))};
  },
  exportEntries(){return Array.from(entries,([id,entry])=>({id,...entry}));},
  importEntries(saved){
   for(const entry of saved||[]){
    const metadata=entry?.metadata,count=metadata?.width*metadata?.height,candidates=metadata?.candidates;
    if(!Number.isSafeInteger(entry?.id)||entry.id<1||!Number.isSafeInteger(entry.revision)||entry.revision<1||!(entry.blob instanceof Blob)||!Number.isSafeInteger(count)||count<1||count>1024*1024||!Array.isArray(candidates)||!candidates.length||candidates.length>8||!Array.isArray(metadata.order)||![undefined,'logits','alpha'].includes(metadata.valueType))throw new Error('保存的蒙版缓存格式无效');
    if(entry.gzip&&typeof DecompressionStream==='undefined')throw new Error('此浏览器无法恢复压缩蒙版，请使用支持解压的新版浏览器');
    if(!entry.gzip&&entry.blob.size!==count*candidates.length*4)throw new Error('保存的蒙版缓存尺寸无效');
    insert(entry.id,{revision:entry.revision,metadata:structuredClone({...metadata,cacheRevision:entry.revision}),blob:entry.blob,gzip:Boolean(entry.gzip)});
   }
  },
  remove(id){pending.delete(id);const entry=entries.get(id);if(entry){bytes-=entry.blob.size;entries.delete(id);}},
  clear(){pending.clear();entries.clear();bytes=0;},getBytes:()=>bytes
 };
}
export function csvCell(value){const text=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';}
