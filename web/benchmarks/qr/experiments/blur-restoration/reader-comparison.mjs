import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {spectrum,filterFrequency} from './frequency.mjs';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage,ImageData}=require(process.env.QR_CANVAS_MODULE||'@napi-rs/canvas');
globalThis.ImageData=ImageData;
const jsqr=require(process.env.QR_JSQR_MODULE||'jsqr');
const zbar=await import(process.env.QR_ZBAR_MODULE||'@undecaf/zbar-wasm');
const scanner=await zbar.getDefaultScanner();
scanner.setConfig(zbar.ZBarSymbolType.ZBAR_NONE,zbar.ZBarConfigType.ZBAR_CFG_ENABLE,0);
scanner.setConfig(zbar.ZBarSymbolType.ZBAR_QRCODE,zbar.ZBarConfigType.ZBAR_CFG_ENABLE,1);
const hash=s=>createHash('sha256').update(s).digest('hex');
const controlImage=await loadImage('test/QRcode/curved/image008.jpg'),controlScale=Math.min(1,384/Math.max(controlImage.width,controlImage.height));
const controlCanvas=createCanvas(Math.round(controlImage.width*controlScale),Math.round(controlImage.height*controlScale)),controlContext=controlCanvas.getContext('2d');
controlContext.drawImage(controlImage,0,0,controlCanvas.width,controlCanvas.height);
const controlData=controlContext.getImageData(0,0,controlCanvas.width,controlCanvas.height);
const controlJS=jsqr(controlData.data,controlData.width,controlData.height,{inversionAttempts:'dontInvert'});
const controlZ=(await zbar.scanImageData(controlData,scanner)).find(q=>q.type===64&&q.points.length===4);
assert.ok(controlJS&&controlZ,'Both alternative readers must decode the clear control image');
assert.equal(hash(controlJS.data),hash(controlZ.decode()));
console.log('PASS: both alternative readers decode the control with matching content.');
if(process.argv.includes('--control-only')){scanner.destroy();process.exit(0);}
const rows=(await fs.readFile('benchmarks/qr/results/local-production-3.11-results.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const output='benchmarks/qr/results/local-reader-comparison.jsonl';await fs.writeFile(output,'');
const filters=[];
for(const sigma of [1,1.5,2,2.5,3])filters.push({sigma,regularization:.01});
for(const length of [5,9,13])for(const angle of [0,45,90,135])filters.push({length,angle,sigma:.6,regularization:.02});
try{
 for(const row of rows){
  if(row.matched>=row.groundTruth)continue;
  const image=await loadImage(path.join('test/QRcode',row.file));
  for(const region of row.record.regions.filter(r=>!r.covered&&r.crop)){
   const crop=region.crop,found={},attempts=[];let small;
   const attempt=async(data,sx,sy,label)=>{
    const convert=(payload,points)=>({payloadHash:hash(payload),points:points.map(p=>({x:p.x/sx+crop.left,y:p.y/sy+crop.top})),variant:label});
    if(!found.jsqr){
     const qr=jsqr(data.data,data.width,data.height,{inversionAttempts:'dontInvert'});
     if(qr)found.jsqr=convert(qr.data,[qr.location.topLeftCorner,qr.location.topRightCorner,qr.location.bottomRightCorner,qr.location.bottomLeftCorner]);
    }
    if(!found.zbar){
     const qrs=await zbar.scanImageData(data,scanner);
     const qr=qrs.find(q=>q.type===64&&q.points.length===4);
     if(qr)found.zbar=convert(qr.decode(),qr.points);
    }
    attempts.push(label);
   };
   for(const edge of [800,576,384]){
    if(found.jsqr&&found.zbar)break;
    const scale=Math.min(1,edge/Math.max(crop.width,crop.height)),c=createCanvas(Math.round(crop.width*scale),Math.round(crop.height*scale));
    const ctx=c.getContext('2d');ctx.drawImage(image,crop.left,crop.top,crop.width,crop.height,0,0,c.width,c.height);
    const data=ctx.getImageData(0,0,c.width,c.height),sx=c.width/crop.width,sy=c.height/crop.height;
    await attempt(data,sx,sy,'original-'+edge);if(edge===384)small={data,sx,sy};
   }
   if(small&&(!found.jsqr||!found.zbar)){
    const input=spectrum(small.data);
    for(const filter of filters){
     await attempt(filterFrequency(input,filter),small.sx,small.sy,JSON.stringify(filter));
     if(found.jsqr&&found.zbar)break;
    }
   }
   const result={file:row.file,regionId:region.id,cachedDetection:true,found,attempts};
   await fs.appendFile(output,JSON.stringify(result)+'\n');console.log(row.file,region.id,Object.keys(found));
  }
 }
}finally{scanner.destroy();}
