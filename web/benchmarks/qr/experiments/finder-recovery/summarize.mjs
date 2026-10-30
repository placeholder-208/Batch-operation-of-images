import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const prefix='benchmarks/qr/results/';
const names=['local-3.14-control-structure','local-production-3.15','local-production-3.15-detailed','local-production-3.15-detailed-confirm'];
const evidence={protocol:{images:95,positions:123,iou:.3,annotation:'position-only, no independent text truth'},runs:[],sources:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
let baseline;
for(const name of names){
 const filename=prefix+name+'-results.jsonl',bytes=await fs.readFile(filename),rows=bytes.toString().trim().split('\n').map(JSON.parse);
 if(rows.length!==95)throw Error('Incomplete run');
 if(!baseline)baseline=new Map(rows.map(r=>[r.file,r]));
 const losses=[];
 if(name.includes('detailed'))for(const row of rows){
  const counts=new Map();for(const c of row.codes)counts.set(c.payloadHash,(counts.get(c.payloadHash)||0)+1);
  for(const c of baseline.get(row.file).codes){const count=counts.get(c.payloadHash)||0;if(!count)losses.push(row.file);else counts.set(c.payloadHash,count-1);}
 }
 const structures=rows.flatMap(row=>row.record.regions.filter(r=>r.structureSampling).map(region=>({file:row.file,regionId:region.id,...region.structureSampling})));
 evidence.runs.push({name,images:rows.length,matched:rows.reduce((n,r)=>n+r.matched,0),
  blurred:rows.filter(r=>r.file.startsWith('blurred/')).reduce((n,r)=>n+r.matched,0),
  curved:rows.filter(r=>r.file.startsWith('curved/')).reduce((n,r)=>n+r.matched,0),
  totalMs:rows.reduce((n,r)=>n+r.record.totalMs,0),
  runtimeErrors:rows.reduce((n,r)=>n+r.record.failedStageCount,0),unmatched:rows.reduce((n,r)=>n+r.unmatchedDecoded.length,0),
  lostPriorPayloads:losses,structureRegions:structures.length,
  structureTotalMs:rows.flatMap(r=>r.record.stages).filter(s=>s.name==='structure_total').reduce((n,s)=>n+s.elapsedMs,0),
  recovered:structures.filter(r=>r.status==='decoded').map(r=>({file:r.file,regionId:r.regionId,attempted:r.attempted,elapsedMs:r.elapsedMs,selected:r.selected}))});
 evidence.sources.push({file:filename,sha256:hash(bytes)});
}
const ablation=JSON.parse(await fs.readFile(prefix+'local-structure-calibration-ablation.json','utf8'));
evidence.ablation=ablation.map(r=>({file:r.file,regionId:r.regionId,source:r.source,edge:r.edge,
 counts:Object.fromEntries(['old','oldCenter','rawCenter','calibrated'].map(mode=>[mode,{attempts:r[mode].attempts,successfulVariants:r[mode].hits.length}]))}));
await fs.writeFile(new URL('./evidence.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence.runs,null,2));
