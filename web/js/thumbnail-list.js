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
export function createTileList(root,onSelect,label){
 const nodes=new Map();
 return (items,selected)=>{
  const wanted=new Set(items);
  for(const [item,node] of nodes)if(!wanted.has(item)){node.button.remove();nodes.delete(item);}
  root.hidden=items.length<2;
  items.forEach((item,index)=>{
   let node=nodes.get(item);
   if(!node){const button=document.createElement('button'),img=document.createElement('img'),text=document.createElement('span');img.alt='';img.width=img.height=60;button.append(img,text);root.append(button);node={button,img,text};nodes.set(item,node);}
   node.button.className='tile'+(index===selected?' active':'');node.button.setAttribute('aria-label',item.file.name);node.button.setAttribute('aria-pressed',String(index===selected));node.button.title=item.file.name;
   if(item.thumbnailURL&&node.img.getAttribute('src')!==item.thumbnailURL)node.img.src=item.thumbnailURL;
   node.text.textContent=label(item);node.button.onclick=()=>onSelect(index);
  });
 };
}
