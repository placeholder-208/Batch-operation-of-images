import { encodeImage, releaseEncoding, segmentBox } from './runtime.js';
let encoded=null, generation=0, queue=Promise.resolve();
self.onmessage=({data})=>{
 queue=queue.then(async()=>{
  const {id,type}=data;
  try {
   let result;
   if(type==='encode') {
    if(typeof OffscreenCanvas==='undefined')throw new Error('此浏览器不支持后台画布，请使用新版 Chrome、Edge 或 Firefox');
    releaseEncoding(encoded);encoded=null;
    const canvas=new OffscreenCanvas(data.width,data.height);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.pixels),data.width,data.height),0,0);
    encoded=await encodeImage(canvas,text=>self.postMessage({id,type:'progress',text}));
    generation++;result={handle:generation,width:encoded.width,height:encoded.height,elapsedMs:encoded.elapsedMs};
   } else if(type==='segment') {
    if(!encoded||data.handle!==generation)throw new Error('图像编码已失效，请重新生成蒙版');
    result=await segmentBox(encoded,data.box,data.points,data.width,data.height);
   } else if(type==='release') {
    if(data.handle===generation){releaseEncoding(encoded);encoded=null;}result=null;
   } else throw new Error('未知分割操作');
   const transfers=type==='segment'?result.candidates.map(c=>c.logits.buffer):[];
   self.postMessage({id,type:'result',result},transfers);
  }catch(error){self.postMessage({id,type:'error',error:error.message||String(error)});}
 }).catch(error=>console.error('[本地分割后台线程]',error));
};
