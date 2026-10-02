import { detectWechatRegions } from "./wechat-detector.js";
import { decodeCurvedRegion, analyzeCurvedImage } from "./curved-region.js";

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

export async function decodeWechatFallback(sourceCanvas, existing = []) {
    const regions = await detectWechatRegions(sourceCanvas);
    const decoded = [];
    let attempted = 0;
    let curvedAttempted = 0;
    let matched = 0;
    let curvedBudgetSkipped = 0;
    let regionBudgetSkipped = 0;

    for (const region of regions) {
        if ([...existing, ...decoded].some(qr => isRegionCovered(region, qr))) {
            matched++;
            continue;
        }
        if (attempted >= 8) { regionBudgetSkipped++; continue; }
        const crop = await cropRegion(sourceCanvas, region);
        if (!crop) continue;
        const { canvas, left, top, moduleSizeHint, paddingMode } = crop;
        console.log('[WeChat 裁剪]', {width: canvas.width, height: canvas.height, moduleSizeHint, paddingMode});
        attempted++;
        const imageData = canvas.getContext("2d", { willReadFrequently: true })
            .getImageData(0, 0, canvas.width, canvas.height);
        const results = await window.ZXingWASM.readBarcodes(imageData, {
            formats: ["QRCode"],
            tryHarder: true
        });
        const valid = results.filter(r => r.isValid !== false && r.text && r.position);
        if (valid.length) {
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
        if (curvedAttempted >= 2) { curvedBudgetSkipped++; continue; }
        curvedAttempted++;
        try {
            const corrected = await decodeCurvedRegion(canvas, {
                maxPixels: 360000,
                maxModels: 12,
                geometryMs: 2000,
                moduleSizeHint
            });
            for (const result of corrected) {
                decoded.push(translateResult(result, left, top));
            }
        } catch (error) {
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
