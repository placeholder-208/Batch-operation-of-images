// Diagnostic: compare the two actual crop policies, never annotation corners.
import fs from 'node:fs/promises';
import {root,loadImage,crop,createCPP,hash} from '../decoder-comparison/common.mjs';
import {analyzeCurvedImage,renderCurvedModel} from '../../../../js/curved-region.js';
import {fitStructureLevels} from '../../../../js/structure-sampling.js';
import {imageGray,resample} from './sampling.mjs';
const reader=await createCPP(),rows=[];
for(const dataset of ['local-production-3.14-detailed','local-structure-candidate']){
 const row=(await fs.readFile('benchmarks/qr/results/'+dataset+'-results.jsonl','utf8')).trim().split('\n').map(JSON.parse).find(r=>r.file==='blurred/image005.jpg');
 const original=await loadImage(root+'/test/QRcode/'+row.file),region=row.record.regions.find(r=>r.id===2);
 for(const edge of [384,448,576]){
  const input=crop(original,region.crop,edge),gray=imageGray(input.image),analysis=await analyzeCurvedImage(input.image,{maxPixels:400000,geometryMs:600,maxModels:12});
  const result={dataset,crop:region.crop,edge,models:analysis.models.length,hits:[]};
  for(const [modelId,model]of analysis.models.entries()){
   const fit=fitStructureLevels(model,gray,input.image.width,input.image.height);if(!fit)continue;
   const samples=resample(model,{...fit,map:model.map},gray,input.image.width,input.image.height,{radius:0});if(!samples)continue;
   for(const cutoff of [.5,.6,.65,.675,.7,.725,.75,.775,.8,.825,.85]){
    const rendered=renderCurvedModel({...model,samples,cutoff}),found=await reader.decode(new ImageData(rendered.data,rendered.width,rendered.height));
    if(found.length)result.hits.push({modelId,dimension:model.dimension,axis:model.axis,curvature:model.curvature,cutoff,payloadHashes:found.map(c=>hash(c.text))});
   }
  }
  input.canvas.width=input.canvas.height=1;rows.push(result);console.log(JSON.stringify(result));
 }
}
await fs.writeFile('benchmarks/qr/results/local-structure-padding-control.json',JSON.stringify(rows,null,2));
