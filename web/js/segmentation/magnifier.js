// Display-only lens: never changes image coordinates, brush radius or export pixels.
export function createMagnifier({canvas,isEnabled,isAvailable,readZoom,readMark}) {
 const lens=document.createElement('div'),view=document.createElement('canvas'),label=document.createElement('div');
 lens.hidden=true;lens.setAttribute('aria-hidden','true');
 lens.style.cssText='position:fixed;z-index:1000;pointer-events:none;width:180px;border:2px solid #365ee8;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 5px 22px #0004;';
 view.width=view.height=176;view.style.cssText='display:block;width:176px;height:176px;max-width:none;';
 label.style.cssText='font:12px system-ui;color:#24324b;padding:4px 8px;background:#fff;text-align:center;';
 lens.append(view,label);document.body.append(lens);
 const ctx=view.getContext('2d');let position=null,frame=null;
 function hide(){position=null;lens.hidden=true;if(frame!==null){cancelAnimationFrame(frame);frame=null;}}
 function paint(){
  frame=null;
  if(!position||!isEnabled()||!isAvailable()||canvas.hidden||!canvas.width||!canvas.height){hide();return;}
  const rect=canvas.getBoundingClientRect(),{x,y}=position;
  if(!rect.width||!rect.height||x<rect.left||x>=rect.right||y<rect.top||y>=rect.bottom){hide();return;}
  const zoom=Math.max(2,Math.min(8,Number(readZoom())||4)),size=view.width,half=size/2;
  const sx=canvas.width/rect.width,sy=canvas.height/rect.height;
  const px=(x-rect.left)*sx,py=(y-rect.top)*sy,sw=size/zoom*sx,sh=size/zoom*sy;
  const left=px-sw/2,top=py-sh/2,l=Math.max(0,left),t=Math.max(0,top),r=Math.min(canvas.width,left+sw),b=Math.min(canvas.height,top+sh);
  ctx.clearRect(0,0,size,size);
  // Checkerboard denotes transparency; a separate gray fill denotes outside the image.
  ctx.fillStyle='#cbd2dc';ctx.fillRect(0,0,size,size);
  const dx=(l-left)/sw*size,dy=(t-top)/sh*size,dw=(r-l)/sw*size,dh=(b-t)/sh*size;
  ctx.save();ctx.beginPath();ctx.rect(dx,dy,dw,dh);ctx.clip();
  for(let cy=0;cy<size;cy+=8)for(let cx=0;cx<size;cx+=8){ctx.fillStyle=((cx/8+cy/8)%2)?'#e6eaf0':'#fff';ctx.fillRect(cx,cy,8,8);}
  ctx.imageSmoothingEnabled=true;ctx.drawImage(canvas,l,t,r-l,b-t,dx,dy,dw,dh);ctx.restore();
  const mark=readMark?.()||{},color=mark.mode==='erase'?'#e05245':'#15a568';
  ctx.strokeStyle='#fff';ctx.lineWidth=3;
  function cross(){ctx.beginPath();ctx.moveTo(half-8,half);ctx.lineTo(half+8,half);ctx.moveTo(half,half-8);ctx.lineTo(half,half+8);ctx.stroke();}
  cross();ctx.strokeStyle=color;ctx.lineWidth=1;cross();
  if(mark.radius>0){ctx.beginPath();ctx.arc(half,half,mark.radius*zoom,0,Math.PI*2);ctx.stroke();}
  label.textContent=zoom+'× · '+(mark.radius>0?'圆圈为实际画笔范围':'十字为实际落点');
  const w=180,h=206,vw=window.innerWidth,vh=window.innerHeight;
  let lx=x+28,ly=y+28;if(lx+w>vw-8)lx=x-w-28;if(ly+h>vh-8)ly=y-h-28;
  lens.style.left=Math.max(8,Math.min(vw-w-8,lx))+'px';lens.style.top=Math.max(8,Math.min(vh-h-8,ly))+'px';lens.hidden=false;
 }
 function refresh(){if(position&&frame===null)frame=requestAnimationFrame(paint);}
 function move(event){if(event.pointerType==='touch'){hide();return;}position={x:event.clientX,y:event.clientY};refresh();}
 canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerdown',move);canvas.addEventListener('pointerup',move);
 canvas.addEventListener('pointerleave',hide);canvas.addEventListener('pointercancel',hide);
 window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);window.addEventListener('blur',hide);
 return {refresh,hide};
}
