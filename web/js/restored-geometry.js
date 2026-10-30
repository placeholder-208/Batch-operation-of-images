import {spectrum,filterFrequency} from './blur-frequency.js';
import {restorationFilters} from './blur-restoration.js';
import {analyzeCurvedImage,decodeCurvedRegion} from './curved-region.js';
import {measureQR,measureQRSync} from './qr-statistics.js';

export const RESTORED_GEOMETRY_LIMITS=Object.freeze({maxEdge:384,maxRegions:3,maxCandidates:4,
    budgetMs:7000,imageBudgetMs:14000,probeMs:200,geometryMs:600});

// Fit the known 7x7 finder pattern, not the unknown payload. This is a ranking
// score for restoration attempts, never a probability or a decoding decision.
export function finderQuality(image,diagnostics){
    const finders=diagnostics?.finders,module=diagnostics?.moduleSize;
    if(finders?.length!==3||!(module>0)||!Number.isFinite(module)||
        !finders.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return 0;
    const [origin,right,bottom]=finders;
    const ax=right.x-origin.x,ay=right.y-origin.y,bx=bottom.x-origin.x,by=bottom.y-origin.y;
    const al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
    if(!(al>0&&bl>0)||Math.abs(ax*by-ay*bx)<1)return 0;
    const sample=(x,y)=>{
        if(x<0||y<0||x>=image.width-1||y>=image.height-1)return NaN;
        const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
        const get=(dx,dy)=>image.data[((iy+dy)*image.width+ix+dx)*4];
        return (1-ty)*((1-tx)*get(0,0)+tx*get(1,0))+ty*((1-tx)*get(0,1)+tx*get(1,1));
    };
    let total=0;
    for(const center of finders){
        let best=0;
        for(const scale of [.9,1,1.1]){
            const values=[];let black=0,white=0,blackCount=0,whiteCount=0;
            for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
                const value=sample(center.x+module*scale*(x*ax/al+y*bx/bl),center.y+module*scale*(x*ay/al+y*by/bl));
                if(!Number.isFinite(value))continue;
                const dark=Math.max(Math.abs(x),Math.abs(y))!==2;
                values.push([value,dark]);
                if(dark){black+=value;blackCount++;}else{white+=value;whiteCount++;}
            }
            if(blackCount<30||whiteCount<12)continue;
            black/=blackCount;white/=whiteCount;
            const gap=white-black;
            if(gap<=0)continue;
            const residual=values.reduce((sum,[value,dark])=>sum+(value-(dark?black:white))**2,0)/values.length;
            best=Math.max(best,gap*gap/(gap*gap+residual+1));
        }
        if(best===0)return 0;
        total+=best;
    }
    return total/3;
}

export async function decodeRestoredGeometry(sourceCanvas,crop,{trace,regionId,statistics={},
    budgetMs=RESTORED_GEOMETRY_LIMITS.budgetMs,accept=()=>true}={}){
    const began=performance.now(),decoded=[],candidates=[];
    const detailTrace=trace?{start:(name,metadata)=>trace.start('restored_'+name,{...metadata,regionId})}:null;
    let canvas;
    Object.assign(statistics,{status:'pending',reason:null,filtersAttempted:0,probed:0,attempted:0,decoded:0,candidates:[],probes:[]});
    const expired=()=>performance.now()-began>=budgetMs;
    const skipped=()=>Object.assign(statistics,{status:'skipped',reason:'restored-geometry-budget'});
    try{
        if(expired()){skipped();return decoded;}
        const edge=Math.max(crop.width,crop.height),scale=Math.min(1,RESTORED_GEOMETRY_LIMITS.maxEdge/edge);
        canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(crop.width*scale));canvas.height=Math.max(1,Math.round(crop.height*scale));
        const context=canvas.getContext('2d',{willReadFrequently:true});
        const image=measureQRSync(trace,'restored_geometry_prepare',{regionId},()=>{
            context.drawImage(sourceCanvas,crop.left,crop.top,crop.width,crop.height,0,0,canvas.width,canvas.height);
            return context.getImageData(0,0,canvas.width,canvas.height);
        });
        const input=measureQRSync(trace,'restored_geometry_prepare',{regionId,step:'fft'},()=>spectrum(image));
        // Finish the bounded selection before fitting any new surface models.
        for(const config of restorationFilters()){
            if(expired()){skipped();break;}
            const restored=measureQRSync(trace,'restored_geometry_restore',{regionId,config},()=>filterFrequency(input,config));
            statistics.filtersAttempted++;
            const probe=await measureQR(trace,'restored_geometry_probe',{regionId,config},()=>analyzeCurvedImage(restored,{
                probeOnly:true,geometryMs:Math.min(RESTORED_GEOMETRY_LIMITS.probeMs,Math.max(1,budgetMs-(performance.now()-began)))
            }));
            statistics.probed++;
            statistics.probes.push({config,reason:probe.diagnostics.reason||null,
                elapsedMs:probe.diagnostics.elapsedMs,finders:probe.diagnostics.finders.length});
            const quality=finderQuality(restored,probe.diagnostics);
            if(quality>0){
                candidates.push({image:restored,config,quality});
                candidates.sort((a,b)=>b.quality-a.quality);
                if(candidates.length>RESTORED_GEOMETRY_LIMITS.maxCandidates)candidates.pop();
            }
            await new Promise(resolve=>setTimeout(resolve,0));
        }
        statistics.candidates=candidates.map(({config,quality})=>({config,quality}));
        for(const candidate of candidates){
            if(expired()){skipped();return decoded;}
            context.putImageData(candidate.image,0,0);
            const detail={config:candidate.config,quality:candidate.quality,geometry:{}};
            (statistics.trials??=[]).push(detail);statistics.attempted++;
            const found=await measureQR(trace,'restored_geometry_fit',{regionId,config:candidate.config,parent:true},()=>decodeCurvedRegion(canvas,{
                continuousResample:true,moduleRecovery:true,maxModels:12,
                geometryMs:Math.min(RESTORED_GEOMETRY_LIMITS.geometryMs,Math.max(1,budgetMs-(performance.now()-began))),
                statistics:detail.geometry,trace:detailTrace,regionId
            }));
            const mapped=found.map(result=>{
                const points=result.points.map(p=>({x:crop.left+p.x*crop.width/canvas.width,y:crop.top+p.y*crop.height/canvas.height}));
                return {...result,source:'wechat-restored-geometry',points,
                    center:{x:points.reduce((sum,p)=>sum+p.x,0)/4,y:points.reduce((sum,p)=>sum+p.y,0)/4}};
            }).filter(result=>result.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
            decoded.push(...mapped);statistics.decoded=decoded.length;
            if(mapped.length&&accept(mapped)){
                Object.assign(statistics,{status:'decoded',reason:null,selectedFilter:candidate.config});return decoded;
            }
        }
        if(statistics.status!=='skipped')Object.assign(statistics,{status:'undecoded',reason:candidates.length?'restored-geometry-undecodable':'restored-finders-not-found'});
        return decoded;
    }catch(error){
        Object.assign(statistics,{status:'error',reason:'runtime-error',error:error.message||String(error)});throw error;
    }finally{
        if(canvas)canvas.width=canvas.height=1;
        statistics.elapsedMs=Math.round(performance.now()-began);
    }
}
