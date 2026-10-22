// Rearrange existing nodes, never clone controls or replace canvases with active state.
const $=id=>document.getElementById(id);
const node=(tag,className='',text='')=>{const el=document.createElement(tag);el.className=className;if(text)el.textContent=text;return el;};
function heading(section,number,title){
 const head=node('div','inspector-heading'),badge=node('span','step-number',String(number)),label=node('h2','',title);
 head.append(badge,label);section.prepend(head);return head;
}
function section(number,title,className){const el=node('section',className);heading(el,number,title);return el;}
function disclosure(label,content){const details=node('details','context-help'),summary=node('summary','',label);details.append(summary,content);return details;}
function stageScroll(stage){const scroll=node('div','stage-scroll');stage.before(scroll);scroll.append(stage);}
function rail(root,list,count,add){
 const aside=node('aside','batch-rail');aside.setAttribute('aria-label','本批图片');
 const head=node('div','rail-heading');head.append(node('h2','','图片'));if(count)head.append(count);
 aside.append(head);if(add){add.textContent='＋ 添加';add.title='添加图片到本批';add.classList.add('rail-add');aside.append(add);}
 const empty=node('p','rail-empty','还没有图片');aside.append(list,empty);root.prepend(aside);return aside;
}
function nav(mode){
 const nav=node('nav','image-navigation');nav.setAttribute('aria-label','切换当前图片');
 for(const [suffix,label,text] of [['Prev','上一张图片','←'],['Position','当前图片位置','0 / 0'],['Next','下一张图片','→']]){
  const el=node(suffix==='Position'?'span':'button','',text);el.id=mode+suffix;el.setAttribute('aria-label',label);
  if(suffix==='Position'){el.setAttribute('aria-live','polite');el.setAttribute('aria-atomic','true');}else{el.type='button';el.className='secondary icon-button';el.disabled=true;el.title=label;}
  nav.append(el);
 }return nav;
}
function prepareStandard(mode,rootId,listId,resultId){
 const root=$(rootId);if(!root)return;
 const main=root.querySelector('section.panel'),aside=root.querySelector('aside.panel'),oldHead=main.querySelector('.panel-head'),body=aside.querySelector('.side-body');
 const count=aside.querySelector('.panel-head .small');
 const tiles=$(listId),add=$(mode==='qr'?'add':mode+'Add'),reset=$(mode==='qr'?'resetImages':mode+'Reset');
 rail(root,tiles,count,add);
 main.classList.add('stage-panel');const toolbar=node('div','stage-toolbar'),filebar=main.querySelector('.image-footer');filebar.className='stage-file';
 toolbar.append(filebar,nav(mode),reset);main.prepend(toolbar);
 oldHead.classList.add('sr-only');oldHead.querySelector('.tools')?.remove();
 const stage=main.querySelector('.stage');stageScroll(stage);
 const maskTools=main.querySelector('.mask-tools');if(maskTools)toolbar.after(maskTools);
 const task=section(1,'处理','task-panel'),results=section(2,'当前图片结果','result-panel'),output=section(3,'导出','output-panel');
 aside.append(task,results,output);
 const oldAsideHead=aside.querySelector('.panel-head');oldAsideHead.classList.add('sr-only');
 const result=$(resultId);
 if(result){const oldTitle=result.previousElementSibling;if(oldTitle?.tagName==='H2'){oldTitle.previousElementSibling?.classList.contains('divider')&&oldTitle.previousElementSibling.remove();oldTitle.remove();}results.append(result);result.classList.add('result-list');}
 if(mode==='mask')results.append($('maskReview'));
 const exports=body.querySelector('.export-actions');if(exports){const help=exports.nextElementSibling;output.append(exports);if(help?.classList.contains('context-help'))output.append(help);}
 if(mode==='qr'){
  const network=body.querySelector('.link-controls');if(network)results.append(network);
  $('downloadAllZip').classList.replace('secondary','primary');$('downloadAllZip').before($('downloadImageZip'));
 }
 if(mode==='barcode')$('barcodeAllZip').classList.replace('secondary','primary');
 if(mode==='semantic'){
  $('semanticZip').classList.replace('secondary','primary');
  const maintenance=node('div','maintenance-actions');maintenance.append($('semanticRetry'),$('semanticDiagnostic'));output.append(disclosure('重新检测与诊断',maintenance));
 }
 const description=node('p','task-description',{
  qr:'导入图片或 PDF，读取码内内容并导出裁图与 CSV。',barcode:'导入图片或 PDF，读取条形码并导出裁图与 CSV。',mask:'导入图片或 PDF，自动检测后逐图检查并补充遮盖框。',semantic:'按图填写描述，或使用统一描述批量裁剪。'
 }[mode]);task.append(description,body);aside.classList.add('inspector');aside.append(task,results,output);
 root.dispatchEvent(new CustomEvent('studio:ready'));
}
function prepareSegmentation(){
 const root=$('samWorkspace');if(!root||root.dataset.editorViews)return;root.dataset.editorViews='true';
 const main=root.querySelector('.sam-main'),aside=root.querySelector('.sam-side'),source=main.children[0],preview=main.children[1],flow=root.querySelector('.sam-flow-nav');
 source.id='sam-sourcePanel';preview.id='sam-previewPanel';source.classList.add('editor-panel');preview.classList.add('editor-panel');
 const queue=root.querySelector('.sam-batch-list'),railNode=rail(root,$('sam-imageList'),$('sam-batchInfo'),$('sam-choose'));
 const queueActions=queue.querySelector('.sam-actions');$('sam-removeImage').textContent='移除当前';$('sam-clearBatch').textContent='清空';railNode.append(queueActions);railNode.title='每批最多 20 张，切换图片保留各自修改';queue.remove();
 const toolbar=node('div','stage-toolbar sam-toolbar'),filebar=root.querySelector('.sam-filebar');filebar.className='stage-file';filebar.lastElementChild.classList.add('frame-legend');
 toolbar.append(filebar,$('sam-quickNav'),$('sam-clearBatch'));main.prepend(toolbar);
 flow.replaceChildren();flow.className='stage-toolstrip';toolbar.after(flow);
 const tablist=node('div','editor-tabs');tablist.setAttribute('role','tablist');tablist.setAttribute('aria-label','本地分割编辑视图');tablist.setAttribute('aria-orientation','horizontal');flow.append(tablist,$('sam-overlay').closest('label'));
 const sourceTools=$('sam-mode').closest('.sam-section'),magnifier=$('sam-magnify').closest('.sam-section'),brush=root.querySelector('.sam-brushbar');
 sourceTools.classList.add('sam-source-tools');magnifier.classList.add('sam-lens-settings');
 const [generate,adjust,output]=[...aside.children];
 generate.querySelector('h2').remove();adjust.querySelector('h2').remove();output.querySelector('h2').remove();
 generate.className='task-panel';adjust.className='result-panel';output.className='output-panel';
 heading(generate,1,'处理');heading(adjust,2,'当前图片结果');heading(output,3,'导出');
 generate.querySelector('.sam-hint')?.remove();
 $('sam-segment').before(sourceTools,magnifier);
 const refine=node('div','sam-refine-tools'),maskInfo=$('sam-maskInfo');
 const adjustment=node('div','mask-settings');for(const child of [...adjust.children])if(!child.classList.contains('inspector-heading')&&child!==maskInfo)adjustment.append(child);
 const brushHelp=preview.querySelector('.sam-section');if(brushHelp)brush.append(brushHelp);
 refine.append(brush,disclosure('候选、边缘与小区域清理',adjustment));
 const empty=node('p','view-help','生成蒙版后，切换到「蒙版修整」检查并编辑结果。');adjust.append(maskInfo,empty,refine);
 source.querySelector('.head').classList.add('sr-only');preview.querySelector('.head').classList.add('sr-only');
 stageScroll($('sam-stage'));stageScroll($('sam-previewStage'));
 const legend=preview.querySelector('.sam-preview-legend');if(legend)legend.lastElementChild.lastChild.textContent='深色外围：图片外，不可绘制';
 aside.classList.add('inspector');main.classList.add('stage-panel');root.classList.add('studio-sam');
 const buttons=[];
 function select(index,focus=false){
  if(!root.dispatchEvent(new CustomEvent('sam:beforeviewchange',{cancelable:true})))return;
  [source,preview].forEach((panel,i)=>{panel.hidden=i!==index;buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;});
  sourceTools.hidden=magnifier.hidden=index===1;refine.hidden=index===0;empty.hidden=index===1;
  $('sam-overlay').closest('label').hidden=index===0;
  root.dispatchEvent(new CustomEvent('sam:viewchange'));if(focus)buttons[index].focus();
 }
 for(const [i,label] of ['范围与提示','蒙版修整'].entries()){
  const button=node('button','',label),panel=i?preview:source;button.id=i?'sam-maskView':'sam-sourceView';button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
  button.onclick=()=>select(i);button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();select(event.key==='Home'?0:event.key==='End'?1:1-i,true);}});buttons.push(button);tablist.append(button);
 }
 root.addEventListener('sam:generated',()=>select(1));root.addEventListener('sam:source-ready',()=>select(0));select(0);
 root.dispatchEvent(new CustomEvent('studio:ready'));
}
export function setupDesign(){
 if(document.body.dataset.studioReady)return;document.body.dataset.studioReady='true';
 const tabs=document.querySelector('.tabs'),header=document.querySelector('header');tabs.setAttribute('aria-orientation','horizontal');header.querySelector('.brand').after(tabs);
 const privacy=document.querySelector('.header-note');privacy.id='privacyLabel';privacy.className='privacy-label';
 const setPrivacy=mode=>{privacy.textContent=mode==='semantic'?'云端检测 · Groq':'图片本地处理';privacy.title=mode==='semantic'?'经同意后发送缩小图片与描述，其余操作在浏览器完成':'图片不上传。运行库和模型按需下载；二维码网页信息仅在开启后联网。';};
 document.addEventListener('workspace:change',event=>setPrivacy(event.detail.mode));setPrivacy('qr');
 document.querySelector('.intro').classList.add('sr-only');document.querySelector('footer').classList.add('sr-only');
 $('semanticTab').textContent='语义裁剪';
 const paths={qr:'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M15 14v3h-2 M20 14v6h-5 M13 20h1',barcode:'M4 5v14 M7 5v14 M11 5v14 M13 5v14 M17 5v14 M20 5v14',mask:'M5 4h14v16H5z M8 8h8v8H8z M8 8l8 8',semantic:'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M12 8v8 M8 12h8',sam:'M8 3c-3 2-4 5-3 8s-2 5 0 8 6 2 8 2 6-1 7-4-1-5-2-7 0-4-3-6-5-2-7-1z'};
 for(const name of Object.keys(paths)){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]);svg.append(path);$(name+'Tab').prepend(svg);}
 document.querySelectorAll('.module-state').forEach(el=>{const rows=el.querySelector('.module-rows');if(!rows)return;el.querySelector('.module-caption')?.remove();const details=disclosure('引擎与运行详情',rows);details.classList.add('runtime-details');el.append(details);const note=el.parentElement.querySelector('.processing-note');if(note)details.append(note);});
 prepareStandard('qr','normalWorkspace','tiles','qrResults');prepareStandard('barcode','barcodeWorkspace','barcodeTiles','barcodeResults');prepareStandard('mask','maskWorkspace','maskTiles','maskSummary');prepareStandard('semantic','semanticWorkspace','semanticTiles','semanticResults');prepareSegmentation();
 document.querySelector('#samWorkspace .sam-help[open]')?.removeAttribute('open');
 const dialog=$('guideDialog');$('openGuide').onclick=()=>dialog.showModal();$('closeGuide').onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
}
