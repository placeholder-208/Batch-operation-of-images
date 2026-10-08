import { $, downloadBlob } from './ui.js';
import { processFile, canvasToBlob } from './image.js';
import { createDecodeVariants } from './preprocess.js';
import { decodeBarcodes, cropBarcode, bounds } from './barcode-decoder.js';
import { barcodeCSV, barcodeZIP } from './barcode-export.js';
import { containsPoint } from './barcode-geometry.js';

export function createBarcodeUI(actions) {
    const tab=document.createElement('button');tab.id='barcodeTab';tab.className='tab';tab.textContent='条形码识别';
    tab.setAttribute('role','tab');tab.setAttribute('aria-controls','barcodeWorkspace');tab.setAttribute('aria-selected','false');tab.tabIndex=-1;
    $('maskTab').before(tab);
    const root=document.createElement('section');root.id='barcodeWorkspace';root.className='workspace';root.hidden=true;
    root.setAttribute('role','tabpanel');root.setAttribute('aria-labelledby','barcodeTab');
    // Fixed interface markup only; filenames and decoded content always use textContent.
    root.innerHTML=`<section class="panel" aria-label="条形码图片工作区"><div class="panel-head"><h2>条形码预览</h2><div class="tools" style="margin:0"><button class="secondary" id="barcodeReset">清空</button><button class="secondary" id="barcodeAdd">添加图片</button></div></div>
    <div class="stage" id="barcodeStage"><div class="upload" id="barcodeUpload"><div class="upload-icon" aria-hidden="true">▥</div><strong>添加需要识别条形码的图片</strong><p>支持多张图片，也可以拖动添加</p><button class="primary" id="barcodeChoose">选择图片</button><span class="small">JPEG · PNG · WebP</span></div><canvas id="barcodeCanvas" hidden aria-label="原图预览，可点击定位条形码"></canvas></div>
    <div class="image-footer"><span id="barcodeFilename">尚未选择图片</span><span id="barcodeDimensions">原图预览</span></div><div class="tiles" id="barcodeTiles" hidden></div></section>
    <aside class="panel"><div class="panel-head"><h2>识别与导出</h2><span class="small" id="barcodeCount">0 张图片</span></div><div class="side-body"><p class="eyebrow">BARCODE</p><h3>条形码，批量整理。</h3><p>识别商品、标签和资料中的常见条形码，查看码制与原文，导出裁图和 CSV。不会查询商品名称或价格。</p><button class="primary full" id="barcodeStart" disabled>开始识别</button>
    <div class="module-state"><div class="status" role="status" aria-live="polite"><span class="dot"></span><span id="barcodeStatus">等待添加图片</span></div><dl class="module-rows"><div><dt>ZXing 解码引擎</dt><dd id="barcodeEngine">等待任务</dd></div></dl></div>
    <div class="progress-bar" id="barcodeProgress" role="progressbar" aria-label="条形码批量识别进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="barcodeBar" style="height:100%;width:0;background:var(--blue)"></div></div>
    <div class="notice">支持 EAN-13、EAN-8、UPC-A、UPC-E、Code 128、Code 39、ITF、Codabar。裁图保留周边区域，不进行曲面校正；请检查条纹是否完整。</div>
    <div class="export-actions"><button class="secondary full" id="barcodeCSV" disabled>下载全部结果 CSV</button><button class="secondary full" id="barcodeImageZip" disabled>下载当前图片 ZIP（含 CSV）</button><button class="secondary full" id="barcodeAllZip" disabled>下载全部结果 ZIP（含 CSV）</button></div>
    <div class="notice">CSV 保留原始内容。用表格软件导入时将 text 列设为文本，避免前导零丢失；不可信内容请勿作为公式执行。</div><div class="divider"></div><h2>识别结果</h2><div id="barcodeResults" style="max-height:520px;overflow:auto"></div></div></aside>`;
    $('maskWorkspace').before(root);
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.multiple=true;input.hidden=true;root.append(input);
    let items=[],position=-1,busy=false,image=null,token=0,active=null;
    const canvas=$('barcodeCanvas'),ctx=canvas.getContext('2d'),current=()=>items[position];
    const blocked=()=>busy||actions.isBlocked();
    const tell=text=>{$('barcodeStatus').textContent=text;};
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);if(!image)return;
        ctx.drawImage(image,0,0,canvas.width,canvas.height);
        const sx=canvas.width/image.naturalWidth,sy=canvas.height/image.naturalHeight;
        for(const code of current()?.result?.barcodes||[]) {
            const b=bounds(code.points);ctx.strokeStyle=code.id===active?'#d96a19':'#365ee8';ctx.lineWidth=3;
            ctx.beginPath();code.points.forEach((p,i)=>i?ctx.lineTo(p.x*sx,p.y*sy):ctx.moveTo(p.x*sx,p.y*sy));ctx.closePath();ctx.stroke();
            ctx.fillStyle=ctx.strokeStyle;ctx.font='bold 16px system-ui';ctx.fillText('#'+code.id,b.left*sx,Math.max(18,b.top*sy-4));
        }
    }
    function refresh() {
        $('barcodeCount').textContent=items.length+' 张图片';
        for(const id of ['barcodeAdd','barcodeChoose','barcodeReset'])$(id).disabled=blocked();
        $('barcodeStart').disabled=blocked()||!items.some(v=>!v.result);
        for(const id of ['barcodeCSV','barcodeAllZip'])$(id).disabled=blocked()||!items.some(v=>v.result);
        $('barcodeImageZip').disabled=blocked()||!current()?.result;
        const tiles=$('barcodeTiles');tiles.replaceChildren();tiles.hidden=items.length<2;
        items.forEach((item,index)=>{const button=document.createElement('button');button.className='tile'+(index===position?' active':'');button.setAttribute('aria-label',item.file.name);button.setAttribute('aria-pressed',String(index===position));
            const img=document.createElement('img');img.src=item.url;img.alt='';const label=document.createElement('span');label.textContent=item.error?'失败':item.result?item.result.barcodes.length:item.processing?'识别中':'待识别';button.append(img,label);button.onclick=()=>select(index);tiles.append(button);});
        const list=$('barcodeResults');list.replaceChildren();
        const item=current(),codes=item?.result?.barcodes||[];
        if(!codes.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=item?.error?'处理失败：'+item.error:item?.result?'本图未识别到条形码。':item?.processing?'正在识别本图…':'添加图片后点击开始识别。';list.append(empty);}
        for(const code of codes){const card=document.createElement('article');card.className='qr-card'+(active===code.id?' active':'');card.id='barcode-card-'+code.id;
            const crop=item.result.crops.find(c=>c.id===code.id);if(crop){const img=document.createElement('img');img.src=crop.image;img.alt='条形码 #'+code.id;card.append(img);}
            const heading=document.createElement('h4');heading.textContent='条形码 #'+code.id+' · '+code.format;const text=document.createElement('pre');text.textContent=code.text||'（空内容）';const buttons=document.createElement('div');buttons.className='actions';
            const button=(label,handler)=>{const node=document.createElement('button');node.className='secondary';node.textContent=label;node.onclick=handler;buttons.append(node);};
            button('定位',()=>{active=code.id;draw();refresh();});button('复制',async()=>{try{await navigator.clipboard.writeText(code.text);tell('内容已复制。');}catch{tell('复制失败，请手动复制。');}});
            if(crop)button('下载 PNG',async()=>{try{downloadBlob(await canvasToBlob(crop.canvas),item.file.name.replace(/\.[^.]+$/,'')+'-barcode-'+code.id+'.png');}catch(error){tell('下载失败：'+error.message);}});
            card.append(heading,text,buttons);
            if(code.contentConflict){const warning=document.createElement('div');warning.className='error-note small';warning.textContent='同一区域出现不同解码结果，已优先选择完整区域和多版本确认的内容，请核对条码下方数字。';card.append(warning);}
            if(code.geometry==='scan-strip'){const warning=document.createElement('div');warning.className='error-note small';warning.textContent='已解码，但尚未可靠定位完整条纹区域；当前框为扫描条带，请检查裁图。';card.append(warning);}
            list.append(card);
        }
        draw();
    }
    async function select(index){position=index;image=null;active=null;const stamp=++token,item=current();canvas.hidden=true;$('barcodeUpload').hidden=Boolean(item);$('barcodeFilename').textContent=item?.file.name||'尚未选择图片';$('barcodeDimensions').textContent='原图预览';refresh();if(!item)return;
        try{const img=new Image();img.src=item.url;await img.decode();if(stamp!==token)return;image=img;const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.hidden=false;$('barcodeDimensions').textContent=img.naturalWidth+' × '+img.naturalHeight;draw();}catch(error){if(stamp===token)tell('预览失败：'+error.message);}}
    function add(files){if(blocked())return;const accepted=files.filter(file=>file.type.startsWith('image/'));if(!accepted.length){tell('请选择图片文件。');return;}const index=items.length;items.push(...accepted.map(file=>({file,url:URL.createObjectURL(file),result:null})));select(index);tell('已添加 '+items.length+' 张图片，请点击开始识别。');}
    async function scan(){if(blocked())return;const pending=items.filter(v=>!v.result);if(!pending.length)return;busy=true;actions.onBusy(true);refresh();let count=0,failed=0;
        try{await actions.prepare();for(let i=0;i<pending.length;i++){const item=pending[i];item.processing=true;item.error=null;tell('正在识别 '+(i+1)+' / '+pending.length+'：'+item.file.name);refresh();let source;
            try{source=await processFile(item.file);const codes=await decodeBarcodes(createDecodeVariants(source.canvas,{curved:false}),text=>{$('barcodeEngine').textContent=text;},source.canvas);const crops=[];
                for(const code of codes)try{const crop=cropBarcode(source.canvas,code);crops.push({id:code.id,canvas:crop,image:crop.toDataURL('image/png')});}catch(error){console.warn('条形码裁切失败',error);}
                item.result={filename:item.file.name,barcodes:codes,crops};count+=codes.length;
            }catch(error){failed++;item.error=error.message;}finally{if(source)source.canvas.width=source.canvas.height=1;item.processing=false;const percent=Math.round((i+1)/pending.length*100);$('barcodeBar').style.width=percent+'%';$('barcodeProgress').setAttribute('aria-valuenow',String(percent));refresh();}}
            tell('本次识别 '+count+' 个条形码'+(failed?'；'+failed+' 张失败，可重试':'')+'。');
        }catch(error){tell('初始化失败：'+error.message);}finally{busy=false;actions.onBusy(false);refresh();}}
    async function exportZip(single){if(blocked())return;const results=single?[current()?.result].filter(Boolean):items.filter(v=>v.result).map(v=>v.result);if(!results.length)return;busy=true;actions.onBusy(true);refresh();tell('正在生成 ZIP…');
        try{downloadBlob(await barcodeZIP(results),single?current().file.name.replace(/\.[^.]+$/,'')+'-barcodes.zip':'barcode-results.zip');tell('ZIP 已生成，包含裁图与 CSV。');}catch(error){tell('导出失败：'+error.message);}finally{busy=false;actions.onBusy(false);refresh();}}
    $('barcodeAdd').onclick=$('barcodeChoose').onclick=()=>input.click();input.onchange=()=>{add([...input.files]);input.value='';};
    $('barcodeStage').ondragover=event=>event.preventDefault();$('barcodeStage').ondrop=event=>{event.preventDefault();add([...event.dataTransfer.files]);};
    $('barcodeReset').onclick=()=>{if(blocked())return;items.forEach(item=>URL.revokeObjectURL(item.url));items=[];select(-1);$('barcodeBar').style.width='0%';$('barcodeProgress').setAttribute('aria-valuenow','0');tell('图片已清空。');};
    $('barcodeStart').onclick=scan;$('barcodeImageZip').onclick=()=>exportZip(true);$('barcodeAllZip').onclick=()=>exportZip(false);
    $('barcodeCSV').onclick=()=>{if(blocked())return;downloadBlob(new Blob([barcodeCSV(items.filter(v=>v.result).map(v=>v.result))],{type:'text/csv;charset=utf-8'}),'barcode-results.csv');};
    canvas.onpointerdown=event=>{if(!image)return;const r=canvas.getBoundingClientRect(),x=(event.clientX-r.left)/r.width*image.naturalWidth,y=(event.clientY-r.top)/r.height*image.naturalHeight;const code=current()?.result?.barcodes.find(v=>containsPoint(v.points,{x,y}));if(code){active=code.id;refresh();$('barcode-card-'+code.id)?.scrollIntoView({block:'nearest'});}};
    refresh();return {refresh,isBusy:()=>busy};
}
