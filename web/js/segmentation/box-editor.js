export function hitBox(point,box,toleranceX,toleranceY) {
    if(!box)return 'new';
    const [l,t,r,b]=box,nearX=x=>Math.abs(point.x-x)<=toleranceX,nearY=y=>Math.abs(point.y-y)<=toleranceY;
    for(const [name,x,y] of [['nw',l,t],['ne',r,t],['sw',l,b],['se',r,b]])if(nearX(x)&&nearY(y))return name;
    if(point.y>=t-toleranceY&&point.y<=b+toleranceY){if(nearX(l))return 'w';if(nearX(r))return 'e';}
    if(point.x>=l-toleranceX&&point.x<=r+toleranceX){if(nearY(t))return 'n';if(nearY(b))return 's';}
    return point.x>=l&&point.x<=r&&point.y>=t&&point.y<=b?'move':'new';
}
export function boxCursor(action) {
    return {new:'crosshair',move:'move',w:'ew-resize',e:'ew-resize',n:'ns-resize',s:'ns-resize',nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize'}[action]||'crosshair';
}
export function editBox(original,action,start,point,width,height) {
    const [l,t,r,b]=original,clamp=(v,a,z)=>Math.max(a,Math.min(z,v));
    if(action==='move'){
        const dx=clamp(point.x-start.x,-l,width-r),dy=clamp(point.y-start.y,-t,height-b);
        return [l+dx,t+dy,r+dx,b+dy];
    }
    if(action.length===2){
        // Opposite corner stays fixed; projection gives uniform scale without ratio drift.
        const west=action.includes('w'),north=action.includes('n'),ax=west?r:l,ay=north?b:t;
        const vx=(west?-1:1)*(r-l),vy=(north?-1:1)*(b-t);
        const scale=((point.x-ax)*vx+(point.y-ay)*vy)/(vx*vx+vy*vy);
        const maximum=Math.min((west?ax:width-ax)/Math.abs(vx),(north?ay:height-ay)/Math.abs(vy));
        const minimum=Math.min(maximum,Math.max(2/Math.abs(vx),2/Math.abs(vy)));
        const factor=clamp(scale,minimum,maximum),x=ax+vx*factor,y=ay+vy*factor;
        return [Math.min(ax,x),Math.min(ay,y),Math.max(ax,x),Math.max(ay,y)];
    }
    if(action==='w')return [clamp(point.x,0,r-2),t,r,b];
    if(action==='e')return [l,t,clamp(point.x,l+2,width),b];
    if(action==='n')return [l,clamp(point.y,0,b-2),r,b];
    if(action==='s')return [l,t,r,clamp(point.y,t+2,height)];
    return [...original];
}
