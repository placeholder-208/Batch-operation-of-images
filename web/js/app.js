import { setupDesign } from './design.js';
import { createQRStatistics, measureQR, normalizeQRExperiments } from './qr-statistics.js';
import { startWorkspaceSession } from './workspace-session.js';
import {storeCrop,releaseCrops} from './crop-store.js';
import { processFile } from "./image.js";
import { perspectiveCrop } from "./crop.js";
import { iterateBackgroundVariants as createDecodeVariants } from './preprocess-client.js';
import { createImageZip, createAllZip } from "./zip.js";
import { createUI, downloadBlob } from "./ui.js?v=qr-experiments-3.8";
import { report } from "./runtime-status.js";
import { createMaskUI } from "./masking.js";
import { createBarcodeUI } from "./barcode-ui.js";
import { createSemanticUI } from "./semantic-ui.js?v=feature-3.6.1";
import { setupWorkspaceTabs } from "./workspace-tabs.js?v=sam-1.8";
import { createSamWorkspace } from "./segmentation/workspace.js";

let running = false, exporting = false, decoderPromise = null;
let barcodeUI = null, semanticUI = null, samUI = null;
let persistence = null;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const ui = createUI({scan, export: exportResults, isExporting: () => exporting, onChange: () => persistence?.schedule('qr'),onBusy:()=>{maskUI.refresh();barcodeUI?.refresh();semanticUI?.refresh();samUI?.refresh();}});
const maskUI = createMaskUI({
    onChange: () => persistence?.schedule('mask'),
    isBlocked: () => running || exporting || ui.isImporting() || Boolean(barcodeUI?.isBusy()) || Boolean(semanticUI?.isBusy()) || Boolean(samUI?.isBusy()),
    onBusy: value => { ui.busy(value); barcodeUI?.refresh(); semanticUI?.refresh(); samUI?.refresh(); },
    async detect(file) {
        const source = await processFile(file), warnings = [];
        let qrcodes = [], regions = [];
        try {
            const { decodeQRCode } = await loadDecoder();
            qrcodes = await decodeQRCode(createDecodeVariants(source.canvas), source.canvas);
        } catch (error) { warnings.push('解码未完成：' + error.message); }
        try {
            const { detectWechatRegions } = await import('./wechat-detector.js');
            regions = await detectWechatRegions(source.canvas);
        } catch (error) { warnings.push('候选检测未完成：' + error.message); }
        source.canvas.width = source.canvas.height = 1;
        return { width: source.width, height: source.height, qrcodes, regions, warnings };
    }
});
barcodeUI = createBarcodeUI({
    onChange: () => persistence?.schedule('barcode'),
    isBlocked: () => running || exporting || ui.isImporting() || maskUI.isBusy() || Boolean(semanticUI?.isBusy()) || Boolean(samUI?.isBusy()),
    prepare: loadDecoder,
    onBusy: value => { ui.busy(value); maskUI.refresh(); semanticUI?.refresh(); samUI?.refresh(); },
    refresh: () => { ui.refresh(); maskUI.refresh(); }
});
semanticUI = createSemanticUI({
    onChange: () => persistence?.schedule('semantic'),
    isBlocked: () => running || exporting || ui.isImporting() || maskUI.isBusy() || barcodeUI.isBusy() || Boolean(samUI?.isBusy()),
    onBusy: value => { ui.busy(value); maskUI.refresh(); barcodeUI.refresh(); },
    openSam: (blob,filename) => samUI.openCrop(blob,filename)
});
samUI = createSamWorkspace({
    onChange: () => persistence?.schedule('sam'),
    isBlocked: () => running || exporting || ui.isImporting() || maskUI.isBusy() || barcodeUI.isBusy() || semanticUI.isBusy(),
    onBusy: value => { ui.busy(value); maskUI.refresh(); barcodeUI.refresh(); semanticUI.refresh(); samUI?.refresh(); }
});
setupWorkspaceTabs(() => { ui.refresh(); maskUI.refresh(); barcodeUI.refresh(); semanticUI.refresh(); samUI?.refresh(); });
report("zxing", window.ZXingWASM ? "脚本已加载，等待首次解码" : "脚本加载失败", window.ZXingWASM ? "info" : "error");
report("wechat", globalThis.ort ? "运行库脚本已加载，模型按需加载" : "ONNX Runtime 脚本加载失败", globalThis.ort ? "info" : "error");
report("curved", "等待任务");
setupDesign();
persistence = startWorkspaceSession({ qr: ui, barcode: barcodeUI, mask: maskUI, semantic: semanticUI, sam: samUI });

async function loadDecoder() {
    if (!decoderPromise) decoderPromise = import("./decoder.js").catch(error => {
        decoderPromise = null;
        report("zxing", "模块加载失败：" + error.message, "error");
        throw error;
    });
    return decoderPromise;
}
async function scan(items, requestedOptions = {}) {
    if (running || exporting || ui.isImporting() || maskUI.isBusy() || barcodeUI.isBusy() || semanticUI.isBusy() || samUI.isBusy() || !items.length) return;
    running = true; ui.busy(true); maskUI.refresh(); barcodeUI.refresh(); semanticUI.refresh(); samUI?.refresh(); ui.progress(0, items.length);
    const options=normalizeQRExperiments(requestedOptions);
    const began = performance.now(); let succeeded = 0, failed = 0, totalCount = 0;
    const run={id:globalThis.crypto?.randomUUID?.()||String(Date.now()),
        startedAt:new Date().toISOString(),imageCount:items.length,
        userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency||null};
    const moduleBegan=performance.now();
    try {
        const {decodeQRCode} = await loadDecoder();
        run.decoderModuleInitMs=Math.round((performance.now()-moduleBegan)*100)/100;
        for (let index = 0; index < items.length; index++) {
            const item = items[index]; item.processing = true; item.error = null;
            if(item.qrStatistics){
                item.qrStatisticsHistory=[...(item.qrStatisticsHistory||[]),item.qrStatistics].slice(-8);
            }
            releaseCrops(item.result);item.result=null;
            ui.tell("正在识别第 " + (index+1) + " / " + items.length + " 张：" + item.file.name, "qr");
            ui.detail("正在读取图片…"); ui.refresh(); await tick();
            const started = performance.now();let source;
            const trace=createQRStatistics(item.file,item.source,run,options);
            item.qrStatistics=trace.record;
            let detectedCodes=[],scanError=null;
            try {
                source = await measureQR(trace,'image_read',{},()=>processFile(item.file));
                Object.assign(trace.record,{width:source.width,height:source.height});
                ui.detail("准备按顺序生成图像预处理版本…"); await tick();
                const variants = createDecodeVariants(source.canvas,{originalOnly:options.reordered});
                ui.detail("正在执行 " + variants.length + " 个解码版本与检测兜底…"); await tick();
                const detected = await decodeQRCode(variants, source.canvas, trace,options);
                const qrcodes = detected.map((qr,index)=>({...qr,id:index+1}));
                detectedCodes=qrcodes;
                const crops = []; let cropFailed = 0;
                ui.detail("正在生成二维码裁切图片…"); await tick();
                for (const qr of qrcodes) {
                    try {
                        crops.push(await measureQR(trace,'output_crop',{codeId:qr.id},async()=>{
                            const canvas = perspectiveCrop(source.canvas,qr.points,20);
                            return storeCrop(canvas,qr.id);
                        }));
                    } catch(error) {cropFailed++;console.warn("二维码 #"+qr.id+" 裁切失败",error);}
                }
                releaseCrops(item.result);
                item.result = {filename:item.file.name,width:source.width,height:source.height,image:item.url,
                    count:qrcodes.length,qrcodes,crops};
                item.elapsedMs = Math.round(performance.now()-started);
                totalCount += qrcodes.length; succeeded++;
                ui.detail("本图 " + item.elapsedMs + " ms · 识别 " + qrcodes.length + " 个" + (cropFailed ? " · "+cropFailed+" 个裁切失败，内容已保留" : ""));
                // 原图使用文件 URL 预览；不在结果中长期缓存原图 Canvas 或大体积 data URL。
            } catch(error) {
                scanError=error;
                failed++;item.error=error.message||String(error);ui.detail("本图失败："+item.error);console.error(error);
            } finally {
                if(source)source.canvas.width=source.canvas.height=1;
                trace.finish(detectedCodes,scanError);
                item.processing=false;ui.progress(index+1,items.length);ui.refresh();await tick();
            }
        }
        ui.tell("本次完成：" + succeeded + " 张图片，共识别 " + totalCount + " 个二维码" +
            (failed ? "；"+failed+" 张失败，可再次识别" : "") + " · " + Math.round(performance.now()-began) + " ms","qr");
    } catch(error) {
        if(run.decoderModuleInitMs===undefined){
            run.decoderModuleInitMs=Math.round((performance.now()-moduleBegan)*100)/100;
            run.decoderModuleInitError=error.message||String(error);
        }else run.pipelineError=error.message||String(error);
        for(const item of items)if(item.qrStatistics?.run.id!==run.id&&!item.result){
            const trace=createQRStatistics(item.file,item.source,run,options);
            item.qrStatistics=trace.finish([],error);
        }
        ui.tell("识别初始化失败："+(error.message||String(error)),"qr");
    } finally {
        running=false;ui.busy(false);ui.refresh();maskUI.refresh();barcodeUI.refresh();semanticUI.refresh(); samUI?.refresh();
    }
}
async function exportResults(results, single = false) {
    if (running || exporting || ui.isImporting() || maskUI.isBusy() || barcodeUI.isBusy() || semanticUI.isBusy() || samUI.isBusy() || !results.length) return;
    if (!window.JSZip) {ui.tell("ZIP 库加载失败，请检查 jszip.min.js。","qr");return;}
    exporting=true;ui.busy(false);maskUI.refresh();barcodeUI.refresh();semanticUI.refresh(); samUI?.refresh();ui.tell("正在生成 ZIP…","qr");await tick();
    try {
        const blob=await (single?createImageZip(results[0]):createAllZip(results));
        downloadBlob(blob,single?results[0].filename.replace(/\.[^.]+$/,"")+".zip":"qrcode_results.zip");
        ui.tell("ZIP 已生成，已发起下载。","qr");
    } catch(error){ui.tell("生成 ZIP 失败："+error.message,"qr");console.error(error);}
    finally {exporting=false;ui.busy(false);ui.refresh();maskUI.refresh();barcodeUI.refresh();semanticUI.refresh(); samUI?.refresh();}
}

