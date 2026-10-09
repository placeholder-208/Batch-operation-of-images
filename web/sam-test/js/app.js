import { encodeImage, releaseEncoding, segmentBox } from './slimsam.js?v=1.5';
import { normalizedBox, binaryMask, maskBounds, applyMaskRGBA, cropRelativePrompts, intersectBox } from './mask-utils.js?v=1.5';
import { hitBox, boxCursor, editBox } from './box-editor.js?v=1.4';
const $=id=>document.getElementById(id),canvas=$('source'),ctx=canvas.getContext('2d'),resultCanvas=$('result'),resultCtx=resultCanvas.getContext('2d',{willReadFrequently:true});
let bitmap=null,filename='',crop=null,promptBox=null,points=[],drag=null,busy=false,encoded=null,segmentation=null,currentMask=null,lastDiagnostic=null;
const tell=text=>{$('status').textContent=text;};
function refresh(){
    for(const id of ['choose','file','mode','undo','clear','clearPrompt'])$(id).disabled=busy;
    $('segment').disabled=busy||!bitmap;
    for(const id of ['candidate','threshold','invert','download','maskDownload','diagnostic'])$(id).disabled=busy||!segmentation;
    $('undo').disabled=busy||!points.length;
    if(window.parent!==window)window.parent.postMessage({type:'xincai-sam-busy',busy},location.origin);
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
function updateCursor(event){canvas.style.cursor=busy?'wait':(!bitmap?'crosshair':(['box','prompt'].includes($('mode').value)?boxCursor(drag?.action||(event.altKey?'new':actionAt(pointer(event)))):'crosshair'));}
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
    if(busy||!bitmap||event.button!==0)return;const p=pointer(event),mode=$('mode').value;
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
    event.preventDefault();if(busy)return;
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
    if(busy||!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024){tell('请选择不超过 20 MiB 的 JPEG、PNG 或 WebP。');return;}
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
    if(busy||!bitmap)return;busy=true;refresh();tell('正在分割裁剪范围内的图片…');
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
        lastDiagnostic={revision:'slimsam-local-v1.8',filename,model:'Xenova/slimsam-77-uniform',dtype:'q8',backend:'wasm',threads:1,
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
    if(busy||!currentMask||!bitmap)return;const bounds=maskBounds(currentMask,segmentation.width,segmentation.height);if(!bounds){tell('当前蒙版为空，未导出。');return;}
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
$('undo').onclick=()=>{if(busy||!points.length)return;const removed=points.pop();invalidate();draw();tell('已撤销最近添加的'+(removed.label===1?'保留点':'排除点')+'，剩余 '+points.length+' 个提示点。请重新生成蒙版。');};
$('clearPrompt').onclick=()=>{if(busy)return;promptBox=null;points=[];invalidate();draw();tell('手动蓝框和提示点已清除，恢复当前输入图完整范围的默认目标提示。白色裁剪范围不变。');};
$('clear').onclick=()=>{if(busy)return;crop=null;promptBox=null;points=[];discardEncoding();invalidate();draw();tell('两个框和提示点已清除，模型输入恢复整图。');};
$('segment').onclick=run;$('candidate').onchange=$('threshold').oninput=$('overlay').onchange=render;
$('invert').onchange=()=>{render();tell($('invert').checked?'已反转裁剪图内的保留区域。':'已恢复模型原始保留区域。');};
$('download').onclick=()=>exportPNG();$('maskDownload').onclick=()=>exportPNG(true);
$('diagnostic').onclick=()=>{if(!busy&&lastDiagnostic)save(new Blob([JSON.stringify(lastDiagnostic,null,2)],{type:'application/json'}),'slimsam-diagnostics.json');};
// Only the same-origin embedding parent may supply a crop; never accept arbitrary windows.
window.addEventListener('message',async event=>{
    if(window.parent===window||event.source!==window.parent||event.origin!==location.origin)return;
    const data=event.data;if(!data||typeof data.type!=='string')return;
    const post=value=>window.parent.postMessage(value,location.origin);
    if(data.type==='xincai-sam-ping'){post({type:'xincai-sam-ready'});return;}
    if(data.type!=='xincai-sam-input'||typeof data.id!=='string')return;
    if(busy){post({type:'xincai-sam-result',id:data.id,ok:false,error:'本地分割正在处理其他任务'});return;}
    try{
        if(!(data.blob instanceof Blob)||!data.blob.size)throw new Error('接收的裁图无效');
        const file=new File([data.blob],typeof data.filename==='string'?data.filename:'semantic-first.png',{type:'image/png'});
        if(!await openFile(file))throw new Error($('status').textContent||'读取裁图失败');
        if(!await run())throw new Error($('status').textContent||'自动生成蒙版失败');
        post({type:'xincai-sam-result',id:data.id,ok:true});
    }catch(error){post({type:'xincai-sam-result',id:data.id,ok:false,error:error.message});}
});
refresh();
if(window.parent!==window)window.parent.postMessage({type:'xincai-sam-ready'},location.origin);
