import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
export const root=path.resolve(process.env.QR_WEB_ROOT||'.');
export const hash=value=>createHash('sha256').update(value).digest('hex');
const require=createRequire(import.meta.url);
export const {createCanvas,loadImage,ImageData}=require(process.env.QR_CANVAS_MODULE||'@napi-rs/canvas');
Object.assign(globalThis,{ImageData,Worker:undefined,document:{createElement:()=>createCanvas(1,1)}});
export async function createCPP({modulePath,name='zxing-cpp'}={}){
 const realm=vm.createContext({console:{log(){},warn(){},error(){}},performance,Date,URL,File,Blob,ImageData,
  Uint8Array,Uint8ClampedArray,Float32Array,Float64Array,Int32Array,Uint32Array,WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout,Buffer,process});
 realm.window=realm;realm.self=realm;
 const script=modulePath?path.join(modulePath,'dist/iife/reader/index.js'):path.join(root,'zxing/index.js');
 const binary=modulePath?path.join(modulePath,'dist/reader/zxing_reader.wasm'):path.join(root,'zxing/zxing_reader.wasm');
 vm.runInContext(await fs.readFile(script,'utf8'),realm,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
 const reader=realm.ZXingWASM;
 await reader.prepareZXingModule({fireImmediately:true,overrides:{wasmBinary:await fs.readFile(binary)}});
 globalThis.window={ZXingWASM:reader};
 return {name,version:reader.ZXING_WASM_VERSION||reader.ZXING_CPP_VERSION||'project-bundled',cppCommit:reader.ZXING_CPP_COMMIT,
  async decode(image,{pure=false}={}){
   const raw=await reader.readBarcodes(image,{formats:['QRCode'],tryHarder:true,isPure:pure,returnErrors:true});
   const codes=raw.filter(r=>r.isValid!==false&&r.text&&r.position).map(r=>({text:r.text,
    points:[r.position.topLeft,r.position.topRight,r.position.bottomRight,r.position.bottomLeft],positionKind:'decoder-quadrilateral'}));
   codes.diagnostics={invalid:raw.filter(r=>r.isValid===false).map(r=>({error:r.error||null,format:r.format,position:!!r.position}))};
   return codes;
  }};
}
export function crop(image,box,maxEdge=Infinity){
 const scale=Math.min(1,maxEdge/Math.max(box.width,box.height));
 const canvas=createCanvas(Math.max(1,Math.round(box.width*scale)),Math.max(1,Math.round(box.height*scale)));
 canvas.getContext('2d').drawImage(image,box.left,box.top,box.width,box.height,0,0,canvas.width,canvas.height);
 return {canvas,image:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),
  map:p=>({x:box.left+p.x*box.width/canvas.width,y:box.top+p.y*box.height/canvas.height})};
}
export function regionCrop(region,width,height){
 if(region.crop)return {...region.crop};
 const b=region.box,padX=(b.right-b.x)*.15,padY=(b.bottom-b.y)*.15;
 const left=Math.max(0,Math.floor(b.x-padX)),top=Math.max(0,Math.floor(b.y-padY));
 return {left,top,width:Math.min(width,Math.ceil(b.right+padX))-left,height:Math.min(height,Math.ceil(b.bottom+padY))-top};
}
export function ordered(points){const c={x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length};return points.slice().sort((a,b)=>Math.atan2(a.y-c.y,a.x-c.x)-Math.atan2(b.y-c.y,b.x-c.x));}
const cross=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
export const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0))/2;
function clip(subject,mask){let out=subject;for(let i=0;i<mask.length;i++){
 const a=mask[i],b=mask[(i+1)%mask.length],input=out;out=[];
 for(let j=0;j<input.length;j++){const p=input[j],q=input[(j+1)%input.length],cp=cross(a,b,p),cq=cross(a,b,q);
  if(cp>=0)out.push(p);if((cp>=0)!==(cq>=0)){const t=cp/(cp-cq);out.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)});}}
 if(!out.length)break;}return out;}
export function iou(p,g){p=ordered(p);g=ordered(g);const x=area(clip(p,g));return x/(area(p)+area(g)-x)||0;}
export function metrics(codes,polygons){
 const gt=polygons||[],scores=codes.map(c=>gt.map(g=>c.points?.length===4?iou(c.points,g):0));
 const owners=new Map();
 function assign(i,seen){for(const [j,score]of scores[i].map((v,j)=>[j,v]).sort((a,b)=>b[1]-a[1])){
  if(score<.3||seen.has(j))continue;seen.add(j);if(!owners.has(j)||assign(owners.get(j),seen)){owners.set(j,i);return true;}}return false;}
 codes.forEach((_,i)=>assign(i,new Set()));
 return {groundTruth:gt.length,matched:owners.size,unmatchedGroundTruth:gt.map((_,i)=>i).filter(i=>!owners.has(i)),
  unmatchedDecoded:codes.map((_,i)=>i).filter(i=>![...owners.values()].includes(i)),bestIoU:scores.map(r=>Math.max(0,...r))};
}
export function merge(codes,found){
 for(const code of found){
  if(!code.points?.every(p=>Number.isFinite(p.x+p.y)))continue;
  if(!codes.some(c=>c.payloadHash===code.payloadHash&&iou(c.points,code.points)>.3))codes.push(code);
 }
 return codes;
}
export const opt=(key,fallback)=>process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3)||fallback;
