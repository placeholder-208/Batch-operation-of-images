import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.QR_PLAYWRIGHT_MODULE?pathToFileURL(process.env.QR_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const rows=[];
try{
 const page=await browser.newPage();page.setDefaultTimeout(180000);
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:8768/');
 await page.waitForFunction(()=>window.ZXingWASM&&window.ort);
 const expected={'curved/image017.jpg':2,'curved/image021.jpg':2,'curved/image024.jpg':2,
  'curved/image026.jpg':1,'curved/image036.jpg':1,'curved/image042.jpg':1,'blurred/image015.jpg':2,
  'blurred/image016.jpg':3,'blurred/image018.jpg':3,'blurred/image021.jpg':1,'blurred/image008.jpg':1};
 if(process.argv.includes('--detailed'))expected['blurred/image005.jpg']=1;
 const filter=process.argv.find(a=>a.startsWith('--files='));
 const files=filter?filter.slice(8).split(','):Object.keys(expected);
 for(const file of files){
   assert.ok(file in expected,'Unknown browser regression sample: '+file);
   const row=await page.evaluate(async({file,tps,detailedRecovery})=>{
    const {decodeQRCode}=await import('/js/decoder.js');
    const {createQRStatistics}=await import('/js/qr-statistics.js');
    const image=new Image();image.src='/test/QRcode/'+file;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0);
    const options={useTPS:tps,detailedRecovery};const trace=createQRStatistics(new File([],file),null,{},options);
    const codes=await decodeQRCode(canvas,trace,options);
    const record=trace.finish(codes);canvas.width=canvas.height=1;
    return {file,count:codes.length,record};
   },{file,tps:process.argv.includes('--tps'),detailedRecovery:process.argv.includes('--detailed')});
   rows.push(row);console.log(file,row.count,row.record.totalMs);
   assert.equal(row.count,expected[file],file);
   assert.equal(row.record.variants.length,1);
   assert.equal(row.record.settings.continuousResample,true);
 }
 await fs.writeFile(new URL('./results/local-browser'+(process.argv.includes('--tps')?'-tps':'')+(process.argv.includes('--detailed')?'-detailed':'')+'.json',import.meta.url),JSON.stringify(rows,null,2));
}finally{await browser.close();}
