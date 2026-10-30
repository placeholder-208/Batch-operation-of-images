import fs from 'node:fs/promises';
import path from 'node:path';
import {root,hash,loadImage,crop,metrics,opt,createCPP,ImageData,createCanvas}from'../decoder-comparison/common.mjs';
import {analyzeCurvedImage,renderCurvedModel}from'../../../../js/curved-region.js';
import {spectrum,filterFrequency}from'../../../../js/blur-frequency.js';
import {restorationFilters}from'../../../../js/blur-restoration.js';
import {finderQuality}from'../../../../js/restored-geometry.js';
import {rankPhaseAdjustments,resample,imageGray,structureScore,localExtremaGrid}from'./sampling.mjs';
const reader=await createCPP(),names=opt('files','').split(',').filter(Boolean),maxTrials=Number(opt('max-trials','1200'));
const calibratedOnly=process.argv.includes('--calibrated-only');
if(process.argv.includes('--control-only')){
 const imported=await import(process.env.QR_ZXING_JS_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/@zxing/library/cjs/index.js');
 const z=imported.QRCodeWriter?imported:imported.default,text='xincai-functional-sampling-control';
 const matrix=new z.QRCodeWriter().encode(text,z.BarcodeFormat.QR_CODE,0,0,new Map([[z.EncodeHintType.MARGIN,0]]));
 const n=matrix.getWidth(),samples=Float64Array.from({length:n*n},(_,i)=>1-Number(matrix.get(i%n,Math.floor(i/n))));
 const rendered=renderCurvedModel({dimension:n,samples,cutoff:.5}),image=new ImageData(rendered.data,rendered.width,rendered.height),gray=imageGray(image),before=hash(gray);
 const model={dimension:n,moduleSize:8,map:(x,y)=>({x:(x+4)*8-.5,y:(y+4)*8-.5})};
 const fit=structureScore(model,gray,image.width,image.height,{});
 if(!fit||fit.score<.9999||Math.abs(fit.black)>1e-8||Math.abs(fit.white-255)>1e-8)throw Error('Functional structure control failed');
 const recovered=resample(model,fit,gray,image.width,image.height,{radius:0});
 if(!recovered.every((v,i)=>Math.abs(v-samples[i])<1e-8)||hash(gray)!==before)throw Error('Functional samples identity failed');
 const output=renderCurvedModel({...model,samples:recovered,cutoff:.7});
 const found=await reader.decode(new ImageData(output.data,output.width,output.height));
 if(found.length!==1||found[0].text!==text)throw Error('Clean decoding control failed');
 if(structureScore(model,new Float64Array(gray.length).fill(255),image.width,image.height,{})!==null)throw Error('Flat image was accepted');
 const old=localExtremaGrid(model,gray,image.width,image.height,{radius:.22});
 if(!old.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Old normalization returned invalid values');
 // A white neighborhood with no black reference is deliberately not an
 // identity case for local min/max normalization. Measure, do not assume it.
 const changedOldModules=old.filter((v,i)=>Math.abs(v-samples[i])>1e-8).length;
 console.log('PASS: known-pattern fit, clean decoding, caller immutability, flat rejection and finite old normalization.',{changedOldModules});
 process.exit(0);
}
const output=opt('output',calibratedOnly?'/tmp/xincai-sampling-calibrated.jsonl':'/tmp/xincai-sampling-results.jsonl');await fs.writeFile(output,'');
const baseline=(await fs.readFile('benchmarks/qr/results/local-production-3.14-detailed-results.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const manifest=JSON.parse(await fs.readFile('benchmarks/qr/results/local-manifest.json','utf8'));
const targets=new Map([['blurred/image005.jpg',new Set([2,3])],['blurred/image020.jpg',new Set([3])],['blurred/image036.jpg',new Set([1])],['blurred/image037.jpg',new Set([1])]]);
for(const row of baseline){
 if(!targets.has(row.file)||names.length&&!names.includes(row.file))continue;
 const filename=path.join(root,'test/QRcode',row.file);if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Changed image');
 const original=await loadImage(filename),entry=manifest.entries.find(e=>e.hash===row.sha256);
 for(const region of row.record.regions.filter(r=>targets.get(row.file).has(r.id))){
  const began=performance.now(),working=crop(original,region.crop,384),record={file:row.file,regionId:region.id,sha256:row.sha256,cachedDetection:true,diagnosticOnly:true,
   maxTrials,calibratedOnly,probes:[],fitting:[],ranking:[],attempts:0,errors:[],codes:[]};
  const input=spectrum(working.image),selected=[];
  for(const config of restorationFilters()){
   const image=filterFrequency(input,config),probe=await analyzeCurvedImage(image,{probeOnly:true,geometryMs:200});
   const quality=finderQuality(image,probe.diagnostics);record.probes.push({config,quality});
   if(quality>0){selected.push({config,image,quality});selected.sort((a,b)=>b.quality-a.quality);if(selected.length>4)selected.pop();}
  }
  const all=[];
  for(const [candidateId,candidate]of[{image:working.image,config:null,quality:null},...selected].entries()){
   const {models,diagnostics}=await analyzeCurvedImage(candidate.image,{geometryMs:600,maxModels:12});
   record.fitting.push({candidateId,config:candidate.config,diagnostics});
   const gray=imageGray(candidate.image),seen=new Set();
   for(const [modelId,model]of models.entries()){
    const key=[model.groupIndex,model.dimension,model.axis,model.curvature].join('/');if(seen.has(key))continue;seen.add(key);
    const ranked=calibratedOnly?[structureScore(model,gray,working.image.width,working.image.height,{})].filter(Boolean):
     rankPhaseAdjustments(model,gray,working.image.width,working.image.height,{top:4});
    for(const fit of ranked)all.push({candidate,gray,model,fit,candidateId,modelId});
   }
  }
  if(!calibratedOnly)all.sort((a,b)=>b.fit.score-a.fit.score);
  // Structure score only, never decoded contents or annotated corners.
  const top=all.slice(0,Number(opt('max-ranked',calibratedOnly?'500':'32')));
  record.ranking=top.map(r=>({candidateId:r.candidateId,config:r.candidate.config,modelId:r.modelId,dimension:r.model.dimension,
   axis:r.model.axis,curvature:r.model.curvature,score:r.fit.score,adjustment:r.fit.adjustment,black:r.fit.black,white:r.fit.white}));
  outer:for(const selected of top){
   const {candidate,gray,model,fit,candidateId,modelId}=selected;
   for(const radius of calibratedOnly?[0]:[0,.12,.22]){
    const samples=resample(model,fit,gray,working.image.width,working.image.height,{radius});if(!samples)continue;
    for(const cutoff of calibratedOnly?[.5,.6,.7,.75]:[.35,.4,.45,.5,.55,.6,.65]){
     const rendered=renderCurvedModel({...model,samples,cutoff}),image=new ImageData(rendered.data,rendered.width,rendered.height);
     for(const pure of calibratedOnly?[false]:[true,false]){
      if(record.attempts>=maxTrials){record.budgetSkipped=true;break outer;}
      record.attempts++;
      const found=await reader.decode(image,{pure});
      if(found.length){
       record.selected={candidateId,config:candidate.config,modelId,dimension:model.dimension,axis:model.axis,curvature:model.curvature,
        adjustment:fit.adjustment,score:fit.score,radius,cutoff,pure};
       record.codes=found.map(c=>({payloadHash:hash(c.text),points:c.points.map(p=>working.map(fit.map(p.x/8-4,p.y/8-4)))}));
       break outer;
      }
     }
    }
   }
  }
  if(process.argv.includes('--visualize')&&top.length){
   const show=top[0],canvas=createCanvas(working.image.width*2,working.image.height),ctx=canvas.getContext('2d');
   ctx.putImageData(working.image,0,0);ctx.putImageData(show.candidate.image,working.image.width,0);
   for(const [offset,map,color]of[[0,show.model.map,'#ff3b30'],[working.image.width,show.fit.map,'#00ff88']]){
    ctx.strokeStyle=color;ctx.lineWidth=.5;
    for(let k=0;k<=show.model.dimension;k++){
     ctx.beginPath();for(let j=0;j<=show.model.dimension;j++){const p=map(k,j);j?ctx.lineTo(p.x+offset,p.y):ctx.moveTo(p.x+offset,p.y);}ctx.stroke();
     ctx.beginPath();for(let j=0;j<=show.model.dimension;j++){const p=map(j,k);j?ctx.lineTo(p.x+offset,p.y):ctx.moveTo(p.x+offset,p.y);}ctx.stroke();
    }
   }
   await fs.writeFile('/tmp/xincai-sampling-overlay-'+row.file.split('/').at(-1).replace('.jpg','')+'-'+region.id+'.png',canvas.toBuffer('image/png'));
   canvas.width=canvas.height=1;
  }
  Object.assign(record,metrics(record.codes,entry.polygons));record.elapsedMs=Math.round(performance.now()-began);
  working.canvas.width=working.canvas.height=1;await fs.appendFile(output,JSON.stringify(record)+'\n');
  console.log(row.file,region.id,'ranked',all.length,'attempts',record.attempts,'decoded',record.codes.length,'ms',record.elapsedMs,record.selected||'');
 }
}
