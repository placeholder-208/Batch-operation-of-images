import { closeCurve, polygonsOverlap, pointInPolygon, classifyPolygon } from './curve-geometry.js';
export function createMaskBrush({canvas,container,getSize,isBlocked,onChange,onMode,onHistory,readRadius,readMode,readTool=()=> 'circle',getAlpha,onStatus=()=>{}}){
 const cursor=document.createElement('span');cursor.className='mask-brush-cursor';cursor.hidden=true;container.append(cursor);
 const ns='http://www.w3.org/2000/svg',overlay=document.createElementNS(ns,'svg');overlay.classList.add('mask-curve-overlay');overlay.setAttribute('aria-hidden','true');container.append(overlay);
 let strokes=[],shapes=[],active=null,frame=null,changed=false,sequence=0,editSequence=0;
 const available=()=>Boolean(getSize())&&!isBlocked();
 function drawOverlay(){
  const size=getSize();overlay.style.display=!size||(!shapes.length&&!active?.curve)?'none':'';if(!size)return;
  const rect=canvas.getBoundingClientRect(),outer=container.getBoundingClientRect();
  overlay.style.left=rect.left-outer.left+'px';overlay.style.top=rect.top-outer.top+'px';overlay.style.width=rect.width+'px';overlay.style.height=rect.height+'px';overlay.setAttribute('viewBox',`0 0 ${size.width} ${size.height}`);overlay.replaceChildren();
  for(const shape of [...shapes,...(active?.curve?[{points:active.points,draft:true}]:[])]){
   const path=document.createElementNS(ns,'path');path.setAttribute('d',shape.points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ')+(shape.draft?'':' Z'));
   const last=strokes.findLast(s=>s.shapeId===shape.id);path.setAttribute('class',shape.draft?'curve-draft':last?.mode==='erase'?'curve-erase':last?.mode==='add'?'curve-add':'curve-pending');path.setAttribute('vector-effect','non-scaling-stroke');overlay.append(path);
  }
 }
 const notify=(modifies=true)=>{changed ||= modifies;if(frame===null)frame=requestAnimationFrame(()=>{frame=null;if(changed){changed=false;onChange();}drawOverlay();onHistory(strokes.length);});};
 function point(event){const rect=canvas.getBoundingClientRect(),size=getSize();return {x:Math.max(0,Math.min(size.width,(event.clientX-rect.left)/rect.width*size.width)),y:Math.max(0,Math.min(size.height,(event.clientY-rect.top)/rect.height*size.height))};}
 function show(event){
  canvas.style.cursor=readTool()==='curve'?'crosshair':'none';
  if(!available()||readTool()==='curve'){cursor.hidden=true;return;}
  const rect=container.getBoundingClientRect(),radius=Number(readRadius());cursor.hidden=false;
  cursor.style.width=cursor.style.height=radius*2+'px';cursor.style.left=event.clientX-rect.left+'px';cursor.style.top=event.clientY-rect.top+'px';cursor.dataset.mode=readMode();
 }
 canvas.onpointerdown=event=>{
  if(event.button!==0||!available()||active)return;event.preventDefault();
  const size=getSize(),rect=canvas.getBoundingClientRect();
  active=readTool()==='curve'?{curve:true,points:[point(event)],units:size.width/rect.width}:{mode:readMode(),radius:Number(readRadius())*size.width/rect.width,points:[point(event)]};
  if(!active.curve){active.editId=++editSequence;strokes.push(active);}canvas.setPointerCapture(event.pointerId);show(event);notify(!active.curve);
 };
 canvas.onpointermove=event=>{
  show(event);if(!active||!available())return;
  const events=event.getCoalescedEvents?.()||[event];
  for(const e of events){const next=point(e),previous=active.points.at(-1);if(Math.hypot(next.x-previous.x,next.y-previous.y)>= (active.curve?active.units*.6:Math.max(.25,active.radius/8)))active.points.push(next);}
  if(active.curve&&active.points.length>12000){active=null;onStatus('曲线过长，请分成较简洁的图形重画。');notify(false);return;}
  notify(!active.curve);
 };
 function end(event,cancel=false){
  if(!active)return;
  const job=active;active=null;if(event&&available())job.points.push(point(event));
  if(job.curve){
   if(!cancel)try{
    const points=closeCurve(job.points,job.units);
    if(shapes.length>=30)throw new Error('最多保留 30 个图形，请先移除或清除部分图形。');
    if(shapes.some(s=>polygonsOverlap(points,s.points)))throw new Error('图形与已有图形重叠、包含或接触，请留出间隔后重画。');
    shapes.push({id:++sequence,points});onStatus('封闭图形已添加，请在图形内部右击判断并切换保留状态。');
   }catch(error){onStatus(error.message);}
   notify(false);
  }else notify();
 }
 canvas.onpointerup=event=>end(event);canvas.onpointercancel=()=>end(null,true);canvas.onlostpointercapture=()=>end(null,true);
 canvas.onpointerleave=()=>{cursor.hidden=true;};
 canvas.oncontextmenu=event=>{
  if(!available())return;event.preventDefault();
  if(readTool()!=='curve'){end();onMode(readMode()==='add'?'erase':'add');show(event);return;}
  if(active){end(null,true);onStatus('绘制已取消，请先完成封闭图形，再在图形内部右击。');return;}
  const p=point(event),shape=shapes.find(s=>pointInPolygon(p,s.points));
  if(!shape){onStatus('请在已闭合的图形内部右击。');return;}
  try{
   const size=getSize(),mask=getAlpha(),stats=classifyPolygon(shape.points,mask.alpha,mask.width,mask.height,size.width,size.height);
   if(!stats.mode){
    if(!strokes.some(s=>s.shapeId===shape.id))shapes=shapes.filter(s=>s!==shape);
    onStatus('图形内少数状态占 '+(stats.minority*100).toFixed(2)+'%，超过 5%；未修改蒙版，请重新绘制图形（已处理的图形可先移除）。');notify(false);return;
   }
   strokes.push({editId:++editSequence,type:'polygon',shapeId:shape.id,points:shape.points,mode:stats.mode});
   notify();onStatus('图形内 '+(stats.mode==='erase'?'全部删除':'全部保留')+'；少数状态占 '+(stats.minority*100).toFixed(2)+'%（不超过 5%）。');
  }catch(error){onStatus(error.message);}
 };
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(drawOverlay).observe(canvas);
 return {
  flush(){if(frame!==null){cancelAnimationFrame(frame);frame=null;}if(changed){changed=false;onChange();}drawOverlay();onHistory(strokes.length);},
  snapshot(){return structuredClone({strokes,shapes,sequence,editSequence});},
  restore(state){this.reset();strokes=state?.strokes||[];shapes=state?.shapes||[];sequence=state?.sequence||0;editSequence=state?.editSequence||0;for(const stroke of strokes){if(!Number.isFinite(stroke.editId))stroke.editId=++editSequence;else editSequence=Math.max(editSequence,stroke.editId);}drawOverlay();onHistory(strokes.length);},
  getLastEditId:()=>editSequence,getStrokes:()=>strokes,getShapes:()=>shapes,isDrawing:()=>Boolean(active),drawOverlay,
  refreshTool(){cursor.hidden=true;canvas.style.cursor=readTool()==='curve'?'crosshair':'none';drawOverlay();},
  reset(){strokes=[];shapes=[];active=null;changed=false;cursor.hidden=true;overlay.style.display='none';overlay.replaceChildren();if(frame!==null){cancelAnimationFrame(frame);frame=null;}onHistory(0);},
  undo(){if(isBlocked()||active||!strokes.length)return;strokes.pop();onChange();drawOverlay();onHistory(strokes.length);},
  removeLastShape(){if(isBlocked()||active||!shapes.length)return;const shape=shapes.pop(),had=strokes.some(s=>s.shapeId===shape.id);strokes=strokes.filter(s=>s.shapeId!==shape.id);if(had)onChange();drawOverlay();onHistory(strokes.length);onStatus('已移除最近的图形及其保留／删除操作，其他修改保留。');},
  clearShapes(){if(isBlocked()||active)return;const had=strokes.some(s=>s.type==='polygon');shapes=[];strokes=strokes.filter(s=>s.type!=='polygon');if(had)onChange();drawOverlay();onHistory(strokes.length);onStatus('曲线图形已清除，圆形画笔修改保留。');},
  clear(){if(isBlocked()||active)return;this.reset();onChange();},
 };
}
