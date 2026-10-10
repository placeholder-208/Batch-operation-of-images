import {iterateDecodeVariants} from './preprocess.js';
let iterator=null,sourceSize=null;
function release(){iterator?.return?.();iterator=null;}
self.onmessage=({data})=>{
 const {id,type}=data;
 try{
  if(type==='init'){
   release();sourceSize=[data.width,data.height];const image=new ImageData(new Uint8ClampedArray(data.pixels),data.width,data.height);
   // A lightweight adapter avoids another full-resolution worker-side canvas.
   const source={width:data.width,height:data.height,getContext:()=>({getImageData:()=>image})};
   iterator=iterateDecodeVariants(source,{curved:data.curved});
   self.postMessage({id,result:{ready:true}});
  }else if(type==='next'){
   if(!iterator)throw new Error('后台预处理未初始化');
   const step=iterator.next();
   if(step.done){release();self.postMessage({id,result:{done:true}});return;}
   const variant=step.value;
   // The pipeline reuses contrast/source buffers. Transfer a copy, not a still-needed buffer.
   const pixels=variant.imageData.data.slice().buffer;
   const result={done:false,name:variant.name,width:variant.imageData.width,height:variant.imageData.height,scaleX:variant.scaleX,scaleY:variant.scaleY,pixels};
   if(variant.name.startsWith('cylindrical-'))result.mapping={width:sourceSize[0],height:sourceSize[1],direction:variant.name.slice('cylindrical-'.length),curvature:.55};
   self.postMessage({id,result},[pixels]);
  }else if(type==='release'){release();self.postMessage({id,result:{released:true}});}
  else throw new Error('未知后台预处理操作');
 }catch(error){release();self.postMessage({id,error:error.message||String(error)});}
};
