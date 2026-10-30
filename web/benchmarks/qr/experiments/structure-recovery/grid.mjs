import fs from 'node:fs/promises';
import path from 'node:path';
import {root,hash,loadImage,decode,valid,crop,remaining} from './runtime.mjs';
import {linearSpectrum,wiener} from './frequency.mjs';
import {analyzeCurvedImage,renderCurvedModel} from '../../../../js/curved-region.js';
import {filterFrequency,spectrum} from '../../../../js/blur-frequency.js';
import {restorationFilters} from '../../../../js/blur-restoration.js';
const opt=(key,fallback)=>process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3)||fallback;
const output=opt('output','benchmarks/qr/results/local-research-grid.jsonl'),restored=process.argv.includes('--restored');
await fs.writeFile(output,'');
for(const row of await remaining()){
 if(opt('files','')&&!opt('files','').split(',').includes(row.file))continue;
 const filename=path.join(root,'test/QRcode',row.file);
 if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Changed image');
 const image=await loadImage(filename);
 for(const region of row.record.regions.filter(r=>!r.covered&&r.crop)){
  const began=performance.now(),scaled=crop(image,region.crop,restored?384:600),record={file:row.file,regionId:region.id,diagnosticOnly:true,cachedDetection:true,models:0,attempts:0,codes:[]};
  const source=spectrum(scaled.image);
  sourceLoop:for(const config of restored?[null,...restorationFilters()]:[null]){
   const data=config?filterFrequency(source,config):scaled.image;
   const {models,diagnostics}=await analyzeCurvedImage(data,{maxPixels:600000,maxModels:12,geometryMs:1000});
   record.models+=models.length;
   for(const model of models){
    const n=model.dimension,gray=new Uint8ClampedArray(n*n*4);
    for(let i=0;i<n*n;i++){gray[i*4]=gray[i*4+1]=gray[i*4+2]=Math.round(255*model.samples[i]);gray[i*4+3]=255;}
    const small=linearSpectrum(new ImageData(gray,n,n)),variants=[{sigma:0},...[.3,.45,.6,.75,.9,1.1].map(sigma=>({sigma,regularization:.01}))];
    for(const gridConfig of variants){
     const filtered=wiener(small,gridConfig),samples=new Float64Array(n*n);
     for(let i=0;i<samples.length;i++)samples[i]=filtered.data[i*4]/255;
     for(const cutoff of [.35,.45,.5,.55,.65,.75]){
      const rendered=renderCurvedModel({...model,samples,cutoff});
      const codes=valid(await decode(new ImageData(rendered.data,rendered.width,rendered.height)));record.attempts++;
      if(codes.length){
       record.selected={config,gridConfig,cutoff,dimension:n,axis:model.axis,curvature:model.curvature};
       record.codes=codes.map(c=>({payloadHash:hash(c.text),points:[c.position.topLeft,c.position.topRight,c.position.bottomRight,c.position.bottomLeft].map(p=>{const v=model.map(p.x/8-4,p.y/8-4);return{x:region.crop.left+v.x*region.crop.width/scaled.canvas.width,y:region.crop.top+v.y*region.crop.height/scaled.canvas.height};})}));
       break sourceLoop;
      }
     }
    }
   }
  }
  scaled.canvas.width=scaled.canvas.height=1;record.elapsedMs=Math.round(performance.now()-began);
  await fs.appendFile(output,JSON.stringify(record)+'\n');console.log(record.file,record.regionId,'models',record.models,'attempts',record.attempts,'codes',record.codes.length,'ms',record.elapsedMs,record.selected||'');
 }
}
