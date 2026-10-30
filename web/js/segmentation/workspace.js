import {setBatchSize} from '../thumbnail-list.js';
import { createEditCache } from './edit-cache.js';
import { createThumbnailItem, updateThumbnailItem, prepareThumbnail, disposeThumbnail } from '../thumbnail-list.js';
import { workspaceTemplate } from './workspace-template.js';
import { createMaskCache, csvCell } from './batch-cache.js';
import { paintStrokes, applyAlphaRGBA } from './postprocess.js';
import { maskAlpha } from './alpha-utils.js';
import { createMaskBrush } from './mask-brush.js';
import { createMagnifier } from './magnifier.js';
import { findSmallRegions, applyRegionRemoval } from './region-cleanup.js';
import { encodeImage, releaseEncoding, segmentBox, mattePortrait } from './inference-client.js';
import { normalizedBox, maskBounds, cropRelativePrompts, intersectBox } from './mask-utils.js';
import { hitBox, boxCursor, editBox } from './box-editor.js';
export function createSamWorkspace(actions) {
 const tab=document.createElement('button');tab.id='samTab';tab.className='tab';tab.textContent='本地分割';tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');tab.tabIndex=-1;document.getElementById('semanticTab').after(tab);
 const root=document.createElement('section');root.id='samWorkspace';root.className='workspace';root.hidden=true;root.innerHTML=workspaceTemplate;document.getElementById('semanticWorkspace').after(root);
 let publishedBusy=false;
 const blocked=()=>busy||batchBusy||Boolean(actions.isBlocked?.());
const $=id=>root.querySelector('#sam-'+id),canvas=$('source'),ctx=canvas.getContext('2d'),resultCanvas=$('result'),resultCtx=resultCanvas.getContext('2d',{willReadFrequently:true});
let bitmap=null,filename='',crop=null,promptBox=null,points=[],drag=null,busy=false,encoded=null,segmentation=null,currentMask=null,lastDiagnostic=null;
let alphaCache=null,areaCleanup=null,previewPixels=null,previewDirty=null,previewOverlay=null;const editCache=createEditCache();
let batchBusy=false,batchOperation='',cancelBatch=false,records=[],activeIndex=-1,sequence=0,cacheRevision=0;
let restoringState=false,flushingState=false;
const changed=()=>{if(!restoringState&&!flushingState)actions.onChange?.();};
const cache=createMaskCache(),settingIds=['candidate','threshold','invert','smooth','tight','overlay','minArea','brushTool','brushMode','brushRadius','mode'];
const tell=text=>{$('status').textContent=text;};
const brush=createMaskBrush({canvas:resultCanvas,container:$('previewStage'),isBlocked:blocked,
    getSize:()=>segmentation?{width:segmentation.region[2]-segmentation.region[0],height:segmentation.region[3]-segmentation.region[1]}:null,
    readRadius:()=>Number($('brushRadius').value),readMode:()=>$('brushMode').value,
    readTool:()=>$('brushTool').value,onStatus:tell,
    getAlpha:()=>({alpha:editedAlpha(segmentation.width,segmentation.height),width:segmentation.width,height:segmentation.height}),
    onMode:mode=>{$('brushMode').value=mode;$('brushMode').dispatchEvent(new Event('input',{bubbles:true}));brushLens.refresh();tell(mode==='add'?'画笔：增加保留区域。':'画笔：删除保留区域。');},
    onChange:render,onHistory:refresh});
const pointLens=createMagnifier({canvas,isEnabled:()=>$('magnify').checked,
    isAvailable:()=>!root.hidden&&!blocked()&&Boolean(bitmap)&&['positive','negative'].includes($('mode').value),
    readZoom:()=>$('magnifyZoom').value,readMark:()=>({mode:$('mode').value==='negative'?'erase':'add'})});
const brushLens=createMagnifier({canvas:resultCanvas,isEnabled:()=>$('magnify').checked,
    isAvailable:()=>!root.hidden&&!blocked()&&Boolean(segmentation),readZoom:()=>$('magnifyZoom').value,
    readMark:()=>({mode:$('brushMode').value,radius:$('brushTool').value==='circle'?Number($('brushRadius').value):0})});
for(const suffix of ['', 'Preview']){
    $('magnify'+suffix).onchange=()=>{const checked=$('magnify'+suffix).checked;$('magnify').checked=$('magnifyPreview').checked=checked;pointLens.refresh();brushLens.refresh();changed();};
    $('magnifyZoom'+suffix).onchange=()=>{const value=$('magnifyZoom'+suffix).value;$('magnifyZoom').value=$('magnifyZoomPreview').value=value;pointLens.refresh();brushLens.refresh();changed();};
}
if(typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(root.hidden){pointLens.hide();brushLens.hide();}}).observe(root,{attributes:true,attributeFilter:['hidden']});
function cleanupKey(){return [$('candidate').value,$('threshold').value,$('invert').checked,$('smooth').checked].join('|');}
function resetCleanup(message='尚未执行区域清理'){
    areaCleanup=null;$('areaInfo').textContent=message;refresh();
}
function refresh(){
    if(blocked()){pointLens.hide();brushLens.hide();}
    for(const id of ['choose','chooseEmpty','file','mode','undo','clear','clearPrompt','overlay','tight'])$(id).disabled=blocked();
    $('segment').disabled=blocked()||brush.isDrawing()||!bitmap;
    $('engine').disabled=blocked()||brush.isDrawing();
    const portrait=$('engine').value==='modnet',alphaResult=segmentation?.valueType==='alpha';
    root.dataset.resultType=segmentation?.valueType||'logits';
    const running=busy||batchBusy;
    if(root.dataset.running!==String(running)){root.dataset.running=String(running);root.dispatchEvent(new CustomEvent('studio:taskchange'));}
    $('engineHelp').textContent=portrait?'人物模式约 26 MB，按需加载。仅白框限定输入；蓝框与提示点不参与推理，可能保留多个人物。切换模式后须点击生成，已有结果保留。':'通用模式支持蓝框、保留点和排除点。批量生成使用当前模式，跳过已有结果。';
    for(const option of $('mode').options)option.disabled=portrait&&option.value!=='box';
    if(portrait)$('mode').value='box';
    for(const id of ['candidate','threshold','invert','smooth','download','maskDownload','diagnostic','brushTool','brushMode','brushRadius'])$(id).disabled=blocked()||brush.isDrawing()||!segmentation;
    if(alphaResult)for(const id of ['candidate','threshold','smooth'])$(id).disabled=true;
    for(const id of ['curveUndo','curveClear'])$(id).disabled=blocked()||brush.isDrawing()||!brush.getShapes().length;
    $('curveInfo').textContent=brush.getShapes().length+' 个图形 · 最多 30 个 · 互不重叠';
    $('circleTools').hidden=$('brushTool').value==='curve';$('curveTools').hidden=$('brushTool').value!=='curve';
    for(const id of ['brushUndo','brushClear'])$(id).disabled=blocked()||brush.isDrawing()||!brush.getStrokes().length;
    for(const id of ['minArea','cleanAreas'])$(id).disabled=blocked()||brush.isDrawing()||!segmentation;
    $('undoAreas').disabled=blocked()||brush.isDrawing()||!areaCleanup;
    $('undo').disabled=blocked()||!points.length;
    if(portrait){$('undo').disabled=true;$('clearPrompt').disabled=true;}
    for(const id of ['batchGenerate','batchZip','batchApply','removeImage','clearBatch','batchFormat'])$(id).disabled=blocked()||brush.isDrawing()||!records.length;
    $('batchApply').disabled=blocked()||brush.isDrawing()||!segmentation;
    $('batchZip').disabled=blocked()||brush.isDrawing()||!records.some(record=>record.hasResult);
    $('batchStop').disabled=!batchBusy||!['generate','export'].includes(batchOperation)||cancelBatch;
    for(const id of ['sourceView','maskView']){const view=root.querySelector('#sam-'+id);if(view)view.disabled=blocked()||brush.isDrawing();}
    const lock=busy||batchBusy;
    if(lock!==publishedBusy){publishedBusy=lock;actions.onBusy?.(lock);}
    refreshList();refreshNavigation();
    root.dispatchEvent(new CustomEvent('sam:ui-update'));
    changed();
}
function refreshList(){
    setBatchSize($('imageList'),records.length);
    $('batchInfo').textContent=records.length+' 张图片';$('batchInfo').title=records.filter(r=>r.hasResult).length+' 张已生成 · 蒙版缓存 '+(cache.getBytes()/1024/1024).toFixed(1)+' MiB';
    for(const [index,record] of records.entries())if(record.button){
        record.button.disabled=blocked()||brush.isDrawing();record.button.setAttribute('aria-current',index===activeIndex?'true':'false');
        const processing=index===activeIndex&&(busy||(batchBusy&&batchOperation==='switch'));
        updateThumbnailItem(record.thumbnail,record,index,index===activeIndex,{text:record.error?'失败':processing?'处理中':record.hasResult?'已生成':'待生成',state:record.error?'error':processing?'processing':record.hasResult?'complete':'pending'},'sam-image-item');
    }
}
function refreshNavigation(){
    $('quickNav').hidden=false;
    const total=records.length,hasCurrent=activeIndex>=0&&activeIndex<total,locked=blocked()||brush.isDrawing();
    const position=(hasCurrent?activeIndex+1:0)+' / '+total;
    if($('imagePosition').textContent!==position)$('imagePosition').textContent=position;
    $('prevImage').disabled=locked||!hasCurrent||activeIndex<=0;
    $('nextImage').disabled=locked||!hasCurrent||activeIndex>=total-1;
}
function readSettings(){return Object.fromEntries(settingIds.map(id=>[id,{value:$(id).value,checked:$(id).checked}]));}
function writeSettings(settings){for(const id of settingIds)if(settings?.[id]){$(id).value=settings[id].value;$(id).checked=settings[id].checked;}$('brushRadiusValue').textContent=$('brushRadius').value;}
function fillCandidates(){
    $('candidate').replaceChildren();
    if(segmentation)for(const candidate of segmentation.order){
        const option=document.createElement('option');option.value=String(candidate.index);
        option.textContent=segmentation.valueType==='alpha'?'人物连续透明度 · MODNet FP32':'候选 '+(candidate.index+1)+' · 预测 IoU '+(candidate.score===null?'未知':candidate.score.toFixed(3));
        $('candidate').append(option);
    }
}
function captureActive(){
    const record=records[activeIndex];if(!record)return;
    if(!bitmap){record.hasResult=false;return;}
    flushingState=true;try{brush.flush();}finally{flushingState=false;}
    record.hasResult=Boolean(segmentation);record.state={crop:crop?[...crop]:null,promptBox:promptBox?[...promptBox]:null,points:structuredClone(points),brush:brush.snapshot(),settings:readSettings(),areaCleanup:structuredClone(areaCleanup),lastDiagnostic:structuredClone(lastDiagnostic),
        areaText:$('areaInfo').textContent,encodeText:$('encodeState').textContent,decodeText:$('decodeState').textContent,status:$('status').textContent};
    return {record,result:segmentation};
}
async function saveActive(){
    const active=captureActive();if(!active)return;
    if(active.result)await cache.put(active.record.id,active.result);else cache.remove(active.record.id);
}
async function selectRecord(index,internal=false){
    if(!internal&&(blocked()||brush.isDrawing()))return false;
    if(!records[index])return false;
    if(index===activeIndex&&bitmap)return true;
    const outer=!internal;if(outer){batchBusy=true;batchOperation='switch';refresh();}
    try{
        await saveActive();const record=records[index];activeIndex=index;
        if(!await openFile(record.file,true)){record.error=$('status').textContent;record.hasResult=false;bitmap?.close();bitmap=null;segmentation=null;crop=promptBox=null;points=[];canvas.hidden=true;resultCanvas.hidden=true;return false;}
        const state=record.state;
        if(state){crop=state.crop;promptBox=state.promptBox;points=state.points;areaCleanup=state.areaCleanup;lastDiagnostic=state.lastDiagnostic;writeSettings(state.settings);
            segmentation=record.hasResult?await cache.get(record.id):null;
            fillCandidates();
            if(segmentation)$('modelState').textContent=segmentation.valueType==='alpha'?'MODNet FP32 · 已保存结果':'SlimSAM-77 q8 · 已保存结果';
            writeSettings(state.settings);brush.restore(state.brush);$('areaInfo').textContent=state.areaText;$('encodeState').textContent=state.lastDiagnostic?'上次 '+state.lastDiagnostic.encodeMs+' ms · 切图后待重新编码':'切图后待重新编码';$('decodeState').textContent=state.decodeText;draw();if(segmentation)render();tell(state.status);
        }
        record.error=null;return true;
    }catch(error){tell('切换图片失败：'+error.message);return false;}finally{if(outer){batchBusy=false;batchOperation='';}refresh();if(outer&&!segmentation&&typeof CustomEvent!=='undefined')root.dispatchEvent(new CustomEvent('sam:source-ready'));}
}
async function addFiles(files){
    if(blocked()||brush.isDrawing())return;
    const accepted=Array.from(files||[]).filter(f=>['image/jpeg','image/png','image/webp'].includes(f.type)&&f.size<=20*1024*1024);
    if(!accepted.length){tell('请选择不超过 20 MiB 的 JPEG、PNG 或 WebP 图片。');return;}
    if(records.length+accepted.length>20){tell('单批最多 20 张，请先导出并移除部分图片。');return;}
    const start=records.length;
    for(const file of accepted){const record={id:++sequence,file,state:null,hasResult:false,error:null};record.thumbnail=createThumbnailItem(()=>selectRecord(records.indexOf(record)));record.button=record.thumbnail.button;records.push(record);$('imageList').append(record.button);prepareThumbnail(record,refreshList);}
    if(!await selectRecord(start))return;
    tell('已添加 '+accepted.length+' 张图片，可批量生成或逐张设置范围。'+(accepted.length!==Array.from(files).length?'部分不支持或超过大小限制的文件已跳过。':''));refresh();
    return true;
}
async function generateBatch(){
    if(blocked()||brush.isDrawing()||!records.length)return;
    batchBusy=true;batchOperation='generate';cancelBatch=false;refresh();const original=activeIndex;let completed=0,failed=0,skipped=0;
    try{
        await saveActive();
        for(let index=0;index<records.length;index++){
            if(cancelBatch)break;const record=records[index];if(record.hasResult){skipped++;continue;}
            $('batchProgress').textContent='生成 '+(index+1)+' / '+records.length+' · '+record.file.name;
            if(!await selectRecord(index,true)){failed++;continue;}
            if(await run(true)){try{await saveActive();record.error=null;completed++;}catch(error){record.error=error.message;failed++;cancelBatch=true;}}else{record.error=$('status').textContent;failed++;}
            refresh();await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(records[original])await selectRecord(original,true);
        tell((cancelBatch?'批量任务已停止。':'批量生成完成。')+'新增 '+completed+' 张，已有结果跳过 '+skipped+' 张，失败 '+failed+' 张。');
    }catch(error){tell('批量生成失败：'+error.message);}finally{batchBusy=false;batchOperation='';$('batchProgress').textContent=cancelBatch?'已停止，可继续生成':'等待批量任务';refresh();}
}
function invalidate(){
    if(!busy&&!batchBusy&&records[activeIndex])records[activeIndex].hasResult=false;
    areaCleanup=null;$('areaInfo').textContent='尚未执行区域清理';
    brush.reset();alphaCache=null;previewPixels=null;editCache.clear();
    segmentation=null;currentMask=null;lastDiagnostic=null;$('invert').checked=false;$('maskInfo').textContent='等待蒙版';
    resultCanvas.hidden=true;$('resultEmpty').hidden=false;$('resultEmpty').textContent='范围或提示已更新，请重新生成蒙版';$('candidate').replaceChildren();refresh();
}
function discardEncoding(){releaseEncoding(encoded);encoded=null;$('encodeState').textContent='裁剪图已更新，等待编码';}
function activeRect(){return $('mode').value==='box'?crop:promptBox;}
function activeCrop(){return crop||[0,0,bitmap.width,bitmap.height];}
function insideCrop(p){const c=activeCrop();return p.x>=c[0]&&p.x<c[2]&&p.y>=c[1]&&p.y<c[3];}
function drawFrame(b,color,active,label){
    if(!b)return;const sx=canvas.width/bitmap.width,sy=canvas.height/bitmap.height,rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return; // The source editor can be hidden while refining its mask.
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
    if($('engine').value!=='modnet')drawFrame(drag?.kind==='prompt'?shown:promptBox,'#365ee8',$('mode').value==='prompt','目标提示');
    ctx.font='bold 14px system-ui';
    for(const p of ($('engine').value==='modnet'?[]:points)){const x=p.x*sx,y=p.y*sy;ctx.fillStyle=p.label===1?'#15a568':'#e05245';ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='white';ctx.fillText(p.label===1?'+':'−',x-4,y+5);}
    pointLens.refresh();
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
    const deletePrompt=$('engine').value!=='modnet'&&contains(promptBox),deleteCrop=!deletePrompt&&contains(crop);
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
$('mode').onchange=()=>{drag=null;canvas.style.cursor='crosshair';draw();changed();};
async function openFile(file,internal=false){
    if(internal!==true&&blocked()||!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024){tell('请选择不超过 20 MiB 的 JPEG、PNG 或 WebP。');return;}
    busy=true;refresh();let next;
    try{
        next=await createImageBitmap(file);if(next.width*next.height>16_000_000)throw new Error('原图最多 1600 万像素，请先缩小图片');
        bitmap?.close();bitmap=next;next=null;discardEncoding();filename=file.name;crop=null;promptBox=null;points=[];drag=null;invalidate();
        const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        canvas.hidden=false;$('empty').hidden=true;$('filename').textContent=filename+' · '+bitmap.width+' × '+bitmap.height;
        $('encodeState').textContent='等待任务';$('decodeState').textContent='等待任务';draw();tell($('engine').value==='modnet'?'可直接生成人物蒙版；白框限定处理范围，蓝框和提示点不参与推理。':'可直接生成蒙版。白框裁剪处理范围；未画蓝框时默认提示为当前输入图的完整范围，不显示提示框。');return true;
    }catch(error){tell('读取失败：'+error.message);return false;}finally{next?.close();busy=false;refresh();}
}
async function run(internal=false){
    if(internal!==true&&blocked()||brush.isDrawing()||!bitmap)return;
    const previous=segmentation,previousDiagnostic=lastDiagnostic,previousCandidate=$('candidate').value;
    alphaCache=null;previewPixels=null;editCache.clear();busy=true;refresh();tell('正在分割裁剪范围内的图片…');
    const region=[...activeCrop()],cw=region[2]-region[0],ch=region[3]-region[1];
    try{
        const portrait=$('engine').value==='modnet';
        let next;
        if(portrait||!encoded){
            const scale=Math.min(1,1024/Math.max(cw,ch)),clean=document.createElement('canvas');clean.width=Math.max(1,Math.round(cw*scale));clean.height=Math.max(1,Math.round(ch*scale));
            const c=clean.getContext('2d');c.fillStyle='white';c.fillRect(0,0,clean.width,clean.height);
            // Only cropped pixels enter the encoder; no rectangles or annotations are painted here.
            c.drawImage(bitmap,region[0],region[1],cw,ch,0,0,clean.width,clean.height);
            try{
                if(portrait){discardEncoding();next=await mattePortrait(clean,text=>{$('modelState').textContent=text;});$('encodeState').textContent='人物图直接推理 · 仅裁剪图';}
                else{encoded=await encodeImage(clean,text=>{$('modelState').textContent=text;});$('encodeState').textContent=encoded.elapsedMs+' ms · 仅裁剪图';}
            }finally{clean.width=clean.height=1;}
        }else $('encodeState').textContent=encoded.elapsedMs+' ms · 本次复用裁剪图';
        const effectivePrompt=promptBox||region;
        const prompts=cropRelativePrompts(region,effectivePrompt,points);
        if(!portrait)next=await segmentBox(encoded,prompts.box,prompts.points,cw,ch);
        segmentation=next;segmentation.region=region;segmentation.cacheRevision=++cacheRevision;
        if(!previous||previous.region.some((v,i)=>v!==region[i])){areaCleanup=null;brush.reset();$('areaInfo').textContent='尚未执行区域清理';}
        $('decodeState').textContent=segmentation.elapsedMs+' ms · 工作图 '+segmentation.width+' × '+segmentation.height;$('modelState').textContent=portrait?'MODNet FP32 · 连续透明度 · WASM':'SlimSAM-77 q8 · WASM';
        fillCandidates();const select=$('candidate');
        select.value=String(segmentation.order[0].index);$('threshold').value='0';$('invert').checked=false;
        if(areaCleanup)areaCleanup.key=cleanupKey();
        lastDiagnostic={revision:'xincai-segmentation-v2.8',filename,model:portrait?'Xenova/modnet':'Xenova/slimsam-77-uniform',dtype:portrait?'fp32':'q8',valueType:segmentation.valueType||'logits',backend:'wasm',threads:1,
            originalSize:[bitmap.width,bitmap.height],crop:[...region],cropSize:[cw,ch],workingSize:[segmentation.width,segmentation.height],promptBox:portrait?null:promptBox?[...promptBox]:null,
            promptMode:portrait?'not-used':promptBox?'manual':'default',effectivePromptBox:portrait?null:[...effectivePrompt],localPrompts:portrait?null:prompts,points:portrait?[]:points.map(p=>({...p})),encodeMs:portrait?0:encoded.elapsedMs,decodeMs:segmentation.elapsedMs,candidates:segmentation.order,inputShape:segmentation.inputShape,outputRange:segmentation.outputRange};
        render();tell((portrait?'人物连续蒙版已生成；蓝框和提示点未参与推理。':promptBox?'蒙版已生成，使用手动蓝框作为目标提示。':'蒙版已生成，使用当前输入图的完整范围作为默认目标提示（不显示蓝框）。')+(previous?' 已保留当前裁剪范围内的画笔修整和区域清理。':''));return true;
    }catch(error){segmentation=previous;lastDiagnostic=previousDiagnostic;fillCandidates();$('candidate').value=previousCandidate;if(segmentation)render();else{currentMask=null;resultCanvas.hidden=true;$('resultEmpty').hidden=false;$('resultEmpty').textContent='分割失败';}$('modelState').textContent='任务失败';tell('分割失败：'+error.message+(previous?'；原有结果与修整已保留。':''));console.error('[本地分割]',error);return false;}
    finally{if(records[activeIndex]){records[activeIndex].hasResult=Boolean(segmentation);records[activeIndex].error=segmentation?null:$('status').textContent;}busy=false;refresh();if(segmentation&&internal!==true&&typeof CustomEvent!=='undefined')root.dispatchEvent(new CustomEvent('sam:generated'));}
}
function editedAlpha(width,height,includeCleanup=true){
    const candidate=segmentation.candidates[Number($('candidate').value)],threshold=Number($('threshold').value),invert=$('invert').checked,smooth=$('smooth').checked;
    // Cache only the preview base, not full-resolution export data.
    let alpha;
    if(width===segmentation.width&&height===segmentation.height){
        if(!alphaCache||alphaCache.candidate!==candidate||alphaCache.threshold!==threshold||alphaCache.invert!==invert||alphaCache.smooth!==smooth)
            alphaCache={candidate,threshold,invert,smooth,alpha:maskAlpha(segmentation,candidate,width,height,{threshold,invert,smooth})};
        const [l,t,r,b]=segmentation.region;
        const update=editCache.update(alphaCache.alpha,width,height,r-l,b-t,brush.getStrokes(),includeCleanup?areaCleanup:null);
        previewDirty=update.dirty;return update.alpha;
    }else alpha=maskAlpha(segmentation,candidate,width,height,{threshold,invert,smooth});
    const [l,t,r,b]=segmentation.region;
    const strokes=brush.getStrokes();
    if(includeCleanup&&areaCleanup){
        // A cleanup is a one-shot layer. Later edits can restore pixels without undoing other deletions.
        const boundary=areaCleanup.throughEditId??Infinity;
        paintStrokes(alpha,width,height,r-l,b-t,strokes.filter(stroke=>stroke.editId<=boundary));
        applyRegionRemoval(alpha,width,height,areaCleanup.removed,segmentation.width,segmentation.height);
        paintStrokes(alpha,width,height,r-l,b-t,strokes.filter(stroke=>stroke.editId>boundary));
    }else paintStrokes(alpha,width,height,r-l,b-t,strokes);
    return alpha;
}
function render(){
    if(!bitmap||!segmentation)return;
    if(areaCleanup&&areaCleanup.key!==cleanupKey())resetCleanup('蒙版设置已更改，区域清理已撤销；确认新蒙版后可再次清理。');
    const index=Number($('candidate').value),threshold=Number($('threshold').value),candidate=segmentation.candidates[index];if(!candidate)return;
    currentMask=editedAlpha(segmentation.width,segmentation.height);$('thresholdValue').textContent=segmentation.valueType==='alpha'?'不适用':threshold.toFixed(1);
    const [l,t,r,b]=segmentation.region;if(!previewPixels||previewPixels.bitmap!==bitmap||previewPixels.segmentation!==segmentation){
        resultCanvas.width=segmentation.width;resultCanvas.height=segmentation.height;
        resultCtx.drawImage(bitmap,l,t,r-l,b-t,0,0,resultCanvas.width,resultCanvas.height);
        const source=resultCtx.getImageData(0,0,resultCanvas.width,resultCanvas.height);
        previewPixels={bitmap,segmentation,source:source.data.slice(),pixels:source};previewDirty=[0,0,resultCanvas.width,resultCanvas.height];
    }
    const overlay=$('overlay').checked;
    if(previewOverlay!==overlay){previewDirty=[0,0,resultCanvas.width,resultCanvas.height];previewOverlay=overlay;}
    const pixels=previewPixels.pixels,original=previewPixels.source;
    if(previewDirty){const [x0,y0,x1,y1]=previewDirty;
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*resultCanvas.width+x,p=i*4,a=currentMask[i];
            pixels.data[p]=original[p];pixels.data[p+1]=original[p+1];pixels.data[p+2]=original[p+2];pixels.data[p+3]=original[p+3];
            if(overlay){const tint=.4*a;pixels.data[p]*=1-tint;pixels.data[p+1]=pixels.data[p+1]*(1-tint)+250*tint;pixels.data[p+2]*=1-tint;}
            else{pixels.data[p+3]=Math.round(original[p+3]*a);if(!pixels.data[p+3])pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=0;}
        }
        resultCtx.putImageData(pixels,0,0,x0,y0,x1-x0,y1-y0);
    }
    resultCanvas.hidden=false;$('resultEmpty').hidden=true;
    brush.drawOverlay();brushLens.refresh();
    if(brush.isDrawing())return;
    const bounds=maskBounds(currentMask.map(a=>a>=1/255?1:0),segmentation.width,segmentation.height),retained=currentMask.reduce((sum,a)=>sum+a,0)/currentMask.length;
    $('maskInfo').textContent=(segmentation.valueType==='alpha'?'人物连续透明度 · ':'')+'裁剪图内保留 '+(retained*100).toFixed(1)+'%'+(retained>.98?(segmentation.valueType==='alpha'?' · 几乎保留整图，可调整白框或用画笔删除背景。':' · 当前候选几乎保留整个裁剪图，若包含背景，请更换候选或补充提示点。'):'');
    if(lastDiagnostic){lastDiagnostic.selectedCandidate=index+1;lastDiagnostic.threshold=segmentation.valueType==='alpha'?null:threshold;lastDiagnostic.inverted=$('invert').checked;lastDiagnostic.foregroundPixels=bounds?.count||0;lastDiagnostic.retainedFraction=retained;lastDiagnostic.postprocess={continuousInterpolation:true,narrowAntialias:segmentation.valueType==='alpha'?false:$('smooth').checked,brushStrokeCount:brush.getStrokes().length};}
    if(!bounds)tell(segmentation.valueType==='alpha'?'人物蒙版为空，可扩大白框、使用画笔补画，或改用通用对象模式。':'当前候选在此阈值下为空，可更换候选或降低阈值。');
    if(lastDiagnostic)lastDiagnostic.regionCleanup=areaCleanup?{minPercent:areaCleanup.minPercent,connectivity:8,throughEditId:areaCleanup.throughEditId,alphaCutoff:1/255,regions:areaCleanup.regions,removedRegions:areaCleanup.removedRegions,removedWorkingPixels:areaCleanup.removedPixels,workingSize:[segmentation.width,segmentation.height]}:null;
}
async function cleanAreas(){
    if(blocked()||brush.isDrawing()||!segmentation)return;
    const input=$('minArea').value.trim(),minPercent=Number(input);
    if(!input||!Number.isFinite(minPercent)||minPercent<0||minPercent>100){tell('请输入 0～100 的区域面积百分比。');return;}
    busy=true;refresh();tell('正在计算连通区域面积…');await new Promise(resolve=>setTimeout(resolve,0));
    try{
        const alpha=editedAlpha(segmentation.width,segmentation.height,false);
        areaCleanup={...findSmallRegions(alpha,segmentation.width,segmentation.height,minPercent),key:cleanupKey(),throughEditId:brush.getLastEditId()};
        render();
        const [l,t,r,b]=segmentation.region,sourceArea=(r-l)*(b-t),minimum=sourceArea*minPercent/100;
        $('areaInfo').textContent='共 '+areaCleanup.regions+' 个连通区域，删除 '+areaCleanup.removedRegions+' 个；阈值 '+minPercent+'% ≈ '+Math.round(minimum)+' 原图像素²（工作图估算）。';
        tell(areaCleanup.removedRegions?'小区域清理完成，预览与导出已同步；可撤销。':'没有面积小于阈值的区域，图片未改变。');
    }catch(error){tell('区域清理失败：'+error.message);}finally{busy=false;refresh();}
}
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const toBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG 编码失败')),'image/png'));
async function createPNG(isMask=false){
    const output=document.createElement('canvas');let full;
    try{
        if(isMask){output.width=segmentation.width;output.height=segmentation.height;const alpha=editedAlpha(output.width,output.height),c=output.getContext('2d'),pixels=c.createImageData(output.width,output.height);
            if(!alpha.some(a=>a>=1/255))throw new Error('当前蒙版为空，未导出');
            for(let i=0;i<alpha.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=Math.round(alpha[i]*255);pixels.data[i*4+3]=255;}c.putImageData(pixels,0,0);
        }else{
            const [l,t,r,b]=segmentation.region;full=document.createElement('canvas');full.width=r-l;full.height=b-t;const c=full.getContext('2d',{willReadFrequently:true});c.drawImage(bitmap,l,t,r-l,b-t,0,0,full.width,full.height);
            const alpha=editedAlpha(full.width,full.height),pixels=c.getImageData(0,0,full.width,full.height);applyAlphaRGBA(pixels.data,alpha);c.putImageData(pixels,0,0);
            // Use the actual exported alpha (including original transparency and brush edits) for tight cropping.
            const visible=new Uint8Array(alpha.length);for(let i=0;i<visible.length;i++)visible[i]=pixels.data[i*4+3]>0?1:0;
            const bounds=maskBounds(visible,full.width,full.height);if(!bounds)throw new Error('当前蒙版为空，未导出');
            const left=$('tight').checked?bounds.left:0,top=$('tight').checked?bounds.top:0;
            const right=$('tight').checked?bounds.right:full.width,bottom=$('tight').checked?bounds.bottom:full.height;
            output.width=right-left;output.height=bottom-top;output.getContext('2d').drawImage(full,left,top,output.width,output.height,0,0,output.width,output.height);
        }
        return {blob:await toBlob(output),width:output.width,height:output.height};
    }finally{output.width=output.height=1;if(full)full.width=full.height=1;}
}
async function exportPNG(isMask=false){
    if(blocked()||brush.isDrawing()||!currentMask||!bitmap)return;
    brush.flush();
    busy=true;refresh();tell('正在按导出尺寸处理蒙版与修整…');await new Promise(resolve=>setTimeout(resolve,0));
    try{const result=await createPNG(isMask);save(result.blob,filename.replace(/\.[^.]+$/,'')+(isMask?'-mask':'-transparent')+'.png');tell(isMask?'已导出含修整的灰度蒙版。':'已导出含修整与边缘处理的原始分辨率透明 PNG。');}
    catch(error){tell('导出失败：'+error.message);}finally{busy=false;refresh();}
}
async function exportBatch(){
    if(blocked()||brush.isDrawing()||!records.length)return;
    if(!window.JSZip){tell('ZIP 库未加载，请检查主站 jszip.min.js。');return;}
    batchBusy=true;batchOperation='export';cancelBatch=false;refresh();const original=activeIndex,zip=new window.JSZip(),format=$('batchFormat').value,rows=[];let exported=0,bytes=0,summary='';
    try{
        await saveActive();
        for(let index=0;index<records.length;index++){
            const record=records[index];let status='未生成',error=record.error||'',sizes=[];
            if(cancelBatch){status='已停止，未导出';}
            else if(record.hasResult){
                try{
                    $('batchProgress').textContent='导出 '+(index+1)+' / '+records.length+' · '+record.file.name;
                    if(!await selectRecord(index,true))throw new Error($('status').textContent);
                    const outputs=[];for(const mask of (format==='both'?[false,true]:[format==='mask'])){const result=await createPNG(mask);outputs.push({mask,...result});}
                    const added=outputs.reduce((sum,o)=>sum+o.blob.size,0);if(bytes+added>256*1024*1024){cancelBatch=true;throw new Error('导出图片累计超过 256 MiB，已停止；请拆分批次');}
                    const safe=record.file.name.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)||'image',folder=String(index+1).padStart(3,'0')+'-'+safe;
                    for(const output of outputs){zip.file(folder+'/'+(output.mask?'mask':'transparent')+'.png',output.blob);sizes.push((output.mask?'蒙版':'透明图')+':'+output.width+'x'+output.height);}
                    bytes+=added;exported++;status='已导出';error='';
                }catch(e){status='导出失败';error=e.message;}
            }
            const info=record.state?.lastDiagnostic;
            rows.push([index+1,record.file.name,status,error,info?.originalSize?.join('x'),info?.workingSize?.join('x'),sizes.join(';'),info?.valueType==='alpha'?'':record.state?.settings?.threshold?.value,record.state?.settings?.invert?.checked,info?.model,info?.dtype]);
            refresh();await new Promise(resolve=>setTimeout(resolve,0));
        }
        const header=['序号','文件名','导出状态','错误','原图尺寸','工作图尺寸','输出尺寸','蒙版阈值','反转','模型','模型精度'];zip.file('manifest.csv','\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'));
        if(!exported){summary='没有可导出的非空蒙版；未生成 ZIP，请逐图检查。';return;}
        $('batchProgress').textContent='正在打包 '+exported+' 张图片…';const blob=await zip.generateAsync({type:'blob',compression:'STORE'});save(blob,'xincai-segmentation-results.zip');
        summary='已导出 '+exported+' 张图片及 CSV 清单。'+(cancelBatch?'本次为停止后的部分结果。':'');
    }catch(error){summary='批量导出失败：'+error.message;}finally{if(records[original])await selectRecord(original,true);batchBusy=false;batchOperation='';$('batchProgress').textContent='等待批量任务';refresh();if(summary)tell(summary);}
}
async function applyBatchSettings(){
    if(blocked()||brush.isDrawing()||!segmentation)return;batchBusy=true;batchOperation='settings';refresh();
    try{await saveActive();const current=readSettings();let count=0;
        for(const record of records)if(record.hasResult&&record.state){
            const sameType=(record.state.lastDiagnostic?.valueType==='alpha')===(segmentation.valueType==='alpha');
            for(const id of (sameType?['threshold','invert','smooth','tight']:['invert','tight']))record.state.settings[id]={...current[id]};
            record.state.areaCleanup=null;record.state.areaText='批量参数已修改，请按需重新清理区域。';count++;
        }
        areaCleanup=null;$('areaInfo').textContent='批量参数已修改，请按需重新清理区域。';render();tell('已调整 '+count+' 张图片；反转和透明裁切对两种模型生效，阈值与抗锯齿仅在相同结果类型间应用。候选和修整各自保留。');
    }catch(error){tell('批量调整失败：'+error.message);}finally{batchBusy=false;batchOperation='';refresh();}
}
function emptyView(){discardEncoding();bitmap?.close();bitmap=null;crop=promptBox=null;points=[];drag=null;invalidate();canvas.hidden=true;$('empty').hidden=false;$('filename').textContent='未选择图片';}
async function removeImage(){
    if(blocked()||brush.isDrawing()||activeIndex<0)return;batchBusy=true;batchOperation='remove';refresh();
    try{const index=activeIndex,record=records[index];disposeThumbnail(record);cache.remove(record.id);record.button.remove();records.splice(index,1);activeIndex=-1;emptyView();if(records.length)await selectRecord(Math.min(index,records.length-1),true);}
    finally{batchBusy=false;batchOperation='';refresh();if(!records.length&&typeof CustomEvent!=='undefined')root.dispatchEvent(new CustomEvent('sam:source-ready'));}
}
$('prevImage').onclick=()=>selectRecord(activeIndex-1);$('nextImage').onclick=()=>selectRecord(activeIndex+1);
$('choose').onclick=$('chooseEmpty').onclick=()=>{if(!blocked())$('file').click();};$('file').onchange=()=>{addFiles($('file').files);$('file').value='';};
$('stage').ondragover=event=>{event.preventDefault();if(!blocked())$('empty').classList.add('drag');};
$('stage').ondragleave=()=>$('empty').classList.remove('drag');
$('stage').ondrop=event=>{event.preventDefault();$('empty').classList.remove('drag');addFiles(event.dataTransfer.files);};
$('batchGenerate').onclick=generateBatch;$('batchZip').onclick=exportBatch;$('batchApply').onclick=applyBatchSettings;
$('batchStop').onclick=()=>{if(!batchBusy||!['generate','export'].includes(batchOperation))return;cancelBatch=true;$('batchProgress').textContent='将在当前图片处理结束后停止…';refresh();};
$('removeImage').onclick=removeImage;$('clearBatch').onclick=()=>{if(blocked()||brush.isDrawing())return;records.forEach(disposeThumbnail);records=[];activeIndex=-1;cache.clear();$('imageList').replaceChildren();emptyView();tell('已清空。');refresh();if(typeof CustomEvent!=='undefined')root.dispatchEvent(new CustomEvent('sam:source-ready'));};
$('undo').onclick=()=>{if(blocked()||!points.length)return;const removed=points.pop();invalidate();draw();tell('已撤销最近添加的'+(removed.label===1?'保留点':'排除点')+'，剩余 '+points.length+' 个提示点。请重新生成蒙版。');};
$('clearPrompt').onclick=()=>{if(blocked())return;promptBox=null;points=[];invalidate();draw();tell('手动蓝框和提示点已清除，恢复当前输入图完整范围的默认目标提示。白色裁剪范围不变。');};
$('clear').onclick=()=>{if(blocked())return;crop=null;promptBox=null;points=[];discardEncoding();invalidate();draw();tell('两个框和提示点已清除，模型输入恢复整图。');};
$('segment').onclick=run;$('candidate').onchange=$('threshold').oninput=$('overlay').onchange=()=>{render();changed();};
$('engine').onchange=()=>{drag=null;refresh();draw();tell('接下来的生成将使用'+($('engine').value==='modnet'?'人物精细抠图。仅白色裁剪范围作为输入，蓝框和提示点不参与推理。':'通用对象分割。')+' 当前已生成的结果与修整保留。');};
$('smooth').onchange=()=>{render();changed();};
$('cleanAreas').onclick=cleanAreas;
$('undoAreas').onclick=()=>{if(blocked()||brush.isDrawing()||!areaCleanup)return;resetCleanup('已撤销区域清理，模型蒙版与画笔修改保留。');render();tell('已撤销区域清理。');};
$('brushRadius').oninput=()=>{$('brushRadiusValue').textContent=$('brushRadius').value;brushLens.refresh();changed();};
$('brushMode').onchange=()=>{brushLens.refresh();changed();};
$('tight').onchange=$('minArea').oninput=$('batchFormat').onchange=changed;
$('brushTool').onchange=()=>{brush.refreshTool();brushLens.refresh();refresh();};
$('curveUndo').onclick=()=>brush.removeLastShape();$('curveClear').onclick=()=>brush.clearShapes();
$('brushUndo').onclick=()=>brush.undo();$('brushClear').onclick=()=>brush.clear();
$('invert').onchange=()=>{render();tell($('invert').checked?'已反转裁剪图内的保留区域。':'已恢复模型原始保留区域。');changed();};
$('download').onclick=()=>exportPNG();$('maskDownload').onclick=()=>exportPNG(true);
$('diagnostic').onclick=()=>{if(!blocked()&&lastDiagnostic)save(new Blob([JSON.stringify(lastDiagnostic,null,2)],{type:'application/json'}),'segmentation-diagnostics.json');};

 root.addEventListener('sam:beforeviewchange',event=>{if(blocked()||brush.isDrawing())event.preventDefault();});
 root.addEventListener('studio:zoomchange',()=>{if(bitmap){draw();brush.drawOverlay();pointLens.hide();brushLens.hide();}});
 root.addEventListener('sam:viewchange',()=>{pointLens.hide();brushLens.hide();draw();brush.refreshTool();});
 refresh();
 async function openCrop(blob,name) {
  if(blocked())throw new Error('其他任务正在处理，请稍后转入本地分割');
  if(!(blob instanceof Blob)||!blob.size)throw new Error('目标裁图不可用');
  tab.click();
  if(!await addFiles([new File([blob],name||'semantic-first.png',{type:blob.type||'image/png'})]))throw new Error($('status').textContent);
  if(!await run())throw new Error($('status').textContent);
 }
 function canSnapshot(){return !busy&&!batchBusy&&!drag&&!brush.isDrawing();}
 async function snapshot(){
  const active=captureActive();
  const saved={version:1,records:records.map(record=>({id:record.id,file:record.file,state:structuredClone(record.state),hasResult:record.hasResult,error:record.error})),activeIndex,sequence,cacheRevision,
   settings:readSettings(),engine:$('engine').value,magnify:$('magnify').checked,magnifyZoom:$('magnifyZoom').value,batchFormat:$('batchFormat').value};
  // Capture the queue before compression yields. Later user edits get a separate save.
  const entries=new Map(cache.exportEntries().map(entry=>[entry.id,entry]));
  if(active){if(active.result)entries.set(active.record.id,{id:active.record.id,...await cache.put(active.record.id,active.result)});else{cache.remove(active.record.id);entries.delete(active.record.id);}}
  saved.masks=saved.records.filter(record=>record.hasResult).map(record=>{const entry=entries.get(record.id);if(!entry)throw new Error('蒙版缓存尚未就绪');return entry;});
  return saved;
 }
 async function restore(saved){
  if(saved?.version!==1||!Array.isArray(saved.records)||saved.records.length>20||!Array.isArray(saved.masks))throw new Error('本地分割工作区数据格式无效');
  const ids=new Set();
  for(const record of saved.records){if(!(record.file instanceof Blob)||!Number.isSafeInteger(record.id)||record.id<1||ids.has(record.id))throw new Error('保存的分割图片无效');ids.add(record.id);}
  restoringState=true;
  try{
   records.forEach(disposeThumbnail);records=[];activeIndex=-1;cache.clear();$('imageList').replaceChildren();emptyView();
   cache.importEntries(saved.masks.filter(entry=>ids.has(entry.id)));
   const entries=new Map(cache.exportEntries().map(entry=>[entry.id,entry]));
   for(const record of saved.records){if(record.hasResult&&!entries.has(record.id))throw new Error('保存的蒙版缺失');}
   sequence=Math.max(Number(saved.sequence)||0,...saved.records.map(record=>record.id),0);
   cacheRevision=Math.max(Number(saved.cacheRevision)||0,...saved.masks.map(entry=>entry.revision),0);
   records=saved.records.map(record=>({...record,state:structuredClone(record.state),hasResult:record.hasResult===true}));
   for(const record of records){record.thumbnail=createThumbnailItem(()=>selectRecord(records.indexOf(record)));record.button=record.thumbnail.button;$('imageList').append(record.button);prepareThumbnail(record,refreshList);}
   writeSettings(saved.settings);
   $('engine').value=saved.engine==='modnet'?'modnet':'slimsam';
   $('magnify').checked=$('magnifyPreview').checked=saved.magnify!==false;
   if(['2','4','6','8'].includes(saved.magnifyZoom))$('magnifyZoom').value=$('magnifyZoomPreview').value=saved.magnifyZoom;
   if(['transparent','mask','both'].includes(saved.batchFormat))$('batchFormat').value=saved.batchFormat;
   if(records.length){const index=Math.max(0,Math.min(records.length-1,Number.isInteger(saved.activeIndex)?saved.activeIndex:0));if(!await selectRecord(index,true))throw new Error($('status').textContent);}
   tell(records.length?'已恢复 '+records.length+' 张图片及已保存的蒙版修改。':'等待添加图片');refresh();
  }finally{restoringState=false;}
 }
 return {refresh,isBusy:()=>busy||batchBusy,openCrop,snapshot,restore,canSnapshot};
}
