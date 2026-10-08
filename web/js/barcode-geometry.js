const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export function polygonArea(points) {
    return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;},0))/2;
}
export function intersectionArea(first,second) {
    let polygon=first;
    const sign=second.reduce((s,p,i)=>{const q=second[(i+1)%second.length];return s+p.x*q.y-p.y*q.x;},0)>=0?1:-1;
    for(let i=0;i<second.length&&polygon.length;i++) {
        const a=second[i],b=second[(i+1)%second.length],output=[];
        for(let j=0;j<polygon.length;j++) {
            const p=polygon[j],q=polygon[(j+1)%polygon.length],dp=sign*cross(a,b,p),dq=sign*cross(a,b,q);
            if(dp>=-1e-6)output.push(p);
            if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);output.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)});}
        }
        polygon=output;
    }
    return polygon.length>=3?polygonArea(polygon):0;
}
export function containsPoint(points,point) {
    const values=points.map((p,i)=>cross(p,points[(i+1)%points.length],point));
    return polygonArea(points)>0.5&&(values.every(v=>v>=-1e-6)||values.every(v=>v<=1e-6));
}
export function rotationGeometry(width,height,degrees,limit=1800) {
    const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    const scale=Math.min(1,limit/Math.max(width,height));
    const outWidth=Math.ceil(scale*(Math.abs(c)*width+Math.abs(s)*height));
    const outHeight=Math.ceil(scale*(Math.abs(s)*width+Math.abs(c)*height));
    return {angle,scale,width:outWidth,height:outHeight,
        mapPoint(p){const x=(p.x-outWidth/2)/scale,y=(p.y-outHeight/2)/scale;return{x:c*x+s*y+width/2,y:-s*x+c*y+height/2};},
        forward(p){const x=(p.x-width/2)*scale,y=(p.y-height/2)*scale;return{x:c*x-s*y+outWidth/2,y:s*x+c*y+outHeight/2};}};
}
export function rotateVariant(source,degrees) {
    const g=rotationGeometry(source.width,source.height,degrees),canvas=document.createElement('canvas');
    canvas.width=g.width;canvas.height=g.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,g.width,g.height);
    ctx.translate(g.width/2,g.height/2);ctx.rotate(g.angle);ctx.scale(g.scale,g.scale);ctx.drawImage(source,-source.width/2,-source.height/2);
    const imageData=ctx.getImageData(0,0,g.width,g.height);canvas.width=canvas.height=1;
    return {name:'rotate-'+degrees,imageData,mapPoint:g.mapPoint};
}
// Estimate the full stripe band around a decoded scan strip. This does not
// manufacture perspective corners; it follows correlated stripe transitions.
export function refineStripeRegion(code,image) {
    if(!image?.data)return code;
    const p=code.points;
    let dx=(p[1].x-p[0].x+p[2].x-p[3].x)/2,dy=(p[1].y-p[0].y+p[2].y-p[3].y)/2;
    let length=Math.hypot(dx,dy),longest=0,pair;
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){const d=Math.hypot(p[j].x-p[i].x,p[j].y-p[i].y);if(d>longest){longest=d;pair=[p[i],p[j]];}}
    if(pair&&(length<longest*.5||polygonArea(p)<longest*longest*.025)){
        dx=pair[1].x-pair[0].x;dy=pair[1].y-pair[0].y;length=longest;
    }
    if(length<20)return {...code,geometry:'scan-strip'};
    const fallback=()=>polygonArea(p)<length*length*.08?{...code,geometry:'scan-strip'}:code;
    let u={x:dx/length,y:dy/length};
    // A decoder's scan line need not be perpendicular to the printed bars.
    // Estimate their normal from the local gradient structure tensor first.
    const originalV={x:-u.y,y:u.x},stride=Math.max(1,Math.round(length/220));
    const gray=(x,y)=>{const k=(y*image.width+x)*4;return image.data[k]*.299+image.data[k+1]*.587+image.data[k+2]*.114;};
    let xx=0,xy=0,yy=0;
    for(let a=-length*.45;a<=length*.45;a+=stride)for(let b=-length*.25;b<=length*.25;b+=stride){
        const x=Math.round(code.center.x+u.x*a+originalV.x*b),y=Math.round(code.center.y+u.y*a+originalV.y*b);
        if(x<1||y<1||x>=image.width-1||y>=image.height-1)continue;
        const gx=gray(x+1,y)-gray(x-1,y),gy=gray(x,y+1)-gray(x,y-1);
        if(gx*gx+gy*gy<400)continue;xx+=gx*gx;xy+=gx*gy;yy+=gy*gy;
    }
    if(xx+yy>0&&Math.hypot(xx-yy,2*xy)/(xx+yy)>.35){
        const angle=Math.atan2(2*xy,xx-yy)/2;let candidate={x:Math.cos(angle),y:Math.sin(angle)};
        if(candidate.x*u.x+candidate.y*u.y<0)candidate={x:-candidate.x,y:-candidate.y};
        if(candidate.x*u.x+candidate.y*u.y>Math.cos(25*Math.PI/180))u=candidate;
    }
    const v={x:-u.y,y:u.x};
    const mid={x:code.center.x,y:code.center.y};
    const project=(point,axis)=>(point.x-mid.x)*axis.x+(point.y-mid.y)*axis.y;
    const left=Math.min(...p.map(q=>project(q,u))),right=Math.max(...p.map(q=>project(q,u)));
    const top=Math.min(...p.map(q=>project(q,v))),bottom=Math.max(...p.map(q=>project(q,v)));
    const n=Math.min(512,Math.max(32,Math.round(length)));
    function profile(offset) {
        const values=[];let valid=0;
        for(let i=0;i<n;i++){const a=left+(right-left)*(i+0.5)/n,x=Math.round(mid.x+u.x*a+v.x*offset),y=Math.round(mid.y+u.y*a+v.y*offset);
            if(x<0||x>=image.width||y<0||y>=image.height){values.push(255);continue;}const k=(y*image.width+x)*4;values.push(image.data[k]*.299+image.data[k+1]*.587+image.data[k+2]*.114);valid++;}
        if(valid<n*.9)return null;
        return values.slice(1).map((value,i)=>value-values[i]);
    }
    let ref=profile(0);if(!ref)return fallback();
    let energy=ref.reduce((s,a)=>s+a*a,0),seed=0;
    // A slanted scan line may cross the digits/quiet zone at its centre.
    // For a thin result, choose a nearby stronger stripe profile as reference.
    if(bottom-top<length*.08)for(const offset of [-.08,-.06,-.04,-.02,.02,.04,.06,.08]){
        const candidate=profile(offset*length);if(!candidate)continue;
        const e=candidate.reduce((s,a)=>s+a*a,0);
        if(e>energy*1.2){ref=candidate;energy=e;seed=offset*length;}
    }
    if(energy/ref.length<60)return fallback();
    function matches(offset){const row=profile(offset);if(!row)return false;const e=row.reduce((s,a)=>s+a*a,0);if(e<energy*.35)return false;
        const shift=Math.min(12,Math.ceil(n*.025));
        for(let delta=-shift;delta<=shift;delta++){let dot=0,er=0,ef=0;for(let i=shift;i<row.length-shift;i++){dot+=row[i]*ref[i+delta];er+=row[i]*row[i];ef+=ref[i+delta]*ref[i+delta];}if(dot/Math.sqrt(er*ef)>.45)return true;}return false;}
    const step=Math.max(1,length/250),limit=Math.min(length*.7,Math.max(image.width,image.height)*.5);
    function edge(sign){let last=seed,misses=0;for(let d=step;d<=limit;d+=step){if(matches(seed+sign*d)){last=seed+sign*d;misses=0;}else if(++misses>=3)break;}return last;}
    const low=edge(-1),high=edge(1);
    // Only extend when texture gives meaningful evidence; never shrink ZXing's area.
    // Do not connect a remote band to a decoded strip across a quiet gap.
    // Rotating the axis can give a thin diagonal scan strip a much larger
    // projected height. That projected envelope is not a required stripe extent.
    // Require the recovered band to reach the decoded centre, not both endpoints.
    if(high-low<Math.max(6,step*3)||low>step*3||high<-step*3)return fallback();
    const lo=Math.min(top,low-step/2),hi=Math.max(bottom,high+step/2);
    const thin=polygonArea(p)<length*length*.08;
    if(!thin&&top-lo<step&&hi-bottom<step)return code;
    // A stripe-band estimate is an oriented region, not exact perspective corners.
    const point=(a,b)=>({x:mid.x+u.x*a+v.x*b,y:mid.y+u.y*a+v.y*b});
    const points=[point(left,lo),point(right,lo),point(right,hi),point(left,hi)];
    if(!points.every(q=>q.x>=0&&q.x<=image.width&&q.y>=0&&q.y<=image.height))return fallback();
    return {...code,points,geometry:'stripe-band',center:{x:points.reduce((s,q)=>s+q.x,0)/4,y:points.reduce((s,q)=>s+q.y,0)/4}};
}
