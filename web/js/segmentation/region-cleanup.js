// 8-connected components of visible alpha pixels. Area is measured on the working mask.
export function findSmallRegions(alpha,width,height,minPercent){
 if(alpha.length!==width*height||width<1||height<1||!Number.isFinite(minPercent)||minPercent<0||minPercent>100)throw new Error('区域面积阈值须为 0～100%');
 const count=alpha.length,seen=new Uint8Array(count),removed=new Uint8Array(count),queue=new Uint32Array(count);
 let regions=0,removedRegions=0,removedPixels=0;
 const cutoff=count*minPercent/100;
 for(let start=0;start<count;start++){
  if(seen[start]||!(alpha[start]>=1/255))continue;
  let head=0,tail=1;queue[0]=start;seen[start]=1;
  while(head<tail){
   const index=queue[head++],x=index%width,y=Math.floor(index/width);
   for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){
    const next=yy*width+xx;if(seen[next]||!(alpha[next]>=1/255))continue;
    seen[next]=1;queue[tail++]=next;
   }
  }
  regions++;
  if(tail<cutoff){removedRegions++;removedPixels+=tail;for(let i=0;i<tail;i++)removed[queue[i]]=1;}
 }
 return {removed,regions,removedRegions,removedPixels,minPercent};
}
export function applyRegionRemoval(alpha,width,height,removal,mw,mh){
 if(alpha.length!==width*height||removal.length!==mw*mh)throw new Error('清理蒙版尺寸无效');
 for(let y=0;y<height;y++){
  const my=Math.min(mh-1,Math.floor((y+.5)*mh/height));
  for(let x=0;x<width;x++)if(removal[my*mw+Math.min(mw-1,Math.floor((x+.5)*mw/width))])alpha[y*width+x]=0;
 }
 return alpha;
}
