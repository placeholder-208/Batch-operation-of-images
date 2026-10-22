import {cropBlob,releaseCrops,storeCrop} from './crop-store.js';
import { createFileImport } from './file-import.js';
import { createTileList, prepareThumbnail, disposeThumbnail, bindBatchNavigation } from './thumbnail-list.js';
import { $, downloadBlob } from './ui.js';
import { processFile, canvasToBlob } from './image.js';
import { iterateBackgroundVariants as createDecodeVariants } from './preprocess-client.js';
import { decodeBarcodes, cropBarcode, bounds } from './barcode-decoder.js';
import { barcodeCSV, barcodeZIP } from './barcode-export.js';
import { containsPoint } from './barcode-geometry.js';
import { packItem, unpackItem } from './workspace-state.js';

export function createBarcodeUI(actions) {
    const tab=document.createElement('button');tab.id='barcodeTab';tab.className='tab';tab.textContent='条形码识别';
    tab.setAttribute('role','tab');tab.setAttribute('aria-controls','barcodeWorkspace');tab.setAttribute('aria-selected','false');tab.tabIndex=-1;
    $('maskTab').before(tab);
    const root=document.createElement('section');root.id='barcodeWorkspace';root.className='workspace';root.hidden=true;
    root.setAttribute('role','tabpanel');root.setAttribute('aria-labelledby','barcodeTab');
    // Fixed interface markup only; filenames and decoded content always use textContent.
    root.innerHTML=`<section class="panel" aria-label="条形码图片工作区"><div class="panel-head"><h2>条形码预览</h2><div class="tools" style="margin:0"><button class="secondary" id="barcodeReset">清空</button><button class="secondary" id="barcodeAdd">添加图片</button></div></div>
    <div class="stage" id="barcodeStage"><div class="upload" id="barcodeUpload"><div class="upload-icon" aria-hidden="true">▥</div><strong>把图片拖到这里</strong><p>图片可多选，PDF 按页导入</p><button class="primary" id="barcodeChoose">选择图片或 PDF</button><span class="small">JPEG · PNG · WebP · PDF</span></div><canvas id="barcodeCanvas" hidden aria-label="原图预览，可点击定位条形码"></canvas></div>
    <div class="image-footer"><span id="barcodeFilename">尚未选择图片</span><span id="barcodeDimensions">原图预览</span></div><div class="tiles" id="barcodeTiles" hidden></div></section>
    <aside class="panel"><div class="panel-head"><h2>识别与导出</h2><span class="small" id="barcodeCount">0 张图片</span></div><div class="side-body"><button class="primary full" id="barcodeStart" disabled>开始识别</button><p class="processing-note">图片在本机处理；首次使用需加载解码引擎。</p>
    <div class="module-state"><div class="status" role="status" aria-live="polite"><span class="dot"></span><span id="barcodeStatus">等待添加图片</span></div><dl class="module-rows"><div><dt>ZXing 解码引擎</dt><dd id="barcodeEngine">等待任务</dd></div></dl></div>
    <div class="progress-bar" id="barcodeProgress" role="progressbar" aria-label="条形码批量识别进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="barcodeBar" style="height:100%;width:0;background:var(--blue)"></div></div>
    <details class="context-help"><summary>支持码制与识别范围</summary><p>EAN-13、EAN-8、UPC-A、UPC-E、Code 128、Code 39、ITF、Codabar。</p><p>读取原始内容，不查询商品名称或价格。裁图保留周边区域，不进行曲面校正，请检查条纹完整性。</p></details>
    <div class="export-actions"><button class="secondary full" id="barcodeCSV" disabled>下载全部结果 CSV</button><button class="secondary full" id="barcodeImageZip" disabled>下载当前图片 ZIP（含 CSV）</button><button class="secondary full" id="barcodeAllZip" disabled>下载全部结果 ZIP（含 CSV）</button></div>
    <details class="context-help"><summary>CSV 导入说明</summary><p>将 text 列按文本导入，避免前导零丢失；不可信内容请勿作为公式执行。</p></details><div class="divider"></div><h2>识别结果</h2><div id="barcodeResults" style="max-height:520px;overflow:auto"></div></div></aside>`;
    $('maskWorkspace').before(root);
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,application/pdf,.pdf';input.multiple=true;input.hidden=true;root.append(input);
    let items=[],position=-1,busy=false,image=null,token=0,active=null,restoring=false,importBusy=false;
    const canvas=$('barcodeCanvas'),ctx=canvas.getContext('2d'),current=()=>items[position];
    const blocked=()=>busy||importBusy||actions.isBlocked();
    const tell=text=>{$('barcodeStatus').textContent=text;};
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);if(!image)return;
        ctx.drawImage(image,0,0,canvas.width,canvas.height);
        const sx=canvas.width/image.naturalWidth,sy=canvas.height/image.naturalHeight;
        for(const code of current()?.result?.barcodes||[]) {
            const b=bounds(code.points);ctx.strokeStyle=code.id===active?'#f4c26b':'#35d0a8';ctx.lineWidth=3;
            ctx.beginPath();code.points.forEach((p,i)=>i?ctx.lineTo(p.x*sx,p.y*sy):ctx.moveTo(p.x*sx,p.y*sy));ctx.closePath();ctx.stroke();
            ctx.fillStyle=ctx.strokeStyle;ctx.font='bold 16px system-ui';ctx.fillText('#'+code.id,b.left*sx,Math.max(18,b.top*sy-4));
        }
    }
    const updateTiles=createTileList($('barcodeTiles'),select,item=>item.error?'失败':item.result?item.result.barcodes.length:item.processing?'识别中':'待识别');
    const navigation=bindBatchNavigation(root,'barcode',()=>({index:position,total:items.length}),select);
    let resultView=null;
    function refresh() {
        $('barcodeCount').textContent=items.length+' 张图片';
        for(const id of ['barcodeAdd','barcodeChoose','barcodeReset'])$(id).disabled=blocked();
        $('barcodeStart').disabled=blocked()||!items.some(v=>!v.result);
        for(const id of ['barcodeCSV','barcodeAllZip'])$(id).disabled=blocked()||!items.some(v=>v.result);
        $('barcodeImageZip').disabled=blocked()||!current()?.result;
        updateTiles(items,position);
        navigation();
        const list=$('barcodeResults'),item=current(),codes=item?.result?.barcodes||[];
        const state=[item,item?.result,item?.error,item?.processing,active];
        if(!resultView||state.some((v,i)=>v!==resultView[i])){resultView=state;list.replaceChildren();
        if(!codes.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=item?.error?'处理失败：'+item.error:item?.result?'本图未识别到条形码。':item?.processing?'正在识别本图…':'添加图片后点击开始识别。';list.append(empty);}
        for(const code of codes){const card=document.createElement('article');card.className='qr-card'+(active===code.id?' active':'');card.id='barcode-card-'+code.id;
            const crop=item.result.crops.find(c=>c.id===code.id);if(crop){const img=document.createElement('img');img.src=crop.image;img.alt='条形码 #'+code.id;card.append(img);}
            const heading=document.createElement('h4');heading.textContent='条形码 #'+code.id+' · '+code.format;const text=document.createElement('pre');text.textContent=code.text||'（空内容）';const buttons=document.createElement('div');buttons.className='actions';
            const button=(label,handler)=>{const node=document.createElement('button');node.className='secondary';node.textContent=label;node.onclick=handler;buttons.append(node);};
            button('定位',()=>{active=code.id;draw();refresh();});button('复制',async()=>{try{await navigator.clipboard.writeText(code.text);tell('内容已复制。');}catch{tell('复制失败，请手动复制。');}});
            if(crop)button('下载裁图',async()=>{try{downloadBlob(await cropBlob(crop),item.file.name.replace(/\.[^.]+$/,'')+'-barcode-'+code.id+'.png');}catch(error){tell('下载失败：'+error.message);}});
            card.append(heading,text,buttons);
            if(code.contentConflict){const warning=document.createElement('div');warning.className='error-note small';warning.textContent='同一区域出现不同解码结果，已优先选择完整区域和多版本确认的内容，请核对条码下方数字。';card.append(warning);}
            if(code.geometry==='scan-strip'){const warning=document.createElement('div');warning.className='error-note small';warning.textContent='已解码，但尚未可靠定位完整条纹区域；当前框为扫描条带，请检查裁图。';card.append(warning);}
            list.append(card);
        }
        draw();}
        if(!restoring)actions.onChange?.();
    }
    async function select(index){position=index;image=null;active=null;const stamp=++token,item=current();canvas.hidden=true;$('barcodeUpload').hidden=Boolean(item);$('barcodeFilename').textContent=item?.file.name||'尚未选择图片';$('barcodeDimensions').textContent='原图预览';refresh();if(!item)return;
        try{const img=new Image();img.src=item.url;await img.decode();if(stamp!==token)return;image=img;const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.hidden=false;$('barcodeDimensions').textContent=img.naturalWidth+' × '+img.naturalHeight;draw();}catch(error){if(stamp===token)tell('预览失败：'+error.message);}}
    const importer=createFileImport({status:$('barcodeStatus'),canStart:()=>!blocked(),onLock(value){importBusy=value;actions.onBusy(value);refresh();},
        async onItem(file,source){const index=items.length,item={file,source,url:URL.createObjectURL(file),result:null};items.push(item);prepareThumbnail(item,()=>updateTiles(items,position));if(position<0)await select(index);refresh();},
        onComplete({added,errors,cancelled}){tell((cancelled?'已停止导入，':'导入完成，')+'新增 '+added+' 张图片。'+(errors.length?' '+errors.join('；'):'请点击开始识别。'));}});
    function add(files){return importer.add(files);}
    async function scan(){if(blocked())return;const pending=items.filter(v=>!v.result);if(!pending.length)return;busy=true;actions.onBusy(true);refresh();let count=0,failed=0;
        try{await actions.prepare();for(let i=0;i<pending.length;i++){const item=pending[i];item.processing=true;item.error=null;tell('正在识别 '+(i+1)+' / '+pending.length+'：'+item.file.name);refresh();let source;
            try{source=await processFile(item.file);const codes=await decodeBarcodes(createDecodeVariants(source.canvas,{curved:false}),text=>{$('barcodeEngine').textContent=text;},source.canvas);const crops=[];
                for(const code of codes)try{const crop=cropBarcode(source.canvas,code);crops.push(await storeCrop(crop,code.id));}catch(error){console.warn('条形码裁切失败',error);}
                releaseCrops(item.result);item.result={filename:item.file.name,barcodes:codes,crops};count+=codes.length;
            }catch(error){failed++;item.error=error.message;}finally{if(source)source.canvas.width=source.canvas.height=1;item.processing=false;const percent=Math.round((i+1)/pending.length*100);$('barcodeBar').style.width=percent+'%';$('barcodeProgress').setAttribute('aria-valuenow',String(percent));refresh();}}
            tell('本次识别 '+count+' 个条形码'+(failed?'；'+failed+' 张失败，可重试':'')+'。');
        }catch(error){tell('初始化失败：'+error.message);}finally{busy=false;actions.onBusy(false);refresh();}}
    async function exportZip(single){if(blocked())return;const results=single?[current()?.result].filter(Boolean):items.filter(v=>v.result).map(v=>v.result);if(!results.length)return;busy=true;actions.onBusy(true);refresh();tell('正在生成 ZIP…');
        try{downloadBlob(await barcodeZIP(results),single?current().file.name.replace(/\.[^.]+$/,'')+'-barcodes.zip':'barcode-results.zip');tell('ZIP 已生成，包含裁图与 CSV。');}catch(error){tell('导出失败：'+error.message);}finally{busy=false;actions.onBusy(false);refresh();}}
    $('barcodeAdd').onclick=$('barcodeChoose').onclick=()=>input.click();input.onchange=()=>{add([...input.files]);input.value='';};
    $('barcodeStage').ondragover=event=>event.preventDefault();$('barcodeStage').ondrop=event=>{event.preventDefault();add([...event.dataTransfer.files]);};
    $('barcodeReset').onclick=()=>{if(blocked())return;items.forEach(item=>{disposeThumbnail(item);releaseCrops(item.result);URL.revokeObjectURL(item.url);});items=[];select(-1);$('barcodeBar').style.width='0%';$('barcodeProgress').setAttribute('aria-valuenow','0');tell('图片已清空。');};
    $('barcodeStart').onclick=scan;$('barcodeImageZip').onclick=()=>exportZip(true);$('barcodeAllZip').onclick=()=>exportZip(false);
    $('barcodeCSV').onclick=()=>{if(blocked())return;downloadBlob(new Blob([barcodeCSV(items.filter(v=>v.result).map(v=>v.result))],{type:'text/csv;charset=utf-8'}),'barcode-results.csv');};
    canvas.onpointerdown=event=>{if(!image)return;const r=canvas.getBoundingClientRect(),x=(event.clientX-r.left)/r.width*image.naturalWidth,y=(event.clientY-r.top)/r.height*image.naturalHeight;const code=current()?.result?.barcodes.find(v=>containsPoint(v.points,{x,y}));if(code){active=code.id;refresh();$('barcode-card-'+code.id)?.scrollIntoView({block:'nearest'});}};
    function snapshot(){return {version:1,items:items.map(packItem),position,active};}
    async function restore(state){
        if(state?.version!==1||!Array.isArray(state.items))throw new Error('条形码工作区数据格式无效');
        restoring=true;
        try {
            items.forEach(item=>{disposeThumbnail(item);releaseCrops(item.result);URL.revokeObjectURL(item.url);});
            items=state.items.map(unpackItem).filter(Boolean);
            for(const item of items){item.processing=false;prepareThumbnail(item,()=>updateTiles(items,position));}
            const index=items.length?Math.min(items.length-1,Math.max(0,Number.isInteger(state.position)?state.position:0)):-1;
            await select(index);
            active=current()?.result?.barcodes?.some(code=>code.id===state.active)?state.active:null;
            const done=items.filter(item=>item.result).length,percent=items.length?Math.round(done/items.length*100):0;
            $('barcodeBar').style.width=percent+'%';$('barcodeProgress').setAttribute('aria-valuenow',String(percent));
            tell(items.length?'已恢复 '+items.length+' 张图片和已完成的识别结果。':'等待添加图片');
            refresh();
        } finally {restoring=false;}
    }
    refresh();return {refresh,isBusy:()=>busy||importBusy,snapshot,restore};
}
