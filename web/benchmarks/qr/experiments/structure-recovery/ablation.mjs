// Single selected-case diagnostic, not a search rule for the product.
import fs from 'node:fs/promises';
import {root,hash,loadImage,decode,valid,crop,remaining} from './runtime.mjs';
import {analyzeCurvedImage,renderCurvedModel,decodeCurvedRegion} from '../../../../js/curved-region.js';
import {spectrum,filterFrequency} from '../../../../js/blur-frequency.js';
const row=(await remaining()).find(r=>r.file==='blurred/image021.jpg');
const region=row.record.regions.find(r=>r.id===3),filename=root+'/test/QRcode/'+row.file;
if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Changed image');
const scaled=crop(await loadImage(filename),region.crop,384);
const config={length:13,angle:45,sigma:.6,regularization:.02};
const image=filterFrequency(spectrum(scaled.image),config);
scaled.canvas.getContext('2d').putImageData(image,0,0);
const results={file:row.file,regionId:3,config,cachedDetection:true,diagnosticOnly:true};
const plain={};results.originalGeometry=(await decodeCurvedRegion(scaled.canvas,{
 geometryMs:600,maxModels:12,continuousResample:true,statistics:plain})).length;
const {models}=await analyzeCurvedImage(image,{geometryMs:600,maxModels:12});
results.thresholdOnly=0;
for(const model of models)for(const cutoff of [.35,.4,.45,.5,.55,.6,.65,.75]){
 const rendered=renderCurvedModel({...model,cutoff});
 results.thresholdOnly+=valid(await decode(new ImageData(rendered.data,rendered.width,rendered.height))).length;
}
const statistics={};results.moduleRecovery=(await decodeCurvedRegion(scaled.canvas,{
 geometryMs:600,maxModels:12,continuousResample:true,moduleRecovery:true,statistics})).map(c=>({payloadHash:hash(c.text)}));
results.statistics=statistics;
await fs.writeFile('benchmarks/qr/results/local-research-ablation.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({original:results.originalGeometry,thresholdOnly:results.thresholdOnly,
 moduleRecovery:results.moduleRecovery.length,attempted:statistics.moduleRecoveryAttempted}));
scaled.canvas.width=scaled.canvas.height=1;
