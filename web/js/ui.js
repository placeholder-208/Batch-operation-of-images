import {cropBlob,releaseCrops} from './crop-store.js';
import { packItem, unpackItem } from './workspace-state.js';
import { createTileList, prepareThumbnail, disposeThumbnail, bindBatchNavigation } from './thumbnail-list.js';
import { subscribe } from "./runtime-status.js";
import { canvasToBlob } from "./image.js";
import { parseWebURL, createLinkPreview, cancelLinkPreviews } from './link-preview.js?v=3.5.1';
export const $ = id => document.getElementById(id);
export function updateWorkspaceDescription(mode) {
    const pages={
        qr:['二维码识别','批量读取二维码内容，分别导出裁图与 CSV。'],
        barcode:['条形码识别','批量读取条形码内容，导出裁图与 CSV。'],
        mask:['二维码遮盖','自动检测或手动补框，批量导出遮盖后的整图。'],
        semantic:['语义裁剪','按文字描述检测目标，批量导出矩形裁图。'],
        sam:['本地分割','生成对象蒙版，修整边缘并导出透明 PNG。']
    };
    const [title,description]=pages[mode]||pages.qr;
    $('introTitle').textContent=title;
    $('introDescription').textContent=description;
    document.title='心裁 · '+title;
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
    linkNote.textContent='网址将经本站服务访问目标网页。勿用于核销、一次性或含凭证的链接。';
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
                context.strokeStyle = active ? "#f4c26b" : "#35d0a8";
                context.lineWidth = Math.max(2, canvas.width / 400);
                context.beginPath(); qr.points.forEach((p, i) => i ? context.lineTo(p.x*sx,p.y*sy) : context.moveTo(p.x*sx,p.y*sy)); context.closePath(); context.stroke();
                const x = qr.center.x*sx, y = qr.center.y*sy, radius = Math.max(12,canvas.width/55);
                context.fillStyle = active ? "#f4c26b" : "#35d0a8"; context.beginPath(); context.arc(x,y,radius,0,Math.PI*2); context.fill();
                context.fillStyle = "#122b23"; context.font = "600 "+radius+"px system-ui"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(qr.id,x,y);
            }
        }
    }
    const updateTiles=createTileList($('tiles'),select,item=>item.error?'失败':item.result?item.result.count:item.processing?'识别中':'待识别');
    const navigation=bindBatchNavigation($('normalWorkspace'),'qr',()=>({index:positions.qr,total:queues.qr.length}),select);
    function tiles() {
        updateTiles(queues.qr,positions.qr);
        navigation();
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
            const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = '已解码 · '+(qr.format||'QRCode');meta.title=qr.source||'';
            const text = document.createElement("pre"); text.textContent = qr.text || "（空内容）";
            const buttons = document.createElement("div"); buttons.className = "actions";
            function button(label, handler) { const el = document.createElement("button"); el.className = "secondary"; el.textContent = label; el.onclick = handler; buttons.append(el); }
            button("定位",()=>{ selectedQR=qr.id; draw(); showResults(); actions.onChange?.(); });
            button("复制",async event=>{try{await navigator.clipboard.writeText(qr.text);event.target.textContent="已复制";}catch{tell("复制失败，请选中结果中的文字手动复制。","qr");}});
            if (crop) button("下载裁图",async()=>{try{downloadBlob(await cropBlob(crop),item.file.name.replace(/\.[^.]+$/,"")+"-qr-"+qr.id+".png");}catch(error){tell("下载失败："+error.message,"qr");}});
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
        actions.onChange?.();
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
    const stage=$('normalWorkspace').querySelector(".stage");
    stage.ondragover=event=>{event.preventDefault();$("upload").classList.add("drag");};
    stage.ondragleave=()=>$("upload").classList.remove("drag");
    stage.ondrop=event=>{event.preventDefault();$("upload").classList.remove("drag");add([...event.dataTransfer.files]);};
    function point(event){const rect=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))};}
    canvas.onpointerdown=event=>{
        if(!image)return;
        {const p=point(event),sx=canvas.width/image.naturalWidth,sy=canvas.height/image.naturalHeight;
            const qr=current()?.result?.qrcodes.find(q=>{const xs=q.points.map(v=>v.x*sx),ys=q.points.map(v=>v.y*sy);return p.x>=Math.min(...xs)&&p.x<=Math.max(...xs)&&p.y>=Math.min(...ys)&&p.y<=Math.max(...ys);});
            if(qr){selectedQR=qr.id;draw();showResults();actions.onChange?.();$("qr-card-"+qr.id)?.scrollIntoView({block:"nearest",behavior:"smooth"});}return;}
    };
    $("qrStart").onclick=()=>actions.scan(queues.qr.filter(item=>!item.result));
    $("zipOutput").onchange=()=>{showResults();actions.onChange?.();};
    $("downloadAllZip").onclick=()=>actions.export(queues.qr.filter(item=>item.result).map(item=>item.result));
    $("downloadImageZip").onclick=()=>{const item=queues.qr[positions.qr];if(item?.result)actions.export([item.result],true);};
    return {
        tell,
        snapshot(){return {version:1,items:queues.qr.map(packItem),position:positions.qr,selectedQR,zipOutput:$("zipOutput").checked};},
        async restore(saved){
            if(saved.version!==1||!Array.isArray(saved.items))throw new Error('二维码工作区数据版本无效');
            queues.qr.forEach(item=>{disposeThumbnail(item);releaseCrops(item.result);URL.revokeObjectURL(item.url);});
            queues.qr=saved.items.map(unpackItem);
            for(const item of queues.qr)prepareThumbnail(item,tiles);
            $("zipOutput").checked=saved.zipOutput!==false;
            // A refreshed page never fetches decoded links automatically.
            linkEnabled.checked=false;cancelLinkPreviews();
            await select(queues.qr.length?Math.max(0,Math.min(queues.qr.length-1,saved.position||0)):-1);
            selectedQR=saved.selectedQR??null;tiles();showResults();draw();
            const done=queues.qr.filter(item=>item.result).length,percent=queues.qr.length?Math.round(done/queues.qr.length*100):0;
            $("progressBar").style.width=percent+"%";$("progressTrack").setAttribute("aria-valuenow",String(percent));
            tell(queues.qr.length?'已恢复 '+queues.qr.length+' 张图片及已完成的识别结果。':'等待添加图片');
        },
        busy(value){busy=value;$("add").disabled=busy||actions.isExporting();$("choose").disabled=busy||actions.isExporting();$("resetImages").disabled=busy||actions.isExporting();showResults();},
        refresh(){tiles();showResults();draw();actions.onChange?.();},
        progress(done,total){const percent=total?Math.round(done/total*100):0;$("progressBar").style.width=percent+"%";$("progressTrack").setAttribute("aria-valuenow",percent);},
        detail(text){$("qrDetail").textContent=text;$("qrDetail").hidden=!text;}
    };
}

