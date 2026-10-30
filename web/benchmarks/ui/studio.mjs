// Real browser checks. All generated QR/barcode fixtures are synthetic; no cloud API calls.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/xincai-portrait-runtime/node_modules/playwright/index.mjs');
const base=process.env.UI_BASE_URL||'http://127.0.0.1:8787';
const output=process.env.UI_OUTPUT||'/tmp/xincai-ui-check';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));
const checks=[];function passed(name){checks.push(name);console.log('PASS',name);}
async function ready(){await page.goto(base);await page.waitForFunction(()=>!document.querySelector('.shell').inert);}
await ready();
const matrices=JSON.parse(await readFile(new URL('./fixtures/qr-matrices.json',import.meta.url),'utf8'));
const sheet=await page.evaluate(matrices=>{
 const c=document.createElement('canvas'),size=205,unit=5;c.width=size*5;c.height=size*6;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#000';
 matrices.forEach((rows,k)=>rows.forEach((row,y)=>[...row].forEach((v,i)=>{if(v==='1')x.fillRect(k%5*size+10+i*unit,Math.floor(k/5)*size+10+y*unit,unit,unit);})));
 return c.toDataURL('image/png').split(',')[1];
},matrices);
const fixture=output+'/30-codes.png';await writeFile(fixture,Buffer.from(sheet,'base64'));
await page.locator('#file').setInputFiles(fixture);await page.waitForFunction(()=>!document.querySelector('#qrStart').disabled);
await page.locator('#qrStart').click();await page.waitForFunction(()=>document.querySelector('#normalWorkspace').dataset.running==='false',{},{timeout:120000});
assert.equal(await page.locator('#qrResults .qr-card').count(),30);passed('real ZXing/WeChat pipeline returns 30 synthetic QR results');
await page.screenshot({path:output+'/desktop-30-results.png'});
for(const [width,height]of [[1440,900],[1280,720],[1024,768],[768,1024],[390,844]]){
 await page.setViewportSize({width,height});
 for(const mode of ['qr','barcode','mask','semantic','sam']){
  await page.locator('#'+mode+'Tab').click();
  const state=await page.evaluate(()=>{const r=[...document.querySelectorAll('.workspace')].find(r=>!r.hidden);return {overflow:document.documentElement.scrollWidth>innerWidth,unique:new Set([...document.querySelectorAll('[id]')].map(x=>x.id)).size===document.querySelectorAll('[id]').length,title:document.title};});
  assert.equal(state.overflow,false,`${width} ${mode} horizontal overflow`);assert.equal(state.unique,true);
  assert.ok(state.title.startsWith('心裁 · '));
 }
 await page.locator('#qrTab').click();
 const rect=await page.locator(width>900?'#normalWorkspace .output-panel':'#normalWorkspace .mobile-actionbar').boundingBox();
 assert.ok(rect.y>=0&&rect.y+rect.height<=height+2,`${width} export/action area is reachable`);
 if(width<=900){assert.equal(await page.locator('#normalWorkspace .stage-panel > .batch-rail').count(),1);assert.equal(await page.locator('#canvas').evaluate(e=>getComputedStyle(e).touchAction),'pan-y pinch-zoom');}
 await page.screenshot({path:output+`/qr-${width}.png`});
}
passed('five workspaces at five viewports: unique IDs, no sideways overflow, reachable export/actions');
await page.setViewportSize({width:1440,height:900});
assert.equal(await page.locator('#qrStart').evaluate(el=>el.closest('.task-panel')!==null),true);
await page.locator('#normalWorkspace .viewport-controls select').selectOption('200');
assert.equal(await page.locator('#canvas').evaluate(el=>Math.round(el.getBoundingClientRect().width)),2050);
await page.locator('#qrResults .qr-card').nth(8).click({position:{x:120,y:20}});assert.ok(await page.locator('#qr-card-9').evaluate(e=>e.classList.contains('active')));passed('zoom and result-card locate preserve handlers');
await page.waitForFunction(()=>document.querySelector('.save-status').dataset.state==='saved');await ready();
assert.equal(await page.locator('#qrResults .qr-card').count(),30);assert.equal(await page.locator('#normalWorkspace .restored-banner').count(),1);passed('refresh restores source, 30 results and recovery banner');
const downloads=page.waitForEvent('download');await page.locator('#downloadAllZip').click();const download=await downloads;await download.saveAs(output+'/qr-results.zip');assert.equal(await download.failure(),null);passed('actual 30-code ZIP download');
await page.locator('#resetImages').click();assert.equal(await page.locator('#qrResults .qr-card').count(),30);assert.match(await page.locator('#resetImages').textContent(),/确认/);await page.locator('#resetImages').click();assert.equal(await page.locator('#qrResults .qr-card').count(),0);passed('two-step clear preserves data until confirmation');
const blank=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=320;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,320,320);return c.toDataURL('image/png').split(',')[1];});
await page.locator('#file').setInputFiles({name:'blank.png',mimeType:'image/png',buffer:Buffer.from(blank,'base64')});await page.waitForFunction(()=>!document.querySelector('#qrStart').disabled);await page.locator('#qrStart').click();await page.waitForFunction(()=>document.querySelector('#normalWorkspace').dataset.running==='false');assert.equal(await page.locator('#qrResults .empty').getAttribute('data-state'),'no-result');passed('valid blank image has a distinct no-result state');await page.locator('#resetImages').click();await page.locator('#resetImages').click();
// Demonstrate a real failure without a network request.
await page.locator('#file').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('invalid image')});await page.waitForFunction(()=>!document.querySelector('#qrStart').disabled);await page.locator('#qrStart').click();await page.waitForFunction(()=>document.querySelector('#normalWorkspace').dataset.running==='false');assert.equal(await page.locator('#qrResults .empty').getAttribute('data-state'),'error');assert.match(await page.locator('#qrStart').textContent(),/重试/);passed('invalid image exposes error state and retry action');
await page.locator('#samTab').click();await page.locator('#sam-file').setInputFiles(process.env.PORTRAIT_SAMPLE||'/tmp/xincai-portrait-sample.jpg');await page.waitForFunction(()=>!document.querySelector('#sam-segment').disabled);
await page.locator('#sam-engine').selectOption('modnet');await page.locator('#sam-segment').click();await page.waitForFunction(()=>document.querySelector('#samWorkspace').dataset.running==='false'&&!document.querySelector('#sam-result').hidden,{},{timeout:120000});
assert.equal(await page.locator('#samWorkspace').getAttribute('data-view'),'mask');assert.equal(await page.locator('#samWorkspace .brush-quickbar').isVisible(),true);assert.equal(await page.locator('#sam-candidate').isVisible(),false);assert.equal(await page.locator('#sam-invert').isVisible(),true);assert.equal(await page.locator('#samWorkspace .regenerate-controls').getAttribute('open'),null);
const exportRect=await page.locator('#samWorkspace .output-panel').boundingBox();assert.ok(exportRect.y+exportRect.height<=902);passed('real MODNet: contextual inspector, visible brush tools and export, alpha controls');
await page.screenshot({path:output+'/sam-mask-desktop.png'});
await page.locator('.brush-mode-switch button[data-value=erase]').click();assert.equal(await page.locator('#sam-brushMode').inputValue(),'erase');
const canvas=page.locator('#sam-result'),box=await canvas.boundingBox();await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5,{button:'right'});await page.waitForFunction(()=>document.querySelector('.brush-mode-switch button[data-value=add]').getAttribute('aria-pressed')==='true');passed('brush segment and canvas right-click stay synchronized');
await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.48,box.y+box.height*.52,{steps:5});await page.mouse.up();await page.waitForFunction(()=>!document.querySelector('#sam-brushUndo').disabled);passed('moved brush controls still edit mask');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/sam-mask-mobile.png'});assert.equal(await page.locator('#samWorkspace .sam-main > .brush-quickbar').count(),1);await page.locator('#samWorkspace .browse-toggle').click();assert.equal(await canvas.evaluate(e=>getComputedStyle(e).touchAction),'pan-y pinch-zoom');passed('mobile editor docking and browse mode release touch scrolling');
assert.deepEqual(errors,[]);await writeFile(output+'/results.json',JSON.stringify({checks,errors},null,2));console.log('evidence',output);await browser.close();
