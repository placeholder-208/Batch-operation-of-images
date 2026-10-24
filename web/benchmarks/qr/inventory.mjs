import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deduplicateExactPolygons} from './annotation-utils.mjs';
const root=path.resolve(process.env.QR_DATASET||'test/QRcode');
function jpegMetadata(bytes){
 let rawWidth,rawHeight,orientation=1;
 if(bytes[0]!==255||bytes[1]!==216)return {orientation};
 for(let pos=2;pos+4<bytes.length;){
  if(bytes[pos]!==255)break;const marker=bytes[pos+1];if(marker===218||marker===217)break;
  const length=bytes.readUInt16BE(pos+2),start=pos+4;
  if([192,193,194].includes(marker)){rawHeight=bytes.readUInt16BE(start+1);rawWidth=bytes.readUInt16BE(start+3);}
  if(marker===225&&bytes.subarray(start,start+6).toString()==='Exif\0\0'){
   const t=start+6,little=bytes.toString('ascii',t,t+2)==='II';
   const u16=p=>little?bytes.readUInt16LE(p):bytes.readUInt16BE(p),u32=p=>little?bytes.readUInt32LE(p):bytes.readUInt32BE(p);
   const ifd=t+u32(t+4);for(let j=0;j<u16(ifd);j++){const p=ifd+2+12*j;if(u16(p)===274)orientation=u16(p+8);}
  }
  pos+=length+2;
 }
 return {orientation,rawWidth,rawHeight};
}
function orient(p,{orientation:o,rawWidth:w,rawHeight:h}){
 switch(o){case 2:return {x:w-1-p.x,y:p.y};case 3:return {x:w-1-p.x,y:h-1-p.y};case 4:return {x:p.x,y:h-1-p.y};
 case 5:return {x:p.y,y:p.x};case 6:return {x:h-1-p.y,y:p.x};case 7:return {x:h-1-p.y,y:w-1-p.x};case 8:return {x:p.y,y:w-1-p.x};default:return p;}
}
const files=[];
for(const category of ['blurred','curved']) for(const name of (await fs.readdir(path.join(root,category))).sort()){
 if(!/\.(jpg|jpeg|png)$/i.test(name))continue;
 const file=path.join(root,category,name),bytes=await fs.readFile(file);
 files.push({category,name,file,hash:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,...jpegMetadata(bytes)});
}
const groups=Map.groupBy(files,f=>f.hash),entries=[],issues=[];
for(const siblings of groups.values()){
 const annotations=[];
 for(const file of siblings){
  const txt=file.file.replace(/\.[^.]+$/,'.txt');
  try{
   const text=(await fs.readFile(txt,'utf8')).replace(/^\uFEFF/,'');
   const polygons=[],coordinates=[];
   for(const line of text.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')&&s!=='SETS')){
    const values=line.split(/\s+/).map(Number);
    if(![2,8].includes(values.length)||!values.every(Number.isFinite)){issues.push({file:txt,reason:'unknown-annotation-line'});continue;}
    coordinates.push(...values);
   }
   if(coordinates.length%8)issues.push({file:txt,reason:'incomplete-quadrilateral'});
   for(let start=0;start+7<coordinates.length;start+=8)polygons.push(Array.from({length:4},(_,i)=>({x:coordinates[start+2*i],y:coordinates[start+2*i+1]})));
   const unique=deduplicateExactPolygons(polygons);
   annotations.push({file:txt,rawPolygons:polygons,...unique});
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(!annotations.length)issues.push({files:siblings.map(f=>f.file),reason:'missing-annotation'});
 if(new Set(annotations.map(a=>JSON.stringify(a.polygons))).size>1)issues.push({files:siblings.map(f=>f.file),reason:'conflicting-annotations'});
 const canonical=siblings.find(f=>annotations.some(a=>a.file===f.file.replace(/\.[^.]+$/,'.txt')))||siblings[0];
 entries.push({...canonical,aliases:siblings.map(f=>f.file),rawPolygons:annotations[0]?.rawPolygons??null,
  annotationDuplicates:annotations[0]?.duplicates??[],
  polygons:annotations[0]?.polygons.map(poly=>poly.map(p=>orient(p,canonical)))??null});
}
const summary={images:files.length,uniqueImages:entries.length,extraCopies:files.length-entries.length,
 rawAnnotationCount:entries.reduce((n,e)=>n+(e.rawPolygons?.length||0),0),
 duplicateAnnotationCount:entries.reduce((n,e)=>n+e.annotationDuplicates.length,0),
 uniqueAnnotationCount:entries.reduce((n,e)=>n+(e.polygons?.length||0),0),
 categories:Object.fromEntries(['blurred','curved'].map(c=>[c,{images:files.filter(f=>f.category===c).length,uniqueImages:entries.filter(f=>f.category===c).length,annotatedQR:entries.filter(f=>f.category===c).reduce((n,f)=>n+(f.polygons?.length||0),0)}])),
 annotationType:'Four-corner locations, exact duplicate rows removed and JPEG EXIF orientation applied. Raw annotations retained. No decoded payload ground truth supplied.',
 exifAdjusted:entries.filter(e=>e.orientation!==1).length,issues};
await fs.writeFile(process.env.QR_MANIFEST||new URL('./results/local-manifest.json',import.meta.url),JSON.stringify({summary,entries},null,2));
console.log(JSON.stringify(summary,null,2));
