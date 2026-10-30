// Offline cached-region diagnostic only; never feed annotation coordinates into decoding.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage,ImageData}=require(process.env.QR_CANVAS_MODULE||'@napi-rs/canvas');
const root=process.cwd(),log=console.log.bind(console),hash=v=>createHash('sha256').update(v).digest('hex');
globalThis.ImageData=ImageData;
globalThis.document={createElement:()=>createCanvas(1,1)};
globalThis.Worker=undefined;
const silent={log(){},warn(){},error(){}};
const realm=vm.createContext({console:silent,performance,Date,URL,File,Blob,ImageData,
 Uint8Array,Uint8ClampedArray,Float32Array,Float64Array,Int32Array,Uint32Array,
 WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout,Buffer,process});
realm.window=realm;realm.self=realm;
vm.runInContext(await fs.readFile(path.join(root,'zxing/index.js'),'utf8'),realm,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
const reader=realm.ZXingWASM;
await reader.prepareZXingModule({overrides:{wasmBinary:await fs.readFile(path.join(root,'zxing/zxing_reader.wasm'))}});
globalThis.window={ZXingWASM:reader};
console.log=()=>{};
const {decodeCurvedRegion}=await import(pathToFileURL(path.join(root,'js/curved-region.js')));
const {spectrum,filterFrequency}=await import(pathToFileURL(path.join(root,'js/blur-frequency.js')));
const arg=(key,fallback)=>process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3)||fallback;
const names=arg('files','').split(',').filter(Boolean),edges=arg('edges','384').split(',').map(Number);
const geometryMs=Number(arg('geometry-ms','600'));
const rows=(await fs.readFile(process.env.QR_RESTORE_BASELINE||path.join(root,'benchmarks/qr/results/local-production-3.12-detailed-results.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const output=arg('output','benchmarks/qr/results/local-restoration-order.jsonl');
await fs.writeFile(output,'');
const filters=[null,...[1,1.5,2,2.5,3].map(sigma=>({sigma,regularization:.01}))];
for(const length of [5,9,13])for(const angle of [0,45,90,135])filters.push({length,angle,sigma:.6,regularization:.02});
for(const row of rows){
 if(row.matched===row.groundTruth||names.length&&!names.includes(row.file))continue;
 const filename=path.join(root,'test/QRcode',row.file),bytes=await fs.readFile(filename);
 if(hash(bytes)!==row.sha256)throw Error('Changed image '+row.file);
 const image=await loadImage(filename);
 for(const region of row.record.regions.filter(r=>!r.covered&&r.crop)){
  const began=performance.now(),record={file:row.file,regionId:region.id,cachedDetection:true,diagnosticOnly:true,attempts:[],codes:[]};
  for(const edge of edges){
   const crop=region.crop,scale=Math.min(1,edge/Math.max(crop.width,crop.height));
   const canvas=createCanvas(Math.max(1,Math.round(crop.width*scale)),Math.max(1,Math.round(crop.height*scale)));
   const context=canvas.getContext('2d');
   context.drawImage(image,crop.left,crop.top,crop.width,crop.height,0,0,canvas.width,canvas.height);
   const original=context.getImageData(0,0,canvas.width,canvas.height),source=spectrum(original);
   const ratio=Math.min(edge,Math.max(crop.width,crop.height))/Math.min(384,Math.max(crop.width,crop.height));
   for(const [index,base]of filters.entries()){
    const config=base?{...base}:null;
    if(config)for(const key of ['sigma','length'])if(config[key]!==undefined)config[key]*=ratio;
    const data=config?filterFrequency(source,config):original;
    context.putImageData(data,0,0);
    const statistics={};
    const found=await decodeCurvedRegion(canvas,{geometryMs,maxModels:12,continuousResample:true,statistics});
    record.attempts.push({edge,config,reason:statistics.reason,finders:statistics.finders,models:statistics.models,
     attempted:statistics.attempted,geometryBudgetMs:geometryMs,geometryElapsedMs:statistics.elapsedMs,decoded:found.length});
    if(index%5===0||found.length)log(row.file,region.id,'edge',edge,'filter',index,'models',statistics.models,'codes',found.length);
    if(found.length){record.selected={edge,config};record.codes=found.map(c=>({payloadHash:hash(c.text),points:c.points.map(p=>({x:crop.left+p.x*crop.width/canvas.width,y:crop.top+p.y*crop.height/canvas.height}))}));break;}
   }
   canvas.width=canvas.height=1;
   if(record.codes.length)break;
  }
  record.elapsedMs=Math.round(performance.now()-began);
  await fs.appendFile(output,JSON.stringify(record)+'\n');
  log('DONE',row.file,region.id,record.codes.length,record.elapsedMs);
 }
}
