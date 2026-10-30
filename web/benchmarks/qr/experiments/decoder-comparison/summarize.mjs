import fs from 'node:fs/promises';
import {metrics,merge,hash} from './common.mjs';
const directory='benchmarks/qr/results/';
const read=async file=>(await fs.readFile(directory+file,'utf8')).trim().split('\n').map(JSON.parse);
const whole=[...await read('local-decoders-whole.jsonl'),...await read('local-decoders-whole-new-cpp.jsonl')];
const regions=[...(await read('local-decoders-regions.jsonl')).filter(r=>r.reader!=='quirc'),
 ...await read('local-decoders-regions-quirc-corrected.jsonl'),...await read('local-decoders-regions-new-cpp.jsonl')];
const baseline=await read('local-production-3.14-detailed-results.jsonl');
const manifest=JSON.parse(await fs.readFile(directory+'local-manifest.json','utf8'));
const truth=new Map(manifest.entries.map(e=>[e.hash,e.polygons])),names=[...new Set(whole.map(r=>r.reader))];
const summary={images:baseline.length,targets:baseline.reduce((n,r)=>n+r.groundTruth,0),
 productMatched:baseline.reduce((n,r)=>n+r.matched,0),readers:[],nativeGrids:[],generated:[],ensemble:{},sources:[]};
for(const name of names){
 const a=whole.filter(r=>r.reader===name),b=regions.filter(r=>r.reader===name);
 if(a.length!==95||b.length!==95)throw Error('Incomplete input matrix: '+name);
 let combined=0,addedToProduct=0,unmatched=0;
 for(const base of baseline){
  const codes=[];for(const rows of [a,b])merge(codes,rows.find(r=>r.file===base.file).codes);
  combined+=metrics(codes,truth.get(base.sha256)).matched;
  unmatched+=metrics(codes,truth.get(base.sha256)).unmatchedDecoded.length;
  const augmented=base.codes.slice();merge(augmented,codes);
  addedToProduct+=metrics(augmented,truth.get(base.sha256)).matched-base.matched;
 }
 summary.readers.push({name,version:a[0].version,wholeMatched:a.reduce((n,r)=>n+r.matched,0),
  regionsMatched:b.reduce((n,r)=>n+r.matched,0),combinedMatched:combined,addedToProduct,combinedUnmatched:unmatched,
  wholeDecodeMs:a.reduce((n,r)=>n+r.decodeMs,0),regionsDecodeMs:b.reduce((n,r)=>n+r.decodeMs,0),
  runtimeErrors:[...a,...b].reduce((n,r)=>n+r.errors.length,0)});
}
for(const base of baseline){
 const independent=[];for(const row of [...whole,...regions].filter(r=>r.file===base.file))merge(independent,row.codes);
 summary.ensemble.withoutProductMatched=(summary.ensemble.withoutProductMatched||0)+metrics(independent,truth.get(base.sha256)).matched;
 const combined=base.codes.slice();merge(combined,independent);
 const evaluation=metrics(combined,truth.get(base.sha256));
 summary.ensemble.matched=(summary.ensemble.matched||0)+evaluation.matched;
 summary.ensemble.unmatched=(summary.ensemble.unmatched||0)+evaluation.unmatchedDecoded.length;
}
const native=await read('local-decoders-native-grids.jsonl');
const grids=native.flatMap(row=>row.candidates.filter(c=>c.routes.length).map(c=>({file:row.file,...c})));
summary.nativeGridsTotal=grids.length;summary.nativeImages=native.length;
for(const key of new Set(grids.flatMap(c=>c.routes.map(a=>a.reader+'/'+a.path)))){
 const rows=grids.flatMap(c=>c.routes.filter(a=>a.reader+'/'+a.path===key));
 summary.nativeGrids.push({route:key,grids:rows.length,decoded:rows.filter(r=>r.payloadHashes?.length).length,runtimeErrors:rows.filter(r=>r.error).length});
}
summary.nativeConflictingHashes=grids.filter(c=>new Set(c.routes.flatMap(r=>r.payloadHashes||[])).size>1).length;
const generated=(await read('local-decoders-generated.jsonl')).filter(r=>r.type==='generated-region');
summary.generatedRegions=new Set(generated.map(r=>r.file+'/'+r.regionId)).size;
summary.generatedEqualInputs=true;
for(const region of new Set(generated.map(r=>r.file+'/'+r.regionId))){
 const rows=generated.filter(r=>r.file+'/'+r.regionId===region);
 const images=rows.filter(r=>r.path!=='direct-grid').map(r=>r.attempts.map(a=>a.imageHash).join(','));
 const grids=rows.filter(r=>r.path==='direct-grid').map(r=>r.attempts.map(a=>a.gridHash).join(','));
 if(new Set(images).size>1||new Set(grids).size>1)throw Error('Generated readers saw different inputs: '+region);
}
for(const key of new Set(generated.map(r=>r.reader+'/'+r.path))){
 const rows=generated.filter(r=>r.reader+'/'+r.path===key);
 summary.generated.push({route:key,regions:rows.length,decoded:rows.reduce((n,r)=>n+r.codes.length,0),
  attempts:rows.reduce((n,r)=>n+r.attempts.length,0),runtimeErrors:rows.reduce((n,r)=>n+r.errors.length,0)});
}
for(const file of ['local-decoders-whole.jsonl','local-decoders-whole-new-cpp.jsonl','local-decoders-regions.jsonl',
 'local-decoders-regions-quirc-corrected.jsonl','local-decoders-regions-new-cpp.jsonl',
 'local-decoders-native-grids.jsonl','local-decoders-generated.jsonl'])summary.sources.push({file,sha256:hash(await fs.readFile(directory+file))});
await fs.writeFile(directory+'local-decoder-comparison-summary.json',JSON.stringify(summary,null,2));
const csv=['reader,version,whole_matched,regions_matched,combined_matched,added_to_product,whole_decode_ms,regions_decode_ms,runtime_errors',
 ...summary.readers.map(r=>[r.name,r.version,r.wholeMatched,r.regionsMatched,r.combinedMatched,r.addedToProduct,
  Math.round(r.wholeDecodeMs),Math.round(r.regionsDecodeMs),r.runtimeErrors].join(','))].join('\n')+'\n';
await fs.writeFile(new URL('./comparison.csv',import.meta.url),csv);
await fs.writeFile(new URL('./evidence.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
