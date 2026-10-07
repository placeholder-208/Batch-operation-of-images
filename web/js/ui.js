import { subscribe } from "./runtime-status.js";
import { canvasToBlob } from "./image.js";
import { parseWebURL, createLinkPreview, cancelLinkPreviews } from './link-preview.js';
export const $ = id => document.getElementById(id);
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function createUI(actions) {
    const canvas = $("canvas"), context = canvas.getContext("2d");
    const queues = {qr: [], object: []}, positions = {qr: -1, object: -1};
    let mode = "qr", image = null, imageToken = 0, selectedQR = null;
    let box = null, start = null, cropBlob = null, cropUrl = null, cropToken = 0, busy = false;
    const current = () => queues[mode][positions[mode]];
    const tell = (text, target = mode) => { $(target + "Status").textContent = text; };
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
    function resetCrop() {
        cropToken++; cropBlob = null; box = null; start = null;
        if (cropUrl) URL.revokeObjectURL(cropUrl);
        cropUrl = null; $("preview").hidden = true; $("cropEmpty").hidden = false;
        $("download").disabled = true; $("exportState").textContent = "等待选框";
        $("exportState").className = ""; $("cropSize").textContent = "输出保留所选区域的原始分辨率";
    }
    function draw() {
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (!image) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (mode === "object" && box) {
            context.fillStyle = "#10203d55"; context.beginPath();
            context.rect(0, 0, canvas.width, canvas.height); context.rect(box.x, box.y, box.w, box.h);
            context.fill("evenodd"); context.strokeStyle = "#486dff";
            context.lineWidth = Math.max(2, canvas.width / 450); context.strokeRect(box.x, box.y, box.w, box.h);
        }
        if (mode === "qr") {
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
    function tiles() {
        const root = $("tiles"); root.replaceChildren(); root.hidden = queues[mode].length < 2;
        queues[mode].forEach((item,index) => {
            const button = document.createElement("button"); button.className = "tile" + (index===positions[mode]?" active":"");
            button.setAttribute("aria-label", item.file.name); button.setAttribute("aria-pressed", String(index===positions[mode]));
            const img = document.createElement("img"); img.src = item.url; img.alt = ""; button.append(img);
            const label = document.createElement("span"); label.textContent = item.error ? "失败" : item.result ? item.result.count : item.processing ? "识别中" : "待识别"; button.append(label);
            button.onclick = () => select(index); root.append(button);
        });
    }
    function showResults() {
        const root = $("qrResults"), item = queues.qr[positions.qr]; root.replaceChildren();
        const results = item?.result?.qrcodes || [];
        if (!results.length) {
            const empty = document.createElement("div"); empty.className = "empty";
            empty.textContent = item?.error ? "本图处理失败："+item.error : item?.result ? "本图未识别到二维码，可在手动裁切模式中选框。" : item?.processing ? "正在识别本图…" : "添加图片后点击开始识别。";
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
            if (crop) button("下载 PNG",async()=>{try{downloadBlob(await canvasToBlob(crop.canvas),item.file.name.replace(/\.[^.]+$/,"")+"-qr-"+qr.id+".png");}catch(error){tell("下载失败："+error.message,"qr");}});
            const url=parseWebURL(qr.text);
            if(url){const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='打开链接';buttons.append(a);}
            card.append(title,meta);
            if(url)card.append(createLinkPreview(url,linkEnabled.checked));
            card.append(text,buttons); root.append(card);
        }
        const exportable = queues.qr.some(item=>item.result), checked = $("zipOutput").checked;
        $("downloadAllZip").disabled = busy || !checked || !exportable || actions.isExporting();
        $("downloadImageZip").disabled = busy || !checked || !item?.result || actions.isExporting();
        $("qrStart").disabled = busy || !queues.qr.some(item=>!item.result) || actions.isExporting();
    }
    async function select(index) {
        positions[mode]=index; const token=++imageToken; image=null; selectedQR=null; resetCrop(); notice("");
        const item=current(); tiles(); showResults(); $("count").textContent=queues[mode].length+" 张图片";
        $("selectAll").disabled=$("clear").disabled=true;
        $("filename").textContent=item?.file.name || "尚未选择图片"; $("dimensions").textContent="原图预览";
        canvas.hidden=true; $("upload").hidden=Boolean(item);
        if(!item) return;
        try {
            const img=new Image();img.src=item.url;await img.decode();if(token!==imageToken)return;
            image=img; const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
            canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
            canvas.hidden=false;$("dimensions").textContent=img.naturalWidth+" × "+img.naturalHeight;
            $("selectAll").disabled=$("clear").disabled=false;draw();
            if(mode==="object")tell("图片已就绪，请拖动选框或选取整张。");
        } catch(error){ if(token!==imageToken)return; notice("图片无法读取："+error.message);if(mode==="object")tell("图片读取失败，请换一张图片。"); }
    }
    function setMode(next) {
        mode=next;for(const name of ["qr","object"]){const active=name===mode;$(name+"Tab").setAttribute("aria-selected",String(active));$(name+"Tab").tabIndex=active?0:-1;$(name+"Mode").hidden=!active;}
        $("file").multiple=mode==="qr";$("sideTitle").textContent=mode==="qr"?"识别与导出":"对象与裁切";
        $("add").disabled=mode==="qr"&&(busy||actions.isExporting());
        $("resetImages").disabled=mode==="qr"&&(busy||actions.isExporting());
        $("uploadHint").textContent=mode==="qr"?"支持多张图片，也可以点击选择":"选择一张图片，描述需要保留的对象";
        select(positions[mode]);
    }
    function add(files) {
        if(mode==="qr"&&(busy||actions.isExporting())){notice("请等待当前任务完成后再添加图片。");return;}
        const accepted=files.filter(file=>file.type.startsWith("image/"));
        if(!accepted.length){notice("请选择浏览器可以读取的图片文件。");return;}
        if(mode==="object"){queues.object.forEach(item=>URL.revokeObjectURL(item.url));queues.object=[];accepted.splice(1);}
        const first=queues[mode].length;
        queues[mode].push(...accepted.map(file=>({file,url:URL.createObjectURL(file),result:null,error:null})));
        select(first);if(mode==="qr")tell("已添加 "+queues.qr.length+" 张图片，请点击开始识别。","qr");
    }
    for(const name of ["qr","object"]){$(name+"Tab").onclick=()=>setMode(name);$(name+"Tab").onkeydown=event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const next=event.key==="Home"?"qr":event.key==="End"?"object":mode==="qr"?"object":"qr";setMode(next);$(next+"Tab").focus();}}}
    $("choose").onclick=$("add").onclick=()=>$("file").click();
    $("file").onchange=event=>{add([...event.target.files]);event.target.value="";};
    $("resetImages").onclick=()=> {
        if(mode==="qr"&&(busy||actions.isExporting()))return;
        queues[mode].forEach(item=>URL.revokeObjectURL(item.url));
        queues[mode]=[];positions[mode]=-1;select(-1);
        tell(mode==="qr"?"图片已清空，等待添加图片。":"等待添加图片，可使用手动裁切");
        if(mode==="qr") { $("progressBar").style.width="0%";$("progressTrack").setAttribute("aria-valuenow","0"); }
    };
    const stage=document.querySelector(".stage");
    stage.ondragover=event=>{event.preventDefault();$("upload").classList.add("drag");};
    stage.ondragleave=()=>$("upload").classList.remove("drag");
    stage.ondrop=event=>{event.preventDefault();$("upload").classList.remove("drag");add([...event.dataTransfer.files]);};
    function point(event){const rect=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))};}
    canvas.onpointerdown=event=>{
        if(!image)return;
        if(mode==="qr"){const p=point(event),sx=canvas.width/image.naturalWidth,sy=canvas.height/image.naturalHeight;
            const qr=current()?.result?.qrcodes.find(q=>{const xs=q.points.map(v=>v.x*sx),ys=q.points.map(v=>v.y*sy);return p.x>=Math.min(...xs)&&p.x<=Math.max(...xs)&&p.y>=Math.min(...ys)&&p.y<=Math.max(...ys);});
            if(qr){selectedQR=qr.id;draw();showResults();$("qr-card-"+qr.id)?.scrollIntoView({block:"nearest",behavior:"smooth"});}return;}
        event.preventDefault();resetCrop();start=point(event);canvas.setPointerCapture(event.pointerId);draw();
    };
    canvas.onpointermove=event=>{if(!start)return;const end=point(event);box={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)};draw();};
    canvas.onpointerup=()=>{if(!start)return;start=null;if(box&&(box.w<2||box.h<2))box=null;draw();renderCrop();};
    canvas.onpointercancel=()=>{resetCrop();draw();};
    async function renderCrop() {
        if(!box||!image)return;
        const token=++cropToken, sx=image.naturalWidth/canvas.width,sy=image.naturalHeight/canvas.height;
        const left=Math.floor(box.x*sx),top=Math.floor(box.y*sy),right=Math.min(image.naturalWidth,Math.ceil((box.x+box.w)*sx)),bottom=Math.min(image.naturalHeight,Math.ceil((box.y+box.h)*sy));
        const output=document.createElement("canvas");output.width=right-left;output.height=bottom-top;
        $("download").disabled=true;$("exportState").textContent="正在生成";tell("正在生成裁切预览…","object");
        try {
            output.getContext("2d").drawImage(image,left,top,output.width,output.height,0,0,output.width,output.height);
            const blob=await canvasToBlob(output);if(token!==cropToken)return;
            if(cropUrl)URL.revokeObjectURL(cropUrl);cropBlob=blob;cropUrl=URL.createObjectURL(blob);
            $("preview").src=cropUrl;$("preview").hidden=false;$("cropEmpty").hidden=true;$("download").disabled=false;
            $("cropSize").textContent="输出尺寸 "+output.width+" × "+output.height+" · PNG";
            $("exportState").textContent="已生成，可下载";$("exportState").className="ready";tell("选框已更新，可以下载裁切图片。","object");
        }catch(error){if(token!==cropToken)return;$("exportState").textContent="生成失败";tell("裁切失败："+error.message,"object");}
    }
    $("selectAll").onclick=()=>{if(!image)return;box={x:0,y:0,w:canvas.width,h:canvas.height};draw();renderCrop();};
    $("clear").onclick=()=>{resetCrop();draw();tell("选框已清除，请重新选择区域。","object");};
    $("download").onclick=()=>{if(!cropBlob)return;downloadBlob(cropBlob,current().file.name.replace(/\.[^.]+$/,"")+"-crop.png");tell("已发起裁切图片下载。","object");};
    document.querySelectorAll(".chip").forEach(button=>button.onclick=()=>{$("prompt").value=button.textContent;$("prompt").focus();});
    $("qrStart").onclick=()=>actions.scan(queues.qr.filter(item=>!item.result));
    $("zipOutput").onchange=showResults;
    $("downloadAllZip").onclick=()=>actions.export(queues.qr.filter(item=>item.result).map(item=>item.result));
    $("downloadImageZip").onclick=()=>{const item=queues.qr[positions.qr];if(item?.result)actions.export([item.result],true);};
    return {
        tell,
        busy(value){busy=value;$("add").disabled=mode==="qr"&&(busy||actions.isExporting());$("choose").disabled=mode==="qr"&&(busy||actions.isExporting());$("resetImages").disabled=mode==="qr"&&(busy||actions.isExporting());showResults();},
        refresh(){tiles();showResults();draw();},
        progress(done,total){const percent=total?Math.round(done/total*100):0;$("progressBar").style.width=percent+"%";$("progressTrack").setAttribute("aria-valuenow",percent);},
        detail(text){$("qrDetail").textContent=text;}
    };
}

