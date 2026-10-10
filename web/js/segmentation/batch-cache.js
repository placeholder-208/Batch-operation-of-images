// Session-only compressed mask cache. No IndexedDB, localStorage or image upload.
export function createMaskCache(maxBytes=128*1024*1024){
 const entries=new Map();let bytes=0;
 return {
  async put(id,result){
   const existing=entries.get(id);if(existing?.revision===result.cacheRevision)return;
   const raw=new Blob(result.candidates.map(c=>new Uint8Array(c.logits.buffer,c.logits.byteOffset,c.logits.byteLength)));
   const gzip=typeof CompressionStream!=='undefined'&&typeof DecompressionStream!=='undefined';
   const blob=gzip?await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob():raw;
   if(bytes-(existing?.blob.size||0)+blob.size>maxBytes)throw new Error('批次蒙版缓存超过 128 MiB，请先导出并移除部分图片');
   const metadata={...result,candidates:result.candidates.map(({logits,...rest})=>rest)};
   entries.set(id,{revision:result.cacheRevision,metadata,blob,gzip});bytes=bytes-(existing?.blob.size||0)+blob.size;
  },
  async get(id){
   const entry=entries.get(id);if(!entry)return null;
   const data=entry.gzip?await new Response(entry.blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():await entry.blob.arrayBuffer();
   const count=entry.metadata.width*entry.metadata.height;
   if(data.byteLength!==count*entry.metadata.candidates.length*4)throw new Error('批次蒙版缓存尺寸无效');
   return {...entry.metadata,candidates:entry.metadata.candidates.map((candidate,index)=>({...candidate,logits:new Float32Array(data,index*count*4,count)}))};
  },
  remove(id){const entry=entries.get(id);if(entry){bytes-=entry.blob.size;entries.delete(id);}},
  clear(){entries.clear();bytes=0;},getBytes:()=>bytes
 };
}
export function csvCell(value){const text=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';}
