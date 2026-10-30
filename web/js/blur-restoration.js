import {spectrum,filterFrequency} from './blur-frequency.js';
import {readBarcodes} from './reader-client.js';
import {measureQR,measureQRSync} from './qr-statistics.js';

export const RESTORATION_LIMITS=Object.freeze({baseEdge:384,maxEdge:448,detailedEdge:576,maxRegions:3,
 regionMs:1500,imageMs:4500,detailedRegionMs:3500,detailedImageMs:10500,filters:22,detailedFilters:39});
const gaussian=[1,1.5,2,2.5,3].map(sigma=>({sigma,regularization:.01}));
const filters=[...gaussian];
for(const length of [5,9,13])for(const angle of [0,45,90,135])filters.push({length,angle,sigma:.6,regularization:.02});
export const restorationFilters=()=>filters.map(config=>({...config}));

export async function decodeBlurredRegion(sourceCanvas,crop,{trace,regionId,statistics={},budgetMs=1500,
 detailedRecovery=false,accept=()=>true}={}){
 const began=performance.now(),decoded=[],canvas=document.createElement('canvas');
 Object.assign(statistics,{attempted:0,filtersAttempted:0,decoded:0,status:'pending',reason:null,
  maxFilters:detailedRecovery?RESTORATION_LIMITS.detailedFilters:RESTORATION_LIMITS.filters,tiers:[]});
 const tiers=[{edge:RESTORATION_LIMITS.baseEdge,filters},{edge:RESTORATION_LIMITS.maxEdge,filters:gaussian}];
 if(detailedRecovery)tiers.push({edge:RESTORATION_LIMITS.detailedEdge,filters});
 const nativeEdge=Math.max(crop.width,crop.height);let previousEdge=0;
 const expired=()=>performance.now()-began>=budgetMs;
 const skip=()=>Object.assign(statistics,{status:'skipped',reason:'restoration-budget'});
 try{
  for(const tier of tiers){
   const actualEdge=Math.min(nativeEdge,tier.edge);
   if(actualEdge<=previousEdge)continue;
   if(previousEdge&&expired()){skip();return decoded;}
   previousEdge=actualEdge;
   const tierRecord={edge:tier.edge,actualEdge,attempted:0,filtersAttempted:0};statistics.tiers.push(tierRecord);
   const scale=actualEdge/nativeEdge;
   canvas.width=Math.max(1,Math.round(crop.width*scale));canvas.height=Math.max(1,Math.round(crop.height*scale));
   const sx=canvas.width/crop.width,sy=canvas.height/crop.height;
   const image=measureQRSync(trace,'deblur_prepare',{regionId,edge:tier.edge},()=>{
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(sourceCanvas,crop.left,crop.top,crop.width,crop.height,0,0,canvas.width,canvas.height);
    return context.getImageData(0,0,canvas.width,canvas.height);
   });
   const attempt=async(image,config)=>{
    const raw=await measureQR(trace,'deblur_decode',{regionId,edge:tier.edge,config},()=>readBarcodes(image,{formats:['QRCode'],tryHarder:true}));
    statistics.attempted++;tierRecord.attempted++;
    if(config){statistics.filtersAttempted++;tierRecord.filtersAttempted++;}
    const found=raw.filter(r=>r.isValid!==false&&r.text&&r.position).map(r=>{
     const points=[r.position.topLeft,r.position.topRight,r.position.bottomRight,r.position.bottomLeft]
      .map(p=>({x:crop.left+p.x/sx,y:crop.top+p.y/sy}));
     return {text:r.text,format:r.format||'QRCode',points,
      center:{x:points.reduce((s,p)=>s+p.x,0)/4,y:points.reduce((s,p)=>s+p.y,0)/4},
      source:config?'wechat-local-restored':'wechat-local-resized'};
    }).filter(r=>r.points.every(p=>Number.isFinite(p.x+p.y)));
    decoded.push(...found);statistics.decoded=decoded.length;
    if(found.length&&accept(found)){
     Object.assign(statistics,{status:'decoded',reason:null,selectedFilter:config,selectedEdge:tier.edge,actualEdge});return true;
    }
    return false;
   };
   if(await attempt(image,null))return decoded;
   if(expired()){skip();return decoded;}
   const input=measureQRSync(trace,'deblur_prepare',{regionId,edge:tier.edge,step:'fft'},()=>spectrum(image));
   const ratio=actualEdge/Math.min(RESTORATION_LIMITS.baseEdge,nativeEdge);
   for(const base of tier.filters){
    if(expired()){skip();return decoded;}
    const config={...base};for(const key of ['sigma','length'])if(config[key]!==undefined)config[key]*=ratio;
    const restored=measureQRSync(trace,'deblur_restore',{regionId,edge:tier.edge,config},()=>filterFrequency(input,config));
    if(await attempt(restored,config))return decoded;
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  Object.assign(statistics,{status:'undecoded',reason:'restoration-undecodable'});return decoded;
 }catch(error){Object.assign(statistics,{status:'error',reason:'runtime-error',error:error.message||String(error)});throw error;}
 finally{canvas.width=canvas.height=1;statistics.elapsedMs=Math.round(performance.now()-began);}
}
