import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.QR_PLAYWRIGHT_MODULE||'/tmp/xincai-portrait-runtime/node_modules/playwright/index.mjs').href);
if(!process.env.QR_DENSE_IMAGE)throw new Error('Set QR_DENSE_IMAGE to the local 30-code photo');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:8773/');await page.waitForFunction(()=>!document.querySelector('.shell').inert);
 await page.locator('#file').setInputFiles(process.env.QR_DENSE_IMAGE);await page.locator('#qrStart').click();
 await page.waitForFunction(()=>document.querySelectorAll('#qrResults .qr-card').length===30);
 await page.waitForFunction(()=>!document.getElementById('qrStatisticsJSON').disabled);
 const pending=page.waitForEvent('download');await page.locator('#qrStatisticsJSON').click();
 const download=await pending,stats=JSON.parse(await fs.readFile(await download.path(),'utf8')).records[0].statistics;
 assert.equal(stats.decodedCount,30);assert.equal(stats.unresolvedRegionCount,0);assert.equal(stats.failedStageCount,0);
 assert.equal(stats.denseDetection.status,'ok');assert.equal(stats.regions.filter(r=>r.denseSampling?.status==='decoded').length,1);
 const zipDownload=page.waitForEvent('download');await page.locator('#downloadAllZip').click();
 const zip=await zipDownload;assert.ok((await fs.stat(await zip.path())).size>1000);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',cards:30,unresolved:stats.unresolvedRegionCount,decoder:stats.settings.decoderRevision,checks:['actual-main-page','30-result-cards','statistics-JSON','ZIP-export','no-page-errors']},null,2));
}finally{await browser.close();}
