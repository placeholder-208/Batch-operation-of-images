import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.QR_PLAYWRIGHT_MODULE||'/tmp/xincai-portrait-runtime/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const output=process.env.QR_DENSE_OUTPUT||'/tmp/xincai-dense-'+Date.now();await mkdir(output,{recursive:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(240000);
 page.on('pageerror',e=>console.log('Page error',e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:8773/');
 await page.waitForFunction(()=>window.ZXingWASM&&window.ort);
 const result=await page.evaluate(async({probe})=>{
  const {decodeQRCode}=await import('/js/decoder.js'),{createQRStatistics}=await import('/js/qr-statistics.js');
  const image=new Image();image.src='/_dense-test/input.jpg';await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
  const trace=createQRStatistics(new File([],'dense-sheet.jpg'),null,{},{}),codes=await decodeQRCode(canvas,trace,{}),record=trace.finish(codes);
  const hashes=await Promise.all(codes.map(async c=>({points:c.points,center:c.center,source:c.source,payloadHash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.text))),x=>x.toString(16).padStart(2,'0')).join('')})));
  const trials=[];
  if(probe){
   const {readBarcodes}=await import('/js/reader-client.js'),ctx=canvas.getContext('2d',{willReadFrequently:true}),data=ctx.getImageData(0,0,canvas.width,canvas.height);
   const base=window.ZXingWASM.defaultReaderOptions;
   for(const options of [{binarizer:'GlobalHistogram'},{tryDownscale:false},{binarizer:'GlobalHistogram',tryDownscale:false}]){
    const t=performance.now(),found=await readBarcodes(data,{formats:['QRCode'],tryHarder:true,...options});
    trials.push({options,count:found.filter(x=>x.isValid!==false).length,ms:performance.now()-t,positions:found.map(x=>x.position)});
   }
   for(let row=0;row<6;row++)for(let col=0;col<5;col++){
    const x=Math.floor(15+col*231),y=Math.floor(65+row*270),w=230,h=260;
    const crop=ctx.getImageData(x,y,w,h),t=performance.now(),found=await readBarcodes(crop,{formats:['QRCode'],tryHarder:true});
    trials.push({cell:row*5+col+1,count:found.filter(x=>x.isValid!==false).length,ms:performance.now()-t});
   }
   const {iterateBackgroundVariants}=await import('/js/preprocess-client.js');
   for(const [id,cx,cy] of [[3,585,220],[4,805,224],[21,145,1275]]){
    const local=document.createElement('canvas');local.width=250;local.height=260;
    local.getContext('2d').drawImage(canvas,cx-125,cy-130,250,260,0,0,250,260);
    for await(const v of iterateBackgroundVariants(local))for(const binarizer of ['LocalAverage','GlobalHistogram']){
     const found=await readBarcodes(v.imageData,{formats:['QRCode'],tryHarder:true,binarizer});
     trials.push({target:id,variant:v.name,binarizer,count:found.filter(x=>x.isValid!==false).length});
    }
    if(id!==21){
     const {decodeCurvedRegion}=await import('/js/curved-region.js'),{decodeBlurredRegion}=await import('/js/blur-restoration.js');
     const statistics={},t=performance.now(),found=await decodeCurvedRegion(local,{maxPixels:360000,maxModels:32,geometryMs:2500,continuousResample:true,statistics});
     trials.push({target:id,variant:'curved',count:found.length,ms:performance.now()-t,statistics});
     const stats={},t2=performance.now(),deblurred=await decodeBlurredRegion(canvas,{left:cx-125,top:cy-130,width:250,height:260},{statistics:stats,budgetMs:3500,detailedRecovery:true,accept:found=>found.length>0});
     trials.push({target:id,variant:'deblur',count:deblurred.length,ms:performance.now()-t2,statistics:stats});
     if(id===4){
      for(const opts of [{useTPS:true},{moduleRecovery:true}]){
       const statistics={},found=await decodeCurvedRegion(local,{maxPixels:360000,maxModels:64,geometryMs:2500,continuousResample:true,statistics,...opts});
       trials.push({target:id,variant:'extra-curved',opts,count:found.length,statistics});
      }
      const {decodeStructureRegion}=await import('/js/structure-decoder.js'),statistics={};
      const found=await decodeStructureRegion(canvas,{left:697,top:107,width:209,height:223},{statistics});
      trials.push({target:id,variant:'structure-gray',count:found.length,statistics});
      const {probe}=await import('/benchmarks/qr/experiments/dense-sheet/phase-probe.js');
      trials.push({target:id,variant:'phase-probe',statistics:await probe(local)});
     }
    }
   }
   const {detectWechatRegions}=await import('/js/wechat-detector.js');
   for(let ty=0;ty<3;ty++)for(let tx=0;tx<2;tx++){
    const w=Math.ceil(canvas.width*.6),h=Math.ceil(canvas.height*.4),left=Math.round(tx*(canvas.width-w)),top=Math.round(ty*(canvas.height-h)/2);
    const tile=document.createElement('canvas');tile.width=w;tile.height=h;tile.getContext('2d').drawImage(canvas,left,top,w,h,0,0,w,h);
    const boxes=await detectWechatRegions(tile);trials.push({detectionTile:[left,top,w,h],boxes:boxes.map(b=>({...b,x:b.x+left,right:b.right+left,y:b.y+top,bottom:b.bottom+top}))});
   }
   // General overlapping tiles, independent of the known 5x6 layout.
   for(let y=0;y<2;y++)for(let x=0;x<2;x++){
    const w=Math.ceil(canvas.width*.6),h=Math.ceil(canvas.height*.6),left=Math.round(x*(canvas.width-w)),top=Math.round(y*(canvas.height-h));
    const local=ctx.getImageData(left,top,w,h);
    for(const binarizer of ['LocalAverage','GlobalHistogram']){
     const found=await readBarcodes(local,{formats:['QRCode'],tryHarder:true,binarizer});
     trials.push({tile:[left,top,w,h],binarizer,count:found.length,centers:found.map(c=>({x:(c.position.topLeft.x+c.position.bottomRight.x)/2+left,y:(c.position.topLeft.y+c.position.bottomRight.y)/2+top}))});
    }
   }
   return {width:canvas.width,height:canvas.height,codes:hashes,record,base,trials};
  }
  return {width:canvas.width,height:canvas.height,codes:hashes,record};
 },{probe:process.env.QR_DENSE_PROBE==='1'});
 await writeFile(output+'/result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({output,width:result.width,height:result.height,count:result.codes.length,ms:result.record.totalMs,trials:result.trials,variants:result.record.variants,regions:result.record.regions.map(r=>({id:r.id,box:r.box,outcome:r.outcome,reason:r.reason}))},null,2));
}finally{await browser.close();}
