export function normalizedBox(a,b,width,height) {
    const box=[Math.max(0,Math.min(a.x,b.x)),Math.max(0,Math.min(a.y,b.y)),Math.min(width,Math.max(a.x,b.x)),Math.min(height,Math.max(a.y,b.y))];
    return box[2]-box[0]>=2 && box[3]-box[1]>=2 ? box : null;
}
export function binaryMask(logits,threshold=0,invert=false) {
    const mask=new Uint8Array(logits.length);
    for(let i=0;i<logits.length;i++){
        if(!Number.isFinite(logits[i]))continue;
        const foreground=logits[i]>threshold;
        mask[i]=(invert?!foreground:foreground)?1:0;
    }
    return mask;
}
export function maskBounds(mask,width,height) {
    if(mask.length!==width*height)throw new Error('蒙版尺寸不匹配');
    let left=width,top=height,right=0,bottom=0,count=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);count++;}
    return count?{left,top,right,bottom,count}:null;
}
export function clipMaskToBox(mask,width,height,box,sourceWidth,sourceHeight) {
    if(mask.length!==width*height||!box||sourceWidth<=0||sourceHeight<=0)throw new Error('框选蒙版尺寸不匹配');
    const sx=sourceWidth/width,sy=sourceHeight/height;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const px=(x+.5)*sx,py=(y+.5)*sy;
        if(px<box[0]||px>=box[2]||py<box[1]||py>=box[3])mask[y*width+x]=0;
    }
    return mask;
}
export function candidateOrder(scores) {
    return Array.from(scores,(score,index)=>({score:Number.isFinite(score)?score:null,index})).sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity));
}
export function applyMaskRGBA(rgba,width,height,mask,maskWidth,maskHeight) {
    if(rgba.length!==width*height*4||mask.length!==maskWidth*maskHeight)throw new Error('像素数据尺寸不匹配');
    // Nearest neighbour scaling preserves binary foreground/background, including holes.
    for(let y=0;y<height;y++){const my=Math.min(maskHeight-1,Math.floor((y+.5)*maskHeight/height));
        for(let x=0;x<width;x++){const mx=Math.min(maskWidth-1,Math.floor((x+.5)*maskWidth/width));
            if(!mask[my*maskWidth+mx]){const p=(y*width+x)*4;rgba[p]=rgba[p+1]=rgba[p+2]=rgba[p+3]=0;}}}
    return rgba;
}
export function boxPrompt(box,points,scaleX,scaleY) {
    if(box&&(box.length!==4||box[2]<=box[0]||box[3]<=box[1]))throw new Error('目标提示框无效');
    if(!box&&!points.some(point=>point.label===1))throw new Error('请添加蓝色目标提示框或绿色保留点');
    // SAM ONNX encodes box corners as point labels 2 (top-left) and 3 (bottom-right).
    const coords=box?[[box[0]*scaleX,box[1]*scaleY],[box[2]*scaleX,box[3]*scaleY]]:[],labels=box?[2,3]:[];
    for(const point of points){coords.push([point.x*scaleX,point.y*scaleY]);labels.push(point.label);}
    return {coords,labels};
}
export function cropRelativePrompts(crop,box,points) {
    return {box:box?[box[0]-crop[0],box[1]-crop[1],box[2]-crop[0],box[3]-crop[1]]:null,
        points:points.filter(p=>p.x>=crop[0]&&p.x<crop[2]&&p.y>=crop[1]&&p.y<crop[3]).map(p=>({...p,x:p.x-crop[0],y:p.y-crop[1]}))};
}
export function intersectBox(box,crop) {
    if(!box)return null;
    const next=[Math.max(box[0],crop[0]),Math.max(box[1],crop[1]),Math.min(box[2],crop[2]),Math.min(box[3],crop[3])];
    return next[2]-next[0]>=2&&next[3]-next[1]>=2?next:null;
}
