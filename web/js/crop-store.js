import {canvasToBlob} from './image.js';
export async function storeCrop(canvas,id){
 try{
  const blob=await canvasToBlob(canvas);
  return {id,blob,image:URL.createObjectURL(blob),width:canvas.width,height:canvas.height};
 }finally{canvas.width=canvas.height=1;}
}
export function releaseCrops(result){
 for(const crop of result?.crops||[]){if(crop.blob&&crop.image)URL.revokeObjectURL(crop.image);if(crop.canvas)crop.canvas.width=crop.canvas.height=1;}
}
export async function cropBlob(crop){return crop.blob||await canvasToBlob(crop.canvas);}
