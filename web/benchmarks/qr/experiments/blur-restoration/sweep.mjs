import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {spectrum,filterFrequency} from './frequency.mjs';
import {filterExtended,compactSpectrum} from './extended-frequency.mjs';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage,ImageData}=require(process.env.QR_CANVAS_MODULE||'@napi-rs/canvas');
globalThis.ImageData=ImageData;
const root=process.cwd(),realm=vm.createContext({console,performance,Date,URL,File,Blob,ImageData,
 Uint8Array,Uint8ClampedArray,Float32Array,Float64Array,Int32Array,Uint32Array,
 WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout,Buffer,process});
realm.window=realm;realm.self=realm;
vm.runInContext(await fs.readFile(path.join(root,'zxing/index.js'),'utf8'),realm,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
const reader=realm.ZXingWASM;
await reader.prepareZXingModule({overrides:{wasmBinary:await fs.readFile(path.join(root,'zxing/zxing_reader.wasm'))}});
const valid=raw=>raw.filter(r=>r.isValid!==false&&r.text&&r.position);
const decode=image=>reader.readBarcodes(image,{formats:['QRCode'],tryHarder:true});
const hash=s=>createHash('sha256').update(s).digest('hex');
function draw(image,crop,max=384){
 const scale=Math.min(1,max/Math.max(crop.width,crop.height)),canvas=createCanvas(Math.round(crop.width*scale),Math.round(crop.height*scale));
 const ctx=canvas.getContext('2d');ctx.drawImage(image,crop.left,crop.top,crop.width,crop.height,0,0,canvas.width,canvas.height);
 return {image:ctx.getImageData(0,0,canvas.width,canvas.height),scaleX:canvas.width/crop.width,scaleY:canvas.height/crop.height};
}
if(process.argv.includes('--synthetic')){
 const image=await loadImage('test/QRcode/curved/image008.jpg');
 const data=draw(image,{left:0,top:0,width:image.width,height:image.height},384).image;
 const clean=valid(await decode(data));
 if(!clean.length)throw Error('Synthetic control source not decodable');
 const source=spectrum(data),rows=[];
 for(const psf of [{sigma:1.5},{sigma:2.4},{sigma:.6,length:7,angle:45}]){
  const blurred=filterFrequency(source,{...psf,forward:true});
  const before=valid(await decode(blurred));
  const restored=filterFrequency(spectrum(blurred),{...psf,regularization:.001});
  const after=valid(await decode(restored));
  assert.ok(after.some(c=>hash(c.text)===hash(clean[0].text)),'Matched-PSF restoration must retain the original payload');
  rows.push({psf,clean:clean.map(c=>hash(c.text)),blurred:before.map(c=>hash(c.text)),restored:after.map(c=>hash(c.text))});
 }
 await fs.writeFile('benchmarks/qr/results/local-synthetic-restoration.json',JSON.stringify(rows,null,2));
 console.log(JSON.stringify(rows));process.exit(0);
}
const configs=[];
const ghost=process.argv.includes('--ghost');
const extended=process.argv.includes('--extended')||ghost;
const hires=process.argv.includes('--hires');
if(ghost){
 for(const length of [2,4,6,8])for(const angle of [0,30,60,90,120,150])for(const mix of [.25,.5])
  configs.push({kind:'ghost',length,angle,mix,sigma:.5,regularization:.02});
}else if(extended){
 for(const length of [5,9,13])for(const angle of [15,30,60,75,105,120,150,165])configs.push({kind:'motion',length,angle,sigma:.6,regularization:.02});
 for(const along of [1,1.5,2,2.5,3])for(const across of [.4,.8])for(const angle of [0,30,60,90,120,150])for(const regularization of [.003,.02])
  configs.push({kind:'anisotropic',along,across,angle,regularization});
 for(const radius of [1.5,2.5,3.5,4.5])for(const regularization of [.003,.02])configs.push({kind:'disk',radius,regularization});
}else{
for(const sigma of (process.argv.includes('--bounded')?[1,1.5,2,2.5,3]:[.7,1.1,1.6,2.2,3]))for(const regularization of (process.argv.includes('--bounded')?[.01]:[.001,.008]))configs.push({sigma,regularization});
for(const length of (process.argv.includes('--bounded')?[5,9,13]:[3,5,7,9,13]))for(const angle of [0,45,90,135])for(const regularization of (process.argv.includes('--bounded')?[.02]:[.003,.02]))
 configs.push({length,angle,sigma:.6,regularization});
}
const rows=(await fs.readFile(process.env.QR_RESTORE_BASELINE||('benchmarks/qr/results/'+(extended||hires?'local-production-3.11-results.jsonl':'local-production-3.10-audited.jsonl')),'utf8')).trim().split('\n').map(JSON.parse);
const output=process.env.QR_RESTORE_OUTPUT||('benchmarks/qr/results/local-restoration'+(ghost?'-ghost':hires?'-hires':extended?'-extended':process.argv.includes('--bounded')?'-bounded':'-sweep')+'.jsonl');await fs.writeFile(output,'');
for(const row of rows){
 if(row.matched>=row.groundTruth)continue;
 const file=path.join(root,'test/QRcode',row.file),bytes=await fs.readFile(file);
 if(hash(bytes)!==row.sha256)throw Error('Image changed: '+row.file);
 const image=await loadImage(file);
 for(const region of row.record.regions.filter(r=>!r.covered&&r.crop)){
  const edge=Number(process.env.QR_RESTORE_EDGE||(hires?576:384));
  const begin=performance.now(),crop=region.crop,scaled=draw(image,crop,edge),source=process.argv.includes('--compact')?compactSpectrum(scaled.image):spectrum(scaled.image),attempts=[];
  const ratio=hires?Math.min(edge,Math.max(crop.width,crop.height))/Math.min(384,Math.max(crop.width,crop.height)):1;
  const original=valid(await decode(scaled.image));
  let codes=original,selected=null;
  if(!codes.length)for(const originalConfig of configs){
   const config={...originalConfig};for(const key of ['sigma','length','along','across','radius'])if(config[key]!==undefined)config[key]*=ratio;
   const restored=extended?filterExtended(source,config):filterFrequency(source,config),found=valid(await decode(restored));
   attempts.push({config,decoded:found.length});
   if(found.length){codes=found;selected=config;break;}
  }
  const result={file:row.file,regionId:region.id,cachedDetection:true,config:selected,attempts,
   workingWidth:scaled.image.width,workingHeight:scaled.image.height,fftSize:source.n,
   elapsedMs:Math.round(performance.now()-begin),codes:codes.map(c=>({payloadHash:hash(c.text),
    points:[c.position.topLeft,c.position.topRight,c.position.bottomRight,c.position.bottomLeft].map(p=>({x:p.x/scaled.scaleX+crop.left,y:p.y/scaled.scaleY+crop.top}))}))};
  await fs.appendFile(output,JSON.stringify(result)+'\n');
  console.log(row.file,region.id,'decoded',codes.length,'tries',attempts.length,'ms',result.elapsedMs,selected||'');
 }
}
