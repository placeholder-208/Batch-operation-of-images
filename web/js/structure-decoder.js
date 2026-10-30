import {analyzeCurvedImage,renderCurvedModel} from './curved-region.js';
import {iterateStructureSampling,STRUCTURE_SAMPLING_LIMITS} from './structure-sampling.js';
import {readBarcodes} from './reader-client.js';
import {measureQR,measureQRSync} from './qr-statistics.js';

export const STRUCTURE_DECODER_LIMITS=Object.freeze({baseEdge:384,maxEdge:448,maxRegions:3,maxModels:12,
    regionMs:2500,imageMs:7500,geometryMs:600,maxAttempts:96});
export async function decodeStructureRegion(sourceCanvas,crop,{trace,regionId,statistics={},
    budgetMs=STRUCTURE_DECODER_LIMITS.regionMs,accept=()=>true}={}){
    const began=performance.now(),decoded=[];let canvas,samplingBegan=null,limited=false;
    Object.assign(statistics,{status:'pending',reason:null,attempted:0,decoded:0,calibrations:[],tiers:[]});
    const expired=()=>performance.now()-began>=budgetMs||
        samplingBegan!==null&&performance.now()-samplingBegan>=STRUCTURE_SAMPLING_LIMITS.budgetMs;
    const skip=()=>Object.assign(statistics,{status:'skipped',reason:'structure-sampling-budget'});
    try{
        if(expired()){skip();return decoded;}
        canvas=document.createElement('canvas');
        const nativeEdge=Math.max(crop.width,crop.height);let previousEdge=0;
        for(const edge of [STRUCTURE_DECODER_LIMITS.baseEdge,STRUCTURE_DECODER_LIMITS.maxEdge]){
            const actualEdge=Math.min(nativeEdge,edge);if(actualEdge<=previousEdge)continue;
            previousEdge=actualEdge;samplingBegan=null;
            if(expired()){skip();return decoded;}
            const tier={edge,actualEdge,attempted:0};statistics.tiers.push(tier);
            const scale=Math.min(1,edge/nativeEdge);
            canvas.width=Math.max(1,Math.round(crop.width*scale));canvas.height=Math.max(1,Math.round(crop.height*scale));
            const context=canvas.getContext('2d',{willReadFrequently:true});
            const image=measureQRSync(trace,'structure_prepare',{regionId,edge},()=>{
                context.drawImage(sourceCanvas,crop.left,crop.top,crop.width,crop.height,0,0,canvas.width,canvas.height);
                return context.getImageData(0,0,canvas.width,canvas.height);
            });
            const analysis=await measureQR(trace,'structure_geometry',{regionId,edge},()=>analyzeCurvedImage(image,{
                maxModels:STRUCTURE_DECODER_LIMITS.maxModels,
                geometryMs:Math.min(STRUCTURE_DECODER_LIMITS.geometryMs,Math.max(1,budgetMs-(performance.now()-began)))
            }));
            statistics.geometry=analysis.diagnostics;tier.geometry=analysis.diagnostics;
            if(expired()){skip();return decoded;}
            if(!analysis.models.length){
                const geometryLimited=analysis.diagnostics.reason==='geometry-budget-reached'||analysis.diagnostics.groupBudgetLimited>0;
                limited||=geometryLimited;
                Object.assign(tier,{status:geometryLimited?'skipped':'undecoded',reason:geometryLimited?'structure-sampling-budget':analysis.diagnostics.reason||'no-accepted-model'});
                continue;
            }
            const gray=measureQRSync(trace,'structure_prepare',{regionId,edge,step:'gray'},()=>Float64Array.from({length:image.width*image.height},(_,i)=>{
                const p=i*4,a=image.data[p+3]/255;
                return a*(.299*image.data[p]+.587*image.data[p+1]+.114*image.data[p+2])+255*(1-a);
            }));
            samplingBegan=performance.now();
            const iterator=iterateStructureSampling(analysis.models,gray,image.width,image.height,{expired});
            try{
                while(true){
                    const next=measureQRSync(trace,'structure_sample',{regionId,edge},()=>iterator.next());
                    if(next.done)break;
                    const {model,calibration}=next.value;
                    const selection={dimension:model.dimension,axis:model.axis,curvature:model.curvature,
                        groupIndex:model.groupIndex,edge,...calibration};
                    statistics.calibrations.push(selection);
                    const rendered=measureQRSync(trace,'structure_sample',{regionId,edge,step:'render'},()=>renderCurvedModel(model));
                    const raw=await measureQR(trace,'structure_decode',{regionId,edge,selection},()=>readBarcodes(
                        new ImageData(rendered.data,rendered.width,rendered.height),{formats:['QRCode'],tryHarder:true}));
                    statistics.attempted++;tier.attempted++;
                    const found=raw.filter(r=>r.isValid!==false&&r.text&&r.position).map(r=>{
                        const points=[r.position.topLeft,r.position.topRight,r.position.bottomRight,r.position.bottomLeft]
                            .map(p=>model.map(p.x/8-4,p.y/8-4))
                            .map(p=>({x:crop.left+p.x*crop.width/canvas.width,y:crop.top+p.y*crop.height/canvas.height}));
                        return {text:r.text,format:r.format||'QRCode',points,source:'wechat-structure-gray',
                            center:{x:points.reduce((s,p)=>s+p.x,0)/4,y:points.reduce((s,p)=>s+p.y,0)/4}};
                    }).filter(r=>r.points.every(p=>Number.isFinite(p.x+p.y)));
                    decoded.push(...found);statistics.decoded=decoded.length;
                    if(found.length&&accept(found)){
                        Object.assign(statistics,{status:'decoded',reason:null,selected:selection});tier.status='decoded';return decoded;
                    }
                    await new Promise(resolve=>setTimeout(resolve,0));
                }
            }finally{iterator.return?.();}
            if(expired()){
                Object.assign(tier,{status:'skipped',reason:'structure-sampling-budget'});limited=true;
                if(performance.now()-began>=budgetMs){skip();return decoded;}
            }else Object.assign(tier,{status:'undecoded',reason:'structure-sampling-undecodable'});
        }
        if(limited)skip();
        else Object.assign(statistics,{status:'undecoded',reason:'structure-sampling-undecodable'});
        return decoded;
    }catch(error){
        Object.assign(statistics,{status:'error',reason:'runtime-error',error:error.message||String(error)});throw error;
    }finally{
        if(canvas)canvas.width=canvas.height=1;
        statistics.elapsedMs=Math.round(performance.now()-began);
    }
}
