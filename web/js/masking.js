import { canvasToBlob } from './image.js';
import { downloadBlob } from './ui.js';
import { subscribe } from './runtime-status.js';

// All masks use original-image coordinates. Solid rectangles also cover curved edges.
export function normalizeRect(rect, width, height, padding = 0) {
    const values = [rect.x, rect.y, rect.right, rect.bottom];
    if (!values.every(Number.isFinite) || rect.right <= rect.x || rect.bottom <= rect.y) return null;
    const extra = Math.max(0, padding);
    const x = Math.max(0, Math.floor(rect.x - extra));
    const y = Math.max(0, Math.floor(rect.y - extra));
    const right = Math.min(width, Math.ceil(rect.right + extra));
    const bottom = Math.min(height, Math.ceil(rect.bottom + extra));
    return right > x && bottom > y ? { x, y, right, bottom } : null;
}
export function rectanglesForDetection(qrcodes, regions, width, height) {
    const rectangles = [];
    for (const qr of qrcodes) {
        if (!qr.points?.length) continue;
        const xs = qr.points.map(p => p.x), ys = qr.points.map(p => p.y);
        const rect = normalizeRect({x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys)}, width, height);
        if (rect) rectangles.push({...rect, kind: 'decoded'});
    }
    for (const region of regions) {
        const rect = normalizeRect(region, width, height);
        if (rect) rectangles.push({...rect, kind: 'candidate'});
    }
    // Keep all regions, even overlapping ones: incomplete merging must not reduce coverage.
    return rectangles;
}
export function paintMasks(context, rectangles, width, height, color, marginPercent) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = color === 'white' ? '#ffffff' : '#000000';
    for (const rect of rectangles) {
        const padding = Math.max(8, Math.max(rect.right-rect.x, rect.bottom-rect.y) * marginPercent / 100);
        const covered = normalizeRect(rect, width, height, padding);
        if (covered) context.fillRect(covered.x, covered.y, covered.right-covered.x, covered.bottom-covered.y);
    }
    context.restore();
}

export function createMaskUI(actions) {
    const $ = id => document.getElementById(id);
    const canvas = $('maskCanvas'), ctx = canvas.getContext('2d');
    let items = [], position = -1, image = null, imageToken = 0, start = null, drag = null, busy = false;
    const current = () => items[position];
    const tell = text => { $('maskStatus').textContent = text; };
    const blocked = () => busy || actions.isBlocked();
    const margin = () => Number($('maskMargin').value) || 0;
    const masks = item => [...item.auto, ...item.manual];
    function update() {
        const item = current(), lock = blocked();
        $('maskChoose').disabled = $('maskAdd').disabled = $('maskReset').disabled = lock;
        $('maskStart').disabled = lock || !items.some(i => !i.detected);
        $('maskDownload').disabled = lock || !item || !masks(item).length;
        $('maskZip').disabled = lock || !items.some(i => masks(i).length);
        $('maskUndo').disabled = lock || !item?.manual.length;
        $('maskColor').disabled = $('maskMargin').disabled = $('maskOriginal').disabled = lock;
        $('maskCount').textContent = items.length + ' 张图片';
        $('maskSummary').textContent = item ? '已解码 ' + item.decodedCount + ' 个 · 检测候选 ' + item.candidateCount + ' 个 · 手动框 ' + item.manual.length + ' 个（自动框可能重叠）' : '等待添加图片';
        $('maskReview').textContent = item?.error ? '本图需检查：' + item.error : item?.detected ? '请检查漏检和误盖；处理完成不代表已找到全部二维码。' : '可先自动检测，也可直接在图上拖动补框。';
        const root = $('maskTiles'); root.replaceChildren();
        items.forEach((entry, index) => {
            const button = document.createElement('button'); button.className = 'tile' + (index===position?' active':'');
            button.setAttribute('aria-label', entry.file.name); button.setAttribute('aria-pressed', String(index===position));
            const thumb = document.createElement('img'); thumb.src=entry.url; thumb.alt='';
            const label = document.createElement('span'); label.textContent=entry.error?'待检查':masks(entry).length?'已设遮盖':entry.detected?'未检出':'待检测';
            button.append(thumb,label); button.onclick=()=>select(index); root.append(button);
        });
        root.hidden = items.length < 2;
    }
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        if (!image) return;
        ctx.drawImage(image,0,0,canvas.width,canvas.height);
        if (!$('maskOriginal').checked) {
            const sx=canvas.width/image.naturalWidth, sy=canvas.height/image.naturalHeight;
            ctx.save();ctx.scale(sx,sy);
            paintMasks(ctx,masks(current()),image.naturalWidth,image.naturalHeight,$('maskColor').value,margin());ctx.restore();
        }
        if (drag) {ctx.strokeStyle='#ff8c32';ctx.lineWidth=3;ctx.strokeRect(drag.x,drag.y,drag.right-drag.x,drag.bottom-drag.y);}
    }
    async function select(index) {
        position=index;image=null;start=drag=null;const token=++imageToken;
        canvas.hidden=true; $('maskUpload').hidden=Boolean(current());
        $('maskFilename').textContent=current()?.file.name || '尚未选择图片';$('maskDimensions').textContent='原图预览';update();
        if (!current()) return;
        try {
            const img=new Image();img.src=current().url;await img.decode();if(token!==imageToken)return;
            image=img;const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
            canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
            canvas.hidden=false;$('maskDimensions').textContent=img.naturalWidth+' × '+img.naturalHeight;draw();
        } catch(error) {if(token!==imageToken)return;current().error='图片读取失败：'+error.message;update();}
    }
    function add(files) {
        if(blocked())return;
        const accepted=files.filter(file=>file.type.startsWith('image/'));if(!accepted.length){tell('请选择图片文件。');return;}
        const first=items.length;
        items.push(...accepted.map(file=>({file,url:URL.createObjectURL(file),auto:[],manual:[],decodedCount:0,candidateCount:0,detected:false,error:null})));
        select(first);tell('图片已添加，请自动检测或拖动手动补框。');
    }
    async function detect() {
        if(blocked())return;
        busy=true;actions.onBusy(true);update();
        const pending=items.filter(item=>!item.detected);
        try {
            for(let index=0;index<pending.length;index++) {
                const item=pending[index];tell('正在检测 '+(index+1)+' / '+pending.length+'：'+item.file.name);
                try {
                    const found=await actions.detect(item.file);
                    const rectangles=rectanglesForDetection(found.qrcodes,found.regions,found.width,found.height);
                    item.auto=found.warnings.length ? [...item.auto,...rectangles] : rectangles;
                    item.decodedCount=found.qrcodes.length;item.candidateCount=found.regions.length;
                    item.error=found.warnings.join('；') || null;
                    item.detected=!item.error;
                } catch(error) {item.error=error.message||String(error);}
                $('maskProgress').textContent=(index+1)+' / '+pending.length;update();draw();
                await new Promise(resolve=>setTimeout(resolve,0));
            }
            tell('检测完成。请检查每张图的遮盖预览，未检出和异常图片需人工检查。');
        } finally {busy=false;actions.onBusy(false);update();draw();}
    }
    async function output(item) {
        const img=new Image();img.src=item.url;await img.decode();
        const out=document.createElement('canvas');out.width=img.naturalWidth;out.height=img.naturalHeight;
        const context=out.getContext('2d');context.drawImage(img,0,0);
        paintMasks(context,masks(item),out.width,out.height,$('maskColor').value,margin());
        const blob=await canvasToBlob(out);out.width=out.height=1;return blob;
    }
    async function exportImages(all) {
        if(blocked())return;
        const chosen=all?items.filter(item=>masks(item).length):[current()].filter(item=>item&&masks(item).length);
        if(!chosen.length)return;
        busy=true;actions.onBusy(true);update();tell('正在生成遮盖后的原尺寸 PNG…');
        try {
            if(!all) downloadBlob(await output(chosen[0]),chosen[0].file.name.replace(/\.[^.]+$/,'')+'-masked.png');
            else {
                if(!globalThis.JSZip)throw new Error('ZIP 库未加载');
                const zip=new globalThis.JSZip(),used=new Set(),report=[];
                for(const item of chosen) {
                    const base=item.file.name.replace(/\.[^.]+$/,'').replace(/[\\/]/g,'_');let name=base+'-masked.png',suffix=2;
                    while(used.has(name))name=base+'-'+suffix+++'-masked.png';used.add(name);
                    zip.file(name,await output(item));report.push({filename:name,decoded:item.decodedCount,candidates:item.candidateCount,manual:item.manual.length,warning:item.error});
                }
                zip.file('遮盖处理记录.json',JSON.stringify({notice:'仅包含设置了遮盖的图片。自动检测可能漏检，未验证所有二维码均不可识别。',skipped:items.length-chosen.length,images:report},null,2));
                downloadBlob(await zip.generateAsync({type:'blob'}),'masked_images.zip');
            }
            tell('已发起下载'+(all?'；未设置遮盖的 '+(items.length-chosen.length)+' 张图片未导出':'')+'。请检查结果后再分享。');
        } catch(error) {tell('导出失败：'+error.message);}
        finally {busy=false;actions.onBusy(false);update();}
    }
    function point(event){const rect=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))};}
    canvas.onpointerdown=event=>{if(!image||blocked())return;event.preventDefault();$('maskOriginal').checked=false;start=point(event);canvas.setPointerCapture(event.pointerId);};
    canvas.onpointermove=event=>{if(!start)return;const end=point(event);drag={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),right:Math.max(start.x,end.x),bottom:Math.max(start.y,end.y)};draw();};
    canvas.onpointerup=()=>{
        if(!start)return;start=null;
        if(drag&&drag.right-drag.x>=3&&drag.bottom-drag.y>=3){const sx=image.naturalWidth/canvas.width,sy=image.naturalHeight/canvas.height;
            current().manual.push({x:drag.x*sx,y:drag.y*sy,right:drag.right*sx,bottom:drag.bottom*sy,kind:'manual'});tell('已添加手动遮盖框。');}
        drag=null;update();draw();
    };
    canvas.onpointercancel=()=>{start=drag=null;draw();};
    $('maskChoose').onclick=$('maskAdd').onclick=()=>$('maskFile').click();
    $('maskFile').onchange=event=>{add([...event.target.files]);event.target.value='';};
    $('maskStage').ondragover=event=>event.preventDefault();
    $('maskStage').ondrop=event=>{event.preventDefault();add([...event.dataTransfer.files]);};
    $('maskReset').onclick=()=>{if(blocked())return;items.forEach(item=>URL.revokeObjectURL(item.url));items=[];select(-1);$('maskProgress').textContent='';tell('图片已清空。');};
    $('maskUndo').onclick=()=>{if(blocked()||!current())return;current().manual.pop();update();draw();};
    $('maskColor').onchange=$('maskMargin').oninput=$('maskOriginal').onchange=draw;
    $('maskStart').onclick=detect;$('maskDownload').onclick=()=>exportImages(false);$('maskZip').onclick=()=>exportImages(true);
    for(const name of ['zxing','wechat','curved'])subscribe(state=>{if(state.module===name)$('mask-'+name+'State').textContent=state.text;});
    $('maskTab').onclick=()=>{
        $('normalWorkspace').hidden=true;$('maskWorkspace').hidden=false;
        for(const name of ['qr','object','mask']){$(name+'Tab').setAttribute('aria-selected',String(name==='mask'));$(name+'Tab').tabIndex=name==='mask'?0:-1;}
        update();draw();
    };
    for(const name of ['qr','object'])$(name+'Tab').addEventListener('click',()=>{$('normalWorkspace').hidden=false;$('maskWorkspace').hidden=true;$('maskTab').setAttribute('aria-selected','false');$('maskTab').tabIndex=-1;});
    // Capture navigation so all three tabs form a single keyboard-accessible group.
    const tabs=['qr','mask','object'];
    for(const name of tabs)$(name+'Tab').addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();event.stopImmediatePropagation();const index=tabs.indexOf(name);
        const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs[2]:tabs[(index+(event.key==='ArrowRight'?1:2))%3];
        $(next+'Tab').click();$(next+'Tab').focus();
    },true);
    update();return {refresh:update,isBusy:()=>busy};
}
