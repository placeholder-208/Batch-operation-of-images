import { $, downloadBlob } from './ui.js?v=sam-1.8';
import { canvasToBlob } from './image.js';
import { detectObjects, semanticCSV } from './semantic-client.js?v=diagnostics-1.8.2';

export function createSemanticUI(actions) {
    const tab=document.createElement('button');tab.id='semanticTab';tab.className='tab';tab.textContent='语义裁剪 · 测试';
    tab.setAttribute('role','tab');tab.setAttribute('aria-controls','semanticWorkspace');tab.setAttribute('aria-selected','false');tab.tabIndex=-1;
    $('maskTab').after(tab);
    const root=document.createElement('section');root.id='semanticWorkspace';root.className='workspace';root.hidden=true;
    root.setAttribute('role','tabpanel');root.setAttribute('aria-labelledby','semanticTab');
    root.innerHTML=`<section class="panel"><div class="panel-head"><h2>目标检测预览</h2><div class="tools" style="margin:0"><button class="secondary" id="semanticReset">清空</button><button class="secondary" id="semanticAdd">添加图片</button></div></div>
    <div class="stage" id="semanticStage"><div class="upload" id="semanticUpload"><div class="upload-icon" aria-hidden="true">⌗</div><strong>用一句话，选择一批图片中的对象</strong><p>先预览检测框，再导出裁图</p><button class="primary" id="semanticChoose">选择图片</button><span class="small">JPEG · PNG · WebP，测试每批最多 10 张</span></div><canvas id="semanticCanvas" hidden aria-label="目标框预览，点击目标框定位结果"></canvas></div>
    <div class="image-footer"><span id="semanticFilename">尚未选择图片</span><span id="semanticDimensions">原图预览</span></div><div class="tiles" id="semanticTiles" hidden></div></section>
    <aside class="panel"><div class="panel-head"><h2>描述与裁剪</h2><span class="small" id="semanticCount">0 张图片</span></div><div class="side-body"><p class="eyebrow">SEMANTIC CROP · GROQ</p><h3>指定对象，批量裁出。</h3><p>例如“所有杯子，包含杯柄”或“左边的红色瓶子”。返回矩形裁图，保留框内背景，不是透明抠图。</p>
    <label for="semanticPrompt">要裁剪的对象</label><textarea id="semanticPrompt" rows="3" maxlength="500" placeholder="裁剪所有杯子，包含完整杯柄" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;font:inherit;resize:vertical"></textarea>
    <label for="semanticToken" class="small">测试访问口令（不是 Groq API Key）</label><input id="semanticToken" type="password" autocomplete="off" maxlength="256" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px" placeholder="填写你设置的测试口令">
    <label class="notice" style="display:block"><input id="semanticConsent" type="checkbox"> 我同意将检测用的缩小图片和描述发送给 Groq；不上传敏感图片。</label>
    <label class="notice" style="display:block"><input id="semanticSam" type="checkbox"> 完成后自动进入本地分割，生成透明蒙版</label>
    <div class="notice">取本批首张有识别结果图片的第一个框（按接口返回顺序），裁图后送入 SlimSAM。不增加 API 调用，其余裁图与 CSV 保留在此页。分割结果仍需检查。</div>
    <button class="primary full" id="semanticStart" style="margin-top:16px" disabled>开始检测待处理图片</button><button class="secondary full" id="semanticStop" style="margin-top:8px" disabled>停止本批</button>
    <div class="module-state"><div class="status" role="status" aria-live="polite"><span class="dot"></span><span id="semanticStatus">等待图片与描述</span></div><dl class="module-rows"><div><dt>Groq 视觉接口</dt><dd id="semanticEngine">尚未调用</dd></div><div><dt>当前结果已知 tokens</dt><dd id="semanticUsage">0</dd></div></dl></div>
    <div class="notice">按张调用，不自动重试。请求之间至少间隔 22 秒；遇到权限、配置或额度错误停止本批。已发出的请求可能消耗额度。口令只留在本页内存中。</div>
    <div class="export-actions"><button class="secondary full" id="semanticRetry" disabled>清除检测结果，重新测试</button><button class="secondary full" id="semanticZip" disabled>下载全部裁图 ZIP（含 CSV）</button><button class="secondary full" id="semanticCSV" disabled>下载坐标 CSV</button><button class="secondary full" id="semanticDiagnostic" disabled>下载检测诊断 JSON</button></div>
    <div class="notice">CSV 保留原文，表格导入时按文本处理，勿执行不可信公式。诊断包含文件名、描述、坐标、耗时及用量，不含图片和口令。</div><div class="divider"></div><h2>当前图片目标</h2><div id="semanticResults" style="max-height:520px;overflow:auto"></div></div></aside>`;
    $('maskWorkspace').after(root);
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.multiple=true;input.hidden=true;root.append(input);
    let items=[],position=-1,image=null,busy=false,controller=null,stamp=0,active=null,lastRequest=0;
    const canvas=$('semanticCanvas'),ctx=canvas.getContext('2d'),current=()=>items[position];
    const blocked=()=>busy||actions.isBlocked(),tell=text=>{$('semanticStatus').textContent=text;};
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);if(!image)return;
        ctx.drawImage(image,0,0,canvas.width,canvas.height);
        for(const object of current()?.result?.objects||[]) {
            const b=object.bbox,sx=canvas.width/1000,sy=canvas.height/1000;
            ctx.strokeStyle=object.id===active?'#d96a19':'#365ee8';ctx.lineWidth=3;
            ctx.strokeRect(b[0]*sx,b[1]*sy,(b[2]-b[0])*sx,(b[3]-b[1])*sy);
            ctx.fillStyle=ctx.strokeStyle;ctx.font='bold 16px system-ui';ctx.fillText('#'+object.id,b[0]*sx,Math.max(18,b[1]*sy-5));
        }
    }
    function refresh() {
        $('semanticCount').textContent=items.length+' 张图片';
        for(const id of ['semanticAdd','semanticChoose','semanticReset','semanticPrompt','semanticToken','semanticConsent','semanticSam'])$(id).disabled=blocked();
        $('semanticStart').disabled=blocked()||!items.some(i=>!i.result)||!$('semanticPrompt').value.trim()||!$('semanticToken').value||!$('semanticConsent').checked;
        $('semanticStop').disabled=!busy||!controller;
        $('semanticRetry').disabled=blocked()||!items.some(i=>i.result||i.error);
        $('semanticCSV').disabled=$('semanticZip').disabled=blocked()||!items.some(i=>i.result?.objects.length);
        $('semanticDiagnostic').disabled=blocked()||!items.some(i=>i.result||i.error);
        $('semanticUsage').textContent=String(items.reduce((n,i)=>n+(i.result?.usage?.total_tokens||i.errorDiagnostic?.usage?.total_tokens||0),0));
        const tiles=$('semanticTiles');tiles.replaceChildren();tiles.hidden=items.length<2;
        items.forEach((item,index)=>{const button=document.createElement('button');button.className='tile'+(index===position?' active':'');button.setAttribute('aria-label',item.file.name);button.setAttribute('aria-pressed',String(index===position));
            const thumb=document.createElement('img');thumb.src=item.url;thumb.alt='';const label=document.createElement('span');label.textContent=item.error?'失败':item.result?item.result.objects.length:item.processing?'检测中':'待检测';button.append(thumb,label);button.onclick=()=>select(index);tiles.append(button);});
        const list=$('semanticResults');list.replaceChildren();const item=current();
        if(!item?.result?.objects.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=item?.error?'本图失败：'+item.error:item?.result?'模型没有返回符合描述的目标；可能确实不存在，也可能漏检。':item?.processing?'正在检测…':'选择图片并填写描述后开始。';list.append(empty);}
        for(const object of item?.result?.objects||[]) {
            const card=document.createElement('article');card.className='qr-card'+(active===object.id?' active':'');
            const crop=item.crops?.find(c=>c.id===object.id);
            if(crop){const img=document.createElement('img');img.src=crop.url;img.alt=object.label;card.append(img);}
            const heading=document.createElement('h4');heading.textContent='#'+object.id+' · '+object.label;
            const text=document.createElement('pre');text.textContent='原图像素框：'+[object.box.left,object.box.top,object.box.right,object.box.bottom].join(', ');
            const buttons=document.createElement('div');buttons.className='actions';
            const locate=document.createElement('button');locate.className='secondary';locate.textContent='定位';locate.onclick=()=>{active=object.id;refresh();};buttons.append(locate);
            if(crop){const save=document.createElement('button');save.className='secondary';save.textContent='下载 PNG';save.disabled=blocked();save.onclick=()=>downloadBlob(crop.blob,item.file.name.replace(/\.[^.]+$/,'')+'-object-'+object.id+'.png');buttons.append(save);}
            card.append(heading,text,buttons);list.append(card);
        }
        if(item?.cropError){const warning=document.createElement('p');warning.className='error-note';warning.textContent='裁图未完成：'+item.cropError+'；坐标和诊断仍可导出。';list.append(warning);}
        draw();
    }
    async function select(index) {
        position=index;image=null;active=null;const token=++stamp,item=current();canvas.hidden=true;$('semanticUpload').hidden=Boolean(item);
        $('semanticFilename').textContent=item?.file.name||'尚未选择图片';$('semanticDimensions').textContent='原图预览';refresh();if(!item)return;
        try {const img=new Image();img.src=item.url;await img.decode();if(token!==stamp)return;image=img;
            const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.hidden=false;
            $('semanticDimensions').textContent=img.naturalWidth+' × '+img.naturalHeight;draw();
        } catch(error){if(token===stamp)tell('预览失败：'+error.message);}
    }
    function releaseResults(item){for(const crop of item.crops||[])URL.revokeObjectURL(crop.url);delete item.crops;delete item.result;delete item.error;delete item.errorStatus;delete item.errorDiagnostic;delete item.cropError;}
    function add(files) {
        if(blocked())return;
        const accepted=files.filter(file=>['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=20*1024*1024);
        if(!accepted.length){tell('请选择不超过 20 MiB 的 JPEG、PNG 或 WebP。');return;}
        if(items.length+accepted.length>10){tell('测试阶段每批最多 10 张，请减少图片数量。');return;}
        const index=items.length;items.push(...accepted.map(file=>({file,url:URL.createObjectURL(file)})));select(index);
        tell('已添加 '+accepted.length+' 张图片'+(accepted.length<files.length?'，部分不支持或过大的文件已跳过':'')+'。');
    }
    async function waitForSlot(signal) {
        const delay=Math.max(0,22000-(Date.now()-lastRequest));if(!delay)return;
        tell('等待下一次请求，约 '+Math.ceil(delay/1000)+' 秒…');
        await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('已停止','AbortError'));};
            const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);
            signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    }
    async function scan() {
        if(blocked()||!$('semanticConsent').checked)return;
        const pending=items.filter(i=>!i.result),prompt=$('semanticPrompt').value.trim(),token=$('semanticToken').value;
        if(!pending.length||!prompt||!token)return;
        const autoSam=$('semanticSam').checked;
        busy=true;controller=new AbortController();const signal=controller.signal;actions.onBusy(true);refresh();let targets=0,failed=0,samTarget=null;
        try {
            for(let i=0;i<pending.length;i++) {
                const item=pending[i];let bitmap;
                await waitForSlot(signal);if(signal.aborted)break;
                item.processing=true;item.error=null;item.errorStatus=null;item.errorDiagnostic=null;item.attemptPrompt=prompt;tell('正在检测 '+(i+1)+' / '+pending.length+'：'+item.file.name);refresh();
                const started=performance.now();
                try {
                    bitmap=await createImageBitmap(item.file);
                    if(bitmap.width*bitmap.height>40_000_000)throw new Error('测试阶段不处理超过 4000 万像素的原图');
                    if(signal.aborted)throw new DOMException('已停止','AbortError');
                    lastRequest=Date.now();$('semanticEngine').textContent='请求中（缩图 ≤ 1024 像素长边）';
                    const result=await detectObjects(bitmap,prompt,token,signal);
                    item.result={...result,prompt,originalWidth:bitmap.width,originalHeight:bitmap.height};item.crops=[];
                    targets+=result.objects.length;
                    let cropPixels=0;
                    for(const object of result.objects) {
                        const b=object.box;
                        cropPixels+=b.width*b.height;
                        if(cropPixels>40_000_000){item.cropError='本图裁图总像素超过测试内存上限，剩余目标只保留坐标';break;}
                        const crop=document.createElement('canvas');crop.width=b.width;crop.height=b.height;
                        try {crop.getContext('2d').drawImage(bitmap,b.left,b.top,b.width,b.height,0,0,b.width,b.height);
                            const blob=await canvasToBlob(crop);item.crops.push({id:object.id,blob,url:URL.createObjectURL(blob)});
                        } catch(error){item.cropError=error.message;}finally{crop.width=crop.height=1;}
                    }
                    $('semanticEngine').textContent=result.model+' · '+result.elapsedMs+' ms';
                    if(autoSam&&!samTarget&&result.objects.length){
                        const first=result.objects[0],firstCrop=item.crops.find(c=>c.id===first.id);
                        samTarget=firstCrop?{blob:firstCrop.blob,filename:item.file.name.replace(/\.[^.]+$/,'')+'-object-'+first.id+'.png'}:{error:'首个识别框的裁图未成功生成，未转入本地分割'};
                    }
                } catch(error) {
                    if(error.name==='AbortError'){item.error='用户停止；已发送请求可能消耗额度';throw error;}
                    failed++;item.error=error.message;item.errorStatus=error.status??null;item.errorDiagnostic=error.diagnostic??null;$('semanticEngine').textContent='本图失败'+(error.diagnostic?.errorCode?' · '+error.diagnostic.errorCode:'');
                    if([401,403,429,503].includes(error.status)){tell(error.message+'；其余图片未继续提交。');return;}
                } finally {bitmap?.close();item.processing=false;item.elapsedMs=Math.round(performance.now()-started);refresh();}
            }
            if(!targets&&failed)tell('本批有 '+failed+' 张处理失败，未获得可用目标。错误：'+(pending.find(item=>item.error)?.error||'未知错误'));
            else tell('本次检测得到 '+targets+' 个目标'+(failed?'；'+failed+' 张失败':'')+'。请核对预览框。');
        } catch(error) {tell(error.name==='AbortError'?'已停止，完成的结果已保留。':'处理停止：'+error.message);}
        finally {
            busy=false;controller=null;actions.onBusy(false);refresh();
            if(autoSam&&!signal.aborted){
                if(samTarget?.blob){
                    tell('语义结果已保留，正在将首个目标转入本地分割…');
                    try{await actions.openSam(samTarget.blob,samTarget.filename);tell('首个识别框已完成本地分割。语义裁图与 CSV 仍可导出。');}
                    catch(error){tell('语义结果已保留；本地分割未完成：'+error.message);}
                }else if(samTarget?.error)tell(samTarget.error+'；语义坐标结果已保留。');
                else if(!targets&&!failed)tell('本批没有识别到目标，未转入本地分割。');
            }
        }
    }
    async function exportZIP() {
        if(blocked())return;if(!window.JSZip){tell('ZIP 库未加载。');return;}
        busy=true;actions.onBusy(true);refresh();
        try {const zip=new window.JSZip();let count=0;items.forEach((item,index)=>{if(!item.crops?.length)return;
                const folder=zip.folder(String(index+1).padStart(3,'0'));for(const crop of item.crops){folder.file('object-'+crop.id+'.png',crop.blob);count++;}});
            zip.file('results.csv',semanticCSV(items));zip.file('diagnostics.json',JSON.stringify(diagnostics(),null,2));
            downloadBlob(await zip.generateAsync({type:'blob'}),'semantic-crops.zip');tell('已导出 '+count+' 张裁图，文件夹编号对应原始上传顺序。');
        } catch(error){tell('导出失败：'+error.message);}finally{busy=false;actions.onBusy(false);refresh();}
    }
    function diagnostics(){return {revision:'groq-semantic-sam-v1.8.2',createdAt:new Date().toISOString(),items:items.map((item,index)=>({index:index+1,filename:item.file.name,prompt:item.result?.prompt||item.attemptPrompt||null,result:item.result||null,error:item.error||null,httpStatus:item.errorStatus??null,errorDiagnostic:item.errorDiagnostic??null,cropError:item.cropError||null,elapsedMs:item.elapsedMs||null}))};}
    $('semanticAdd').onclick=$('semanticChoose').onclick=()=>input.click();input.onchange=()=>{add([...input.files]);input.value='';};
    $('semanticStage').ondragover=event=>event.preventDefault();$('semanticStage').ondrop=event=>{event.preventDefault();add([...event.dataTransfer.files]);};
    $('semanticReset').onclick=()=>{if(blocked())return;for(const item of items){releaseResults(item);URL.revokeObjectURL(item.url);}items=[];select(-1);tell('已清空图片和结果。');};
    $('semanticPrompt').oninput=()=>{if(blocked())return;for(const item of items)releaseResults(item);tell('描述已修改，先前结果已清除。');refresh();};
    $('semanticToken').oninput=$('semanticConsent').onchange=refresh;
    $('semanticRetry').onclick=()=>{if(blocked()||!confirm('清除检测结果？再次检测会重新调用 API、消耗额度。'))return;items.forEach(releaseResults);refresh();tell('结果已清除，点击开始检测重试。');};
    $('semanticStart').onclick=scan;$('semanticStop').onclick=()=>controller?.abort();$('semanticZip').onclick=exportZIP;
    $('semanticCSV').onclick=()=>{if(!blocked())downloadBlob(new Blob([semanticCSV(items)],{type:'text/csv;charset=utf-8'}),'semantic-results.csv');};
    $('semanticDiagnostic').onclick=()=>{if(!blocked())downloadBlob(new Blob([JSON.stringify(diagnostics(),null,2)],{type:'application/json'}),'semantic-diagnostics.json');};
    canvas.onpointerdown=event=>{if(!image)return;const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*1000,y=(event.clientY-rect.top)/rect.height*1000;
        const found=current()?.result?.objects.find(o=>x>=o.bbox[0]&&x<=o.bbox[2]&&y>=o.bbox[1]&&y<=o.bbox[3]);if(found){active=found.id;refresh();}};
    refresh();return {refresh,isBusy:()=>busy};
}
