// Experimental finder proposals independent of connected-component enclosure.
// Standard 1:1:3:1:1 scan proportions, cross checks, then gray 7x7 evidence.
// Not a QR decoder and not a calibrated confidence estimate.
// Algorithm reference (independent implementation, not a source-code port):
// https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/qrcode/detector/FinderPatternFinder.java
const point=(x,y)=>({x,y}),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function ratios(counts,tolerance=.28){
 const total=counts.reduce((s,n)=>s+n,0),module=total/7;
 if(module<1||counts.some(v=>v<1))return null;
 const expected=[1,1,3,1,1];
 const error=counts.reduce((sum,n,i)=>sum+Math.abs(n/module-expected[i]),0)/7;
 if(error>tolerance||counts.some((v,i)=>Math.abs(v/module-expected[i])>expected[i]*.8))return null;
 return {module,error,total};
}
function crossing(binary,width,height,x,y,dx,dy,module,tolerance){
 x=Math.round(x);y=Math.round(y);
 const get=t=>{const xx=x+t*dx,yy=y+t*dy;return xx<0||yy<0||xx>=width||yy>=height?-1:binary[yy*width+xx];};
 if(get(0)!==1)return null;
 const max=Math.ceil(module*9),counts=[0,0,1,0,0];let left=-1,right=1;
 while(left>=-max&&get(left)===1){counts[2]++;left--;}
 while(right<=max&&get(right)===1){counts[2]++;right++;}
 while(left>=-max&&get(left)===0){counts[1]++;left--;}
 while(right<=max&&get(right)===0){counts[3]++;right++;}
 while(left>=-max&&get(left)===1){counts[0]++;left--;}
 while(right<=max&&get(right)===1){counts[4]++;right++;}
 const check=ratios(counts,tolerance);if(!check||Math.abs(check.module-module)>module*.65)return null;
 const center=(right-counts[4]-counts[3]-(counts[2]+1)/2);
 return {...check,x:x+center*dx,y:y+center*dy,counts};
}
function grayAt(gray,width,height,x,y){
 if(x<0||y<0||x>=width-1||y>=height-1)return NaN;
 const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy,i=iy*width+ix;
 return (1-ty)*((1-tx)*gray[i]+tx*gray[i+1])+ty*((1-tx)*gray[i+width]+tx*gray[i+width+1]);
}
function quality(gray,width,height,finder,ax,ay,bx,by,scales=[.8,1,1.2]){
 let best=null;
 for(const sx of scales)for(const sy of scales){
  const values=[],sum=[0,0],count=[0,0];
  for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
   const value=grayAt(gray,width,height,finder.x+finder.module*(sx*x*ax+sy*y*bx),finder.y+finder.module*(sx*x*ay+sy*y*by));
   if(!Number.isFinite(value))continue;
   const type=Number(Math.max(Math.abs(x),Math.abs(y))===2);
   sum[type]+=value;count[type]++;values.push([value,type]);
  }
  if(count[0]<30||count[1]<12)continue;
  const dark=sum[0]/count[0],light=sum[1]/count[1],gap=light-dark;
  if(gap<6)continue;
  const variance=values.reduce((s,[v,t])=>s+(v-(t?light:dark))**2,0)/values.length;
  const score=gap*gap/(gap*gap+variance+4);
  if(!best||score>best.score)best={score,sx,sy,dark,light,gap,variance};
 }
 return best;
}
function integral(gray,width,height){
 const stride=width+1,sum=new Float64Array(stride*(height+1));
 for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){row+=gray[y*width+x];sum[(y+1)*stride+x+1]=sum[y*stride+x+1]+row;}}
 return (x,y,r)=>{const l=Math.max(0,x-r),t=Math.max(0,y-r),rr=Math.min(width,x+r+1),b=Math.min(height,y+r+1);
  return (sum[b*stride+rr]-sum[b*stride+l]-sum[t*stride+rr]+sum[t*stride+l])/((rr-l)*(b-t));};
}
export function scanFinderProposals(image,{budgetMs=500,maxFinders=24,maxGroups=6,rowStep=1,tolerance=.28}={}){
 const began=performance.now(),{width,height,data}=image;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>1000000||data?.length!==width*height*4)
  throw new TypeError('Invalid or oversized finder image');
 if(!(budgetMs>0))return {finders:[],groups:[],diagnostics:{width,height,thresholds:[],rawHits:0,budgetSkipped:true,
  finders:0,groups:0,elapsedMs:performance.now()-began,reason:'finder-budget'}};
 rowStep=Math.max(1,Math.floor(rowStep)||1);
 const gray=new Float32Array(width*height),hist=new Uint32Array(256);
 for(let i=0;i<gray.length;i++){const a=data[i*4+3]/255;gray[i]=a*(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2])+255*(1-a);hist[Math.round(gray[i])]++;}
 const quantile=f=>{let s=0;for(let i=0;i<256;i++){s+=hist[i];if(s>=gray.length*f)return i;}return 255;};
 const low=quantile(.08),high=quantile(.92),mean=integral(gray,width,height),pool=[];
 const thresholds=[.25,.4,.55,.7].map(f=>({name:'global-'+f,value:low+(high-low)*f}));
 thresholds.push(...[9,17,31].map(radius=>({name:'local-'+radius,radius})));
 const diagnostics={width,height,thresholds:[],rawHits:0,budgetSkipped:false};
 const expired=()=>performance.now()-began>=budgetMs;
 const add=hit=>{
  const found=pool.find(p=>distance(p,hit)<Math.max(2,Math.min(p.module,hit.module)*1.2)&&Math.abs(p.module-hit.module)<Math.max(p.module,hit.module)*.5);
  if(found){const n=found.support;for(const key of ['x','y','module','ratioError'])found[key]=(found[key]*n+hit[key])/(n+1);found.support++;found.thresholds.add(hit.threshold);}
  else pool.push({...hit,support:1,thresholds:new Set([hit.threshold])});
 };
 for(const threshold of thresholds){
  if(expired()){diagnostics.budgetSkipped=true;break;}
  const binary=Uint8Array.from(gray,(v,i)=>Number(v<(threshold.radius?mean(i%width,Math.floor(i/width),threshold.radius)-2:threshold.value)));
  let thresholdHits=0;
  for(const vertical of [false,true]){
   const lines=vertical?width:height,length=vertical?height:width;
   for(let line=0;line<lines;line+=rowStep){
    if((line&31)===0&&expired()){diagnostics.budgetSkipped=true;break;}
    const runs=[];let color=vertical?binary[line]:binary[line*width],start=0;
    const finish=(end,next)=>{
     runs.push({color,start,length:end-start});
     if(runs.length>5)runs.shift();
     if(runs.length===5&&runs[0].color===1){
      const r=ratios(runs.map(v=>v.length),tolerance);
      if(r){
       const center=runs[2].start+(runs[2].length-1)/2;
       const first=point(vertical?line:center,vertical?center:line);
       const second=crossing(binary,width,height,first.x,first.y,vertical?1:0,vertical?0:1,r.module,tolerance);
       if(second){
        const third=crossing(binary,width,height,second.x,second.y,vertical?0:1,vertical?1:0,second.module,tolerance);
        if(third){add({...third,module:(r.module+second.module+third.module)/3,ratioError:(r.error+second.error+third.error)/3,threshold:threshold.name});thresholdHits++;}
       }
      }
     }
     color=next;start=end;
    };
    for(let t=1;t<length;t++){const value=vertical?binary[t*width+line]:binary[line*width+t];if(value!==color)finish(t,value);}
    finish(length,-1);
   }
   if(diagnostics.budgetSkipped)break;
  }
  diagnostics.rawHits+=thresholdHits;diagnostics.thresholds.push({name:threshold.name,hits:thresholdHits});
  if(diagnostics.budgetSkipped)break;
 }
 pool.sort((a,b)=>b.support*(1-b.ratioError)-a.support*(1-a.ratioError));
 const finders=pool.slice(0,maxFinders),groups=[];
 for(let i=0;i<finders.length-2;i++)for(let j=i+1;j<finders.length-1;j++)for(let k=j+1;k<finders.length;k++){
  if(expired()){diagnostics.budgetSkipped=true;break;}
  const triple=[finders[i],finders[j],finders[k]];
  if(Math.max(...triple.map(p=>p.module))/Math.min(...triple.map(p=>p.module))>2)continue;
  for(let pivot=0;pivot<3;pivot++){
   const tl=triple[pivot],arms=triple.filter((_,i)=>i!==pivot);let [tr,bl]=arms;
   let ax=tr.x-tl.x,ay=tr.y-tl.y,bx=bl.x-tl.x,by=bl.y-tl.y;
   const al=Math.hypot(ax,ay),blen=Math.hypot(bx,by),cosine=Math.abs(ax*bx+ay*by)/(al*blen);
   if(cosine>.65||Math.min(al,blen)<tl.module*10)continue;
   if(ax*by-ay*bx<0){[tr,bl]=[bl,tr];[ax,ay,bx,by]=[bx,by,ax,ay];}
   const a=Math.hypot(ax,ay),b=Math.hypot(bx,by),observed=[tl,tr,bl],scores=observed.map(p=>quality(gray,width,height,p,ax/a,ay/a,bx/b,by/b));
   if(scores.some(s=>!s||s.score<.6))continue;
   const fitted=observed.map((p,index)=>{
    const s=scores[index],quad=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>point(p.x+3.5*p.module*(x*s.sx*ax/a+y*s.sy*bx/b),p.y+3.5*p.module*(x*s.sx*ay/a+y*s.sy*by/b)));
    return {...p,thresholds:[...p.thresholds],template:s,quad,positionKind:'gray-template-fitted'};
   });
   const score=scores.reduce((v,s)=>v+s.score,0)/3-.1*cosine;
   groups.push({finders:fitted,cosine,score,moduleSize:[...observed.map(p=>p.module)].sort((a,b)=>a-b)[1]});
  }
 }
 // A broken third ring may not form even one ratio crossing. Use two strong
 // scan-confirmed finders only to restrict a gray-template search, never to
 // insert a third marker at its predicted location without image evidence.
 if(!groups.length&&finders.filter(p=>p.support>=5).length>=2&&!expired()){
  const strong=finders.filter(p=>p.support>=5).slice(0,3),pairGroups=[];
  for(let i=0;i<strong.length;i++)for(let j=0;j<strong.length;j++){
   if(i===j)continue;
   const origin=strong[i],right=strong[j],length=distance(origin,right),module=(origin.module+right.module)/2;
   if(length<module*10)continue;
   const ax=(right.x-origin.x)/length,ay=(right.y-origin.y)/length;
   for(const sign of [-1,1]){
    const bx=-ay*sign,by=ax*sign,candidates=[];
    for(let along=-.3*length;along<=.3*length;along+=Math.max(1,module*.6)){
     if(expired()){diagnostics.budgetSkipped=true;break;}
     for(let perpendicular=.6*length;perpendicular<=1.45*length;perpendicular+=Math.max(1,module*.6)){
      const third={x:origin.x+ax*along+bx*perpendicular,y:origin.y+ay*along+by*perpendicular,module,support:0,
       ratioError:0,thresholds:[],source:'pair-guided-gray-template'};
      const evidence=quality(gray,width,height,third,ax,ay,bx,by,[.65,.85,1.05]);
      if(evidence&&evidence.score>.7)candidates.push({third,evidence,along,perpendicular});
     }
    }
    candidates.sort((a,b)=>b.evidence.score-a.evidence.score);
    for(const candidate of candidates.slice(0,3)){
     const list=[origin,right,candidate.third],qa=[quality(gray,width,height,origin,ax,ay,bx,by),
      quality(gray,width,height,right,ax,ay,bx,by),candidate.evidence];
     if(qa.some(q=>!q||q.score<.6))continue;
     const cosine=Math.abs(candidate.along)/Math.hypot(candidate.along,candidate.perpendicular);
     let observed=list.map((p,index)=>{
      const s=qa[index],quad=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>point(p.x+3.5*p.module*(x*s.sx*ax+y*s.sy*bx),p.y+3.5*p.module*(x*s.sx*ay+y*s.sy*by)));
      return {...p,thresholds:[...p.thresholds],template:s,quad,positionKind:'gray-template-fitted'};
     });
     if(sign<0)observed=[observed[0],observed[2],observed[1]].map(p=>({...p,
      quad:[p.quad[0],p.quad[3],p.quad[2],p.quad[1]],template:{...p.template,sx:p.template.sy,sy:p.template.sx}}));
     pairGroups.push({finders:observed,cosine,score:qa.reduce((v,q)=>v+q.score,0)/3-.1*cosine,
      moduleSize:module,source:'pair-guided-gray-template'});
    }
    if(expired()){diagnostics.budgetSkipped=true;break;}
   }
  }
  diagnostics.pairTemplateGroups=pairGroups.length;groups.push(...pairGroups);
 }
 groups.sort((a,b)=>b.score-a.score);
 const selected=[];
 for(const g of groups){if(selected.some(h=>g.finders.every((p,i)=>distance(p,h.finders[i])<Math.max(3,p.module))))continue;selected.push(g);if(selected.length>=maxGroups)break;}
 return {finders:finders.map(p=>({...p,thresholds:[...p.thresholds]})),groups:selected,
  diagnostics:{...diagnostics,finders:finders.length,groups:selected.length,elapsedMs:performance.now()-began,reason:selected.length?null:diagnostics.budgetSkipped?'finder-budget':'finder-triple-not-found'}};
}

// Fit photographed finder corners and centers, not outer QR GT coordinates.
// Corners are gray-template estimates; callers must still verify/score a grid.
export function finderHomography(group,dimension){
 if(!Number.isInteger(dimension)||dimension<21||dimension>177||(dimension-21)%4||group.finders?.length!==3)return null;
 const ideal=[],observed=[];
 for(const [index,[x,y]]of [[0,0],[dimension-7,0],[0,dimension-7]].entries()){
  ideal.push(point(x,y),point(x+7,y),point(x+7,y+7),point(x,y+7));observed.push(...group.finders[index].quad);
 }
 ideal.push(point(3.5,3.5),point(dimension-3.5,3.5),point(3.5,dimension-3.5));
 observed.push(...group.finders);
 const scale=Math.max(1,...observed.flatMap(p=>[Math.abs(p.x),Math.abs(p.y)])),a=Array.from({length:8},()=>new Float64Array(9));
 for(let i=0;i<ideal.length;i++){
  const x=ideal[i].x/dimension,y=ideal[i].y/dimension,u=observed[i].x/scale,v=observed[i].y/scale;
  const rows=[[x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]],weight=i>=12?2:1;
  for(const row of rows)for(let j=0;j<8;j++)for(let k=0;k<9;k++)a[j][k]+=weight*row[j]*row[k];
 }
 for(let i=0;i<8;i++){
  let pivot=i;for(let j=i+1;j<8;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
  if(Math.abs(a[pivot][i])<1e-12)return null;
  [a[i],a[pivot]]=[a[pivot],a[i]];const d=a[i][i];for(let k=i;k<9;k++)a[i][k]/=d;
  for(let j=0;j<8;j++)if(j!==i){const m=a[j][i];for(let k=i;k<9;k++)a[j][k]-=m*a[i][k];}
 }
 const h=a.map(row=>row[8]),map=(xx,yy)=>{
  const x=xx/dimension,y=yy/dimension,d=h[6]*x+h[7]*y+1;
  if(Math.abs(d)<1e-7)return point(NaN,NaN);
  return point(scale*(h[0]*x+h[1]*y+h[2])/d,scale*(h[3]*x+h[4]*y+h[5])/d);
 };
 const rms=Math.sqrt(ideal.reduce((sum,p,i)=>sum+distance(map(p.x,p.y),observed[i])**2,0)/ideal.length);
 return {map,rms,dimension};
}
