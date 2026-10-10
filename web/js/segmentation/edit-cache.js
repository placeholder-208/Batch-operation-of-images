import {paintStrokes} from './postprocess.js';
import {applyRegionRemoval} from './region-cleanup.js';

// Preview only. Export still replays the complete ledger at original resolution.
export function createEditCache(){
 let key=null,alpha=null,previous=[];
 return {
  update(base,width,height,cropWidth,cropHeight,strokes,cleanup){
   const actions=cleanup?[...strokes.filter(s=>s.editId<=cleanup.throughEditId),cleanup,...strokes.filter(s=>s.editId>cleanup.throughEditId)]:strokes;
   let rebuild=key!==base||!alpha||actions.length<previous.length;
   for(let i=0;i<previous.length&&!rebuild;i++){
    const old=previous[i],action=actions[i];
    if(action!==old.action||action.points?.length<old.length||action.points?.length!==old.length&&i!==previous.length-1)rebuild=true;
   }
   let dirty=null;
   const include=stroke=>{
    const xs=stroke.points.map(p=>p.x),ys=stroke.points.map(p=>p.y),r=stroke.radius||0,sx=width/cropWidth,sy=height/cropHeight;
    const b=[Math.max(0,Math.floor((Math.min(...xs)-r)*sx)-2),Math.max(0,Math.floor((Math.min(...ys)-r)*sy)-2),Math.min(width,Math.ceil((Math.max(...xs)+r)*sx)+2),Math.min(height,Math.ceil((Math.max(...ys)+r)*sy)+2)];
    dirty=dirty?[Math.min(dirty[0],b[0]),Math.min(dirty[1],b[1]),Math.max(dirty[2],b[2]),Math.max(dirty[3],b[3])]:b;
   };
   if(rebuild){key=base;alpha=base.slice();previous=[];dirty=[0,0,width,height];}
   for(let i=0;i<actions.length;i++){
    const action=actions[i],old=previous[i];
    if(action===cleanup){if(!old){applyRegionRemoval(alpha,width,height,cleanup.removed,width,height);dirty=[0,0,width,height];}continue;}
    if(old&&old.length===action.points.length)continue;
    const added=old&&action.type!=='polygon'?{...action,points:action.points.slice(Math.max(0,old.length-1))}:action;
    paintStrokes(alpha,width,height,cropWidth,cropHeight,[added]);include(added);
   }
   previous=actions.map(action=>({action,length:action.points?.length}));
   return {alpha,dirty};
  },
  clear(){key=null;alpha=null;previous=[];}
 };
}
