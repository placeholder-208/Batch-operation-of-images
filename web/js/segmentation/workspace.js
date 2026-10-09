import { workspaceTemplate } from './workspace-template.js';
import { interpolatedAlpha, paintStrokes, applyAlphaRGBA } from './postprocess.js';
import { createMaskBrush } from './mask-brush.js';
import { findSmallRegions, applyRegionRemoval } from './region-cleanup.js';
import { encodeImage, releaseEncoding, segmentBox } from './inference-client.js';
import { normalizedBox, maskBounds, cropRelativePrompts, intersectBox } from './mask-utils.js';
import { hitBox, boxCursor, editBox } from './box-editor.js';
export function createSamWorkspace(actions) {
 const tab=document.createElement('button');tab.id='samTab';tab.className='tab';tab.textContent='本地分割';tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');tab.tabIndex=-1;document.getElementById('semanticTab').after(tab);
 const root=document.createElement('section');root.id='samWorkspace';root.className='workspace';root.hidden=true;root.innerHTML=workspaceTemplate;document.getElementById('semanticWorkspace').after(root);
 let publishedBusy=false;
 const blocked=()=>busy||Boolean(actions.isBlocked?.());
const $=id=>root.querySelector('#sam-'+id),canvas=$('source'),ctx=canvas.getContext('2d'),resultCanvas=$('result'),resultCtx=resultCanvas.getContext('2d',{willReadFrequently:true});
let bitmap=null,filename='',crop=null,promptBox=null,points=[],drag=null,busy=false,encoded=null,segmentation=null,currentMask=null,lastDiagnostic=null;
let alphaCache=null,areaCleanup=null;
const tell=text=>{$('status').textContent=text;};
const brush=createMaskBrush({canvas:resultCanvas,container:$('previewStage'),isBlocked:blocked,
    getSize:()=>segmentation?{width:segmentation.region[2]-segmentation.region[0],height:segmentation.region[3]-segmentation.region[1]}:null,
    readRadius:()=>Number($('brushRadius').value),readMode:()=>$('brushMode').value,
    readTool:()=>$('brushTool').value,onStatus:tell,
    getAlpha:()=>({alpha:editedAlpha(segmentation.width,segmentation.height),width:segmentation.width,height:segmentation.height}),
    onMode:mode=>{$('brushMode').value=mode;tell(mode==='add'?'画笔：增加保留区域。':'画笔：删除保留区域。');},
    onChange:()=>{if(areaCleanup)resetCleanup('画笔已修改，区域清理已撤销；修整完成后可再次清理。');render();},onHistory:refresh});
function cleanupKey(){return [$('candidate').value,$('threshold').value,$('invert').checked,$('smooth').checked].join('|');}
function resetCleanup(message='尚未执行区域清理'){
    areaCleanup=null;$('areaInfo').textContent=message;refresh();
}
function refresh(){
    for(const id of ['choose','file','mode','undo','clear','clearPrompt','overlay','tight'])$(id).disabled=blocked();
    $('segment').disabled=blocked()||brush.isDrawing()||!bitmap;
    for(const id of ['candidate','threshold','invert','smooth','download','maskDownload','diagnostic','brushTool','brushMode','brushRadius'])$(id).disabled=blocked()||brush.isDrawing()||!segmentation;
    for(const id of ['curveUndo','curveClear'])$(id).disabled=blocked()||brush.isDrawing()||!brush.getShapes().length;
    $('curveInfo').textContent=brush.getShapes().length+' 个图形 · 最多 30 个 · 互不重叠';
    $('circleTools').hidden=$('brushTool').value==='curve';$('curveTools').hidden=$('brushTool').value!=='curve';
    for(const id of ['brushUndo','brushClear'])$(id).disabled=blocked()||brush.isDrawing()||!brush.getStrokes().length;
    for(const id of ['minArea','cleanAreas'])$(id).disabled=blocked()||brush.isDrawing()||!segmentation;
    $('undoAreas').disabled=blocked()||brush.isDrawing()||!areaCleanup;
    $('undo').disabled=blocked()||!points.length;
    if(busy!==publishedBusy){publishedBusy=busy;actions.onBusy?.(busy);}
}
function invalidate(){
    areaCleanup=null;$('areaInfo').textContent='尚未执行区域清理';
    brush.reset();alphaCache=null;
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
    if(blocked()||brush.isDrawing()||!bitmap)return;areaCleanup=null;$('areaInfo').textContent='尚未执行区域清理';brush.reset();alphaCache=null;busy=true;refresh();tell('正在分割裁剪范围内的图片…');
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
        lastDiagnostic={revision:'xincai-segmentation-v2.4',filename,model:'Xenova/slimsam-77-uniform',dtype:'q8',backend:'wasm',threads:1,
            originalSize:[bitmap.width,bitmap.height],crop:[...region],cropSize:[cw,ch],workingSize:[encoded.width,encoded.height],promptBox:promptBox?[...promptBox]:null,
            promptMode:promptBox?'manual':'default',effectivePromptBox:[...effectivePrompt],localPrompts:prompts,points:points.map(p=>({...p})),encodeMs:encoded.elapsedMs,decodeMs:segmentation.elapsedMs,candidates:segmentation.order};
        render();tell(promptBox?'蒙版已生成，使用手动蓝框作为目标提示。':'蒙版已生成，使用当前输入图的完整范围作为默认目标提示（不显示蓝框）。');return true;
    }catch(error){segmentation=null;currentMask=null;resultCanvas.hidden=true;$('resultEmpty').hidden=false;$('resultEmpty').textContent='分割失败';$('modelState').textContent='任务失败';tell('分割失败：'+error.message);console.error('[SlimSAM 分割]',error);return false;}
    finally{busy=false;refresh();}
}
function editedAlpha(width,height,includeCleanup=true){
    const candidate=segmentation.candidates[Number($('candidate').value)],threshold=Number($('threshold').value),invert=$('invert').checked,smooth=$('smooth').checked;
    // Cache only the preview base, not full-resolution export data.
    let alpha;
    if(width===segmentation.width&&height===segmentation.height){
        if(!alphaCache||alphaCache.candidate!==candidate||alphaCache.threshold!==threshold||alphaCache.invert!==invert||alphaCache.smooth!==smooth)
            alphaCache={candidate,threshold,invert,smooth,alpha:interpolatedAlpha(candidate.logits,segmentation.width,segmentation.height,width,height,threshold,invert,smooth)};
        alpha=alphaCache.alpha.slice();
    }else alpha=interpolatedAlpha(candidate.logits,segmentation.width,segmentation.height,width,height,threshold,invert,smooth);
    const [l,t,r,b]=segmentation.region;
    paintStrokes(alpha,width,height,r-l,b-t,brush.getStrokes());
    if(includeCleanup&&areaCleanup)applyRegionRemoval(alpha,width,height,areaCleanup.removed,segmentation.width,segmentation.height);
    return alpha;
}
function render(){
    if(!bitmap||!segmentation)return;
    if(areaCleanup&&areaCleanup.key!==cleanupKey())resetCleanup('蒙版设置已更改，区域清理已撤销；确认新蒙版后可再次清理。');
    const index=Number($('candidate').value),threshold=Number($('threshold').value),candidate=segmentation.candidates[index];if(!candidate)return;
    currentMask=editedAlpha(segmentation.width,segmentation.height);$('thresholdValue').textContent=threshold.toFixed(1);
    const [l,t,r,b]=segmentation.region;resultCanvas.width=segmentation.width;resultCanvas.height=segmentation.height;resultCtx.clearRect(0,0,resultCanvas.width,resultCanvas.height);
    resultCtx.drawImage(bitmap,l,t,r-l,b-t,0,0,resultCanvas.width,resultCanvas.height);const pixels=resultCtx.getImageData(0,0,resultCanvas.width,resultCanvas.height);
    if($('overlay').checked){for(let i=0;i<currentMask.length;i++){const p=i*4,a=.4*currentMask[i];pixels.data[p]*=1-a;pixels.data[p+1]=pixels.data[p+1]*(1-a)+250*a;pixels.data[p+2]*=1-a;}}
    else applyAlphaRGBA(pixels.data,currentMask);
    resultCtx.putImageData(pixels,0,0);resultCanvas.hidden=false;$('resultEmpty').hidden=true;
    brush.drawOverlay();
    const bounds=maskBounds(currentMask.map(a=>a>=1/255?1:0),segmentation.width,segmentation.height),retained=currentMask.reduce((sum,a)=>sum+a,0)/currentMask.length;
    $('maskInfo').textContent='裁剪图内保留 '+(retained*100).toFixed(1)+'%'+(retained>.98?' · 当前候选几乎保留整个裁剪图，若包含背景，请更换候选或补充提示点。':'');
    if(lastDiagnostic){lastDiagnostic.selectedCandidate=index+1;lastDiagnostic.threshold=threshold;lastDiagnostic.inverted=$('invert').checked;lastDiagnostic.foregroundPixels=bounds?.count||0;lastDiagnostic.retainedFraction=retained;lastDiagnostic.postprocess={continuousInterpolation:true,narrowAntialias:$('smooth').checked,brushStrokeCount:brush.getStrokes().length};}
    if(!bounds)tell('当前候选在此阈值下为空，可更换候选或降低阈值。');
    if(lastDiagnostic)lastDiagnostic.regionCleanup=areaCleanup?{minPercent:areaCleanup.minPercent,connectivity:8,alphaCutoff:1/255,regions:areaCleanup.regions,removedRegions:areaCleanup.removedRegions,removedWorkingPixels:areaCleanup.removedPixels,workingSize:[segmentation.width,segmentation.height]}:null;
}
async function cleanAreas(){
    if(blocked()||brush.isDrawing()||!segmentation)return;
    const input=$('minArea').value.trim(),minPercent=Number(input);
    if(!input||!Number.isFinite(minPercent)||minPercent<0||minPercent>100){tell('请输入 0～100 的区域面积百分比。');return;}
    busy=true;refresh();tell('正在计算连通区域面积…');await new Promise(resolve=>setTimeout(resolve,0));
    try{
        const alpha=editedAlpha(segmentation.width,segmentation.height,false);
        areaCleanup={...findSmallRegions(alpha,segmentation.width,segmentation.height,minPercent),key:cleanupKey()};
        render();
        const [l,t,r,b]=segmentation.region,sourceArea=(r-l)*(b-t),minimum=sourceArea*minPercent/100;
        $('areaInfo').textContent='共 '+areaCleanup.regions+' 个连通区域，删除 '+areaCleanup.removedRegions+' 个；阈值 '+minPercent+'% ≈ '+Math.round(minimum)+' 原图像素²（工作图估算）。';
        tell(areaCleanup.removedRegions?'小区域清理完成，预览与导出已同步；可撤销。':'没有面积小于阈值的区域，图片未改变。');
    }catch(error){tell('区域清理失败：'+error.message);}finally{busy=false;refresh();}
}
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const toBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG 编码失败')),'image/png'));
async function exportPNG(isMask=false){
    if(blocked()||brush.isDrawing()||!currentMask||!bitmap)return;
    busy=true;refresh();tell('正在按导出尺寸处理蒙版与画笔修改…');await new Promise(resolve=>setTimeout(resolve,0));const output=document.createElement('canvas');let full;
    try{
        if(isMask){output.width=segmentation.width;output.height=segmentation.height;const alpha=editedAlpha(output.width,output.height),c=output.getContext('2d'),pixels=c.createImageData(output.width,output.height);
            if(!alpha.some(a=>a>=1/255)){tell('当前蒙版为空，未导出。');return;}
            for(let i=0;i<alpha.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=Math.round(alpha[i]*255);pixels.data[i*4+3]=255;}c.putImageData(pixels,0,0);
        }else{
            const [l,t,r,b]=segmentation.region;full=document.createElement('canvas');full.width=r-l;full.height=b-t;const c=full.getContext('2d',{willReadFrequently:true});c.drawImage(bitmap,l,t,r-l,b-t,0,0,full.width,full.height);
            const alpha=editedAlpha(full.width,full.height),pixels=c.getImageData(0,0,full.width,full.height);applyAlphaRGBA(pixels.data,alpha);c.putImageData(pixels,0,0);
            // Use the actual exported alpha (including original transparency and brush edits) for tight cropping.
            const visible=new Uint8Array(alpha.length);for(let i=0;i<visible.length;i++)visible[i]=pixels.data[i*4+3]>0?1:0;
            const bounds=maskBounds(visible,full.width,full.height);if(!bounds){tell('当前蒙版为空，未导出。');return;}
            const left=$('tight').checked?bounds.left:0,top=$('tight').checked?bounds.top:0;
            const right=$('tight').checked?bounds.right:full.width,bottom=$('tight').checked?bounds.bottom:full.height;
            output.width=right-left;output.height=bottom-top;output.getContext('2d').drawImage(full,left,top,output.width,output.height,0,0,output.width,output.height);
        }
        save(await toBlob(output),filename.replace(/\.[^.]+$/,'')+(isMask?'-mask':'-transparent')+'.png');tell(isMask?'已导出含画笔修改的灰度蒙版。':'已导出含画笔修改与边缘处理的原始分辨率透明 PNG。');
    }catch(error){tell('导出失败：'+error.message);}finally{output.width=output.height=1;if(full)full.width=full.height=1;busy=false;refresh();}
}
$('choose').onclick=()=>$('file').click();$('file').onchange=()=>{openFile($('file').files[0]);$('file').value='';};
$('stage').ondragover=event=>event.preventDefault();$('stage').ondrop=event=>{event.preventDefault();openFile(event.dataTransfer.files[0]);};
$('undo').onclick=()=>{if(blocked()||!points.length)return;const removed=points.pop();invalidate();draw();tell('已撤销最近添加的'+(removed.label===1?'保留点':'排除点')+'，剩余 '+points.length+' 个提示点。请重新生成蒙版。');};
$('clearPrompt').onclick=()=>{if(blocked())return;promptBox=null;points=[];invalidate();draw();tell('手动蓝框和提示点已清除，恢复当前输入图完整范围的默认目标提示。白色裁剪范围不变。');};
$('clear').onclick=()=>{if(blocked())return;crop=null;promptBox=null;points=[];discardEncoding();invalidate();draw();tell('两个框和提示点已清除，模型输入恢复整图。');};
$('segment').onclick=run;$('candidate').onchange=$('threshold').oninput=$('overlay').onchange=render;
$('smooth').onchange=render;
$('cleanAreas').onclick=cleanAreas;
$('undoAreas').onclick=()=>{if(blocked()||brush.isDrawing()||!areaCleanup)return;resetCleanup('已撤销区域清理，模型蒙版与画笔修改保留。');render();tell('已撤销区域清理。');};
$('brushRadius').oninput=()=>{$('brushRadiusValue').textContent=$('brushRadius').value;};
$('brushTool').onchange=()=>{brush.refreshTool();refresh();};
$('curveUndo').onclick=()=>brush.removeLastShape();$('curveClear').onclick=()=>brush.clearShapes();
$('brushUndo').onclick=()=>brush.undo();$('brushClear').onclick=()=>brush.clear();
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
