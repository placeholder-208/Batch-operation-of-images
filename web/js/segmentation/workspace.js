import { encodeImage, releaseEncoding, segmentBox } from './inference-client.js';
import { normalizedBox, binaryMask, maskBounds, applyMaskRGBA, cropRelativePrompts, intersectBox } from './mask-utils.js';
import { hitBox, boxCursor, editBox } from './box-editor.js';
export function createSamWorkspace(actions) {
 const tab=document.createElement('button');tab.id='samTab';tab.className='tab';tab.textContent='本地分割';tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');tab.tabIndex=-1;document.getElementById('semanticTab').after(tab);
 const root=document.createElement('section');root.id='samWorkspace';root.className='workspace';root.hidden=true;root.innerHTML="\n<section class=\"panel\"><div class=\"head\"><h2>原图与提示</h2><button id=\"sam-choose\">选择图片</button></div>\n<div class=\"stage\" id=\"sam-stage\"><div id=\"sam-empty\">选择一张 JPEG、PNG 或 WebP 图片，再拖动框选对象。</div><canvas id=\"sam-source\" hidden aria-label=\"拖动框选对象，或点击添加保留与排除点\"></canvas></div>\n<p class=\"caption\">白色裁剪框决定模型输入范围。未画蓝框时，目标提示默认为白框范围；没有白框时默认为原图范围。默认提示不绘制蓝框。手动蓝框提供目标位置，不是裁剪边界。</p>\n<div class=\"tools\"><label for=\"sam-mode\">操作</label><select id=\"sam-mode\"><option value=\"box\">框选 / 编辑框（白色裁剪框）</option><option value=\"prompt\">目标位置框选提示（蓝色提示框）</option><option value=\"positive\">点击保留点 ＋</option><option value=\"negative\">点击排除点 −</option></select><button id=\"sam-undo\" title=\"按添加顺序撤销最近的一个点，保留点与排除点统一排序\" aria-describedby=\"sam-undoHelp\">撤销点</button><button id=\"sam-clearPrompt\">清除目标提示</button><button id=\"sam-clear\">清除全部</button></div>\n<p class=\"caption\">当前模式只编辑对应颜色的框。框内拖动可移动，左右边水平缩放，上下边竖直缩放；四个角按当前宽高比缩放。对应框外拖动或按住 Alt 拖动可重画。修改白框重新编码；修改蓝框或点复用裁剪图编码。</p>\n<p class=\"caption\">在框内右击删除框。两个框重叠时优先删除蓝色目标提示框，再次在白框内右击才删除裁剪框。右击删除框不删除提示点。</p>\n<p class=\"caption\" id=\"sam-undoHelp\">撤销点：每次撤销最近添加的一个点，保留点与排除点按共同的添加顺序依次撤销，与当前操作模式无关。</p>\n<p id=\"sam-filename\" class=\"caption\">未选择图片</p>\n<div class=\"head\"><h2>透明预览</h2><label><input type=\"checkbox\" id=\"sam-overlay\"> 在裁剪图上叠加蒙版</label></div>\n<div class=\"stage checker\"><canvas id=\"sam-result\" hidden aria-label=\"透明背景结果预览\"></canvas><span id=\"sam-resultEmpty\">分割结果显示在这里</span></div>\n<p class=\"caption\">预览只显示白色裁剪范围。棋盘格表示被删除的区域；叠加模式中绿色标记才是保留区域。此版是二值分割，不是精细半透明抠图。</p></section>\n<aside class=\"panel controls\"><p class=\"eyebrow\">SLIMSAM · Q8 · WASM</p><h2>本地分割</h2><p>上传后可直接生成蒙版，也可先用白框裁剪。默认使用当前输入图完整范围作为目标提示，不显示蓝框；如需进一步指定对象，可画蓝框或添加保留点、排除点。完整范围提示不保证自动选中你想要的对象。</p>\n<button class=\"primary\" id=\"sam-segment\" disabled>生成蒙版</button>\n<div class=\"status\" id=\"sam-status\" role=\"status\" aria-live=\"polite\">等待图片与框选</div>\n<dl><div><dt>模型</dt><dd id=\"sam-modelState\">首次分割时加载</dd></div><div><dt>图像编码</dt><dd id=\"sam-encodeState\">等待任务</dd></div><div><dt>蒙版解码</dt><dd id=\"sam-decodeState\">等待任务</dd></div></dl>\n<label for=\"sam-candidate\">候选蒙版</label><select id=\"sam-candidate\" disabled></select>\n<p class=\"small\">默认选择预测 IoU 较高的候选。这是模型估计的蒙版质量，不是“目标正确概率”；可手动比较其他候选。</p>\n<label class=\"check\"><input id=\"sam-invert\" type=\"checkbox\" disabled> 反转保留区域（当前保留了背景时）</label>\n<p class=\"small\">优先比较候选，或在目标上添加保留点、背景上添加排除点后重新生成。反转不会重新推理，会同步影响透明预览和 PNG 导出，也会反转原有空洞。</p>\n<label for=\"sam-threshold\">蒙版阈值 <output id=\"sam-thresholdValue\">0.0</output></label><input id=\"sam-threshold\" type=\"range\" min=\"-3\" max=\"3\" step=\"0.1\" value=\"0\" disabled>\n<p class=\"small\">阈值越高，保留区域通常越少。调节阈值不重新推理；增加点或改框后需再点击生成蒙版。</p>\n<p class=\"small\">默认阈值 0 保留模型输出大于 0 的区域。反转只交换裁剪图内的保留与删除区域，不会恢复白框外图片。</p>\n<p class=\"small\" id=\"sam-maskInfo\" aria-live=\"polite\">等待蒙版</p>\n<label class=\"check\"><input id=\"sam-tight\" type=\"checkbox\" checked> 导出时裁去外围透明留白</label>\n<button id=\"sam-download\" disabled>下载透明 PNG</button><button id=\"sam-maskDownload\" disabled>下载黑白蒙版 PNG</button><button id=\"sam-diagnostic\" disabled>下载诊断 JSON</button>\n<p class=\"small\">量化模型约 13.8 MB，另有专用运行库。当前用单线程 CPU 推理，不需要跨域隔离。首次编码较慢，同图改框和补点可复用编码。</p>\n<p class=\"warning\">背景相似、遮挡、玻璃和细小边缘可能分割不准，请检查导出。原图限制为 1600 万像素；分割工作图长边不超过 1024 像素。</p>\n</aside><input id=\"sam-file\" type=\"file\" accept=\"image/jpeg,image/png,image/webp\" hidden>";document.getElementById('semanticWorkspace').after(root);
 let publishedBusy=false;
 const blocked=()=>busy||Boolean(actions.isBlocked?.());
const $=id=>root.querySelector('#sam-'+id),canvas=$('source'),ctx=canvas.getContext('2d'),resultCanvas=$('result'),resultCtx=resultCanvas.getContext('2d',{willReadFrequently:true});
let bitmap=null,filename='',crop=null,promptBox=null,points=[],drag=null,busy=false,encoded=null,segmentation=null,currentMask=null,lastDiagnostic=null;
const tell=text=>{$('status').textContent=text;};
function refresh(){
    for(const id of ['choose','file','mode','undo','clear','clearPrompt','overlay','tight'])$(id).disabled=blocked();
    $('segment').disabled=blocked()||!bitmap;
    for(const id of ['candidate','threshold','invert','download','maskDownload','diagnostic'])$(id).disabled=blocked()||!segmentation;
    $('undo').disabled=blocked()||!points.length;
    if(busy!==publishedBusy){publishedBusy=busy;actions.onBusy?.(busy);}
}
function invalidate(){
    segmentation=null;currentMask=null;lastDiagnostic=null;$('invert').checked=false;$('maskInfo').textContent='等待蒙版';
    resultCanvas.hidden=true;$('resultEmpty').hidden=false;$('resultEmpty').textContent='范围或提示已更新，请重新生成蒙版';$('candidate').replaceChildren();refresh();
}
function discardEncoding(){releaseEncoding(encoded);encoded=null;$('encodeState').textContent='裁剪图已更新，等待编码';}
function activeRect(){return $('mode').value==='box'?crop:promptBox;}
function activeCrop(){return crop||[0,0,bitmap.width,bitmap.height];}
function insideCrop(p){const c=activeCrop();return p.x>=c[0]&&p.x<c[2]&&p.y>=c[1]&&p.y<c[3];}
function drawFrame(b,color,active,label){
    if(!b)return;const sx=canvas.width/bitmap.width,sy=canvas.height/bitmap.height,rect=canvas.getBoundingClientRect();
    const hx=8*canvas.width/rect.width,hy=8*canvas.height/rect.height;
    // Dark under-stroke keeps the white crop line visible on a white photograph.
    ctx.strokeStyle='#202630';ctx.lineWidth=4;ctx.strokeRect(b[0]*sx,b[1]*sy,(b[2]-b[0])*sx,(b[3]-b[1])*sy);
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.strokeRect(b[0]*sx,b[1]*sy,(b[2]-b[0])*sx,(b[3]-b[1])*sy);
    ctx.fillStyle=color;ctx.font='bold 12px system-ui';ctx.fillText(label,b[0]*sx+7,Math.max(14,b[1]*sy-6));
    if(active)for(const [x,y] of [[b[0],b[1]],[b[2],b[1]],[b[0],b[3]],[b[2],b[3]],[(b[0]+b[2])/2,b[1]],[(b[0]+b[2])/2,b[3]],[b[0],(b[1]+b[3])/2],[b[2],(b[1]+b[3])/2]]){
        ctx.fillStyle='#202630';ctx.fillRect(x*sx-hx/2-1,y*sy-hy/2-1,hx+2,hy+2);
        ctx.fillStyle=color;ctx.fillRect(x*sx-hx/2,y*sy-hy/2,hx,hy);
    }
}
function draw(){
    if(!bitmap)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const sx=canvas.width/bitmap.width,sy=canvas.height/bitmap.height;
    const shown=drag?(drag.action==='new'?normalizedBox(drag.start,drag.end,bitmap.width,bitmap.height):drag.preview):null;
    drawFrame(drag?.kind==='crop'?shown:crop,'#ffffff',$('mode').value==='box','裁剪范围');
    drawFrame(drag?.kind==='prompt'?shown:promptBox,'#365ee8',$('mode').value==='prompt','目标提示');
    ctx.font='bold 14px system-ui';
    for(const p of points){const x=p.x*sx,y=p.y*sy;ctx.fillStyle=p.label===1?'#15a568':'#e05245';ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='white';ctx.fillText(p.label===1?'+':'−',x-4,y+5);}
}
function pointer(event){const rect=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(bitmap.width,(event.clientX-rect.left)/rect.width*bitmap.width)),y:Math.max(0,Math.min(bitmap.height,(event.clientY-rect.top)/rect.height*bitmap.height))};}
function actionAt(point){const rect=canvas.getBoundingClientRect();return hitBox(point,activeRect(),8*bitmap.width/rect.width,8*bitmap.height/rect.height);}
function updateCursor(event){canvas.style.cursor=blocked()?'wait':(!bitmap?'crosshair':(['box','prompt'].includes($('mode').value)?boxCursor(drag?.action||(event.altKey?'new':actionAt(pointer(event)))):'crosshair'));}
function dragPosition(point){
    if(drag.kind!=='prompt')return point;
    const c=activeCrop();return {x:Math.max(c[0],Math.min(c[2],point.x)),y:Math.max(c[1],Math.min(c[3],point.y))};
}
function editedRect(point){
    if(drag.kind==='crop')return editBox(drag.original,drag.action,drag.start,point,bitmap.width,bitmap.height);
    const c=activeCrop(),relative=b=>[b[0]-c[0],b[1]-c[1],b[2]-c[0],b[3]-c[1]];
    const next=editBox(relative(drag.original),drag.action,{x:drag.start.x-c[0],y:drag.start.y-c[1]},{x:point.x-c[0],y:point.y-c[1]},c[2]-c[0],c[3]-c[1]);
    return [next[0]+c[0],next[1]+c[1],next[2]+c[0],next[3]+c[1]];
}
canvas.onpointerdown=event=>{
    if(blocked()||!bitmap||event.button!==0)return;const p=pointer(event),mode=$('mode').value;
    if(['box','prompt'].includes(mode)){
        const action=event.altKey?'new':actionAt(p);if(mode==='prompt'&&action==='new'&&!insideCrop(p)){tell('请在白色裁剪范围内添加蓝色提示框。');return;}
        const original=activeRect();drag={kind:mode==='box'?'crop':'prompt',action,start:p,end:p,original:original?[...original]:null,preview:original?[...original]:null};
        canvas.setPointerCapture(event.pointerId);updateCursor(event);
    }else{
        if(!insideCrop(p)){tell('提示点须位于白色裁剪范围内。');return;}
        if(points.length>=30){tell('每个对象最多 30 个补充点。');return;}
        points.push({...p,label:mode==='positive'?1:0});invalidate();draw();
    }
};
canvas.onpointermove=event=>{if(drag){drag.end=dragPosition(pointer(event));if(drag.action!=='new')drag.preview=editedRect(drag.end);draw();}updateCursor(event);};
canvas.onpointerup=event=>{
    if(!drag)return;drag.end=dragPosition(pointer(event));const kind=drag.kind;
    let next=drag.action==='new'?normalizedBox(drag.start,drag.end,bitmap.width,bitmap.height):editedRect(drag.end);
    if(next&&kind==='crop')next=[Math.floor(next[0]),Math.floor(next[1]),Math.ceil(next[2]),Math.ceil(next[3])];
    const old=kind==='crop'?crop:promptBox,changed=next&&(!old||next.some((v,i)=>v!==old[i]));drag=null;
    if(changed){
        if(kind==='crop'){
            crop=next;discardEncoding();const before=points.length,previous=promptBox;promptBox=intersectBox(promptBox,crop);points=points.filter(insideCrop);
            tell('裁剪范围已修改：模型仅接收白框内图片，需重新编码。'+((before!==points.length||previous&&!promptBox)?'已移除裁剪范围外的提示。':''));
        }else{promptBox=next;tell('目标位置提示已修改，请重新生成蒙版；裁剪图编码可复用。');}
        invalidate();
    }
    draw();refresh();updateCursor(event);
};
canvas.onpointercancel=()=>{drag=null;canvas.style.cursor='crosshair';draw();};
canvas.oncontextmenu=event=>{
    if(!bitmap)return;const p=pointer(event);
    const contains=b=>b&&p.x>=b[0]&&p.x<=b[2]&&p.y>=b[1]&&p.y<=b[3];
    const deletePrompt=contains(promptBox),deleteCrop=!deletePrompt&&contains(crop);
    if(!deletePrompt&&!deleteCrop)return;
    event.preventDefault();if(blocked())return;
    drag=null;
    if(deletePrompt){
        promptBox=null;invalidate();tell('已删除蓝色目标提示框，恢复裁剪图完整范围的默认提示（不显示蓝框）。提示点保留，请重新生成蒙版。');
    }else{
        crop=null;discardEncoding();invalidate();tell('已删除白色裁剪框，模型输入恢复整图。目标提示和提示点保留，需重新编码。');
    }
    draw();refresh();updateCursor(event);
};
$('mode').onchange=()=>{drag=null;canvas.style.cursor='crosshair';draw();};
async function openFile(file){
    if(blocked()||!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024){tell('请选择不超过 20 MiB 的 JPEG、PNG 或 WebP。');return;}
    busy=true;refresh();let next;
    try{
        next=await createImageBitmap(file);if(next.width*next.height>16_000_000)throw new Error('原图最多 1600 万像素，请先缩小图片');
        bitmap?.close();bitmap=next;next=null;discardEncoding();filename=file.name;crop=null;promptBox=null;points=[];drag=null;invalidate();
        const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        canvas.hidden=false;$('empty').hidden=true;$('filename').textContent=filename+' · '+bitmap.width+' × '+bitmap.height;
        $('encodeState').textContent='等待任务';$('decodeState').textContent='等待任务';draw();tell('可直接生成蒙版。白框裁剪处理范围；未画蓝框时默认提示为当前输入图的完整范围，不显示提示框。');return true;
    }catch(error){tell('读取失败：'+error.message);return false;}finally{next?.close();busy=false;refresh();}
}
async function run(){
    if(blocked()||!bitmap)return;busy=true;refresh();tell('正在分割裁剪范围内的图片…');
    const region=[...activeCrop()],cw=region[2]-region[0],ch=region[3]-region[1];
    try{
        if(!encoded){
            const scale=Math.min(1,1024/Math.max(cw,ch)),clean=document.createElement('canvas');clean.width=Math.max(1,Math.round(cw*scale));clean.height=Math.max(1,Math.round(ch*scale));
            const c=clean.getContext('2d');c.fillStyle='white';c.fillRect(0,0,clean.width,clean.height);
            // Only cropped pixels enter the encoder; no rectangles or annotations are painted here.
            c.drawImage(bitmap,region[0],region[1],cw,ch,0,0,clean.width,clean.height);
            try{encoded=await encodeImage(clean,text=>{$('modelState').textContent=text;});}finally{clean.width=clean.height=1;}
            $('encodeState').textContent=encoded.elapsedMs+' ms · 仅裁剪图';
        }else $('encodeState').textContent=encoded.elapsedMs+' ms · 本次复用裁剪图';
        const effectivePrompt=promptBox||region;
        const prompts=cropRelativePrompts(region,effectivePrompt,points);
        segmentation=await segmentBox(encoded,prompts.box,prompts.points,cw,ch);segmentation.region=region;
        $('decodeState').textContent=segmentation.elapsedMs+' ms';$('modelState').textContent='SlimSAM-77 q8 · WASM';
        const select=$('candidate');select.replaceChildren();for(const candidate of segmentation.order){const option=document.createElement('option');option.value=String(candidate.index);option.textContent='候选 '+(candidate.index+1)+' · 预测 IoU '+(candidate.score===null?'未知':candidate.score.toFixed(3));select.append(option);}
        select.value=String(segmentation.order[0].index);$('threshold').value='0';$('invert').checked=false;
        lastDiagnostic={revision:'xincai-segmentation-v2.0',filename,model:'Xenova/slimsam-77-uniform',dtype:'q8',backend:'wasm',threads:1,
            originalSize:[bitmap.width,bitmap.height],crop:[...region],cropSize:[cw,ch],workingSize:[encoded.width,encoded.height],promptBox:promptBox?[...promptBox]:null,
            promptMode:promptBox?'manual':'default',effectivePromptBox:[...effectivePrompt],localPrompts:prompts,points:points.map(p=>({...p})),encodeMs:encoded.elapsedMs,decodeMs:segmentation.elapsedMs,candidates:segmentation.order};
        render();tell(promptBox?'蒙版已生成，使用手动蓝框作为目标提示。':'蒙版已生成，使用当前输入图的完整范围作为默认目标提示（不显示蓝框）。');return true;
    }catch(error){segmentation=null;currentMask=null;resultCanvas.hidden=true;$('resultEmpty').hidden=false;$('resultEmpty').textContent='分割失败';$('modelState').textContent='任务失败';tell('分割失败：'+error.message);console.error('[SlimSAM 分割]',error);return false;}
    finally{busy=false;refresh();}
}
function render(){
    if(!bitmap||!segmentation)return;
    const index=Number($('candidate').value),threshold=Number($('threshold').value),candidate=segmentation.candidates[index];if(!candidate)return;
    currentMask=binaryMask(candidate.logits,threshold,$('invert').checked);$('thresholdValue').textContent=threshold.toFixed(1);
    const [l,t,r,b]=segmentation.region;resultCanvas.width=segmentation.width;resultCanvas.height=segmentation.height;resultCtx.clearRect(0,0,resultCanvas.width,resultCanvas.height);
    resultCtx.drawImage(bitmap,l,t,r-l,b-t,0,0,resultCanvas.width,resultCanvas.height);const pixels=resultCtx.getImageData(0,0,resultCanvas.width,resultCanvas.height);
    if($('overlay').checked){for(let i=0;i<currentMask.length;i++)if(currentMask[i]){const p=i*4;pixels.data[p]*=.6;pixels.data[p+1]=pixels.data[p+1]*.6+100;pixels.data[p+2]*=.6;}}
    else applyMaskRGBA(pixels.data,resultCanvas.width,resultCanvas.height,currentMask,segmentation.width,segmentation.height);
    resultCtx.putImageData(pixels,0,0);resultCanvas.hidden=false;$('resultEmpty').hidden=true;
    const bounds=maskBounds(currentMask,segmentation.width,segmentation.height),retained=(bounds?.count||0)/currentMask.length;
    $('maskInfo').textContent='裁剪图内保留 '+(retained*100).toFixed(1)+'%'+(retained>.98?' · 当前候选几乎保留整个裁剪图，若包含背景，请更换候选或补充提示点。':'');
    if(lastDiagnostic){lastDiagnostic.selectedCandidate=index+1;lastDiagnostic.threshold=threshold;lastDiagnostic.inverted=$('invert').checked;lastDiagnostic.foregroundPixels=bounds?.count||0;lastDiagnostic.retainedFraction=retained;}
    if(!bounds)tell('当前候选在此阈值下为空，可更换候选或降低阈值。');
}
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const toBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG 编码失败')),'image/png'));
async function exportPNG(isMask=false){
    if(blocked()||!currentMask||!bitmap)return;const bounds=maskBounds(currentMask,segmentation.width,segmentation.height);if(!bounds){tell('当前蒙版为空，未导出。');return;}
    busy=true;refresh();const output=document.createElement('canvas');let full;
    try{
        if(isMask){output.width=segmentation.width;output.height=segmentation.height;const c=output.getContext('2d'),pixels=c.createImageData(output.width,output.height);
            for(let i=0;i<currentMask.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=currentMask[i]?255:0;pixels.data[i*4+3]=255;}c.putImageData(pixels,0,0);
        }else{
            const [l,t,r,b]=segmentation.region;full=document.createElement('canvas');full.width=r-l;full.height=b-t;const c=full.getContext('2d',{willReadFrequently:true});c.drawImage(bitmap,l,t,r-l,b-t,0,0,full.width,full.height);
            const pixels=c.getImageData(0,0,full.width,full.height);applyMaskRGBA(pixels.data,full.width,full.height,currentMask,segmentation.width,segmentation.height);c.putImageData(pixels,0,0);
            const sx=full.width/segmentation.width,sy=full.height/segmentation.height;
            const left=$('tight').checked?Math.floor(bounds.left*sx):0,top=$('tight').checked?Math.floor(bounds.top*sy):0;
            const right=$('tight').checked?Math.min(full.width,Math.ceil(bounds.right*sx)):full.width,bottom=$('tight').checked?Math.min(full.height,Math.ceil(bounds.bottom*sy)):full.height;
            output.width=right-left;output.height=bottom-top;output.getContext('2d').drawImage(full,left,top,output.width,output.height,0,0,output.width,output.height);
        }
        save(await toBlob(output),filename.replace(/\.[^.]+$/,'')+(isMask?'-mask':'-transparent')+'.png');tell(isMask?'已导出裁剪工作图尺寸黑白蒙版。':'已导出裁剪范围内原始分辨率透明 PNG。');
    }catch(error){tell('导出失败：'+error.message);}finally{output.width=output.height=1;if(full)full.width=full.height=1;busy=false;refresh();}
}
$('choose').onclick=()=>$('file').click();$('file').onchange=()=>{openFile($('file').files[0]);$('file').value='';};
$('stage').ondragover=event=>event.preventDefault();$('stage').ondrop=event=>{event.preventDefault();openFile(event.dataTransfer.files[0]);};
$('undo').onclick=()=>{if(blocked()||!points.length)return;const removed=points.pop();invalidate();draw();tell('已撤销最近添加的'+(removed.label===1?'保留点':'排除点')+'，剩余 '+points.length+' 个提示点。请重新生成蒙版。');};
$('clearPrompt').onclick=()=>{if(blocked())return;promptBox=null;points=[];invalidate();draw();tell('手动蓝框和提示点已清除，恢复当前输入图完整范围的默认目标提示。白色裁剪范围不变。');};
$('clear').onclick=()=>{if(blocked())return;crop=null;promptBox=null;points=[];discardEncoding();invalidate();draw();tell('两个框和提示点已清除，模型输入恢复整图。');};
$('segment').onclick=run;$('candidate').onchange=$('threshold').oninput=$('overlay').onchange=render;
$('invert').onchange=()=>{render();tell($('invert').checked?'已反转裁剪图内的保留区域。':'已恢复模型原始保留区域。');};
$('download').onclick=()=>exportPNG();$('maskDownload').onclick=()=>exportPNG(true);
$('diagnostic').onclick=()=>{if(!blocked()&&lastDiagnostic)save(new Blob([JSON.stringify(lastDiagnostic,null,2)],{type:'application/json'}),'slimsam-diagnostics.json');};

 refresh();
 async function openCrop(blob,name) {
  if(blocked())throw new Error('其他任务正在处理，请稍后转入本地分割');
  if(!(blob instanceof Blob)||!blob.size)throw new Error('目标裁图不可用');
  tab.click();
  if(!await openFile(new File([blob],name||'semantic-first.png',{type:blob.type||'image/png'})))throw new Error($('status').textContent);
  if(!await run())throw new Error($('status').textContent);
 }
 return {refresh,isBusy:()=>busy,openCrop};
}
