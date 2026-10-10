import {cropBlob,releaseCrops} from './crop-store.js';
import { createTileList, prepareThumbnail, disposeThumbnail } from './thumbnail-list.js';
import { subscribe } from "./runtime-status.js";
import { canvasToBlob } from "./image.js";
import { parseWebURL, createLinkPreview, cancelLinkPreviews } from './link-preview.js';
export const $ = id => document.getElementById(id);
export function updateWorkspaceDescription(mode) {
    if(mode === 'sam') {
        $('introTitle').textContent='留下主角，让背景透明。';
        $('introDescription').textContent='框选范围、标记保留与排除位置，在本地生成蒙版。使用画笔精修边缘，批量导出透明背景图片。';
        $('introBadge').textContent='本地推理 · 图片不上传';
        $('footerNote').textContent='SlimSAM 按需加载 · 请检查蒙版边缘后导出';document.title='心裁 · 本地分割';return;
    }
    if(mode === 'semantic') {
        $('introTitle').textContent='描述所需，批量裁出对象。';
        $('introDescription').textContent='适合从一批照片中提取相同对象：输入名称、颜色或位置描述，通过 Groq 检测目标，再从原图生成矩形裁图。测试结果需要核对。';
        $('introBadge').textContent='云端检测 · 裁图本地生成';
        $('footerNote').textContent='检测缩图与描述发送至 Groq · 非透明抠图';
        document.title='心裁 · 语义裁剪测试';return;
    }
    if(mode === 'barcode') {
        $('introTitle').textContent='条形码，批量识别与整理。';
        $('introDescription').textContent='适合商品包装、标签和资料图片：识别常见条形码、查看码制与原文，批量导出裁图和 CSV，便于后续整理与格式化输入。';
        $('introBadge').textContent='条形码图片在本机处理';
        $('footerNote').textContent='图片本地识别 · CSV 保留原始解码内容';
        document.title='心裁 · 条形码识别';return;
    }
    const mask = mode === 'mask';
    $('introTitle').textContent = mask ? '遮盖二维码，安心分享图片。' : '二维码，批量识别与整理。';
    $('introDescription').textContent = mask
        ? '适合分享截图、照片或公开展示资料前隐藏二维码：自动检测并实色遮盖，支持手动补框与整图批量导出。自动检测可能漏检，请检查后再分享。'
        : '适合活动二维码材料、多码截图和标签照片：定位二维码、查看内容，并将每个二维码分别裁出，支持单张下载与 ZIP 打包。';
    $('introBadge').textContent = mask ? '图片与遮盖在本机处理' : '图片本地处理 · 网页信息按需联网';
    $('footerNote').textContent = mask ? '图片本地遮盖 · 导出保留原图尺寸' : '图片本地识别 · 单码裁图按原图像素输出';
    document.title = mask ? '心裁 · 二维码遮盖' : '心裁 · 二维码识别';
}
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function createUI(actions) {
    updateWorkspaceDescription('qr');
    const canvas = $("canvas"), context = canvas.getContext("2d");
    const queues = {qr: []}, positions = {qr: -1};
    let image = null, imageToken = 0, selectedQR = null, busy = false;
    const current = () => queues.qr[positions.qr];
    const tell = text => { $("qrStatus").textContent = text; };
    const notice = text => { $("imageNotice").hidden = !text; $("imageNotice").textContent = text; };
    const linkControls = document.createElement('div'); linkControls.className='link-controls';
    const linkLabel=document.createElement('label'), linkEnabled=document.createElement('input');
    linkEnabled.type='checkbox';linkEnabled.checked=false;
    linkLabel.append(linkEnabled,document.createTextNode(' 联网获取网页标题和图标'));
    const linkNote=document.createElement('div');linkNote.className='small';
    linkNote.textContent='开启后会将网址发送给本站服务并访问目标网页；核销、一次性或含凭证的链接请勿开启。图片不上传。';
    linkControls.append(linkLabel,linkNote);$('qrDetail').after(linkControls);
    linkEnabled.onchange=()=>{if(!linkEnabled.checked)cancelLinkPreviews();showResults();};
    subscribe(({module, text, level}) => {
        const node = $(module + "State");
        if (node) { node.textContent = text; node.className = level === "ready" ? "ready" : level === "error" ? "error-note" : ""; }
    });
    function draw() {
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (!image) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        {
            const item = current(), sx = canvas.width / image.naturalWidth, sy = canvas.height / image.naturalHeight;
            for (const qr of item?.result?.qrcodes || []) {
                const active = qr.id === selectedQR;
                context.strokeStyle = active ? "#ff9f45" : "#365ee8";
                context.lineWidth = Math.max(2, canvas.width / 400);
                context.beginPath(); qr.points.forEach((p, i) => i ? context.lineTo(p.x*sx,p.y*sy) : context.moveTo(p.x*sx,p.y*sy)); context.closePath(); context.stroke();
                const x = qr.center.x*sx, y = qr.center.y*sy, radius = Math.max(12,canvas.width/55);
                context.fillStyle = active ? "#d96a19" : "#365ee8"; context.beginPath(); context.arc(x,y,radius,0,Math.PI*2); context.fill();
                context.fillStyle = "white"; context.font = "600 "+radius+"px system-ui"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(qr.id,x,y);
            }
        }
    }
    const updateTiles=createTileList($('tiles'),select,item=>item.error?'失败':item.result?item.result.count:item.processing?'识别中':'待识别');
    function tiles() {
        updateTiles(queues.qr,positions.qr);
    }
    let resultView=null;
    function showResults() {
        const root = $("qrResults"), item = queues.qr[positions.qr];
        const state=[item,item?.result,item?.error,item?.processing,selectedQR,linkEnabled.checked];
        if(!resultView||state.some((v,i)=>v!==resultView[i])){resultView=state;root.replaceChildren();
        const results = item?.result?.qrcodes || [];
        if (!results.length) {
            const empty = document.createElement("div"); empty.className = "empty";
            empty.textContent = item?.error ? "本图处理失败："+item.error : item?.result ? "本图未识别到二维码。需要遮盖时，可在二维码遮盖页手动补框。" : item?.processing ? "正在识别本图…" : "添加图片后点击开始识别。";
            root.append(empty);
        }
        for (const qr of results) {
            const crop = item.result.crops.find(c=>c.id===qr.id);
            const card = document.createElement("article"); card.className = "qr-card" + (qr.id===selectedQR?" active":""); card.id = "qr-card-"+qr.id;
            if (crop) { const img = document.createElement("img"); img.src = crop.image; img.alt = "二维码 #"+qr.id; card.append(img); }
            const title = document.createElement("h4"); title.textContent = "二维码 #"+qr.id;
            const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = qr.source || qr.format;
            const text = document.createElement("pre"); text.textContent = qr.text || "（空内容）";
            const buttons = document.createElement("div"); buttons.className = "actions";
            function button(label, handler) { const el = document.createElement("button"); el.className = "secondary"; el.textContent = label; el.onclick = handler; buttons.append(el); }
            button("定位",()=>{ selectedQR=qr.id; draw(); showResults(); });
            button("复制",async event=>{try{await navigator.clipboard.writeText(qr.text);event.target.textContent="已复制";}catch{tell("复制失败，请选中结果中的文字手动复制。","qr");}});
            if (crop) button("下载 PNG",async()=>{try{downloadBlob(await cropBlob(crop),item.file.name.replace(/\.[^.]+$/,"")+"-qr-"+qr.id+".png");}catch(error){tell("下载失败："+error.message,"qr");}});
            const url=parseWebURL(qr.text);
            if(url){const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='打开链接';buttons.append(a);}
            card.append(title,meta);
            if(url)card.append(createLinkPreview(url,linkEnabled.checked));
            card.append(text,buttons); root.append(card);
        }
        }
        const exportable = queues.qr.some(item=>item.result), checked = $("zipOutput").checked;
        $("downloadAllZip").disabled = busy || !checked || !exportable || actions.isExporting();
        $("downloadImageZip").disabled = busy || !checked || !item?.result || actions.isExporting();
        $("qrStart").disabled = busy || !queues.qr.some(item=>!item.result) || actions.isExporting();
    }
    async function select(index) {
        positions.qr=index; const token=++imageToken; image=null; selectedQR=null; notice("");
        const item=current(); tiles(); showResults(); $("count").textContent=queues.qr.length+" 张图片";
        $("filename").textContent=item?.file.name || "尚未选择图片"; $("dimensions").textContent="原图预览";
        canvas.hidden=true; $("upload").hidden=Boolean(item);
        if(!item) return;
        try {
            const img=new Image();img.src=item.url;await img.decode();if(token!==imageToken)return;
            image=img; const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
            canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
            canvas.hidden=false;$("dimensions").textContent=img.naturalWidth+" × "+img.naturalHeight;
            draw();
        } catch(error){ if(token!==imageToken)return; notice("图片无法读取："+error.message); }
    }
    function add(files) {
        if(busy||actions.isExporting()){notice("请等待当前任务完成后再添加图片。");return;}
        const accepted=files.filter(file=>file.type.startsWith("image/"));
        if(!accepted.length){notice("请选择浏览器可以读取的图片文件。");return;}
        const first=queues.qr.length;
        queues.qr.push(...accepted.map(file=>({file,url:URL.createObjectURL(file),result:null,error:null})));
        for(const item of queues.qr.slice(first))prepareThumbnail(item,tiles);
        select(first);tell("已添加 "+queues.qr.length+" 张图片，请点击开始识别。");
    }
    $("choose").onclick=$("add").onclick=()=>$("file").click();
    $("file").onchange=event=>{add([...event.target.files]);event.target.value="";};
    $("resetImages").onclick=()=> {
        if(busy||actions.isExporting())return;
        queues.qr.forEach(item=>{disposeThumbnail(item);releaseCrops(item.result);URL.revokeObjectURL(item.url);});
        queues.qr=[];positions.qr=-1;select(-1);
        tell("图片已清空，等待添加图片。");
        $("progressBar").style.width="0%";$("progressTrack").setAttribute("aria-valuenow","0");
    };
    const stage=document.querySelector(".stage");
    stage.ondragover=event=>{event.preventDefault();$("upload").classList.add("drag");};
    stage.ondragleave=()=>$("upload").classList.remove("drag");
    stage.ondrop=event=>{event.preventDefault();$("upload").classList.remove("drag");add([...event.dataTransfer.files]);};
    function point(event){const rect=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))};}
    canvas.onpointerdown=event=>{
        if(!image)return;
        {const p=point(event),sx=canvas.width/image.naturalWidth,sy=canvas.height/image.naturalHeight;
            const qr=current()?.result?.qrcodes.find(q=>{const xs=q.points.map(v=>v.x*sx),ys=q.points.map(v=>v.y*sy);return p.x>=Math.min(...xs)&&p.x<=Math.max(...xs)&&p.y>=Math.min(...ys)&&p.y<=Math.max(...ys);});
            if(qr){selectedQR=qr.id;draw();showResults();$("qr-card-"+qr.id)?.scrollIntoView({block:"nearest",behavior:"smooth"});}return;}
    };
    $("qrStart").onclick=()=>actions.scan(queues.qr.filter(item=>!item.result));
    $("zipOutput").onchange=showResults;
    $("downloadAllZip").onclick=()=>actions.export(queues.qr.filter(item=>item.result).map(item=>item.result));
    $("downloadImageZip").onclick=()=>{const item=queues.qr[positions.qr];if(item?.result)actions.export([item.result],true);};
    return {
        tell,
        busy(value){busy=value;$("add").disabled=busy||actions.isExporting();$("choose").disabled=busy||actions.isExporting();$("resetImages").disabled=busy||actions.isExporting();showResults();},
        refresh(){tiles();showResults();draw();},
        progress(done,total){const percent=total?Math.round(done/total*100):0;$("progressBar").style.width=percent+"%";$("progressTrack").setAttribute("aria-valuenow",percent);},
        detail(text){$("qrDetail").textContent=text;}
    };
}

