import { interpolatedAlpha } from './postprocess.js';

// Actual opacity is kept distinct from SAM logits, including in old caches.
export function resizeAlphaBilinear(source, sw, sh, dw, dh) {
    for (const [w,h] of [[sw,sh],[dw,dh]]) if (!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||!Number.isSafeInteger(w*h)) throw new Error('透明度尺寸无效');
    if (source?.length!==sw*sh) throw new Error('透明度数据长度无效');
    for (const value of source) if (!Number.isFinite(value)||value<0||value>1) throw new Error('透明度数据无效');
    const output=new Float32Array(dw*dh);
    for(let y=0;y<dh;y++){
        const sy=Math.max(0,Math.min(sh-1,(y+.5)*sh/dh-.5)),y0=Math.floor(sy),y1=Math.min(sh-1,y0+1),fy=sy-y0;
        for(let x=0;x<dw;x++){
            const sx=Math.max(0,Math.min(sw-1,(x+.5)*sw/dw-.5)),x0=Math.floor(sx),x1=Math.min(sw-1,x0+1),fx=sx-x0;
            const top=source[y0*sw+x0]*(1-fx)+source[y0*sw+x1]*fx,bottom=source[y1*sw+x0]*(1-fx)+source[y1*sw+x1]*fx;
            output[y*dw+x]=top*(1-fy)+bottom*fy;
        }
    }
    return output;
}
export function normalizeModelAlpha(values) {
    let min=Infinity,max=-Infinity,rounded=0;
    const alpha=Float32Array.from(values,value=>{
        if(!Number.isFinite(value)||value < -1e-5||value > 1+1e-5) throw new Error('人物模型返回了无效透明度');
        min=Math.min(min,value);max=Math.max(max,value);if(value<0||value>1)rounded++;
        return Math.max(0,Math.min(1,value));
    });
    return {alpha,range:{min,max,rounded}};
}
export function maskAlpha(result,candidate,width,height,{threshold=0,invert=false,smooth=true}={}){
    if(result.valueType==='alpha'){
        const alpha=resizeAlphaBilinear(candidate.logits,result.width,result.height,width,height);
        if(invert)for(let i=0;i<alpha.length;i++)alpha[i]=1-alpha[i];
        return alpha;
    }
    // `logits` is retained as the float-buffer field for backwards-compatible
    // compressed caches. valueType, not the field name, determines semantics.
    return interpolatedAlpha(candidate.logits,result.width,result.height,width,height,threshold,invert,smooth);
}
