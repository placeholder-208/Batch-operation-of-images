// Offline diagnostic only: ground-truth coordinates must never feed product decoding.
import {createHash} from 'node:crypto';
import {perspectiveCrop} from '../../js/crop.js';
import {iterateBackgroundVariants} from '../../js/preprocess-client.js';

export async function diagnoseKnownPositions(canvas,polygons,readBarcodes){
 const targets=[];
 for(const [target,points]of polygons.entries()){
  let crop;
  const result={target,decoded:false,attempts:[]};
  try{
   crop=perspectiveCrop(canvas,points,20);
   for await(const variant of iterateBackgroundVariants(crop)){
    try{
     const raw=await readBarcodes(variant.imageData,{formats:['QRCode'],tryHarder:true,returnErrors:true});
     result.attempts.push({name:variant.name,results:raw.map(r=>({valid:r.isValid,
      error:r.error,hasPosition:!!r.position,
      payloadHash:r.isValid!==false&&r.text?createHash('sha256').update(r.text).digest('hex'):null}))});
     if(raw.some(r=>r.isValid!==false&&r.text)){result.decoded=true;break;}
    }finally{if(variant.releaseAfterDecode)variant.imageData=null;}
   }
  }catch(error){result.error=error.message||String(error);result.status='error';}
  finally{if(crop)crop.width=crop.height=1;}
  targets.push(result);
 }
 return targets;
}
