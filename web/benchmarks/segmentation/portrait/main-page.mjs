// Real main-page regression: real portrait model, worker, edits, persistence,
// exports, mixed models, and failure recovery. Uses only local HTTP resources.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const sample=process.env.PORTRAIT_SAMPLE;
if(!sample)throw new Error('Set PORTRAIT_SAMPLE to a local portrait JPEG');
const folder=process.env.PORTRAIT_TEST_RESULTS||'/tmp/xincai-portrait-main-'+Date.now();await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let timer;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>requests.push(r.url()));
 page.setDefaultTimeout(180_000);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(process.env.PORTRAIT_APP_URL||'http://127.0.0.1:8772/');
 await page.waitForFunction(()=>document.querySelector('#sam-engine')&&!document.querySelector('.shell').inert);
 await page.locator('#samTab').click();
 assert.equal(requests.filter(u=>u.endsWith('/modnet/onnx/model.onnx')).length,0);
 await page.locator('#sam-engine').selectOption('modnet');
 await page.locator('#sam-file').setInputFiles({name:'portrait.jpg',mimeType:'image/jpeg',buffer:await readFile(sample)});
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled);
 timer=setInterval(async()=>{try{console.log(await page.locator('#sam-status').innerText());}catch{}},15_000);
 await page.locator('#sam-segment').click();
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-maskInfo').textContent.includes('人物连续透明度'));
 assert.equal(requests.filter(u=>u.includes('vision_encoder')).length,0,'portrait must not load SAM');
 for(const id of ['threshold','smooth','candidate'])assert.equal(await page.locator('#sam-'+id).isDisabled(),true);
 const pixels=()=>page.locator('#sam-result').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 const first=await pixels();assert.ok(first.filter((v,i)=>i%4===3&&v>0&&v<255).length>100,'must preserve soft alpha');
 // Edit a patch, regenerate with the same crop, then check the edit survives.
 const canvas=page.locator('#sam-result');await canvas.scrollIntoViewIfNeeded();
 await page.locator('#sam-brushRadius').evaluate(input=>{input.value='30';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#sam-brushMode').selectOption('add');
 const box=await canvas.boundingBox();
 await page.mouse.click(box.x+box.width*.05,box.y+box.height*.05);
 await page.waitForFunction(()=>!document.querySelector('#sam-brushUndo').disabled);
 const edited=await pixels();assert.notDeepEqual(edited,first);
 await page.locator('#sam-segment').click();
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-status').textContent.includes('已保留'));
 assert.deepEqual(await pixels(),edited,'regeneration must retain manual edits');
 await page.waitForFunction(()=>document.querySelector('.save-status').textContent==='已保存到本机');
 await page.reload();
 await page.waitForFunction(()=>!document.querySelector('.shell').inert&&!document.querySelector('#sam-result').hidden);
 assert.equal(await page.locator('#sam-engine').inputValue(),'modnet');
 assert.deepEqual(await pixels(),edited,'refresh must restore continuous alpha and edits');
 assert.equal(await page.locator('#sam-threshold').isDisabled(),true);
 // Actual downloads exercise full-resolution alpha and postprocessing.
 for(const [id,name] of [['download','transparent.png'],['maskDownload','mask.png'],['batchZip','batch.zip']]){
  const downloading=page.waitForEvent('download');await page.locator('#sam-'+id).click();
  await(await downloading).saveAs(folder+'/'+name);
 }
 // Retain the result and edits if the new model attempt fails.
 await page.locator('#sam-engine').selectOption('slimsam');
 await page.route('**/slimsam/onnx/**',route=>route.abort());
 await page.locator('#sam-segment').click();
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-status').textContent.includes('原有结果与修整已保留'));
 assert.deepEqual(await pixels(),edited);
 await page.unroute('**/slimsam/onnx/**');
 await page.locator('#sam-segment').click();
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-modelState').textContent.includes('SlimSAM-77 q8'));
 assert.equal(await page.locator('#sam-threshold').isDisabled(),false);
 await page.locator('#sam-engine').selectOption('modnet');
 await page.locator('#sam-segment').click();
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-modelState').textContent.includes('MODNet FP32'));
 assert.deepEqual(await pixels(),edited,'SAM round-trip must retain edited portrait pixels after regenerating');
 // Add two sources, crop the first, and batch-generate only the unfinished pair.
 await page.locator('#sam-file').setInputFiles([
  {name:'cropped.jpg',mimeType:'image/jpeg',buffer:await readFile(sample)},
  {name:'other.jpg',mimeType:'image/jpeg',buffer:await readFile(sample)}
 ]);
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-filename').textContent.startsWith('cropped.jpg'));
 await page.locator('#sam-sourceView').click();
 const source=page.locator('#sam-source');await source.scrollIntoViewIfNeeded();
 const sourceBox=await source.boundingBox();
 await page.mouse.move(sourceBox.x+sourceBox.width*.1,sourceBox.y+sourceBox.height*.1);await page.mouse.down();
 await page.mouse.move(sourceBox.x+sourceBox.width*.9,sourceBox.y+sourceBox.height*.9,{steps:10});await page.mouse.up();
 await page.locator('#sam-batchGenerate').click();
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-status').textContent.includes('新增 2 张'));
 assert.ok((await page.locator('#sam-status').innerText()).includes('已有结果跳过 1 张'));
 const diagnosticDownload=page.waitForEvent('download');
 // The diagnostic control is inside a collapsed help section.
 await page.locator('#sam-diagnostic').evaluate(button=>button.click());
 const diagnostic=await diagnosticDownload;await diagnostic.saveAs(folder+'/cropped-diagnostic.json');
 const detail=JSON.parse(await readFile(folder+'/cropped-diagnostic.json','utf8'));
 assert.equal(detail.model,'Xenova/modnet');assert.equal(detail.promptMode,'not-used');
 assert.ok(detail.crop[0]>0&&detail.crop[1]>0&&detail.crop[2]<detail.originalSize[0]&&detail.crop[3]<detail.originalSize[1]);
 await page.locator('#sam-nextImage').click();
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-filename').textContent.startsWith('other.jpg'));
 await page.locator('#sam-engine').selectOption('slimsam');await page.locator('#sam-segment').click();
 await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled&&document.querySelector('#sam-modelState').textContent.includes('SlimSAM-77 q8'));
 await page.locator('#sam-batchFormat').selectOption('both');
 const mixedDownload=page.waitForEvent('download');await page.locator('#sam-batchZip').click();await(await mixedDownload).saveAs(folder+'/mixed-batch.zip');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:folder+'/main-page.png',fullPage:true});
 await writeFile(folder+'/result.json',JSON.stringify({status:'passed',checks:['lazy-load','worker-inference','continuous-alpha','brush','regeneration','refresh','PNG','gray-mask','ZIP','failed-run-preserves-result','SAM-round-trip','crop-only-input','batch-skips-completed','mixed-model-export'],errors,portraitModelRequests:requests.filter(u=>u.endsWith('/modnet/onnx/model.onnx')).length},null,2));
 console.log('Main-page regression passed:',folder);
}finally{clearInterval(timer);await browser.close();}
