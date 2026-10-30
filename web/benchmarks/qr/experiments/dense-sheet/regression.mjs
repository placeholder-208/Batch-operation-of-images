import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.QR_PLAYWRIGHT_MODULE||'/tmp/xincai-portrait-runtime/node_modules/playwright/index.mjs').href);
const manifest=JSON.parse(await fs.readFile('benchmarks/qr/results/local-manifest.json','utf8'));
const phase=process.argv[2]||'current',prefix=phase==='baseline'?'/_baseline-js/':'/js/';
const output=process.env.QR_DENSE_REGRESSION||'/tmp/xincai-dense-regression-'+phase+'.json';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),rows=[],errors=[];
try{
 const page=await browser.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:8773/');await page.waitForFunction(()=>window.ZXingWASM&&window.ort);
 for(const detailed of [false,true])for(const [index,entry]of manifest.entries.entries()){
  const file=entry.category+'/'+entry.name;
  const row=await page.evaluate(async({file,prefix,detailed})=>{
   const {decodeQRCode}=await import(prefix+'decoder.js'),{createQRStatistics}=await import(prefix+'qr-statistics.js');
   const image=new Image();image.src='/test/QRcode/'+file;await image.decode();
   const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);
   const options={detailedRecovery:detailed},trace=createQRStatistics(new File([],file),null,{},options);
   const codes=await decodeQRCode(c,trace,options),record=trace.finish(codes);
   const hashes=await Promise.all(codes.map(async code=>({points:code.points,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code.text))),x=>x.toString(16).padStart(2,'0')).join('')})));
   c.width=c.height=1;
   return {file,detailed,codes:hashes,ms:record.totalMs,dense:record.denseDetection||null,errors:record.stages.filter(s=>s.status==='error'),fallbackError:record.fallbackError};
  },{file,prefix,detailed});
  rows.push(row);console.log(phase,detailed?'detailed':'default',index+1,file,row.codes.length,row.ms);
  await fs.writeFile(output,JSON.stringify({phase,rows,errors},null,2));
 }
}finally{await browser.close();}
