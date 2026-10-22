import {readBarcodes,getReaderBackend} from './reader-client.js';
import { measureQR, measureQRSync } from './qr-statistics.js';
import { report } from "./runtime-status.js";
import { detectWechatRegions } from "./wechat-detector.js";
import { decodeCurvedRegion, analyzeCurvedImage } from "./curved-region.js";
import { iterateBackgroundVariants } from './preprocess-client.js';

async function cropRegion(sourceCanvas, region) {
    const width = region.right - region.x;
    const height = region.bottom - region.y;
    if (![width, height, region.x, region.y].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    const probeLeft = Math.max(0, Math.floor(region.x));
    const probeTop = Math.max(0, Math.floor(region.y));
    const probeRight = Math.min(sourceCanvas.width, Math.ceil(region.right));
    const probeBottom = Math.min(sourceCanvas.height, Math.ceil(region.bottom));
    const probeWidth = probeRight - probeLeft, probeHeight = probeBottom - probeTop;
    if (probeWidth <= 0 || probeHeight <= 0) return null;
    const probeScale = Math.min(1, Math.sqrt(90000 / (probeWidth * probeHeight)));
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = Math.max(1, Math.floor(probeWidth * probeScale));
    probeCanvas.height = Math.max(1, Math.floor(probeHeight * probeScale));
    const probeContext = probeCanvas.getContext('2d', {willReadFrequently: true});
    probeContext.drawImage(sourceCanvas, probeLeft, probeTop, probeWidth, probeHeight,
        0, 0, probeCanvas.width, probeCanvas.height);
    const probe = await analyzeCurvedImage(probeContext.getImageData(0, 0, probeCanvas.width, probeCanvas.height), {
        maxPixels: 90000, geometryMs: 150, probeOnly: true
    });
    let moduleSizeHint = probe.diagnostics.moduleSize /
        Math.sqrt((probeCanvas.width / probeWidth) * (probeCanvas.height / probeHeight));
    if (!Number.isFinite(moduleSizeHint) || moduleSizeHint < 0.75 || moduleSizeHint > Math.min(width, height) / 7) moduleSizeHint = null;
    // 对旋转的方块也预留四模块边距；无法估计时显式退回百分比边距。
    const paddingX = moduleSizeHint ? Math.max(2, 4 * Math.SQRT2 * moduleSizeHint) : width * 0.20;
    const paddingY = moduleSizeHint ? Math.max(2, 4 * Math.SQRT2 * moduleSizeHint) : height * 0.20;
    const left = Math.max(0, Math.floor(region.x - paddingX));
    const top = Math.max(0, Math.floor(region.y - paddingY));
    const right = Math.min(sourceCanvas.width, Math.ceil(region.right + paddingX));
    const bottom = Math.min(sourceCanvas.height, Math.ceil(region.bottom + paddingY));
    if (right <= left || bottom <= top) return null;
    const canvas = document.createElement("canvas");
    canvas.width = right - left;
    canvas.height = bottom - top;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(
        sourceCanvas, left, top, canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height
    );
    return { canvas, left, top, moduleSizeHint, paddingMode: moduleSizeHint ? 'modules' : 'percentage-fallback' };
}

function translateResult(result, left, top) {
    const points = result.points.map(p => ({ x: p.x + left, y: p.y + top }));
    return {
        ...result,
        points,
        center: {
            x: points.reduce((sum, p) => sum + p.x, 0) / 4,
            y: points.reduce((sum, p) => sum + p.y, 0) / 4
        }
    };
}

// 保守地匹配已有二维码；不使用文本匹配，以保留同内容的不同实体。
export function isRegionCovered(region, qr) {
    if (!qr.points || qr.points.length !== 4) return false;
    const xs = qr.points.map(p => p.x), ys = qr.points.map(p => p.y);
    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    const rw = region.right - region.x, rh = region.bottom - region.y;
    const qw = right - left, qh = bottom - top;
    if (![rw, rh, qw, qh].every(v => Number.isFinite(v) && v > 0)) return false;
    const centerX = xs.reduce((s, v) => s + v, 0) / 4;
    const centerY = ys.reduce((s, v) => s + v, 0) / 4;
    if (centerX < region.x || centerX > region.right || centerY < region.y || centerY > region.bottom) return false;
    const intersection = Math.max(0, Math.min(right, region.right) - Math.max(left, region.x)) *
        Math.max(0, Math.min(bottom, region.bottom) - Math.max(top, region.y));
    const regionArea = rw * rh, qrArea = qw * qh;
    const iou = intersection / (regionArea + qrArea - intersection);
    const comparableSize = Math.min(regionArea, qrArea) / Math.max(regionArea, qrArea) >= 0.5;
    const closeCenters = Math.hypot(centerX - (region.x + region.right) / 2,
        centerY - (region.y + region.bottom) / 2) <= 0.3 * Math.min(Math.hypot(rw, rh), Math.hypot(qw, qh));
    return iou >= 0.5 || (comparableSize && closeCenters && intersection / Math.min(regionArea, qrArea) >= 0.8);
}

export async function decodeWechatFallback(sourceCanvas, existing = [], trace = null, options = {}) {
    if(options.reordered)return decodeReordered(sourceCanvas,existing,trace,options);
    const regions = await detectWechatRegions(sourceCanvas, trace);
    if (trace) trace.record.regions = regions.map((box,index)=>({id:index+1,box,
        outcome:'pending',covered:false,curvedAttempted:false}));
    const decoded = [];
    let attempted = 0;
    let curvedAttempted = 0;
    let matched = 0;
    let curvedBudgetSkipped = 0;
    let regionBudgetSkipped = 0;

    for (const [regionIndex, region] of regions.entries()) {
        const record = trace?.record.regions[regionIndex];
        if ([...existing, ...decoded].some(qr => isRegionCovered(region, qr))) {
            if(record)record.outcome='already-decoded';
            matched++;
            continue;
        }
        if (attempted >= 8) { regionBudgetSkipped++; if(record)Object.assign(record,{outcome:'skipped',reason:'region-budget'});continue; }
        let crop;
        try { crop = await measureQR(trace,'region_crop',{regionId:regionIndex+1},()=>cropRegion(sourceCanvas,region)); }
        catch(error){if(record)Object.assign(record,{outcome:'error',reason:'runtime-error',error:error.message||String(error)});throw error;}
        if (!crop) { if(record)Object.assign(record,{outcome:'skipped',reason:'invalid-crop'});continue; }
        const { canvas, left, top, moduleSizeHint, paddingMode } = crop;
        console.log('[WeChat 裁剪]', {width: canvas.width, height: canvas.height, moduleSizeHint, paddingMode});
        attempted++;
        if(record)Object.assign(record,{crop:{width:canvas.width,height:canvas.height,left,top,moduleSizeHint,paddingMode}});
        const imageData = measureQRSync(trace,'region_read',{regionId:regionIndex+1},()=>
            canvas.getContext("2d", { willReadFrequently: true })
                .getImageData(0, 0, canvas.width, canvas.height));
        let results;
        try { results = await measureQR(trace,'region_decode',{regionId:regionIndex+1},()=>readBarcodes(imageData, {
            formats: ["QRCode"],
            tryHarder: true
        })); } catch(error){if(record)Object.assign(record,{outcome:'error',reason:'runtime-error',error:error.message||String(error)});throw error;}
        const valid = results.filter(r => r.isValid !== false && r.text && r.position);
        if (valid.length) {
            if(record)Object.assign(record,{outcome:'local-decoded',localDecoded:valid.length});
            for (const result of valid) {
                decoded.push(translateResult({
                    text: result.text,
                    format: result.format || "QRCode",
                    points: [
                        result.position.topLeft,
                        result.position.topRight,
                        result.position.bottomRight,
                        result.position.bottomLeft
                    ],
                    source: "wechat-detect-zxing"
                }, left, top));
            }
            continue;
        }

        // 每张图片最多校正两个失败区域，每个区域最多尝试十二种采样结果。
        if (curvedAttempted >= 2) { curvedBudgetSkipped++;if(record)Object.assign(record,{outcome:'skipped',reason:'curved-budget'});continue; }
        curvedAttempted++;
        if(record){record.curvedAttempted=true;record.curved={};}
        report("curved", "正在校正第 " + curvedAttempted + " 个区域…");
        const curvedStarted = performance.now();
        try {
            const corrected = await measureQR(trace,'curved_total',{regionId:regionIndex+1,parent:true},()=>decodeCurvedRegion(canvas, {
                maxPixels: 360000,
                maxModels: 12,
                geometryMs: 2000,
                moduleSizeHint, trace, regionId:regionIndex+1, statistics:record?.curved,useTPS:options.useTPS===true
            }));
            if(record)Object.assign(record,{outcome:corrected.length?'curved-decoded':'undecoded',
                curvedDecoded:corrected.length,reason:corrected.length?null:record.curved.reason});
            report("curved", "校正解码 " + corrected.length + " 个 · " + Math.round(performance.now() - curvedStarted) + " ms", "ready");
            for (const result of corrected) {
                decoded.push(translateResult(result, left, top));
            }
        } catch (error) {
            if(record)Object.assign(record,{outcome:'error',reason:'runtime-error',error:error.message||String(error)});
            report("curved", "校正失败：" + error.message, "error");
            console.warn("[局部曲面校正失败]", error);
        }
    }

    console.log("[WeChat 区域解码]", {
        candidates: regions.length,
        matched,
        attempted,
        curvedAttempted,
        curvedBudgetSkipped,
        regionBudgetSkipped,
        decoded: decoded.length
    });
    return decoded;
}

function convertedRegionResults(results, crop, name, variant = {}) {
    const sx=variant.scaleX||1,sy=variant.scaleY||1;
    return results.filter(r=>r.isValid!==false&&r.text&&r.position).map(result=>translateResult({
        text:result.text,format:result.format||'QRCode',source:name,
        points:[result.position.topLeft,result.position.topRight,result.position.bottomRight,result.position.bottomLeft]
            .map(p=>({x:p.x/sx,y:p.y/sy}))
    },crop.left,crop.top));
}

async function decodeReordered(sourceCanvas, existing, trace, options) {
    const regions=await detectWechatRegions(sourceCanvas,trace),decoded=[],deferred=[];
    const records=regions.map((box,index)=>({id:index+1,box,outcome:'pending',covered:false,
        curvedAttempted:false,localVariants:[]}));
    if(trace)trace.record.regions=records;
    const covered=box=>[...existing,...decoded].some(qr=>isRegionCovered(box,qr));
    let attempted=0,curvedAttempted=0;
    // Complete cheap work across the queue before spending the two-region geometry budget.
    for(const record of records){
        const {box,id}=record;
        if(covered(box)){record.outcome='already-decoded';continue;}
        if(attempted>=8){Object.assign(record,{outcome:'skipped',reason:'region-budget'});continue;}
        attempted++;
        let crop;
        try{
            crop=await measureQR(trace,'region_crop',{regionId:id},()=>cropRegion(sourceCanvas,box));
            if(!crop){Object.assign(record,{outcome:'skipped',reason:'invalid-crop'});continue;}
            const {canvas,left,top,moduleSizeHint,paddingMode}=crop;
            record.crop={width:canvas.width,height:canvas.height,left,top,moduleSizeHint,paddingMode};
            const imageData=measureQRSync(trace,'region_read',{regionId:id},()=>
                canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height));
            const results=await measureQR(trace,'region_decode',{regionId:id,variant:'original'},()=>
                readBarcodes(imageData,{formats:['QRCode'],tryHarder:true}));
            let found=convertedRegionResults(results,crop,'wechat-detect-zxing');
            decoded.push(...found);
            record.localVariants.push({name:'original',decoded:found.length});
            if(covered(box)){Object.assign(record,{outcome:'local-decoded',localDecoded:found.length});continue;}

            const iterator=iterateBackgroundVariants(canvas,{curved:false});
            try{
                while(true){
                    const next=await measureQR(trace,'region_preprocess',{regionId:id},()=>iterator.next());
                    if(next.done)break;
                    const variant=next.value;
                    try{
                        // The original crop was decoded above. Preserve the four existing cheap enhancements.
                        if(variant.name==='original')continue;
                        const results=await measureQR(trace,'region_decode',{regionId:id,variant:variant.name},()=>
                            readBarcodes(variant.imageData,{formats:['QRCode'],tryHarder:true}));
                        found=convertedRegionResults(results,crop,'wechat-local-'+variant.name,variant);
                        decoded.push(...found);
                        record.localVariants.push({name:variant.name,decoded:found.length,
                            preprocessBackend:variant.preprocessBackend});
                    }finally{if(variant.releaseAfterDecode)variant.imageData=null;}
                    if(covered(box))break;
                }
            }finally{await iterator.return?.();}
            if(covered(box)){record.outcome='local-enhanced-decoded';continue;}
            record.outcome='awaiting-geometry';
            deferred.push(record);
        }catch(error){
            Object.assign(record,{outcome:'error',reason:'runtime-error',error:error.message||String(error)});
        }finally{
            if(crop)crop.canvas.width=crop.canvas.height=1;
        }
    }
    for(const record of deferred){
        const {box,id}=record;
        if(covered(box)){record.outcome='covered-by-other-region';continue;}
        if(curvedAttempted>=2){Object.assign(record,{outcome:'skipped',reason:'curved-budget'});continue;}
        curvedAttempted++;record.curvedAttempted=true;record.curved={};
        let canvas;
        try{
            const crop=record.crop;
            canvas=measureQRSync(trace,'region_crop',{regionId:id,step:'rehydrate'},()=>{
                const result=document.createElement('canvas');result.width=crop.width;result.height=crop.height;
                result.getContext('2d',{willReadFrequently:true}).drawImage(sourceCanvas,crop.left,crop.top,
                    crop.width,crop.height,0,0,crop.width,crop.height);
                return result;
            });
            report('curved','正在校正第 '+curvedAttempted+' 个区域…');
            const corrected=await measureQR(trace,'curved_total',{regionId:id,parent:true},()=>
                decodeCurvedRegion(canvas,{maxPixels:360000,maxModels:12,geometryMs:2000,
                    moduleSizeHint:crop.moduleSizeHint,trace,regionId:id,statistics:record.curved,
                    useTPS:options.useTPS===true}));
            decoded.push(...corrected.map(qr=>translateResult(qr,crop.left,crop.top)));
            Object.assign(record,{outcome:covered(box)?'curved-decoded':'undecoded',
                curvedDecoded:corrected.length,reason:covered(box)?null:record.curved.reason||'not-covered'});
            report('curved','校正解码 '+corrected.length+' 个','ready');
        }catch(error){
            Object.assign(record,{outcome:'error',reason:'runtime-error',error:error.message||String(error)});
            report('curved','校正失败：'+record.error,'error');
        }finally{if(canvas)canvas.width=canvas.height=1;}
    }
    return decoded;
}
