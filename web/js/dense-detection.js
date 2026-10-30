import {detectWechatRegions} from './wechat-detector.js';
import {report} from './runtime-status.js';
export const DENSE_DETECTION_LIMITS=Object.freeze({maxEdge:1024,budgetMs:6000,maxCandidates:64});

// Dense sheets can shrink each symbol below the detector's useful input scale.
// Leave sparse photos on exactly the original path.
export function needsDenseDetection(codes,regions,width,height){
 return codes.length>=8&&regions.length<codes.length*.75&&width>=600&&height>=600;
}
export function denseTiles(width,height){
 const wide=width>height,nx=wide?3:2,ny=wide?2:3,w=Math.ceil(width*(wide?.4:.6)),h=Math.ceil(height*(wide?.6:.4));
 return Array.from({length:nx*ny},(_,i)=>({left:Math.round((i%nx)*(width-w)/(nx-1)),top:Math.round(Math.floor(i/nx)*(height-h)/(ny-1)),width:w,height:h}));
}
export function mergeDenseRegions(regions,protectedCount=0){
 const result=regions.slice(0,protectedCount);
 if(protectedCount>=DENSE_DETECTION_LIMITS.maxCandidates)return result;
 for(const box of regions.slice(protectedCount).sort((a,b)=>b.score-a.score)){
  if(![box.x,box.y,box.right,box.bottom].every(Number.isFinite)||box.right<=box.x||box.bottom<=box.y)continue;
  const area=(box.right-box.x)*(box.bottom-box.y);
  if(result.some(other=>{
   const intersect=Math.max(0,Math.min(box.right,other.right)-Math.max(box.x,other.x))*Math.max(0,Math.min(box.bottom,other.bottom)-Math.max(box.y,other.y));
   const otherArea=(other.right-other.x)*(other.bottom-other.y);
   return intersect/(area+otherArea-intersect)>=.5;
  }))continue;
  result.push(box);if(result.length>=Math.max(protectedCount,DENSE_DETECTION_LIMITS.maxCandidates))break;
 }
 return result;
}
export async function supplementDenseDetection(canvas,codes,regions,trace){
 if(!needsDenseDetection(codes,regions,canvas.width,canvas.height))return regions;
 const stats={status:'pending',initialCandidates:regions.length,tiles:[],addedCandidates:0};
 if(trace)trace.record.denseDetection=stats;
 const all=[...regions],begin=performance.now();
 for(const [index,tile] of denseTiles(canvas.width,canvas.height).entries()){
  const item={id:index+1,...tile,status:'pending'};stats.tiles.push(item);
  if(performance.now()-begin>DENSE_DETECTION_LIMITS.budgetMs){Object.assign(item,{status:'skipped',reason:'dense-detection-budget'});continue;}
  const scale=Math.min(1,DENSE_DETECTION_LIMITS.maxEdge/Math.max(tile.width,tile.height)),target=document.createElement('canvas');
  target.width=Math.max(1,Math.round(tile.width*scale));target.height=Math.max(1,Math.round(tile.height*scale));
  try{
   target.getContext('2d').drawImage(canvas,tile.left,tile.top,tile.width,tile.height,0,0,target.width,target.height);
   const localTrace=trace?{record:{},start:(name,metadata)=>trace.start('dense_'+name,{...metadata,tileId:index+1})}:null;
   const found=await detectWechatRegions(target,localTrace);
   const sx=tile.width/target.width,sy=tile.height/target.height;
   all.push(...found.map(box=>({...box,x:box.x*sx+tile.left,right:box.right*sx+tile.left,y:box.y*sy+tile.top,bottom:box.bottom*sy+tile.top,proposalSource:'dense-tile'})));
   Object.assign(item,{status:'ok',candidates:found.length,analysisWidth:target.width,analysisHeight:target.height});
  }catch(error){Object.assign(item,{status:'error',error:error.message||String(error)});}
  finally{target.width=target.height=1;}
 }
 const merged=mergeDenseRegions(all,regions.length);stats.addedCandidates=merged.length-regions.length;
 stats.candidateLimit=DENSE_DETECTION_LIMITS.maxCandidates;stats.rawCandidates=all.length;
 stats.candidateLimitReached=merged.length>=DENSE_DETECTION_LIMITS.maxCandidates;
 if(stats.candidateLimitReached)stats.selectionReason='dense-candidate-budget';
 stats.status=stats.tiles.some(t=>t.status==='error')?'partial':stats.tiles.some(t=>t.status==='skipped')?'skipped':'ok';stats.elapsedMs=performance.now()-begin;
 report('wechat','整图候选 '+regions.length+' 个 · 密集补检后 '+merged.length+' 个',stats.status==='ok'?'ready':'error');
 return merged;
}
