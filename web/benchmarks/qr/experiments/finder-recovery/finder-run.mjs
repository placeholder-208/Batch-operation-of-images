import fs from 'node:fs/promises';
import path from 'node:path';
import {root,hash,createCPP,loadImage,crop,opt,ImageData} from '../decoder-comparison/common.mjs';
import {scanFinderProposals,finderHomography} from './scan-finders.mjs';
import {renderContinuousModel,renderCurvedModel} from '../../../../js/curved-region.js';
const output=opt('output','benchmarks/qr/results/local-finder-scans.jsonl'),edgeList=opt('edges','384,600').split(',').map(Number);
const budgetMs=Number(opt('budget-ms','700')),names=opt('files','').split(',').filter(Boolean);
const rows=(await fs.readFile('benchmarks/qr/results/local-production-3.14-detailed-results.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const targets={'blurred/image019.jpg':[1,3],'blurred/image020.jpg':[1,2],'blurred/image021.jpg':[1],'blurred/image045.jpg':[1]};
const reader=await createCPP();await fs.writeFile(output,'');
const rgba=image=>new ImageData(image.data,image.width,image.height);
const sample=(gray,width,height,x,y)=>{
 if(x<0||y<0||x>=width-1||y>=height-1)return NaN;
 const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy,i=iy*width+ix;
 return (1-ty)*((1-tx)*gray[i]+tx*gray[i+1])+ty*((1-tx)*gray[i+width]+tx*gray[i+width+1]);
};
for(const row of rows){
 if(!targets[row.file]||names.length&&!names.includes(row.file))continue;
 const filename=path.join(root,'test/QRcode',row.file);
 if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Changed image');
 const original=await loadImage(filename);
 for(const region of row.record.regions.filter(r=>targets[row.file].includes(r.id))){
  const began=performance.now(),record={file:row.file,regionId:region.id,diagnosticOnly:true,cachedDetection:true,sha256:row.sha256,crop:region.crop,attempts:[],codes:[]};
  let previousEdge=0;
  for(const edge of edgeList){
   const actualEdge=Math.min(edge,Math.max(region.crop.width,region.crop.height));if(actualEdge===previousEdge)continue;previousEdge=actualEdge;
   const input=crop(original,region.crop,edge),started=performance.now();
   const proposal=scanFinderProposals(input.image,{budgetMs});
   const detail={edge,proposal,decodeAttempts:0,decodeMs:0,invalidMappings:0};record.attempts.push(detail);
   const gray=Float64Array.from({length:input.image.width*input.image.height},(_,i)=>.299*input.image.data[i*4]+.587*input.image.data[i*4+1]+.114*input.image.data[i*4+2]);
   for(const [index,group]of proposal.groups.entries()){
    const [tl,tr,bl]=group.finders,ax=tr.x-tl.x,ay=tr.y-tl.y,bx=bl.x-tl.x,by=bl.y-tl.y;
    const estimate=7+(Math.hypot(ax,ay)+Math.hypot(bx,by))/(2*group.moduleSize);
    const dimensions=Array.from({length:40},(_,i)=>21+i*4).sort((a,b)=>Math.abs(a-estimate)-Math.abs(b-estimate)).slice(0,8);
    for(const dimension of dimensions){
     const fitted=process.argv.includes('--homography')?finderHomography(group,dimension):null;
     if(process.argv.includes('--homography')&&!fitted)continue;
     const map=fitted?.map||((x,y)=>({x:tl.x+(x-3.5)*ax/(dimension-7)+(y-3.5)*bx/(dimension-7),y:tl.y+(x-3.5)*ay/(dimension-7)+(y-3.5)*by/(dimension-7)}));
     const rendered=renderContinuousModel({dimension},map,gray,input.image.width,input.image.height);
     if(!rendered){detail.invalidMappings++;continue;}
     const variants=[{image:rgba(rendered),label:'continuous-gray'}];
     const values=new Float64Array(dimension*dimension);let valid=true;
     for(let y=0;y<dimension;y++)for(let x=0;x<dimension;x++){
      const p=map(x+.5,y+.5),i=y*dimension+x;values[i]=sample(gray,input.image.width,input.image.height,p.x,p.y);if(!Number.isFinite(values[i]))valid=false;
     }
     if(valid){
      const normalized=Float64Array.from(values,(v,i)=>{
       const x=i%dimension,y=Math.floor(i/dimension);let low=255,high=0;
       for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const value=values[Math.max(0,Math.min(dimension-1,y+dy))*dimension+Math.max(0,Math.min(dimension-1,x+dx))];low=Math.min(low,value);high=Math.max(high,value);
       }
       return (v-low)/Math.max(8,high-low);
      });
      for(const cutoff of [.4,.5,.6])variants.push({image:rgba(renderCurvedModel({dimension,samples:normalized,cutoff})),label:'module-threshold-'+cutoff});
     }
     for(const variant of variants)for(const pure of [false,true]){
      const decodeStarted=performance.now(),codes=await reader.decode(variant.image,{pure});detail.decodeMs+=performance.now()-decodeStarted;detail.decodeAttempts++;
      if(codes.length){
       record.codes=codes.map(code=>({payloadHash:hash(code.text),points:code.points.map(p=>input.map(map(p.x/8-4,p.y/8-4)))}));
       record.selected={edge,group:index,dimension,estimate,variant:variant.label,pure};break;
      }
     }
     if(record.codes.length)break;
    }
    if(record.codes.length)break;
   }
   detail.elapsedMs=performance.now()-started;input.canvas.width=input.canvas.height=1;
   if(record.codes.length)break;
  }
  record.elapsedMs=performance.now()-began;await fs.appendFile(output,JSON.stringify(record)+'\n');
  console.log(row.file,region.id,'groups',record.attempts.map(a=>a.proposal.groups.length),'decode',record.attempts.reduce((s,a)=>s+a.decodeAttempts,0),'codes',record.codes.length,'ms',Math.round(record.elapsedMs),record.selected||'');
 }
}
