// Diagnostic: expand the observed ROI's luminance range before topology fitting.
import fs from 'node:fs/promises';
import path from 'node:path';
import {root,hash,loadImage,crop,createCPP,metrics} from '../decoder-comparison/common.mjs';
import {restorationFilters} from '../../../../js/blur-restoration.js';
import {spectrum,filterFrequency} from '../../../../js/blur-frequency.js';
import {analyzeCurvedImage,decodeCurvedRegion} from '../../../../js/curved-region.js';
const baseline=(await fs.readFile('benchmarks/qr/results/local-production-3.14-detailed-results.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const manifest=JSON.parse(await fs.readFile('benchmarks/qr/results/local-manifest.json','utf8'));
const reader=await createCPP(),output='benchmarks/qr/results/local-finder-tone.jsonl';
await fs.writeFile(output,'');
const log=console.log.bind(console);console.log=()=>{};
function stretch(image,tail){
 const gray=new Uint8ClampedArray(image.width*image.height),hist=new Uint32Array(256);
 for(let i=0;i<gray.length;i++){const p=i*4,a=image.data[p+3]/255;gray[i]=a*(.299*image.data[p]+.587*image.data[p+1]+.114*image.data[p+2])+255*(1-a);hist[gray[i]]++;}
 const percentile=p=>{let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=gray.length*p)return i;}return 255;};
 const lo=percentile(tail),hi=percentile(1-tail),data=new Uint8ClampedArray(image.data.length);
 for(let i=0;i<gray.length;i++){const v=255*(gray[i]-lo)/Math.max(1,hi-lo);data[i*4]=data[i*4+1]=data[i*4+2]=v;data[i*4+3]=255;}
 return {image:new ImageData(data,image.width,image.height),lo,hi};
}
for(const row of baseline.filter(r=>r.matched<r.groundTruth)){
 const filename=path.join(root,'test/QRcode',row.file);if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Changed image');
 const original=await loadImage(filename);
 for(const region of row.record.regions.filter(r=>!r.covered&&r.crop)){
  const began=performance.now(),record={file:row.file,regionId:region.id,diagnosticOnly:true,cachedDetection:true,attempts:[],codes:[]};
  const working=crop(original,region.crop,384),ctx=working.canvas.getContext('2d');
  outer:for(const tail of [.02,.1]){
   const enhanced=stretch(working.image,tail),input=spectrum(enhanced.image);
   for(const config of [null,...restorationFilters()]){
    const image=config?filterFrequency(input,config):enhanced.image;
    const raw=await reader.decode(image);
    let found=raw.map(c=>({payloadHash:hash(c.text),points:c.points.map(working.map)}));
    const stats={};
    if(!found.length){
     const probe=await analyzeCurvedImage(image,{probeOnly:true,geometryMs:200});
     if(probe.diagnostics.finders.length===3){
      ctx.putImageData(image,0,0);
      const corrected=await decodeCurvedRegion(working.canvas,{continuousResample:true,moduleRecovery:true,maxModels:12,geometryMs:600,statistics:stats});
      found=corrected.map(c=>({payloadHash:hash(c.text),points:c.points.map(working.map)}));
     }else Object.assign(stats,probe.diagnostics);
    }
    record.attempts.push({tail,lo:enhanced.lo,hi:enhanced.hi,config,models:stats.models,reason:stats.reason,finders:stats.finders?.length,decoded:found.length});
    if(found.length){record.codes=found;record.selected=record.attempts.at(-1);break outer;}
   }
  }
  working.canvas.width=working.canvas.height=1;record.elapsedMs=Math.round(performance.now()-began);
  Object.assign(record,metrics(record.codes,manifest.entries.find(e=>e.hash===row.sha256).polygons));
  await fs.appendFile(output,JSON.stringify(record)+'\n');log(row.file,region.id,'codes',record.codes.length,'models',record.attempts.reduce((n,a)=>n+(a.models||0),0),'ms',record.elapsedMs,record.selected||'');
 }
}
