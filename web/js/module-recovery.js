import {spectrum,filterFrequency} from './blur-frequency.js';

export const MODULE_RECOVERY_LIMITS=Object.freeze({maxModels:12,maxAttempts:180,budgetMs:1000});
const sigmas=[.3,.45,.6],cutoffs=[.4,.45,.5,.55,.6];

// Work on sampled module intensities, before binarization. No payload bits or
// known finder bits are inserted. A valid decoder result is still required.
export function* iterateModuleRecovery(models,{expired=()=>false}={}){
    const seen=new Set();let count=0;
    for(const model of models){
        if(expired())return;
        const n=model.dimension;
        if(!Number.isInteger(n)||n<21||n>177||(n-21)%4||model.samples?.length!==n*n||
            !model.samples.every(Number.isFinite))continue;
        const key=[model.groupIndex,model.family,model.dimension,model.axis,model.curvature].join('/');
        if(seen.has(key))continue;
        seen.add(key);if(++count>MODULE_RECOVERY_LIMITS.maxModels)return;
        const data=new Uint8ClampedArray(n*n*4);
        for(let i=0;i<n*n;i++){
            data[i*4]=data[i*4+1]=data[i*4+2]=Math.round(255*model.samples[i]);data[i*4+3]=255;
        }
        const input=spectrum({data,width:n,height:n});
        for(const sigma of sigmas){
            if(expired())return;
            const image=filterFrequency(input,{sigma,regularization:.01});
            const samples=Float64Array.from({length:n*n},(_,i)=>image.data[i*4]/255);
            for(const cutoff of cutoffs){
                if(expired())return;
                yield {model:{...model,samples,cutoff},recovery:{sigma,regularization:.01,cutoff}};
            }
        }
    }
}
