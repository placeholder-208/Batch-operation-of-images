import { applyPolygon } from './curve-geometry.js';
// Logits are sampled before thresholding. They are not physical opacity estimates.
const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
function sample(values,width,height,x,y){
 x=clamp(x,0,width-1);y=clamp(y,0,height-1);
 const left=Math.floor(x),top=Math.floor(y),right=Math.min(width-1,left+1),bottom=Math.min(height-1,top+1),fx=x-left,fy=y-top;
 const value=i=>Number.isFinite(values[i])?values[i]:-100;
 return (value(top*width+left)*(1-fx)+value(top*width+right)*fx)*(1-fy)+(value(bottom*width+left)*(1-fx)+value(bottom*width+right)*fx)*fy;
}
export function interpolatedAlpha(logits,mw,mh,width,height,threshold=0,invert=false,smooth=true){
 if(logits.length!==mw*mh||mw<1||mh<1||width<1||height<1)throw new Error('连续蒙版尺寸无效');
 const alpha=new Float32Array(width*height),sx=mw/width,sy=mh/height;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const mx=(x+.5)*sx-.5,my=(y+.5)*sy-.5,value=sample(logits,mw,mh,mx,my)-threshold;
  let a=value>0?1:0;
  if(smooth){
   // Estimate local spatial slope, then soften only ~1.5 output pixels across the contour.
   const gx=(sample(logits,mw,mh,mx+sx/2,my)-sample(logits,mw,mh,mx-sx/2,my));
   const gy=(sample(logits,mw,mh,mx,my+sy/2)-sample(logits,mw,mh,mx,my-sy/2));
   const slope=Math.hypot(gx,gy);
   if(slope>1e-6){const t=clamp(.5+value/(1.5*slope),0,1);a=t*t*(3-2*t);}
  }
  alpha[y*width+x]=invert?1-a:a;
 }
 return alpha;
}
export function paintStrokes(alpha,width,height,cropWidth,cropHeight,strokes){
 const sx=width/cropWidth,sy=height/cropHeight;
 for(const stroke of strokes){
  if(stroke.type==='polygon'){applyPolygon(alpha,width,height,cropWidth,cropHeight,stroke.points,stroke.mode);continue;}
  const points=stroke.points;if(!points.length)continue;
  for(let i=0;i<Math.max(1,points.length-1);i++){
   const a=points[i],b=points[Math.min(i+1,points.length-1)],r=stroke.radius;
   const left=clamp(Math.floor((Math.min(a.x,b.x)-r)*sx)-1,0,width),right=clamp(Math.ceil((Math.max(a.x,b.x)+r)*sx)+1,0,width);
   const top=clamp(Math.floor((Math.min(a.y,b.y)-r)*sy)-1,0,height),bottom=clamp(Math.ceil((Math.max(a.y,b.y)+r)*sy)+1,0,height);
   const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,feather=.75/Math.min(sx,sy);
   for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    const px=(x+.5)/sx,py=(y+.5)/sy,t=len?clamp(((px-a.x)*dx+(py-a.y)*dy)/len,0,1):0;
    const distance=Math.hypot(px-a.x-t*dx,py-a.y-t*dy);
    const coverage=clamp(.5+(r-distance)/(2*feather),0,1),index=y*width+x;
    alpha[index]=stroke.mode==='add'?Math.max(alpha[index],coverage):Math.min(alpha[index],1-coverage);
   }
  }
 }
 return alpha;
}
export function applyAlphaRGBA(rgba,alpha){
 if(rgba.length!==alpha.length*4)throw new Error('透明通道尺寸不匹配');
 for(let i=0;i<alpha.length;i++){
  const p=i*4;rgba[p+3]=Math.round(rgba[p+3]*clamp(alpha[i],0,1));
  if(!rgba[p+3])rgba[p]=rgba[p+1]=rgba[p+2]=0;
 }
 return rgba;
}
