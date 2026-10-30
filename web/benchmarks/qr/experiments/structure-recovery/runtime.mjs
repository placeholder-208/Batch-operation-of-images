import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
export const {createCanvas,loadImage,ImageData}=require(process.env.QR_CANVAS_MODULE);
export const root=process.cwd(),hash=value=>createHash('sha256').update(value).digest('hex');
globalThis.ImageData=ImageData;globalThis.Worker=undefined;
globalThis.document={createElement:()=>createCanvas(1,1)};
const quiet={log(){},warn(){},error(){}},realm=vm.createContext({console:quiet,performance,Date,URL,File,Blob,ImageData,
 Uint8Array,Uint8ClampedArray,Float32Array,Float64Array,Int32Array,Uint32Array,WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout,Buffer,process});
realm.window=realm;realm.self=realm;
vm.runInContext(await fs.readFile(path.join(root,'zxing/index.js'),'utf8'),realm,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
export const reader=realm.ZXingWASM;
await reader.prepareZXingModule({overrides:{wasmBinary:await fs.readFile(path.join(root,'zxing/zxing_reader.wasm'))}});
globalThis.window={ZXingWASM:reader};
export const decode=image=>reader.readBarcodes(image,{formats:['QRCode'],tryHarder:true});
export const valid=raw=>raw.filter(result=>result.isValid!==false&&result.text&&result.position);
export function crop(image,box,maxEdge){
 const scale=Math.min(1,maxEdge/Math.max(box.width,box.height));
 const canvas=createCanvas(Math.max(1,Math.round(box.width*scale)),Math.max(1,Math.round(box.height*scale)));
 const ctx=canvas.getContext('2d');ctx.drawImage(image,box.left,box.top,box.width,box.height,0,0,canvas.width,canvas.height);
 return {canvas,image:ctx.getImageData(0,0,canvas.width,canvas.height)};
}
export async function remaining(){
 return (await fs.readFile(process.env.QR_RESEARCH_BASELINE||'benchmarks/qr/results/local-3.13-control-research-results.jsonl','utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.matched<row.groundTruth);
}
