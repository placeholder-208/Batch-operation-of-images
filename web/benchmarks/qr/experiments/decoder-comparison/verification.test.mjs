import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,createCPP,ImageData,iou,merge,metrics} from './common.mjs';
import {createJSQR,createZXingJS} from './js-adapters.mjs';
import {createZBar} from './zbar-adapter.mjs';
import {createQuirc} from './quirc-adapter.mjs';
import {renderCurvedModel} from '../../../../js/curved-region.js';
test('comparison matches entities one-to-one and preserves equal payloads at distinct locations',()=>{
 const points=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
 const remote=points.map(p=>({x:p.x+30,y:p.y}));
 assert.equal(iou(points,points.slice().reverse()),1);
 const codes=[];merge(codes,[{payloadHash:'same',points},{payloadHash:'same',points:points.slice().reverse()},
  {payloadHash:'same',points:remote}]);
 assert.equal(codes.length,2);assert.equal(metrics(codes,[points,remote]).matched,2);
 assert.equal(metrics([{points},{points}], [points]).matched,1);
});
test('all real readers decode a clean control and distinguish direct grids from rendered images',async()=>{
 const modulePath=process.env.QR_ZXING_JS_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/@zxing/library/cjs/index.js';
 const imported=await import(modulePath),z=imported.QRCodeWriter?imported:imported.default;
 const text='xincai-decoder-control',matrix=new z.QRCodeWriter().encode(text,z.BarcodeFormat.QR_CODE,0,0,new Map([[z.EncodeHintType.MARGIN,0]]));
 const dimension=matrix.getWidth(),bits=Uint8Array.from({length:dimension*dimension},(_,i)=>Number(matrix.get(i%dimension,Math.floor(i/dimension))));
 const rendered=renderCurvedModel({dimension,samples:Float64Array.from(bits,b=>1-b),cutoff:.5});
 const image=new ImageData(rendered.data,rendered.width,rendered.height),before=hash(image.data),readers=[];
 try{
  readers.push(await createCPP(),await createJSQR({modulePath:process.env.QR_JSQR_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/jsqr/dist/jsQR.js'}),
   await createZBar({modulePath:process.env.QR_ZBAR_MODULE||'/tmp/xincai-decoder-comparison/main/node_modules/@undecaf/zbar-wasm/dist/main.mjs'}),
   await createQuirc({modulePath:process.env.QR_QUIRC_MODULE||'/tmp/xincai-decoder-comparison/quirc/node_modules/quirc/dist/libquirc.wasm'}),
   await createZXingJS({modulePath}));
  for(const reader of readers){
   const codes=await reader.decode(image,{maxSymbols:1});assert.equal(codes.length,1,reader.name);assert.equal(codes[0].text,text);
   assert.equal(codes[0].points.length,4);assert.equal(hash(image.data),before,reader.name+' must keep caller pixels');
  }
  for(const reader of readers.filter(r=>['quirc','zxing-js'].includes(r.name))){
   const prior=hash(bits),codes=await reader.decodeGrid({bits,dimension});
   assert.equal(codes.length,1);assert.equal(codes[0].text,text);assert.equal(hash(bits),prior);
  }
  const quirc=readers.find(r=>r.name==='quirc');
  await assert.rejects(quirc.decodeGrid({bits:new Uint8Array(22*22),dimension:22}),/Invalid/);
  quirc.close();await assert.rejects(quirc.decode(image),/closed/);
 }finally{for(const reader of readers)reader.close?.();}
});
