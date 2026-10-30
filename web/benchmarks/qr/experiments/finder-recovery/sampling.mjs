// Research-only phase/scale refinement. Fits only mandatory QR structures.
export function imageGray(image){
 const gray=new Float64Array(image.width*image.height);
 for(let i=0;i<gray.length;i++){const j=i*4,a=image.data[j+3]/255;gray[i]=a*(.299*image.data[j]+.587*image.data[j+1]+.114*image.data[j+2])+255*(1-a);}
 return gray;
}
export function bilinear(values,width,height,x,y){
 if(!Number.isFinite(x+y)||x<0||y<0||x>width-1||y>height-1)return NaN;
 const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy,xx=Math.min(ix+1,width-1),yy=Math.min(iy+1,height-1);
 return (1-ty)*((1-tx)*values[iy*width+ix]+tx*values[iy*width+xx])+ty*((1-tx)*values[yy*width+ix]+tx*values[yy*width+xx]);
}
export function mandatoryCells(n){
 const groups=[];
 for(const [left,top]of[[0,0],[n-7,0],[0,n-7]]){
  const cells=[];
  for(let y=0;y<7;y++)for(let x=0;x<7;x++)cells.push({x:left+x+.5,y:top+y+.5,dark:Math.max(Math.abs(x-3),Math.abs(y-3))!==2});
  groups.push(cells);
 }
 const timing=[];
 for(let k=8;k<n-8;k++)timing.push({x:k+.5,y:6.5,dark:k%2===0},{x:6.5,y:k+.5,dark:k%2===0});
 groups.push(timing);return groups;
}
export function correctedMap(model,{dx=0,dy=0,sx=1,sy=1}={}){
 const center=model.dimension/2;
 return(x,y)=>model.map(center+(x-center)*sx+dx,center+(y-center)*sy+dy);
}
function separation(rows){
 let black=0,white=0,bn=0,wn=0;
 for(const [v,dark]of rows){if(!Number.isFinite(v))return null;if(dark){black+=v;bn++;}else{white+=v;wn++;}}
 if(!bn||!wn)return null;black/=bn;white/=wn;
 const gap=white-black;if(gap<=8)return null;
 let residual=0;for(const [v,dark]of rows)residual+=(v-(dark?black:white))**2;
 residual/=rows.length;
 return {score:gap*gap/(gap*gap+4*residual+1),black,white,gap};
}
export function structureScore(model,gray,width,height,adjustment={}){
 const map=correctedMap(model,adjustment),groups=mandatoryCells(model.dimension),scores=[],all=[];
 for(const cells of groups){
  const rows=cells.map(p=>{const xy=map(p.x,p.y);return[bilinear(gray,width,height,xy.x,xy.y),p.dark];});
  const fit=separation(rows);if(!fit)return null;scores.push(fit.score);all.push(...rows);
 }
 const fit=separation(all);if(!fit)return null;
 const score=(scores[0]+scores[1]+scores[2]+2*scores[3])/5;
 return {...fit,score,finderScores:scores.slice(0,3),timingScore:scores[3],adjustment,map};
}
export function rankPhaseAdjustments(model,gray,width,height,{top=8}={}){
 const ranked=[];
 for(const sx of [.98,1,1.02])for(const sy of [.98,1,1.02])for(const dx of [-.3,-.2,-.1,0,.1,.2,.3])for(const dy of [-.3,-.2,-.1,0,.1,.2,.3]){
  const fit=structureScore(model,gray,width,height,{dx,dy,sx,sy});if(!fit)continue;
  ranked.push(fit);
 }
 ranked.sort((a,b)=>b.score-a.score);
 // Avoid spending every trial on essentially identical nearby hypotheses.
 const selected=[];
 for(const candidate of ranked){
  if(selected.some(other=>Math.abs(candidate.adjustment.dx-other.adjustment.dx)<.15&&Math.abs(candidate.adjustment.dy-other.adjustment.dy)<.15&&
   candidate.adjustment.sx===other.adjustment.sx&&candidate.adjustment.sy===other.adjustment.sy))continue;
  selected.push(candidate);if(selected.length>=top)break;
 }
 const zero=structureScore(model,gray,width,height,{});
 if(zero&&!selected.some(s=>Object.values(s.adjustment).every((v,i)=>v===[0,0,1,1][i])))selected.push(zero);
 return selected;
}
export function resample(model,fit,gray,width,height,{radius=0,normalize=true}={}){
 const n=model.dimension,samples=new Float64Array(n*n),offsets=radius?[[-radius,-radius],[0,-radius],[radius,-radius],[-radius,0],[0,0],[radius,0],[-radius,radius],[0,radius],[radius,radius]]:[[0,0]];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  let sum=0;
  for(const [dx,dy]of offsets){const p=fit.map(x+.5+dx,y+.5+dy);const value=bilinear(gray,width,height,p.x,p.y);if(!Number.isFinite(value))return null;sum+=value;}
  const value=sum/offsets.length;
  samples[y*n+x]=normalize?(value-fit.black)/fit.gap:value/255;
 }
 return samples;
}

// A diagnostic reproduction of the old local-extrema normalization, evaluated
// only where samples are requested. Used to isolate radius from calibration.
export function localExtremaGrid(model,gray,width,height,{radius=0}={}){
 const window=Math.max(5,Math.min(31,Math.round(model.moduleSize*2.4)|1)),r=(window-1)/2,cache=new Map();
 const pixel=(x,y)=>{
  const key=y*width+x;if(cache.has(key))return cache.get(key);
  let low=Infinity,high=-Infinity;
  for(let yy=Math.max(0,y-r);yy<=Math.min(height-1,y+r);yy++)for(let xx=Math.max(0,x-r);xx<=Math.min(width-1,x+r);xx++){
   const value=gray[yy*width+xx];low=Math.min(low,value);high=Math.max(high,value);
  }
  const value=Math.max(0,Math.min(1,(gray[key]-low)/Math.max(30,high-low)));cache.set(key,value);return value;
 };
 const sample=(x,y)=>{
  if(x<0||y<0||x>width-1||y>height-1||!Number.isFinite(x+y))return NaN;
  const ix=Math.floor(x),iy=Math.floor(y),xx=Math.min(width-1,ix+1),yy=Math.min(height-1,iy+1),tx=x-ix,ty=y-iy;
  return (1-ty)*((1-tx)*pixel(ix,iy)+tx*pixel(xx,iy))+ty*((1-tx)*pixel(ix,yy)+tx*pixel(xx,yy));
 };
 const n=model.dimension,samples=new Float64Array(n*n),offsets=radius?[-radius,0,radius]:[0];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  let sum=0;for(const dy of offsets)for(const dx of offsets){const p=model.map(x+.5+dx,y+.5+dy);sum+=sample(p.x,p.y);}
  samples[y*n+x]=sum/(offsets.length*offsets.length);
 }
 return samples;
}
