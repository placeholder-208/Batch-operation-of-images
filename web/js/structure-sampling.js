// Calibrate observed intensities using mandatory QR structure, without writing
// expected structure or payload bits into the sampled module matrix.
export const STRUCTURE_SAMPLING_LIMITS=Object.freeze({maxModels:12,maxAttempts:48,budgetMs:1000});
const cutoffs=[.5,.6,.7,.75];
function at(gray,width,height,p){
    if(!Number.isFinite(p.x+p.y)||p.x<0||p.y<0||p.x>width-1||p.y>height-1)return NaN;
    const x=Math.floor(p.x),y=Math.floor(p.y),xx=Math.min(x+1,width-1),yy=Math.min(y+1,height-1),fx=p.x-x,fy=p.y-y;
    return (1-fy)*((1-fx)*gray[y*width+x]+fx*gray[y*width+xx])+fy*((1-fx)*gray[yy*width+x]+fx*gray[yy*width+xx]);
}
export function fitStructureLevels(model,gray,width,height){
    const n=model.dimension;
    if(!Number.isInteger(n)||n<21||n>177||(n-21)%4||gray.length!==width*height||typeof model.map!=='function')return null;
    const groups=[];
    for(const [left,top]of [[0,0],[n-7,0],[0,n-7]]){
        const cells=[];
        for(let y=0;y<7;y++)for(let x=0;x<7;x++)cells.push({x:left+x+.5,y:top+y+.5,dark:Math.max(Math.abs(x-3),Math.abs(y-3))!==2});
        groups.push(cells);
    }
    const timing=[];
    for(let k=8;k<n-8;k++)timing.push({x:k+.5,y:6.5,dark:k%2===0},{x:6.5,y:k+.5,dark:k%2===0});
    groups.push(timing);
    const fit=rows=>{
        let black=0,white=0,bn=0,wn=0;
        for(const [value,dark]of rows){
            if(!Number.isFinite(value))return null;
            if(dark){black+=value;bn++;}else{white+=value;wn++;}
        }
        if(!bn||!wn)return null;
        black/=bn;white/=wn;const gap=white-black;if(gap<=8)return null;
        const residual=rows.reduce((sum,[v,dark])=>sum+(v-(dark?black:white))**2,0)/rows.length;
        return {black,white,gap,score:gap*gap/(gap*gap+4*residual+1)};
    };
    const all=[],scores=[];
    for(const group of groups){
        const rows=group.map(cell=>[at(gray,width,height,model.map(cell.x,cell.y)),cell.dark]);
        const calibration=fit(rows);if(!calibration)return null;
        all.push(...rows);scores.push(calibration.score);
    }
    const calibration=fit(all);if(!calibration)return null;
    return {...calibration,score:(scores[0]+scores[1]+scores[2]+2*scores[3])/5};
}
export function* iterateStructureSampling(models,gray,width,height,{expired=()=>false}={}){
    const seen=new Set();let count=0;
    for(const model of models){
        if(expired())return;
        const key=[model.groupIndex,model.family,model.dimension,model.axis,model.curvature].join('/');
        if(seen.has(key))continue;
        seen.add(key);if(++count>STRUCTURE_SAMPLING_LIMITS.maxModels)return;
        const calibration=fitStructureLevels(model,gray,width,height);if(!calibration)continue;
        const n=model.dimension,samples=new Float64Array(n*n);let valid=true;
        for(let y=0;y<n&&valid;y++)for(let x=0;x<n;x++){
            const value=at(gray,width,height,model.map(x+.5,y+.5));
            if(!Number.isFinite(value)){valid=false;break;}
            samples[y*n+x]=(value-calibration.black)/calibration.gap;
        }
        if(!valid)continue;
        for(const cutoff of cutoffs){
            if(expired())return;
            yield {model:{...model,samples,cutoff},calibration:{...calibration,cutoff}};
        }
    }
}
