const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const onSegment=(p,a,b)=>Math.abs(cross(a,b,p))<1e-7&&p.x>=Math.min(a.x,b.x)-1e-7&&p.x<=Math.max(a.x,b.x)+1e-7&&p.y>=Math.min(a.y,b.y)-1e-7&&p.y<=Math.max(a.y,b.y)+1e-7;
export function segmentsIntersect(a,b,c,d){
 const p=cross(a,b,c),q=cross(a,b,d),r=cross(c,d,a),s=cross(c,d,b);
 return ((p>0&&q<0||p<0&&q>0)&&(r>0&&s<0||r<0&&s>0))||onSegment(c,a,b)||onSegment(d,a,b)||onSegment(a,c,d)||onSegment(b,c,d);
}
export function pointInPolygon(p,points){
 let inside=false;
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[j],b=points[i];if(onSegment(p,a,b))return true;
  if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
 }
 return inside;
}
export function polygonArea(points){let sum=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=a.x*b.y-b.x*a.y;}return Math.abs(sum)/2;}
export function selfIntersects(points){
 const n=points.length;
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  if(j===i+1||i===0&&j===n-1)continue;
  if(segmentsIntersect(points[i],points[(i+1)%n],points[j],points[(j+1)%n]))return true;
 }
 return false;
}
export function polygonsOverlap(a,b){
 const bounds=p=>({left:Math.min(...p.map(v=>v.x)),right:Math.max(...p.map(v=>v.x)),top:Math.min(...p.map(v=>v.y)),bottom:Math.max(...p.map(v=>v.y))}),aa=bounds(a),bb=bounds(b);
 if(aa.right<bb.left||bb.right<aa.left||aa.bottom<bb.top||bb.bottom<aa.top)return false;
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(segmentsIntersect(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))return true;
 return pointInPolygon(a[0],b)||pointInPolygon(b[0],a);
}
// Iterative Ramer-Douglas-Peucker. Coordinates remain in original crop pixels.
export function simplifyCurve(points,epsilon){
 if(points.length<3)return points.slice();
 const kept=new Uint8Array(points.length),stack=[[0,points.length-1]];kept[0]=kept[points.length-1]=1;
 while(stack.length){
  const [start,end]=stack.pop(),a=points[start],b=points[end],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
  let best=epsilon*epsilon,index=-1;
  for(let i=start+1;i<end;i++){const p=points[i],t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0,d=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;if(d>best){best=d;index=i;}}
  if(index>=0){kept[index]=1;stack.push([start,index],[index,end]);}
 }
 return points.filter((_,i)=>kept[i]);
}
export function closeCurve(points,unitsPerScreenPixel){
 if(points.length<3)throw new Error('曲线太短，请拖动画出封闭图形。');
 if(Math.hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)>12*unitsPerScreenPixel)throw new Error('曲线未闭合，请将终点画到起点附近（容许约 12 个屏幕像素）。');
 let clean=simplifyCurve(points,.6*unitsPerScreenPixel);
 if(Math.hypot(clean[0].x-clean.at(-1).x,clean[0].y-clean.at(-1).y)<.1*unitsPerScreenPixel)clean.pop();
 if(clean.length<3||polygonArea(clean)<25*unitsPerScreenPixel**2)throw new Error('图形过小，请重新绘制。');
 if(clean.length>800)throw new Error('曲线过于复杂，请用较简洁的轮廓重画。');
 if(selfIntersects(clean))throw new Error('曲线存在自交，请重新绘制不交叉的封闭图形。');
 return clean;
}
function spans(points,y,width,visit){
 const xs=[];
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[j],b=points[i];if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));
 }
 xs.sort((a,b)=>a-b);
 for(let i=0;i+1<xs.length;i+=2){const l=Math.max(0,xs[i]),r=Math.min(width,xs[i+1]);if(r>l)visit(l,r);}
}
export function classifyPolygon(points,alpha,width,height,cropWidth,cropHeight){
 if(alpha.length!==width*height)throw new Error('蒙版尺寸无效');
 const scaled=points.map(p=>({x:p.x*width/cropWidth,y:p.y*height/cropHeight}));let total=0,foreground=0;
 const first=Math.max(0,Math.floor(Math.min(...scaled.map(p=>p.y)))),last=Math.min(height,Math.ceil(Math.max(...scaled.map(p=>p.y))));
 for(let y=first;y<last;y++)spans(scaled,y+.5,width,(l,r)=>{for(let x=Math.max(0,Math.ceil(l-.5));x<Math.min(width,Math.ceil(r-.5));x++){total++;if(alpha[y*width+x]>=.5)foreground++;}});
 if(!total)throw new Error('图形内没有可判断的工作图像素，请画大一些。');
 const fraction=foreground/total,minority=Math.min(fraction,1-fraction);
 return {total,foreground,minority,mode:minority<=.05+1e-12?(fraction>=.5?'erase':'add'):null};
}
// Two vertical samples with fractional horizontal coverage give a narrow antialiased contour.
export function applyPolygon(alpha,width,height,cropWidth,cropHeight,points,mode){
 const scaled=points.map(p=>({x:p.x*width/cropWidth,y:p.y*height/cropHeight}));
 const first=Math.max(0,Math.floor(Math.min(...scaled.map(p=>p.y)))),last=Math.min(height,Math.ceil(Math.max(...scaled.map(p=>p.y)))),coverage=new Float32Array(width);
 for(let y=first;y<last;y++){
  coverage.fill(0);
  for(const sample of [.25,.75])spans(scaled,y+sample,width,(l,r)=>{for(let x=Math.floor(l);x<Math.ceil(r);x++)coverage[x]+=.5*Math.max(0,Math.min(x+1,r)-Math.max(x,l));});
  for(let x=0;x<width;x++)if(coverage[x]>0){const i=y*width+x,c=Math.min(1,coverage[x]);alpha[i]=mode==='add'?Math.max(alpha[i],c):Math.min(alpha[i],1-c);}
 }
 return alpha;
}
