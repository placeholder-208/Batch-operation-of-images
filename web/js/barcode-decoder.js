import { polygonArea, intersectionArea, refineStripeRegion, rotateVariant } from './barcode-geometry.js';
// Explicit names avoid differences between ZXing versions' group aliases.
export const BARCODE_FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'ITF', 'Codabar'];
export function normalizeFormat(format) {
    return String(format||'').replace(/[- _]/g,'');
}
export function readerFormats(engine=window.ZXingWASM) {
    const advertised=engine.barcodeFormats||engine.BARCODE_FORMATS;
    if(Array.isArray(advertised)&&advertised.every(value=>typeof value==='string')) {
        const supported=advertised.filter(value=>BARCODE_FORMATS.includes(normalizeFormat(value)));
        if(supported.length)return supported;
    }
    // Older builds use hyphenated retail names. Unknown names can be silently
    // ignored, so never assume the current documentation matches a local WASM.
    return ['EAN-13','EAN-8','UPC-A','UPC-E','Code128','Code39','ITF','Codabar'];
}
export function bounds(points) {
    return {left: Math.min(...points.map(p=>p.x)), top: Math.min(...points.map(p=>p.y)),
        right: Math.max(...points.map(p=>p.x)), bottom: Math.max(...points.map(p=>p.y))};
}
export function sameBarcode(a,b) {
    const identity=code=>normalizeFormat(code.format)==='UPCA'&&/^\d{12}$/.test(code.text)?'EAN13:0'+code.text:normalizeFormat(code.format)+':'+code.text;
    if(identity(a)!==identity(b))return false;
    const areaA=polygonArea(a.points),areaB=polygonArea(b.points),intersection=intersectionArea(a.points,b.points);
    if(Math.min(areaA,areaB)>1&&intersection/Math.min(areaA,areaB)>=.65)return true;
    // Compare along and across the barcode, not a radius based on its long edge.
    const p=a.points, dx=p[1].x-p[0].x, dy=p[1].y-p[0].y, length=Math.hypot(dx,dy);
    if(!length)return Math.hypot(a.center.x-b.center.x,a.center.y-b.center.y)<2;
    const ux=dx/length, uy=dy/length;
    const height=Math.abs((p[3].x-p[0].x)*(-uy)+(p[3].y-p[0].y)*ux);
    const bx=b.center.x-a.center.x, by=b.center.y-a.center.y;
    return Math.abs(bx*ux+by*uy)<=length*0.2 && Math.abs(-bx*uy+by*ux)<=Math.max(2,height*0.25);
}
export function samePhysicalRegion(a,b) {
    const areaA=polygonArea(a.points),areaB=polygonArea(b.points);
    if(Math.min(areaA,areaB)<4)return false;
    const overlap=intersectionArea(a.points,b.points);
    const span=code=>Math.max(...code.points.flatMap(p=>code.points.map(q=>Math.hypot(p.x-q.x,p.y-q.y))));
    const small=areaA<areaB?a:b;
    // A wrong symbology can be read along a thin line inside a valid barcode.
    // Do not require the thin line to cover a large fraction of the full area.
    if(Math.min(areaA,areaB)/Math.max(areaA,areaB)<.2&&
        Math.min(areaA,areaB)<span(small)**2*.08&&overlap/Math.min(areaA,areaB)>.85)return true;
    const width=code=>Math.hypot(code.points[1].x-code.points[0].x,code.points[1].y-code.points[0].y);
    const wa=width(a),wb=width(b);if(Math.min(wa,wb)/Math.max(wa,wb)<.8)return false;
    return overlap/Math.min(areaA,areaB)>.85&&overlap/Math.max(areaA,areaB)>.55;
}
export function resolveConflicts(codes) {
    const sorted=[...codes].sort((a,b)=>{
        const rank=code=>{const width=Math.hypot(code.points[1].x-code.points[0].x,code.points[1].y-code.points[0].y);
            const full=polygonArea(code.points)>width*width*.08&&code.geometry!=='scan-strip';
            return (full?10000:0)+(code.sources?.length||1)*100+(code.sources?.includes('original')?30:0)+(code.sources?.includes('contrast')?20:0);};
        return rank(b)-rank(a);
    }),kept=[];
    for(const code of sorted){const existing=kept.find(other=>samePhysicalRegion(other,code));
        if(!existing){kept.push(code);continue;}
        existing.contentConflict=true;
        existing.alternatives=[...(existing.alternatives||[]),{text:code.text,format:code.format,sources:code.sources||[code.source]}];
    }
    return kept;
}
export async function decodeBarcodes(variants, onState=()=>{}, sourceCanvas=null) {
    const decoded=[]; let succeeded=0, lastError;
    const formats=readerFormats();
    const sourceImage=sourceCanvas?.getContext('2d',{willReadFrequently:true}).getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
    async function* passes(){yield* variants;if(sourceCanvas)for(const angle of [-45,-30,-15,15,30,45])yield rotateVariant(sourceCanvas,angle);}
    let attempted=0;
    for await (const variant of passes()) {
        attempted++;
        onState('正在解码：'+variant.name);
        try {
            const results=await window.ZXingWASM.readBarcodes(variant.imageData,{formats,tryHarder:true,tryRotate:true,minLineCount:2});
            succeeded++;
            for(const result of results) {
                if(result.isValid===false || !result.position || !BARCODE_FORMATS.includes(normalizeFormat(result.format)))continue;
                const points=['topLeft','topRight','bottomRight','bottomLeft'].map(key=>({
                    x:result.position[key]?.x/(variant.scaleX||1), y:result.position[key]?.y/(variant.scaleY||1)})).map(variant.mapPoint||((p)=>p));
                if(!points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))continue;
                let entry={text:result.text||'',format:normalizeFormat(result.format),points,source:variant.name,sources:[variant.name],
                    center:{x:points.reduce((s,p)=>s+p.x,0)/4,y:points.reduce((s,p)=>s+p.y,0)/4}};
                entry=refineStripeRegion(entry,sourceImage);
                const index=decoded.findIndex(existing=>sameBarcode(existing,entry));
                if(index<0)decoded.push(entry);
                else {const sources=[...new Set([...decoded[index].sources,variant.name])];
                    if(polygonArea(entry.points)>polygonArea(decoded[index].points))decoded[index]=entry;
                    decoded[index].sources=sources;
                }
            }
        } catch(error) {lastError=error; console.warn('条形码版本解码失败',variant.name,error);}
        await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!succeeded)throw lastError||new Error('所有条形码解码版本均失败');
    // Final pass catches results that initially had narrow strips before a later
    // variant supplied a fuller region. Do not merge by payload alone.
    for(let i=0;i<decoded.length;i++)for(let j=decoded.length-1;j>i;j--)if(sameBarcode(decoded[i],decoded[j])){
        const sources=[...new Set([...decoded[i].sources,...decoded[j].sources])];
        if(polygonArea(decoded[j].points)>polygonArea(decoded[i].points))decoded[i]=decoded[j];decoded[i].sources=sources;decoded.splice(j,1);
    }
    const unique=resolveConflicts(decoded);
    const conflicts=unique.filter(code=>code.contentConflict).length;
    console.log('[条形码识别]',{revision:'barcode-v4-20261008',formats,passes:attempted,beforeConflictResolution:decoded.length,decoded:unique.length,conflicts,
        regions:unique.map(code=>({format:code.format,geometry:code.geometry||'decoder-region',points:code.points}))});
    onState('识别完成：'+unique.length+' 个'+(conflicts?'；'+conflicts+' 个内容冲突，建议核对':'')+(succeeded<attempted?'（部分版本失败）':''));
    return unique.map((code,index)=>({...code,id:index+1}));
}
export function cropBarcode(canvas,code) {
    const box=bounds(code.points), w=box.right-box.left,h=box.bottom-box.top;
    // Some linear readers return a narrow scan strip. Keep a contextual margin.
    const pad=Math.max(12,Math.max(w,h)*0.15);
    const left=Math.max(0,Math.floor(box.left-pad)),top=Math.max(0,Math.floor(box.top-pad));
    const right=Math.min(canvas.width,Math.ceil(box.right+pad)),bottom=Math.min(canvas.height,Math.ceil(box.bottom+pad));
    if(right<=left||bottom<=top)throw new Error('条形码区域超出图片范围');
    const output=document.createElement('canvas');output.width=right-left;output.height=bottom-top;
    output.getContext('2d').drawImage(canvas,left,top,output.width,output.height,0,0,output.width,output.height);
    return output;
}
