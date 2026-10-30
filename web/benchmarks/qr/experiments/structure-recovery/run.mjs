import fs from 'node:fs/promises';
import path from 'node:path';
import {root,hash,loadImage,decode,valid,crop,remaining} from './runtime.mjs';
import {linearSpectrum,wiener,tv} from './frequency.mjs';
const option=(name,fallback)=>process.argv.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3)||fallback;
const mode=option('mode','gamma'),names=option('files','').split(',').filter(Boolean),edges=option('edges','384').split(',').map(Number);
const output=option('output','benchmarks/qr/results/local-research-'+mode+'.jsonl');await fs.writeFile(output,'');
const filters=[...[1,1.5,2,2.5,3].map(sigma=>({sigma,regularization:.01}))];
for(const length of [5,9,13])for(const angle of [0,45,90,135])filters.push({length,angle,sigma:.6,regularization:.02});
for(const row of await remaining()){
 if(names.length&&!names.includes(row.file))continue;
 const filename=path.join(root,'test/QRcode',row.file);if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Changed image');
 const image=await loadImage(filename);
 for(const region of row.record.regions.filter(region=>!region.covered&&region.crop)){
  const began=performance.now(),result={file:row.file,regionId:region.id,cachedDetection:true,diagnosticOnly:true,attempts:[],codes:[]};
  let previousEdge=0;
  for(const edge of edges){
   const actual=Math.min(edge,Math.max(region.crop.width,region.crop.height));if(actual===previousEdge)continue;previousEdge=actual;
   const scaled=crop(image,region.crop,edge),ratio=actual/Math.min(384,Math.max(region.crop.width,region.crop.height));
   outer:for(const gamma of mode==='gamma'?[1,1.8,2.2,2.6]:[1]){
    const source=linearSpectrum(scaled.image,gamma);
    for(const original of mode==='tv'?[{sigma:0},{sigma:1},{sigma:2},{sigma:3},...[0,45,90,135].map(angle=>({length:9,angle,sigma:.6}))]:filters){
     const config={...original};for(const key of ['sigma','length'])if(config[key]!==undefined)config[key]*=ratio;
     const outputs=mode==='tv'?tv(source,config,{lambda:Number(option('lambda','.002')),iterations:20}):[{image:wiener(source,config)}];
     for(const attempt of outputs){
      const found=valid(await decode(attempt.image));
      result.attempts.push({edge,gamma,config,iteration:attempt.iteration,decoded:found.length});
      if(found.length){
       result.codes=found.map(code=>({payloadHash:hash(code.text),points:[code.position.topLeft,code.position.topRight,code.position.bottomRight,code.position.bottomLeft].map(p=>({x:region.crop.left+p.x*region.crop.width/scaled.canvas.width,y:region.crop.top+p.y*region.crop.height/scaled.canvas.height}))}));
       result.selected=result.attempts.at(-1);break outer;
      }
     }
    }
   }
   scaled.canvas.width=scaled.canvas.height=1;if(result.codes.length)break;
   console.log(mode,row.file,region.id,'edge',edge,'attempts',result.attempts.length,'none');
  }
  result.elapsedMs=Math.round(performance.now()-began);await fs.appendFile(output,JSON.stringify(result)+'\n');
  console.log('DONE',mode,row.file,region.id,'codes',result.codes.length,'ms',result.elapsedMs,result.selected||'');
 }
}
