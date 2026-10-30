import {analyzeCurvedImage,renderCurvedModel} from './curved-region.js';
import {fitStructureLevels} from './structure-sampling.js';
import {readBarcodes} from './reader-client.js';
import {measureQR,measureQRSync} from './qr-statistics.js';
export const DENSE_SAMPLING_LIMITS=Object.freeze({maxRegions:2,maxPixels:360000,maxModels:24,maxAttempts:160,regionMs:1500,imageMs:3000});
const phases=[-.3,-.15,0,.15,.3],cutoffs=[.5,.6,.7,.4,.75];
export function sampleGray(gray,width,height,p){
 if(!Number.isFinite(p.x+p.y)||p.x<0||p.y<0||p.x>width-1||p.y>height-1)return NaN;
 const x=Math.floor(p.x),y=Math.floor(p.y),xx=Math.min(width-1,x+1),yy=Math.min(height-1,y+1),fx=p.x-x,fy=p.y-y;
 return (1-fy)*((1-fx)*gray[y*width+x]+fx*gray[y*width+xx])+fy*((1-fx)*gray[yy*width+x]+fx*gray[yy*width+xx]);
}
export function rankDensePhases(models,gray,width,height,expired=()=>false){
 const result=[];
 for(const model of models.slice(0,DENSE_SAMPLING_LIMITS.maxModels)){
  if(model.dimension>85)continue;
  for(const px of phases)for(const py of phases){
   if(expired())return result.sort((a,b)=>b.calibration.score-a.calibration.score);
   const shifted={...model,map:(x,y)=>model.map(x+px,y+py)},calibration=fitStructureLevels(shifted,gray,width,height);
   if(calibration)result.push({model:shifted,calibration,px,py});
  }
 }
 return result.sort((a,b)=>b.calibration.score-a.calibration.score);
}
export async function decodeDenseSampling(source,crop,{trace,regionId,statistics={},budgetMs=DENSE_SAMPLING_LIMITS.regionMs,accept=()=>true}={}){
 const began=performance.now(),expired=()=>performance.now()-began>=budgetMs;
 Object.assign(statistics,{status:'pending',attempted:0,decoded:0});
 if(crop.width*crop.height>DENSE_SAMPLING_LIMITS.maxPixels){Object.assign(statistics,{status:'skipped',reason:'dense-phase-size-budget'});return [];}
 const canvas=document.createElement('canvas');canvas.width=crop.width;canvas.height=crop.height;
 try{
  const image=measureQRSync(trace,'dense_phase_prepare',{regionId},()=>{
   const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(source,crop.left,crop.top,crop.width,crop.height,0,0,canvas.width,canvas.height);
   return c.getImageData(0,0,canvas.width,canvas.height);
  }),w=image.width,h=image.height;
  const gray=Float64Array.from({length:w*h},(_,i)=>{const a=image.data[i*4+3]/255;return a*(.299*image.data[i*4]+.587*image.data[i*4+1]+.114*image.data[i*4+2])+255*(1-a);});
  const {models}=await measureQR(trace,'dense_phase_geometry',{regionId},()=>analyzeCurvedImage(image,{maxPixels:DENSE_SAMPLING_LIMITS.maxPixels,maxModels:DENSE_SAMPLING_LIMITS.maxModels,geometryMs:Math.max(100,Math.min(600,budgetMs))}));
  const variants=measureQRSync(trace,'dense_phase_sample',{regionId,step:'rank'},()=>rankDensePhases(models,gray,w,h,expired));
  statistics.models=models.length;statistics.phases=variants.length;
  for(const {model,calibration,px,py}of variants){
   if(expired()||statistics.attempted>=DENSE_SAMPLING_LIMITS.maxAttempts)break;
   const n=model.dimension,samples=measureQRSync(trace,'dense_phase_sample',{regionId,step:'sample'},()=>Float64Array.from({length:n*n},(_,i)=>(sampleGray(gray,w,h,model.map(i%n+.5,Math.floor(i/n)+.5))-calibration.black)/calibration.gap));
   if(!samples.every(Number.isFinite))continue;
   for(const cutoff of cutoffs){
    if(expired()||statistics.attempted>=DENSE_SAMPLING_LIMITS.maxAttempts)break;
    const rendered=measureQRSync(trace,'dense_phase_sample',{regionId,step:'render'},()=>renderCurvedModel({...model,samples,cutoff}));
    statistics.attempted++;
    const raw=await measureQR(trace,'dense_phase_decode',{regionId},()=>readBarcodes(new ImageData(rendered.data,rendered.width,rendered.height),{formats:['QRCode'],tryHarder:true}));
    const found=raw.filter(r=>r.isValid!==false&&r.position).map(r=>{
     const points=[r.position.topLeft,r.position.topRight,r.position.bottomRight,r.position.bottomLeft].map(p=>model.map(p.x/8-4,p.y/8-4)).map(p=>({x:p.x+crop.left,y:p.y+crop.top}));
     return {text:r.text||'',format:r.format||'QRCode',points,center:{x:points.reduce((s,p)=>s+p.x,0)/4,y:points.reduce((s,p)=>s+p.y,0)/4},source:'wechat-dense-phase'};
    });
    if(found.length&&accept(found)){Object.assign(statistics,{status:'decoded',reason:null,decoded:found.length,selection:{px,py,cutoff,dimension:n,axis:model.axis,curvature:model.curvature,score:calibration.score}});return found;}
   }
  }
  const limited=expired()||statistics.attempted>=DENSE_SAMPLING_LIMITS.maxAttempts;
  Object.assign(statistics,{status:limited?'skipped':'undecoded',reason:limited?'dense-phase-budget':'dense-phase-undecodable'});return [];
 }finally{canvas.width=canvas.height=1;statistics.elapsedMs=performance.now()-began;}
}
