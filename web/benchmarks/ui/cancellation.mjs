import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/xincai-portrait-runtime/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true});const output=process.env.UI_OUTPUT||'/tmp/xincai-ui-check';await mkdir(output,{recursive:true});
for(const mode of ['qr','barcode','mask']){
 const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/js/reader-worker.js',async route=>{await new Promise(resolve=>setTimeout(resolve,1000));await route.continue();});
 await page.goto(process.env.UI_BASE_URL||'http://127.0.0.1:8787');await page.waitForFunction(()=>!document.querySelector('.shell').inert);
 let buffer;
 if(mode==='barcode'){
  const data=await page.evaluate(()=>{
   const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'],G=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'],parity='LGGLLG',digits='5901234123457';
   let bits='101';for(let i=1;i<7;i++)bits+=(parity[i-1]==='L'?L:G)[Number(digits[i])];bits+='01010';for(let i=7;i<13;i++)bits+=L[Number(digits[i])].split('').map(b=>b==='0'?'1':'0').join('');bits+='101';
   const c=document.createElement('canvas');c.width=(bits.length+24)*4;c.height=220;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';[...bits].forEach((b,i)=>{if(b==='1')x.fillRect((i+12)*4,15,4,165);});return c.toDataURL('image/png').split(',')[1];
  });buffer=Buffer.from(data,'base64');await writeFile(output+'/barcode.png',buffer);
 }else buffer=await readFile(output+'/30-codes.png');
 const input={qr:'#file',barcode:'#barcodeWorkspace input[type=file]',mask:'#maskFile'}[mode],root={qr:'#normalWorkspace',barcode:'#barcodeWorkspace',mask:'#maskWorkspace'}[mode];
 await page.locator('#'+mode+'Tab').click();await page.locator(input).setInputFiles([{name:'first.png',mimeType:'image/png',buffer},{name:'second.png',mimeType:'image/png',buffer}]);
 const start=page.locator({qr:'#qrStart',barcode:'#barcodeStart',mask:'#maskStart'}[mode]);await page.waitForFunction(id=>!document.getElementById(id).disabled,{qr:'qrStart',barcode:'barcodeStart',mask:'maskStart'}[mode]);await start.click();
 await page.locator(root+' .tile[data-state=processing]').first().waitFor();await page.locator('#'+mode+'Stop').click();
 await page.waitForFunction(id=>document.querySelector(id).dataset.running==='false',root,{timeout:120000});
 assert.equal(await page.locator(root+' .tile[data-state=complete]').count(),1);assert.equal(await page.locator(root+' .tile[data-state=pending]').count(),1);assert.equal(await start.isEnabled(),true);
 await start.click();await page.waitForFunction(id=>document.querySelector(id).dataset.running==='false',root,{timeout:120000});assert.equal(await page.locator(root+' .tile[data-state=complete]').count(),2);assert.deepEqual(errors,[]);
 if(mode==='barcode'){assert.equal(await page.locator('#barcodeResults .qr-card').count(),1);assert.match(await page.locator('#barcodeResults pre').textContent(),/5901234123457/);}
 console.log('PASS',mode,'stop finishes current image, preserves next image, resumes successfully');await context.close();
}
await browser.close();
