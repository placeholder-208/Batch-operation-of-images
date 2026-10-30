import {analyzeCurvedImage,renderCurvedModel} from '/js/curved-region.js';
import {fitStructureLevels} from '/js/structure-sampling.js';
import {readBarcodes} from '/js/reader-client.js';
export async function probe(canvas){
 const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),w=image.width,h=image.height;
 const gray=Float64Array.from({length:w*h},(_,i)=>.299*image.data[i*4]+.587*image.data[i*4+1]+.114*image.data[i*4+2]);
 const at=p=>{const x=Math.max(0,Math.min(w-1,p.x)),y=Math.max(0,Math.min(h-1,p.y)),xx=Math.floor(x),yy=Math.floor(y),fx=x-xx,fy=y-yy;return (1-fy)*((1-fx)*gray[yy*w+xx]+fx*gray[yy*w+Math.min(w-1,xx+1)])+fy*((1-fx)*gray[Math.min(h-1,yy+1)*w+xx]+fx*gray[Math.min(h-1,yy+1)*w+Math.min(w-1,xx+1)]);};
 const {models}=await analyzeCurvedImage(image,{maxPixels:360000,maxModels:48,geometryMs:2500}),variants=[];
 for(const model of models)for(const px of [-.3,-.15,0,.15,.3])for(const py of [-.3,-.15,0,.15,.3]){
  const shifted={...model,map:(x,y)=>model.map(x+px,y+py)},calibration=fitStructureLevels(shifted,gray,w,h);
  if(calibration)variants.push({model:shifted,calibration,px,py});
 }
 variants.sort((a,b)=>b.calibration.score-a.calibration.score);
 let attempts=0;const begin=performance.now();
 for(const {model,calibration,px,py}of variants){
  const n=model.dimension,samples=Float64Array.from({length:n*n},(_,i)=>(at(model.map(i%n+.5,Math.floor(i/n)+.5))-calibration.black)/calibration.gap);
  for(const cutoff of [.5,.6,.7,.4,.75]){
   const r=renderCurvedModel({...model,samples,cutoff});
   for(const isPure of [false,true]){
    attempts++;const found=await readBarcodes(new ImageData(r.data,r.width,r.height),{formats:['QRCode'],tryHarder:true,isPure});
    if(found.some(x=>x.isValid!==false))return {decoded:true,attempts,ms:performance.now()-begin,px,py,cutoff,isPure,axis:model.axis,curvature:model.curvature,score:calibration.score};
   }
  }
 }
 return {decoded:false,attempts,ms:performance.now()-begin};
}
