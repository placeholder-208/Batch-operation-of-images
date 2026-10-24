import {cropBlob,releaseCrops} from './crop-store.js';
import { qrStatisticsCSV, qrStatisticsJSON, normalizeQROptions } from './qr-statistics.js';
import { createFileImport } from './file-import.js';
import { packItem, unpackItem } from './workspace-state.js';
import { createTileList, prepareThumbnail, disposeThumbnail, bindBatchNavigation } from './thumbnail-list.js';
import { subscribe } from "./runtime-status.js";
import { canvasToBlob } from "./image.js";
import { parseWebURL, createLinkPreview, cancelLinkPreviews } from './link-preview.js?v=3.5.1';
export const $ = id => document.getElementById(id);
export function updateWorkspaceDescription(mode) {
    const pages={
        qr:['二维码识别','支持图片及 PDF，读取二维码内容并导出裁图与 CSV。'],
        barcode:['条形码识别','支持图片及 PDF，读取条形码内容并导出裁图与 CSV。'],
        mask:['二维码遮盖','支持图片及 PDF，检测或手动补框后导出遮盖图片。'],
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
    let image = null, imageToken = 0, selectedQR = null, busy = false, importBusy = false;
    const locked=()=>busy||importBusy;
    const current = () => queues.qr[positions.qr];
    const experiments=document.createElement('details');experiments.className='context-help';
    const experimentTitle=document.createElement('summary');experimentTitle.textContent='识别选项';
    experiments.append(experimentTitle);
    const experimentControls={};
    for(const [key,label,id]of [['useTPS','启用 TPS 校正（实验）','qrUseTPS'],['detailedRecovery','精细模糊恢复（较慢）','qrDetailedRecovery']]){
        const wrapper=document.createElement('label');wrapper.style.display='block';
        const input=document.createElement('input');input.type='checkbox';input.checked=false;input.id=id;
        input.onchange=()=>actions.onChange?.();experimentControls[key]=input;
        wrapper.append(input,document.createTextNode(' '+label));experiments.append(wrapper);
    }
    const experimentNote=document.createElement('p');experimentNote.className='small';
    experimentNote.textContent='两项默认关闭。TPS失败后继续柱面校正；精细恢复使用更高分辨率，增加耗时与内存。选项只影响下次识别，重新识别会保留此前统计并替换结果。';
    const rerun=document.createElement('button');rerun.type='button';rerun.className='secondary full';
    rerun.id='qrRerun';rerun.textContent='重新识别本批';
    const getOptions=()=>normalizeQROptions(Object.fromEntries(Object.entries(experimentControls).map(([key,input])=>[key,input.checked])));
    rerun.onclick=()=>{if(!locked()&&!actions.isExporting()&&queues.qr.length)actions.scan([...queues.qr],getOptions());};
    experiments.append(experimentNote,rerun);$('qrStart').after(experiments);
    const statisticsButtons=[];
    for(const [label,format] of [['下载识别统计 CSV','csv'],['下载详细统计 JSON','json']]){
        const button=document.createElement('button');button.type='button';button.className='secondary full';
        button.id=format==='csv'?'qrStatisticsCSV':'qrStatisticsJSON';button.textContent=label;button.disabled=true;
        button.onclick=()=>{
            if(locked()||actions.isExporting())return;
            const content=format==='csv'?qrStatisticsCSV(queues.qr):JSON.stringify(qrStatisticsJSON(queues.qr),null,2);
            downloadBlob(new Blob([content],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'}),
                'qr-statistics-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+format);
        };
        $('downloadAllZip').parentElement.append(button);statisticsButtons.push(button);
    }
    const statisticsNote=document.createElement('p');statisticsNote.className='small';
    statisticsNote.textContent='统计包含本批逐图耗时、未解决候选及人工补记栏。“全部识别”仅指本轮已发现候选，不判断未知漏检。';
    $('downloadAllZip').parentElement.append(statisticsNote);
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
        $("downloadAllZip").disabled = locked() || !checked || !exportable || actions.isExporting();
        $("downloadImageZip").disabled = locked() || !checked || !item?.result || actions.isExporting();
        $("qrStart").disabled = locked() || !queues.qr.some(item=>!item.result) || actions.isExporting();
        for(const button of statisticsButtons)button.disabled=locked()||actions.isExporting()||!queues.qr.some(item=>item.qrStatistics);
        for(const input of Object.values(experimentControls))input.disabled=locked()||actions.isExporting();
        rerun.disabled=locked()||actions.isExporting()||!queues.qr.length;
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
    const importer=createFileImport({status:$("qrStatus"),canStart:()=>!locked()&&!actions.isExporting(),
        onLock(value){importBusy=value;actions.onBusy?.(value);uiLock();},
        async onItem(file,source){const index=queues.qr.length,item={file,source,url:URL.createObjectURL(file),result:null,error:null};queues.qr.push(item);prepareThumbnail(item,tiles);if(positions.qr<0)await select(index);tiles();$("count").textContent=queues.qr.length+" 张图片";actions.onChange?.();},
        onComplete({added,errors,cancelled}){tell((cancelled?'已停止导入，':'导入完成，')+'新增 '+added+' 张图片。'+(errors.length?' '+errors.join('；'):'请点击开始识别。'));showResults();}
    });
    function add(files){if(locked()||actions.isExporting()){notice('请等待当前任务完成。');return;}return importer.add(files);}
    $("choose").onclick=$("add").onclick=()=>$("file").click();
    $("file").onchange=event=>{add([...event.target.files]);event.target.value="";};
    $("resetImages").onclick=()=> {
        if(locked()||actions.isExporting())return;
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
    $("qrStart").onclick=()=>actions.scan(queues.qr.filter(item=>!item.result),getOptions());
    $("zipOutput").onchange=()=>{showResults();actions.onChange?.();};
    $("downloadAllZip").onclick=()=>actions.export(queues.qr.filter(item=>item.result).map(item=>item.result));
    $("downloadImageZip").onclick=()=>{const item=queues.qr[positions.qr];if(item?.result)actions.export([item.result],true);};
    function uiLock(){$("add").disabled=$("choose").disabled=$("resetImages").disabled=locked()||actions.isExporting();showResults();}
    return {
        tell,
        isImporting:()=>importBusy,
        snapshot(){return {version:1,items:queues.qr.map(packItem),position:positions.qr,selectedQR,zipOutput:$("zipOutput").checked,options:getOptions()};},
        async restore(saved){
            if(saved.version!==1||!Array.isArray(saved.items))throw new Error('二维码工作区数据版本无效');
            queues.qr.forEach(item=>{disposeThumbnail(item);releaseCrops(item.result);URL.revokeObjectURL(item.url);});
            queues.qr=saved.items.map(unpackItem);
            const options=normalizeQROptions(saved.options??saved.experiments);
            for(const [key,input]of Object.entries(experimentControls))input.checked=options[key];
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
        busy(value){busy=value;uiLock();},
        refresh(){tiles();showResults();draw();actions.onChange?.();},
        progress(done,total){const percent=total?Math.round(done/total*100):0;$("progressBar").style.width=percent+"%";$("progressTrack").setAttribute("aria-valuenow",percent);},
        detail(text){$("qrDetail").textContent=text;$("qrDetail").hidden=!text;}
    };
}

