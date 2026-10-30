// Equal-input decoder comparison. Cached WeChat boxes are data, never GT crops.
import fs from 'node:fs/promises';
import path from 'node:path';
import {root,hash,loadImage,createCanvas,crop,regionCrop,metrics,merge,opt,createCPP} from './common.mjs';
import {createZBar} from './zbar-adapter.mjs';
import {iterateDecodeVariants} from '../../../../js/preprocess.js';
const layer=opt('layer','whole'),output=opt('output','benchmarks/qr/results/local-decoders-'+layer+'.jsonl');
const requested=opt('readers','zxing-cpp,jsqr,zbar,quirc,zxing-js').split(','),readers=[],initialization=[];
for(const name of requested){
 const began=performance.now();let reader;
 if(name==='zxing-cpp')reader=await createCPP();
 else if(name==='zxing-cpp-new')reader=await createCPP({name,modulePath:process.env.QR_CPP_NEW_MODULE||'/tmp/xincai-decoder-comparison/main/node_modules/zxing-wasm'});
 else if(name==='zbar')reader=await createZBar({modulePath:process.env.QR_ZBAR_MODULE||'/tmp/xincai-decoder-comparison/main/node_modules/@undecaf/zbar-wasm/dist/main.mjs'});
 else if(name==='quirc'){
  const {createQuirc}=await import('./quirc-adapter.mjs');
  reader=await createQuirc({modulePath:process.env.QR_QUIRC_MODULE||'/tmp/xincai-decoder-comparison/quirc/node_modules/quirc/dist/libquirc.wasm'});
 }else{
  const {createJSQR,createZXingJS}=await import('./js-adapters.mjs');
  reader=await (name==='jsqr'?createJSQR:createZXingJS)({modulePath:name==='jsqr'?
   process.env.QR_JSQR_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/jsqr/dist/jsQR.js':
   process.env.QR_ZXING_JS_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/@zxing/library/cjs/index.js'});
 }
 initialization.push({name,version:reader.version,elapsedMs:performance.now()-began});readers.push(reader);
}
const manifest=JSON.parse(await fs.readFile('benchmarks/qr/results/local-manifest.json','utf8'));
const baseline=(await fs.readFile(process.env.QR_COMPARE_BASELINE||'benchmarks/qr/results/local-production-3.14-detailed-results.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const names=opt('files','').split(',').filter(Boolean);
const rows=baseline.filter(r=>!names.length||names.includes(r.file));
await fs.writeFile(output,'');
const controls=[];
try{
 for(const file of ['curved/image008.jpg']){
  const original=await loadImage(path.join(root,'test/QRcode',file)),input=crop(original,{left:0,top:0,width:original.width,height:original.height},1600);
  const reference=baseline.find(r=>r.file===file),expected=new Set(reference.codes.map(c=>c.payloadHash));
  for(const reader of readers){
   const found=await reader.decode(input.image),hashes=found.map(c=>hash(c.text));
   if(hashes.length!==reference.codes.length||hashes.some(h=>!expected.has(h)))throw Error('Control failed: '+reader.name+' '+file+' '+hashes.length);
   controls.push({reader:reader.name,file,count:hashes.length,payloadHashes:hashes});
  }
  const points=reference.codes[0].points,pad=15;
  const left=Math.max(0,Math.min(...points.map(p=>p.x))-pad),top=Math.max(0,Math.min(...points.map(p=>p.y))-pad);
  const box={left,top,width:Math.min(original.width,Math.max(...points.map(p=>p.x))+pad)-left,height:Math.min(original.height,Math.max(...points.map(p=>p.y))+pad)-top};
  const piece=crop(original,box,320),dual=createCanvas(piece.canvas.width*2+120,piece.canvas.height+80),ctx=dual.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,dual.width,dual.height);ctx.drawImage(piece.canvas,20,40);ctx.drawImage(piece.canvas,piece.canvas.width+100,40);
  const data=ctx.getImageData(0,0,dual.width,dual.height);
  for(const reader of readers){
   const found=await reader.decode(data),hashes=found.map(c=>hash(c.text));
   if(hashes.some(h=>!expected.has(h)))throw Error('Duplicate-location control returned different content: '+reader.name);
   controls.push({reader:reader.name,file:'synthetic-two-positions-same-payload',count:hashes.length,expected:2,
    allFound:hashes.length===2,payloadHashes:hashes});
  }
  piece.canvas.width=piece.canvas.height=dual.width=dual.height=1;
  input.canvas.width=input.canvas.height=1;
 }
 for(const [index,row]of rows.entries()){
  const filename=path.join(root,'test/QRcode',row.file);
  if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Image changed: '+row.file);
  const original=await loadImage(filename),entry=manifest.entries.find(e=>e.hash===row.sha256);
  const results=Object.fromEntries(readers.map(r=>[r.name,{file:row.file,sha256:row.sha256,reader:r.name,version:r.version,layer,
   cachedDetection:layer==='regions',diagnosticOnly:layer==='regions',codes:[],attempts:[],decodeMs:0,errors:[]}]));
  const attempt=async(reader,input,map,metadata)=>{
   const record=results[reader.name],began=performance.now();
   try{
    const raw=await reader.decode(input),elapsedMs=performance.now()-began;record.decodeMs+=elapsedMs;
    const mapped=raw.filter(c=>c.text&&c.points?.length===4).map(c=>({payloadHash:hash(c.text),points:c.points.map(map),positionKind:c.positionKind,...metadata}));
    merge(record.codes,mapped);record.attempts.push({...metadata,width:input.width,height:input.height,elapsedMs,decoded:raw.length,positioned:mapped.length,
     diagnostics:raw.diagnostics||reader.lastDiagnostics&&{...reader.lastDiagnostics,candidates:reader.lastDiagnostics.candidates?.map(c=>({dimension:c.dimension,error:c.error,errorName:c.errorName}))}||null});
    return mapped.length>0;
   }catch(error){
    const elapsedMs=performance.now()-began;record.decodeMs+=elapsedMs;
    record.errors.push({...metadata,error:error.message||String(error)});return false;
   }
  };
  if(layer==='whole'){
   const edge=Number(opt('edge','0'))||Infinity,input=crop(original,{left:0,top:0,width:original.width,height:original.height},edge);
   for(const reader of readers)await attempt(reader,input.image,input.map,{variant:'original',edge:Number.isFinite(edge)?edge:'native'});
   input.canvas.width=input.canvas.height=1;
  }else if(layer==='regions'){
   for(const region of row.record.regions){
    const box=regionCrop(region,original.width,original.height);if(!(box.width>0&&box.height>0))continue;
    const input=crop(original,box,800),solved=new Set();
    try{
     for(const variant of iterateDecodeVariants(input.canvas)){
      for(const reader of readers){
       if(solved.has(reader.name))continue;
       const map=p=>input.map({x:p.x/variant.scaleX,y:p.y/variant.scaleY});
       if(await attempt(reader,variant.imageData,map,{regionId:region.id,variant:variant.name,crop:box}))solved.add(reader.name);
      }
      if(solved.size===readers.length)break;
     }
    }finally{input.canvas.width=input.canvas.height=1;}
   }
  }else throw Error('Unknown layer');
  for(const record of Object.values(results)){
   Object.assign(record,metrics(record.codes,entry.polygons));
   await fs.appendFile(output,JSON.stringify(record)+'\n');
  }
  console.log(index+1+'/'+rows.length,row.file,Object.values(results).map(r=>r.reader+':'+r.matched+'/'+r.groundTruth+' '+Math.round(r.decodeMs)+'ms'+(r.errors.length?' ERR'+r.errors.length:'')).join(' | '));
 }
 await fs.writeFile(output+'.metadata.json',JSON.stringify({initialization,controls,layer,images:rows.length,excludes:'decodeMs excludes image reading, WeChat detection and shared preprocessing; includes each reader conversion/multi-scan'},null,2));
}finally{for(const reader of readers)await reader.close?.();}
