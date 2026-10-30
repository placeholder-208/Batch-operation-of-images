// Equal geometry and thresholds: local extrema versus mandatory-pattern levels.
import fs from 'node:fs/promises';
import {root,hash,loadImage,crop,createCPP,ImageData} from '../decoder-comparison/common.mjs';
import {analyzeCurvedImage,renderCurvedModel} from '../../../../js/curved-region.js';
import {iterateStructureSampling} from '../../../../js/structure-sampling.js';
import {imageGray,localExtremaGrid} from './sampling.mjs';
const reader=await createCPP(),records=[];
for(const source of ['local-production-3.14-detailed','local-structure-candidate']){
 const row=(await fs.readFile('benchmarks/qr/results/'+source+'-results.jsonl','utf8')).trim().split('\n').map(JSON.parse).find(r=>r.file==='blurred/image005.jpg');
 const filename=root+'/test/QRcode/'+row.file;if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Changed image');
 const original=await loadImage(filename);
 for(const region of row.record.regions.filter(r=>[2,3].includes(r.id)))for(const edge of [384,448]){
  const input=crop(original,region.crop,edge),gray=imageGray(input.image);
  const {models}=await analyzeCurvedImage(input.image,{geometryMs:600,maxModels:12});
  const result={file:row.file,regionId:region.id,source,edge,crop:region.crop,diagnosticOnly:true,cachedDetection:true,
   old:{attempts:0,hits:[]},oldCenter:{attempts:0,hits:[]},rawCenter:{attempts:0,hits:[]},calibrated:{attempts:0,hits:[]}};
  const centerCache=new Map();
  for(const {model,calibration}of iterateStructureSampling(models,gray,input.image.width,input.image.height)){
   const old=models.find(m=>m.map===model.map);
   if(!centerCache.has(old.map))centerCache.set(old.map,localExtremaGrid(old,gray,input.image.width,input.image.height));
   const samples={old:old.samples,oldCenter:centerCache.get(old.map),
    rawCenter:Float64Array.from(model.samples,v=>(v*calibration.gap+calibration.black)/255),calibrated:model.samples};
   for(const mode of ['old','oldCenter','rawCenter','calibrated']){
    const rendered=renderCurvedModel({...model,samples:samples[mode]});
    const codes=await reader.decode(new ImageData(rendered.data,rendered.width,rendered.height));
    result[mode].attempts++;
    if(codes.length)result[mode].hits.push({dimension:model.dimension,axis:model.axis,curvature:model.curvature,
     cutoff:model.cutoff,calibration,payloadHashes:codes.map(c=>hash(c.text))});
   }
  }
  input.canvas.width=input.canvas.height=1;records.push(result);
  console.log(source,region.id,edge,
   'old',result.old.hits.length,'oldCenter',result.oldCenter.hits.length,'rawCenter',result.rawCenter.hits.length,'calibrated',result.calibrated.hits.length);
 }
}
await fs.writeFile('benchmarks/qr/results/local-structure-calibration-ablation.json',JSON.stringify(records,null,2));
