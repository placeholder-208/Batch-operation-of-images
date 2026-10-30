// UI composition only. Existing controls, canvas nodes and feature handlers stay live.
import {subscribe} from './runtime-status.js';
const $=id=>document.getElementById(id);
const make=(tag,cls='',text='')=>{const el=document.createElement(tag);el.className=cls;el.textContent=text;return el;};
const roots={qr:'normalWorkspace',barcode:'barcodeWorkspace',mask:'maskWorkspace',semantic:'semanticWorkspace',sam:'samWorkspace'};
const starts={qr:'qrStart',barcode:'barcodeStart',mask:'maskStart',semantic:'semanticStart',sam:'sam-segment'};
const stops={qr:'qrStop',barcode:'barcodeStop',mask:'maskStop',semantic:'semanticStop',sam:'sam-batchStop'};
const interactive='button,a,input,select,textarea,label,summary,details,pre';
function icon(button,name,label){
 const paths={copy:'M9 9h11v11H9z M5 15H3V3h12v2',download:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',open:'M14 3h7v7 M10 14 21 3 M21 14v7H3V3h7'};
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]);svg.append(path);
 button.replaceChildren(svg);button.title=label;button.setAttribute('aria-label',label);button.classList.add('result-icon');
}
function results(root,id){
 const list=$(id);if(!list)return;
 const summary=make('p','result-summary');summary.setAttribute('role','status');list.before(summary);
 function update(){
  const cards=[...list.querySelectorAll('.qr-card')];
  summary.textContent=cards.length?'当前图片 · '+cards.length+' 个结果':'当前图片 · 暂无结果';
  for(const card of cards){
   if(card.dataset.compact)continue;card.dataset.compact='true';
   const locate=[...card.querySelectorAll('button')].find(el=>el.textContent==='定位');
   if(locate){
    locate.hidden=true;card.tabIndex=0;card.setAttribute('aria-label',(card.querySelector('h4')?.textContent||'结果')+'，按回车定位');
    card.addEventListener('click',event=>{if(!event.target.closest(interactive))locate.click();});
    card.addEventListener('keydown',event=>{if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();locate.click();}});
   }
   for(const button of card.querySelectorAll('.actions button')){
    const label=button.textContent;if(label==='复制')icon(button,'copy','复制内容');else if(label==='下载裁图')icon(button,'download','下载裁图');
   }
   for(const link of card.querySelectorAll('.actions a'))icon(link,'open','打开链接（新窗口）');
   const pre=card.querySelector('pre');
   if(pre){
    pre.classList.add('result-content');
    const more=make('button','content-toggle','展开内容');more.type='button';more.setAttribute('aria-expanded','false');
    more.onclick=()=>{const expanded=more.getAttribute('aria-expanded')!=='true';more.setAttribute('aria-expanded',String(expanded));pre.classList.toggle('expanded',expanded);more.textContent=expanded?'收起内容':'展开内容';};
    pre.after(more);
    // Long URLs can wrap even when there is no newline.
    requestAnimationFrame(()=>{more.hidden=pre.scrollHeight<=pre.clientHeight+2;});
   }
  }
  for(const empty of list.querySelectorAll('.empty')){
   const text=empty.textContent;empty.dataset.state=/失败|异常/.test(text)?'error':/正在|处理中/.test(text)?'processing':/未识别|未找到|没有目标/.test(text)?'no-result':'empty';
  }
 }
 function refreshExpansion(){for(const pre of list.querySelectorAll('pre')){const button=pre.nextElementSibling;if(button?.classList.contains('content-toggle')&&!pre.classList.contains('expanded'))button.hidden=pre.scrollHeight<=pre.clientHeight+2;}}
 new MutationObserver(()=>{update();requestAnimationFrame(refreshExpansion);}).observe(list,{childList:true});
 document.addEventListener('workspace:change',()=>{if(!root.hidden)requestAnimationFrame(refreshExpansion);});window.addEventListener('resize',()=>requestAnimationFrame(refreshExpansion));update();
}
function confirmClear(button){
 if(!button)return;
 const original=button.onclick;let timer=null,armed=false,label=button.textContent;
 function reset(){clearTimeout(timer);armed=false;button.textContent=label;button.classList.remove('confirm-danger');button.removeAttribute('aria-live');}
 button.onclick=event=>{
  if(button.disabled)return;
  if(!armed){label=button.textContent;armed=true;button.textContent='确认'+label+'？';button.classList.add('confirm-danger');button.setAttribute('aria-live','polite');timer=setTimeout(reset,3000);return;}
  reset();original?.call(button,event);
 };
 new MutationObserver(()=>{if(button.disabled&&armed)reset();}).observe(button,{attributes:true,attributeFilter:['disabled']});
}
function zoom(root){
 const toolbar=root.querySelector('.stage-toolbar'),stages=[...root.querySelectorAll('.stage')];
 const group=make('div','viewport-controls'),label=make('label','','查看');
 const select=make('select');select.setAttribute('aria-label','图片预览缩放');
 for(const [value,text]of [['fit','适合窗口'],['100','预览 100%'],['200','预览 200%']]){const option=make('option','',text);option.value=value;select.append(option);}
 label.append(select);group.append(label);toolbar.append(group);
 function apply(){
  for(const stage of stages){
   const canvas=stage.querySelector('canvas');if(!canvas)continue;
   stage.dataset.zoom=select.value;
   if(select.value==='fit'){canvas.style.removeProperty('width');canvas.style.removeProperty('height');}
   else{const ratio=Number(select.value)/100;canvas.style.width=canvas.width*ratio+'px';canvas.style.height=canvas.height*ratio+'px';}
  }
  root.dispatchEvent(new CustomEvent('studio:zoomchange'));
 }
 select.title='100% 按预览画布像素显示；高倍放大用于核对，导出仍使用原图。';select.onchange=apply;
 for(const stage of stages){const canvas=stage.querySelector('canvas');if(canvas)new MutationObserver(apply).observe(canvas,{attributes:true,attributeFilter:['width','height']});}
 // Editing views also offer an explicit browse mode for touch scrolling / panning.
 {
  const editing=['maskWorkspace','samWorkspace'].includes(root.id);
  const browse=make('button','secondary browse-toggle',editing?'绘制':'定位');browse.type='button';browse.setAttribute('aria-pressed','false');browse.title='切为浏览后可滚动或拖动查看；切回绘制再编辑';group.append(browse);
  browse.onclick=()=>{const value=root.dataset.browse!=='true';root.dataset.browse=String(value);browse.setAttribute('aria-pressed',String(value));browse.textContent=value?'浏览':editing?'绘制':'定位';};
 }
 for(const stage of stages){
  const canvas=stage.querySelector('canvas');if(!canvas)continue;let drag=null;
  canvas.addEventListener('pointerdown',event=>{
   const browsing=root.dataset.browse==='true'||event.button===1&&stage.dataset.zoom!=='fit';
   if(!browsing)return;event.stopImmediatePropagation();
   if(event.pointerType==='touch')return;
   event.preventDefault();const scroll=stage.closest('.stage-scroll');drag={x:event.clientX,y:event.clientY,left:scroll.scrollLeft,top:scroll.scrollTop,scroll};canvas.setPointerCapture(event.pointerId);
  },true);
  canvas.addEventListener('pointermove',event=>{if(root.dataset.browse==='true')event.stopImmediatePropagation();if(!drag)return;event.stopImmediatePropagation();drag.scroll.scrollLeft=drag.left+drag.x-event.clientX;drag.scroll.scrollTop=drag.top+drag.y-event.clientY;},true);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>{if(drag||root.dataset.browse==='true'){event.stopImmediatePropagation();drag=null;}},true);
  canvas.addEventListener('click',event=>{if(root.dataset.browse==='true'||event.button===1){event.preventDefault();event.stopImmediatePropagation();}},true);
  canvas.addEventListener('contextmenu',event=>{if(root.dataset.browse==='true'){event.preventDefault();event.stopImmediatePropagation();}},true);
 }
 apply();
}
function mobileLayout(root){
 const rail=root.querySelector('.batch-rail'),main=root.querySelector('.stage-panel'),toolbar=main.querySelector('.stage-toolbar');
 const railHome=document.createComment('desktop batch rail');rail.before(railHome);
 const brush=root.querySelector('.brush-quickbar'),brushHome=document.createComment('desktop brush tools');if(brush)brush.before(brushHome);
 const media=matchMedia('(max-width:900px)');
 function place(){
  if(media.matches){toolbar.after(rail);if(brush)$('sam-previewPanel').after(brush);}
  else{railHome.after(rail);if(brush)brushHome.after(brush);}
 }
 media.addEventListener('change',place);place();
}
function actionArea(root,mode){
 const start=$(starts[mode]);if(!start)return;
 const hint=make('p','action-hint');hint.id=mode+'ActionHint';start.after(hint);start.setAttribute('aria-describedby',hint.id);
 const progress=make('span','task-live');progress.setAttribute('role','status');
 root.querySelector('.task-panel .inspector-heading')?.append(progress);
 const mobile=make('div','mobile-actionbar'),actions=make('div','mobile-actions'),mobileHint=make('p','action-hint');mobile.append(actions,mobileHint);root.append(mobile);
 const exportButton=make('button','secondary','导出 ↓');exportButton.type='button';exportButton.onclick=()=>root.querySelector('.output-panel').scrollIntoView({behavior:'smooth',block:'start'});actions.append(exportButton);
 const controls=[start,$(stops[mode])].filter(Boolean).map(el=>{const home=document.createComment('desktop action '+el.id);el.before(home);return {el,home};});
 const media=matchMedia('(max-width:900px)');
 function place(){for(const {el,home}of controls){if(media.matches)actions.insertBefore(el,exportButton);else home.after(el);}update();}
 function update(){
  const count=Number(root.dataset.total||0),running=root.dataset.running==='true';
  let reason='';
  if(!count)reason='先添加图片'+(['qr','barcode','mask'].includes(mode)?'或 PDF':'')+'。';
  else if(running)reason=mode==='semantic'?'正在云端处理；已发出的请求可能消耗额度。':'正在处理；可在当前图片结束后停止。';
  else if(start.disabled){
   const otherRunning=[...document.querySelectorAll('.workspace')].some(other=>other!==root&&other.dataset.running==='true');
   if(otherRunning)reason='其他任务正在进行，完成后可操作。';
   else if(mode==='semantic')reason=!$('semanticToken').value?'请填写访问口令。':!$('semanticConsent').checked?'请确认将检测图和描述发送到云端。':'请为所有待处理图片填写对象描述。';
   else if(!root.querySelector('.tile:not([data-state=complete])'))reason=mode==='qr'?'本批已完成；可在处理选项中重新识别，或继续添加图片。':'本批已完成，可继续添加图片。';
   else reason='等待图片读取或当前任务完成。';
  }
  else reason=mode==='sam'?'生成当前图片，或在右侧选择批量生成。':'已准备好，可开始处理。';
  if(['sam','semantic'].includes(mode)&&controls[1])controls[1].el.hidden=controls[1].el.disabled;
  hint.textContent=mobileHint.textContent=reason;start.title=start.disabled?reason:'';
  const current=root.querySelector('.tile[data-state=processing]');
  progress.textContent=running?(current?'处理中 · '+(current.querySelector('.tile-index')?.textContent||'')+' / '+count:'处理中'):'';
  for(const el of root.querySelectorAll('button:disabled'))if(!el.title)el.title='添加图片或完成当前任务后可用';
 }
 new MutationObserver(update).observe(start,{attributes:true,attributeFilter:['disabled']});
 if(controls[1])new MutationObserver(update).observe(controls[1].el,{attributes:true,attributeFilter:['disabled']});
 for(const status of root.querySelectorAll('.module-state .status,#sam-status')){const paint=()=>{status.dataset.state=/失败|异常|未完成|未保存/.test(status.textContent)?'error':'info';};new MutationObserver(paint).observe(status,{childList:true,subtree:true,characterData:true});paint();}
 root.addEventListener('studio:batchchange',update);root.addEventListener('studio:taskchange',update);
 root.addEventListener('input',update);root.addEventListener('change',update);media.addEventListener('change',place);place();
}
function setupSam(root){
 const flow=root.querySelector('.stage-toolstrip'),brush=$('sam-brushTool'),mode=$('sam-brushMode');
 const toolbar=make('div','brush-quickbar');toolbar.setAttribute('aria-label','蒙版修整工具');
 $('sam-brushUndo').textContent='撤销';
 toolbar.append(brush.closest('.sam-field'),$('sam-circleTools'),$('sam-brushUndo'));flow.after(toolbar);
 const segmented=make('div','brush-mode-switch');segmented.setAttribute('role','group');segmented.setAttribute('aria-label','画笔模式');
 const modeField=mode.closest('.sam-field');modeField.classList.add('brush-mode-field');mode.classList.add('sr-only');mode.tabIndex=-1;mode.setAttribute('aria-hidden','true');
 for(const [value,text]of [['add','保留 ＋'],['erase','擦除 −']]){
  const button=make('button','secondary',text);button.type='button';button.dataset.value=value;button.onclick=()=>{mode.value=value;mode.dispatchEvent(new Event('change',{bubbles:true}));};segmented.append(button);
 }
 modeField.append(segmented);
 function sync(){
  toolbar.hidden=root.dataset.view!=='mask';
  for(const button of segmented.children){button.disabled=mode.disabled;button.setAttribute('aria-pressed',String(button.dataset.value===mode.value));}
  const alpha=root.dataset.resultType==='alpha';
  $('sam-candidate').closest('.sam-field').hidden=alpha;$('sam-threshold').closest('.sam-field').hidden=alpha;$('sam-smooth').closest('label').hidden=alpha;
 }
 mode.addEventListener('input',sync);mode.addEventListener('change',sync);root.addEventListener('sam:viewchange',sync);root.addEventListener('sam:ui-update',sync);
 new MutationObserver(sync).observe(mode,{attributes:true,attributeFilter:['disabled']});sync();
 root.querySelector('.stage-toolbar').append($('sam-removeImage'));
 const aside=root.querySelector('.sam-side'),task=aside.querySelector('.task-panel'),home=document.createComment('source processing controls');task.before(home);
 const regenerate=make('details','regenerate-controls'),summary=make('summary','','重新生成与批量任务');regenerate.append(summary);aside.append(regenerate);
 function contextual(){const mask=root.dataset.view==='mask';regenerate.hidden=!mask;if(mask)regenerate.append(task);else home.after(task);aside.scrollTop=0;}
 root.addEventListener('sam:viewchange',contextual);contextual();
 const legend=root.querySelector('.frame-legend');legend.replaceChildren();
 for(const [color,text]of [['#fff','裁剪范围'],['#365ee8','目标提示']]){const item=make('span','frame-key',text),chip=make('i');chip.style.borderColor=color;item.prepend(chip);legend.append(item);}
 const labels={box:'裁剪范围（白框）',prompt:'目标提示框（蓝框）',positive:'保留点 ＋',negative:'排除点 −'};
 for(const option of $('sam-mode').options)option.textContent=labels[option.value];
}
export function setupStudioControls(){
 for(const [mode,id]of Object.entries(roots)){
  const root=$(id);zoom(root);
  if(mode==='sam')setupSam(root);
  mobileLayout(root);actionArea(root,mode);
  results(root,{qr:'qrResults',barcode:'barcodeResults',semantic:'semanticResults'}[mode]);
  root.addEventListener('studio:batchchange',event=>{
   root.dataset.total=String(event.detail.total);root.dataset.single=String(event.detail.total<2);
  });
  root.dataset.single=String(Number(root.dataset.total||0)<2);
 }
 for(const id of ['resetImages','barcodeReset','maskReset','semanticReset','sam-clearBatch','sam-removeImage'])confirmClear($(id));
 document.addEventListener('workspace:change',event=>{
  const root=$(roots[event.detail.mode]);for(const el of root.querySelectorAll('.inspector,.result-panel,.task-panel'))el.scrollTop=0;
  const tab=$(event.detail.mode+'Tab');if(matchMedia('(max-width:900px)').matches)tab.scrollIntoView({block:'nearest',inline:'nearest'});
 });
 for(const mode of ['qr','mask','barcode']){
  const root=$(roots[mode]),line=make('p','runtime-current');line.setAttribute('role','status');root.querySelector('.module-state')?.prepend(line);
  subscribe(state=>{if(root.dataset.running!=='true')return;line.textContent=state.text;line.dataset.state=state.level;root.dataset.loading=String(state.level!=='ready'&&/加载|初始化|创建|下载/.test(state.text));});
  root.addEventListener('studio:taskchange',()=>{if(root.dataset.running!=='true'){line.textContent='';root.dataset.loading='false';}});
 }
 const sam=$('samWorkspace'),model=$('sam-modelState'),line=make('p','runtime-current');line.setAttribute('role','status');$('sam-status').after(line);
 new MutationObserver(()=>{line.textContent=sam.dataset.running==='true'?model.textContent:'';}).observe(model,{childList:true,subtree:true,characterData:true});
}
