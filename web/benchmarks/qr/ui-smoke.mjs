import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.QR_PLAYWRIGHT_MODULE?pathToFileURL(process.env.QR_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[],missing=[];
 page.setDefaultTimeout(120000);
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)missing.push({url:r.url(),status:r.status()});});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:8768/');
 await page.waitForFunction(()=>!document.querySelector('.shell').inert);
 assert.equal(await page.locator('#qrReordered').count(),0);
 assert.equal(await page.locator('#qrUseTPS').isChecked(),false);
 assert.equal(await page.locator('#qrDetailedRecovery').isChecked(),false);
 // Seed an older persisted setting: the retired false switch must not restore the old algorithm.
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  const req=indexedDB.open('xincai-workspace',1);req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{const db=req.result,tx=db.transaction('workspaces','readwrite');
   tx.objectStore('workspaces').put({schema:1,revision:1,assets:[],data:{version:1,items:[],position:-1,
    zipOutput:true,experiments:{reordered:false,useTPS:true}}},'qr');
   tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
  };
 }));
 await page.reload();await page.waitForFunction(()=>!document.querySelector('.shell').inert);
 assert.equal(await page.locator('#qrUseTPS').isChecked(),true);
 await page.locator('#qrMode details').filter({has:page.locator('#qrUseTPS')}).locator('summary').click();
 await page.locator('#qrUseTPS').uncheck();
 await page.waitForFunction(()=>document.querySelector('.save-status').dataset.state==='saved');
 const options=await page.evaluate(()=>new Promise(resolve=>{
  const req=indexedDB.open('xincai-workspace',1);req.onsuccess=()=>{const db=req.result;
   const read=db.transaction('workspaces').objectStore('workspaces').get('qr');
   read.onsuccess=()=>{db.close();resolve(read.result.data);};};
 }));
 assert.deepEqual(options.options,{useTPS:false,detailedRecovery:false});assert.equal(options.experiments,undefined);
 await page.locator('#qrDetailedRecovery').check();
 await page.waitForFunction(()=>document.querySelector('.save-status').dataset.state==='saved');
 await page.reload();await page.waitForFunction(()=>!document.querySelector('.shell').inert);
 assert.equal(await page.locator('#qrDetailedRecovery').isChecked(),true);
 assert.equal(await page.locator('#qrUseTPS').isChecked(),false);
 const file=path.resolve('test/QRcode/curved/image017.jpg');
 await page.locator('#file').setInputFiles(file);
 await page.locator('#qrStart').click();
 await page.waitForFunction(()=>document.querySelectorAll('#qrResults .qr-card').length===2);
 await page.waitForFunction(()=>!document.getElementById('qrStatisticsJSON').disabled);
 const downloadPromise=page.waitForEvent('download');await page.locator('#qrStatisticsJSON').click();
 const download=await downloadPromise,report=JSON.parse(await fs.readFile(await download.path(),'utf8'));
 const record=report.records[0].statistics;
 assert.equal(record.decodedCount,2);assert.equal(record.settings.pipeline,'region-first');
 assert.equal(record.settings.useTPS,false);assert.equal(record.variants.length,1);
 assert.equal(record.settings.detailedRecovery,true);
 const zipPromise=page.waitForEvent('download');await page.locator('#downloadAllZip').click();
 const zip=await zipPromise;assert.ok((await fs.stat(await zip.path())).size>100);
 await page.waitForFunction(()=>document.querySelector('.save-status').dataset.state==='saved');
 await page.reload();await page.waitForFunction(()=>!document.querySelector('.shell').inert);
 assert.equal(await page.locator('#qrResults .qr-card').count(),2);
 await page.locator('#maskTab').click();await page.locator('#maskFile').setInputFiles(file);
 await page.locator('#maskStart').click();
 await page.waitForFunction(()=>/已设置|自动检测完成|完成/.test(document.getElementById('maskStatus').textContent));
 await page.waitForFunction(()=>!document.getElementById('maskDownload').disabled);
 for(const mode of ['barcode','semantic','sam','qr'])await page.locator('#'+mode+'Tab').click();
 const barcode=await page.evaluate(async()=>{
  const {decodeBarcodes}=await import('/js/barcode-decoder.js');
  const {iterateBackgroundVariants}=await import('/js/preprocess-client.js');
  const text='5901234123457',left=['0001101','0011001','0010011','0111101','0100011',
   '0110001','0101111','0111011','0110111','0001011'];
  const invert=s=>s.replace(/[01]/g,b=>b==='0'?'1':'0'),parity='LGGLLG';
  let bits='101';
  for(let i=1;i<7;i++)bits+=parity[i-1]==='L'?left[+text[i]]:invert(left[+text[i]]).split('').reverse().join('');
  bits+='01010';for(let i=7;i<13;i++)bits+=invert(left[+text[i]]);bits+='101';
  const canvas=document.createElement('canvas');canvas.width=(bits.length+24)*3;canvas.height=160;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='black';
  for(let i=0;i<bits.length;i++)if(bits[i]==='1')ctx.fillRect((i+12)*3,20,3,120);
  const codes=await decodeBarcodes(iterateBackgroundVariants(canvas),()=>{},canvas);
  return codes.map(c=>({text:c.text,format:c.format}));
 });
 assert.equal(barcode.length,1);assert.equal(barcode[0].text,'5901234123457');
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
 console.log(JSON.stringify({status:'passed',checks:['TPS default','legacy setting migration','two QR results',
  'statistics export','ZIP export','refresh restoration','QR covering','five tabs','EAN13 decoding','detailed setting persistence'],codes:record.decodedCount}));
}finally{await browser.close();}
