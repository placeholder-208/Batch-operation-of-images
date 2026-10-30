// Compare identical quirc-extracted bits. No annotation or decoded text repairs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {root,hash,loadImage,crop,opt,createCPP,ImageData} from './common.mjs';
import {createQuirc} from './quirc-adapter.mjs';
import {createJSQR,createZXingJS} from './js-adapters.mjs';
import {createZBar} from './zbar-adapter.mjs';
import {renderCurvedModel} from '../../../../js/curved-region.js';
const readers=[await createCPP(),
 await createJSQR({modulePath:process.env.QR_JSQR_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/jsqr/dist/jsQR.js'}),
 await createZBar({modulePath:process.env.QR_ZBAR_MODULE||'/tmp/xincai-decoder-comparison/main/node_modules/@undecaf/zbar-wasm/dist/main.mjs'}),
 await createQuirc({modulePath:process.env.QR_QUIRC_MODULE||'/tmp/xincai-decoder-comparison/quirc/node_modules/quirc/dist/libquirc.wasm'}),
 await createZXingJS({modulePath:process.env.QR_ZXING_JS_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/@zxing/library/cjs/index.js'})];
if(process.argv.includes('--latest-cpp'))readers.push(await createCPP({name:'zxing-cpp-new',
 modulePath:process.env.QR_CPP_NEW_MODULE||'/tmp/xincai-decoder-comparison/main/node_modules/zxing-wasm'}));
const source=readers.find(r=>r.name==='quirc'),names=opt('files','').split(',').filter(Boolean);
const baseline=(await fs.readFile(process.env.QR_COMPARE_BASELINE||'benchmarks/qr/results/local-production-3.14-detailed-results.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const output=opt('output','benchmarks/qr/results/local-decoders-native-grids.jsonl');
await fs.writeFile(output,'');
try{
 for(const row of baseline){
  if(names.length&&!names.includes(row.file))continue;
  const filename=path.join(root,'test/QRcode',row.file);
  if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Changed image');
  const image=await loadImage(filename),input=crop(image,{left:0,top:0,width:image.width,height:image.height});
  const began=performance.now(),extracted=await source.decodeWithDiagnostics(input.image);
  const record={file:row.file,sha256:row.sha256,diagnosticOnly:true,extraction:'quirc-1.0-native-image',
   extractionMs:performance.now()-began,candidates:[],runtimeErrors:[]};
  for(const candidate of extracted.candidates){
   const {bits,dimension}=candidate;
   const result={index:candidate.index,dimension,points:candidate.points,originalError:candidate.error,
    originalErrorName:candidate.errorName,gridHash:bits?hash(bits):null,routes:[]};
   record.candidates.push(result);
   if(!bits||dimension<21||dimension>177||(dimension-21)%4)continue;
   const rendered=renderCurvedModel({dimension,samples:Float64Array.from(bits,b=>1-b),cutoff:.5});
   const data=new ImageData(rendered.data,rendered.width,rendered.height);
   const routes=[...readers.map(reader=>({reader,path:'rendered-image'})),
    ...readers.filter(r=>r.name.startsWith('zxing-cpp')).map(reader=>({reader,path:'cpp-pure-rendered'})),
    ...readers.filter(r=>['quirc','zxing-js'].includes(r.name)).map(reader=>({reader,path:'direct-grid'}))];
   for(const {reader,path:route}of routes){
    const start=performance.now();
    try{
     const raw=route==='direct-grid'?await reader.decodeGrid({bits,dimension}):await reader.decode(data,{pure:route==='cpp-pure-rendered',maxSymbols:1});
     const diagnostic=raw.diagnostics||reader.lastDiagnostics;
     result.routes.push({reader:reader.name,path:route,elapsedMs:performance.now()-start,
      payloadHashes:raw.map(c=>hash(c.text)),diagnostics:diagnostic?{...diagnostic,candidates:undefined}:null});
    }catch(error){
     const detail={reader:reader.name,path:route,elapsedMs:performance.now()-start,error:error.message||String(error)};
     result.routes.push(detail);record.runtimeErrors.push(detail);
    }
   }
  }
  input.canvas.width=input.canvas.height=1;
  await fs.appendFile(output,JSON.stringify(record)+'\n');
  console.log(row.file,'candidates',record.candidates.length,'quirc decoded',extracted.codes.length,'runtime errors',record.runtimeErrors.length);
 }
}finally{for(const reader of readers)await reader.close?.();}
