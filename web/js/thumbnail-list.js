export function setBatchSize(list,total){
 const root=list.closest('.workspace');if(!root||root.dataset.total===String(total))return;
 root.dataset.total=String(total);root.dataset.single=String(total<2);
 root.dispatchEvent(new CustomEvent('studio:batchchange',{detail:{total},bubbles:true}));
}
let queue=Promise.resolve();
export function prepareThumbnail(item,changed){
 queue=queue.then(async()=>{
  await new Promise(resolve=>setTimeout(resolve,0));
  if(item.thumbnailDisposed)return;
  let bitmap,canvas;
  try{
   bitmap=await createImageBitmap(item.file);if(item.thumbnailDisposed)return;
   const scale=Math.min(1,160/Math.max(bitmap.width,bitmap.height));
   canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.75));
   if(blob&&!item.thumbnailDisposed){item.thumbnailURL=URL.createObjectURL(blob);changed();}
  }catch{/* Keep a filename placeholder when thumbnail decoding fails. */}
  finally{bitmap?.close();if(canvas)canvas.width=canvas.height=1;}
 }).catch(()=>{});
}
export function disposeThumbnail(item){item.thumbnailDisposed=true;if(item.thumbnailURL)URL.revokeObjectURL(item.thumbnailURL);}
export function createThumbnailItem(onSelect){
 const button=document.createElement('button'),media=document.createElement('span'),img=document.createElement('img'),index=document.createElement('span'),badge=document.createElement('span'),name=document.createElement('span');
 button.type='button';media.className='tile-media';index.className='tile-index';badge.className='tile-badge';name.className='tile-name';img.alt='';img.width=img.height=96;img.hidden=true;
 media.append(img,index,badge);button.append(media,name);button.onclick=onSelect;
 return {button,img,index,badge,name};
}
export function updateThumbnailItem(node,item,index,selected,label,extraClass=''){
 const previousState=node.button.dataset.state;
 const detail=typeof label==='object'&&label!==null?label:{text:label};
 const status=detail.text??'',state=detail.state||(item.error?'error':item.processing?'processing':item.result||item.detected||item.hasResult?'complete':'pending');
 const description=typeof status==='number'?status+' 个结果':String(status);
 node.button.className='tile'+(extraClass?' '+extraClass:'')+(selected?' active':'');node.button.dataset.state=state;
 node.button.setAttribute('aria-label',(index+1)+'. '+item.file.name+'，'+description);node.button.setAttribute('aria-pressed',String(selected));node.button.title=item.file.name+' · '+description;
 node.index.textContent=String(index+1);node.badge.textContent=(state==='error'?'! ':state==='processing'?'◌ ':'')+String(detail.count??status);node.name.textContent=item.file.name;
 if(previousState!==state)node.button.closest('.workspace')?.dispatchEvent(new CustomEvent('studio:taskchange'));
 if(item.thumbnailURL){if(node.img.getAttribute('src')!==item.thumbnailURL)node.img.src=item.thumbnailURL;node.img.hidden=false;}
}
export function createTileList(root,onSelect,label){
 const nodes=new Map();
 return (items,selected)=>{
  setBatchSize(root,items.length);
  const wanted=new Set(items);
  for(const [item,node] of nodes)if(!wanted.has(item)){node.button.remove();nodes.delete(item);}
  root.hidden=items.length<1;
  items.forEach((item,index)=>{
   let node=nodes.get(item);
   if(!node){node=createThumbnailItem(()=>onSelect(index));root.append(node.button);nodes.set(item,node);}
   updateThumbnailItem(node,item,index,index===selected,label(item));node.button.onclick=()=>onSelect(index);
  });
 };
}

// Navigation controls are added after feature initialization by the layout module.
export function bindBatchNavigation(root,prefix,getState,onSelect){
 function refresh(){
  const {index,total}=getState(),previous=root.querySelector('#'+prefix+'Prev'),next=root.querySelector('#'+prefix+'Next'),position=root.querySelector('#'+prefix+'Position');
  if(previous)previous.disabled=!total||index<=0;
  if(next)next.disabled=!total||index<0||index>=total-1;
  if(position){position.setAttribute('role','status');position.setAttribute('aria-live','polite');position.setAttribute('aria-atomic','true');const text=(total&&index>=0?index+1:0)+' / '+total;if(position.textContent!==text)position.textContent=text;}
 }
 root.addEventListener('click',event=>{
  const button=event.target.closest?.('button');if(!button||button.disabled)return;
  if(button.id!==prefix+'Prev'&&button.id!==prefix+'Next')return;
  const {index,total}=getState(),target=index+(button.id===prefix+'Prev'?-1:1);if(target>=0&&target<total)onSelect(target);
 });
 root.addEventListener('studio:ready',refresh);
 return refresh;
}
