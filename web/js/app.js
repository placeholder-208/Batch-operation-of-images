import { processFile } from "./image.js";
import { perspectiveCrop } from "./crop.js";
import { createDecodeVariants } from "./preprocess.js";
import { createImageZip, createAllZip } from "./zip.js";
import { createUI, downloadBlob } from "./ui.js?v=sam-1.8";
import { report } from "./runtime-status.js";
import { createMaskUI } from "./masking.js";
import { createBarcodeUI } from "./barcode-ui.js";
import { createSemanticUI } from "./semantic-ui.js?v=token-fix-1.8.1";
import { setupWorkspaceTabs } from "./workspace-tabs.js?v=sam-1.8";
import { createSamWorkspace } from "./sam-workspace.js?v=sam-1.8";

let running = false, exporting = false, decoderPromise = null;
let barcodeUI = null, semanticUI = null, samUI = null;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const ui = createUI({scan, export: exportResults, isExporting: () => exporting});
const maskUI = createMaskUI({
    isBlocked: () => running || exporting || Boolean(barcodeUI?.isBusy()) || Boolean(semanticUI?.isBusy()) || Boolean(samUI?.isBusy()),
    onBusy: value => { ui.busy(value); barcodeUI?.refresh(); semanticUI?.refresh(); },
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
    isBlocked: () => running || exporting || maskUI.isBusy() || Boolean(semanticUI?.isBusy()) || Boolean(samUI?.isBusy()),
    prepare: loadDecoder,
    onBusy: value => { ui.busy(value); maskUI.refresh(); semanticUI?.refresh(); },
    refresh: () => { ui.refresh(); maskUI.refresh(); }
});
semanticUI = createSemanticUI({
    isBlocked: () => running || exporting || maskUI.isBusy() || barcodeUI.isBusy() || Boolean(samUI?.isBusy()),
    onBusy: value => { ui.busy(value); maskUI.refresh(); barcodeUI.refresh(); },
    openSam: (blob,filename) => samUI.openCrop(blob,filename)
});
samUI = createSamWorkspace({
    isBlocked: () => running || exporting || maskUI.isBusy() || barcodeUI.isBusy() || semanticUI.isBusy(),
    onBusy: value => { ui.busy(value); maskUI.refresh(); barcodeUI.refresh(); semanticUI.refresh(); }
});
setupWorkspaceTabs(() => { ui.refresh(); maskUI.refresh(); barcodeUI.refresh(); semanticUI.refresh(); });
report("zxing", window.ZXingWASM ? "脚本已加载，等待首次解码" : "脚本加载失败", window.ZXingWASM ? "info" : "error");
report("wechat", globalThis.ort ? "运行库脚本已加载，模型按需加载" : "ONNX Runtime 脚本加载失败", globalThis.ort ? "info" : "error");
report("curved", "等待任务");

async function loadDecoder() {
    if (!decoderPromise) decoderPromise = import("./decoder.js").catch(error => {
        decoderPromise = null;
        report("zxing", "模块加载失败：" + error.message, "error");
        throw error;
    });
    return decoderPromise;
}
async function scan(items) {
    if (running || exporting || maskUI.isBusy() || barcodeUI.isBusy() || semanticUI.isBusy() || samUI.isBusy() || !items.length) return;
    running = true; ui.busy(true); maskUI.refresh(); barcodeUI.refresh(); semanticUI.refresh(); ui.progress(0, items.length);
    const began = performance.now(); let succeeded = 0, failed = 0, totalCount = 0;
    try {
        const {decodeQRCode} = await loadDecoder();
        for (let index = 0; index < items.length; index++) {
            const item = items[index]; item.processing = true; item.error = null;
            ui.tell("正在识别第 " + (index+1) + " / " + items.length + " 张：" + item.file.name, "qr");
            ui.detail("正在读取图片…"); ui.refresh(); await tick();
            const started = performance.now();
            try {
                const source = await processFile(item.file);
                ui.detail("正在生成图像预处理版本…"); await tick();
                const variants = createDecodeVariants(source.canvas);
                ui.detail("正在执行 " + variants.length + " 个解码版本与检测兜底…"); await tick();
                const detected = await decodeQRCode(variants, source.canvas);
                const qrcodes = detected.map((qr,index)=>({...qr,id:index+1}));
                const crops = []; let cropFailed = 0;
                ui.detail("正在生成二维码裁切图片…"); await tick();
                for (const qr of qrcodes) {
                    try {
                        const canvas = perspectiveCrop(source.canvas,qr.points,20);
                        crops.push({id:qr.id,canvas,image:canvas.toDataURL("image/png")});
                    } catch(error) {cropFailed++;console.warn("二维码 #"+qr.id+" 裁切失败",error);}
                }
                item.result = {filename:item.file.name,width:source.width,height:source.height,image:item.url,
                    count:qrcodes.length,qrcodes,crops};
                item.elapsedMs = Math.round(performance.now()-started);
                totalCount += qrcodes.length; succeeded++;
                ui.detail("本图 " + item.elapsedMs + " ms · 识别 " + qrcodes.length + " 个" + (cropFailed ? " · "+cropFailed+" 个裁切失败，内容已保留" : ""));
                // 原图使用文件 URL 预览；不在结果中长期缓存原图 Canvas 或大体积 data URL。
            } catch(error) {
                failed++;item.error=error.message||String(error);ui.detail("本图失败："+item.error);console.error(error);
            } finally {
                item.processing=false;ui.progress(index+1,items.length);ui.refresh();await tick();
            }
        }
        ui.tell("本次完成：" + succeeded + " 张图片，共识别 " + totalCount + " 个二维码" +
            (failed ? "；"+failed+" 张失败，可再次识别" : "") + " · " + Math.round(performance.now()-began) + " ms","qr");
    } catch(error) {
        ui.tell("识别初始化失败："+(error.message||String(error)),"qr");
    } finally {
        running=false;ui.busy(false);ui.refresh();maskUI.refresh();barcodeUI.refresh();semanticUI.refresh();
    }
}
async function exportResults(results, single = false) {
    if (running || exporting || maskUI.isBusy() || barcodeUI.isBusy() || semanticUI.isBusy() || samUI.isBusy() || !results.length) return;
    if (!window.JSZip) {ui.tell("ZIP 库加载失败，请检查 jszip.min.js。","qr");return;}
    exporting=true;ui.busy(false);maskUI.refresh();barcodeUI.refresh();semanticUI.refresh();ui.tell("正在生成 ZIP…","qr");await tick();
    try {
        const blob=await (single?createImageZip(results[0]):createAllZip(results));
        downloadBlob(blob,single?results[0].filename.replace(/\.[^.]+$/,"")+".zip":"qrcode_results.zip");
        ui.tell("ZIP 已生成，已发起下载。","qr");
    } catch(error){ui.tell("生成 ZIP 失败："+error.message,"qr");console.error(error);}
    finally {exporting=false;ui.busy(false);ui.refresh();maskUI.refresh();barcodeUI.refresh();semanticUI.refresh();}
}

