import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage,ImageData}=require(process.env.QR_CANVAS_MODULE||'@napi-rs/canvas');
const repo=path.resolve(process.env.QR_WEB_ROOT||'.');
const kind=process.argv[2]||'current';
if(process.argv.includes('--legacy'))throw new Error('旧整图流程已退役；历史对照记录见 archive/v3.9。');
const study=path.resolve(new URL('./results/',import.meta.url).pathname);
const source=path.resolve(process.env.QR_SOURCE||path.join(repo,'js')),log=console.log.bind(console);
const output=path.resolve(process.env.QR_OUTPUT||path.join(study,kind+'-results.jsonl'));
const wasm=await fs.readFile(path.join(repo,'zxing/zxing_reader.wasm'));
const ort=require(path.join(repo,'vendor/ort-1.22.0/ort.wasm.js'));
const runtime=await fs.readFile(path.join(repo,'vendor/ort-1.22.0/ort-wasm-simd-threaded.wasm'));
const model=await fs.readFile(path.join(repo,'models/detect-web.onnx'));
const config=JSON.parse(await fs.readFile(path.join(repo,'models/detect-web.json'),'utf8'));
const silent={log(){},warn(){},error(){}};
const realm=vm.createContext({console:silent,performance,Date,URL,File,Blob,ImageData,
 Uint8Array,Uint8ClampedArray,Float32Array,Float64Array,Int32Array,Uint32Array,
 WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout,Buffer,process});
realm.window=realm;realm.self=realm;
vm.runInContext(await fs.readFile(path.join(repo,'zxing/index.js'),'utf8'),realm,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
const reader=realm.ZXingWASM;
const facade={env:{wasm:{}},Tensor:ort.Tensor,InferenceSession:{async create(url,options){
 Object.assign(ort.env.wasm,{numThreads:1,proxy:false,wasmBinary:runtime,
  wasmPaths:{mjs:pathToFileURL(path.join(repo,'vendor/ort-1.22.0/ort-wasm-simd-threaded.mjs')).href}});
 const session=await ort.InferenceSession.create(model,options);globalThis.Worker=undefined;return session;
}}};
Object.assign(globalThis,{window:{ZXingWASM:{prepareZXingModule:options=>reader.prepareZXingModule({
 ...options,overrides:{...options?.overrides,wasmBinary:wasm}}),readBarcodes:(...args)=>reader.readBarcodes(...args)}},
 document:{createElement:()=>createCanvas(1,1)},ImageData,ort:facade,Worker:undefined,
 fetch:async url=>String(url).includes('.json')?new Response(JSON.stringify(config)):new Response(runtime)});
console.log=()=>{};
const {decodeQRCode}=await import(pathToFileURL(path.join(source,'decoder.js')));
const {createQRStatistics}=await import(pathToFileURL(path.join(source,'qr-statistics.js')));
const {diagnoseKnownPositions}=process.argv.includes('--oracle-position')?await import('./oracle-diagnostic.mjs'):{};
await window.ZXingWASM.prepareZXingModule();
function ordered(points){const c={x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length};return points.slice().sort((a,b)=>Math.atan2(a.y-c.y,a.x-c.x)-Math.atan2(b.y-c.y,b.x-c.x));}
const cross=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0))/2;
function clip(subject,mask){let out=subject;for(let i=0;i<mask.length;i++){
 const a=mask[i],b=mask[(i+1)%mask.length],input=out;out=[];
 for(let j=0;j<input.length;j++){const p=input[j],q=input[(j+1)%input.length],cp=cross(a,b,p),cq=cross(a,b,q);
  if(cp>=0)out.push(p);if((cp>=0)!==(cq>=0)){const t=cp/(cp-cq);out.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)});}}
 if(!out.length)break;}return out;}
function metrics(codes,polygons){
 const gt=(polygons||[]).map(ordered),pred=codes.map(c=>ordered(c.points));
 const scores=pred.map(p=>gt.map(g=>{if(!p.every(v=>Number.isFinite(v.x+v.y)))return 0;const x=area(clip(p,g)),a=area(p),b=area(g);return x/(a+b-x)||0;}));
 const owners=new Map();
 function assign(i,seen){for(const [j,score]of scores[i].map((v,j)=>[j,v]).sort((a,b)=>b[1]-a[1])){
  if(score<.3||seen.has(j))continue;seen.add(j);if(!owners.has(j)||assign(owners.get(j),seen)){owners.set(j,i);return true;}}return false;}
 pred.forEach((_,i)=>assign(i,new Set()));
 return {groundTruth:gt.length,matched:owners.size,unmatchedGroundTruth:gt.map((_,i)=>i).filter(i=>!owners.has(i)),
  unmatchedDecoded:pred.map((_,i)=>i).filter(i=>![...owners.values()].includes(i)),bestIoU:scores.map(r=>Math.max(0,...r))};
}
let entries=JSON.parse(await fs.readFile(process.env.QR_MANIFEST||path.join(study,'local-manifest.json'),'utf8')).entries;
if(process.argv.includes('--rescore')){
 const rows=(await fs.readFile(output,'utf8')).trim().split('\n').map(JSON.parse);
 for(const row of rows){const entry=entries.find(e=>e.hash===row.sha256);Object.assign(row,metrics(row.codes,entry.polygons));}
 await fs.writeFile(output,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 log(JSON.stringify({images:rows.length,matched:rows.reduce((n,r)=>n+r.matched,0),gt:rows.reduce((n,r)=>n+r.groundTruth,0),unmatched:rows.filter(r=>r.unmatchedDecoded.length).map(r=>r.file)}));process.exit(0);
}
if(process.argv.includes('--smoke'))entries=entries.filter(e=>['blurred/image005.jpg','curved/image017.jpg','curved/image008.jpg'].includes(e.category+'/'+e.name));
const filter=process.argv.find(a=>a.startsWith('--files='));if(filter){const names=filter.slice(8).split(',');entries=entries.filter(e=>names.includes(e.category+'/'+e.name));}
await fs.writeFile(output,'');
for(const [index,entry]of entries.entries()){
 const image=await loadImage(entry.file),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);
 if(process.argv.includes('--oracle-position')){
  const targets=await diagnoseKnownPositions(canvas,entry.polygons,window.ZXingWASM.readBarcodes);
  await fs.appendFile(output,JSON.stringify({file:entry.category+'/'+entry.name,sha256:entry.hash,
   oracle:true,diagnosticOnly:true,targets})+'\n');
  log(kind,entry.category+'/'+entry.name,'known-position diagnostic',targets.filter(t=>t.decoded).length+'/'+targets.length);
  canvas.width=canvas.height=1;continue;
 }
 const options={useTPS:process.argv.includes('--tps'),detailedRecovery:process.argv.includes('--detailed')};
 const trace=createQRStatistics(new File([],entry.name),null,{id:kind},options);
 const codes=await decodeQRCode(canvas,trace,options);
 const record=trace.finish(codes);
 const result={file:entry.category+'/'+entry.name,sha256:entry.hash,width:image.width,height:image.height,options,
  ...metrics(codes,entry.polygons),codes:codes.map(c=>({points:c.points,source:c.source,payloadHash:createHash('sha256').update(c.text).digest('hex')})),record};
 await fs.appendFile(output,JSON.stringify(result)+'\n');
 log(kind,index+1+'/'+entries.length,result.file,'matched='+result.matched+'/'+result.groundTruth,'codes='+codes.length,'ms='+record.totalMs);
 canvas.width=canvas.height=1;
}
