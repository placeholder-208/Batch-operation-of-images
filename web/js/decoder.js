import {readBarcodes,getReaderBackend} from './reader-client.js';
import { measureQR, normalizeQROptions } from './qr-statistics.js';
import { iterateBackgroundVariants } from './preprocess-client.js';
import { report } from "./runtime-status.js";
import {
    decodeWechatFallback, isRegionCovered
} from "./wechat-decoder.js";

const ZXING_CONFIG = {
    overrides: {
        locateFile: function (path, prefix) {
            if (path.endsWith(".wasm")) {
                return new URL("../zxing/" + path, import.meta.url).href;
            }

            return prefix + path;
        }
    }
};

if (!window.ZXingWASM) {
    report("zxing", "脚本加载失败", "error");
    throw new Error("ZXingWASM 尚未加载");
}

window.ZXingWASM.prepareZXingModule(ZXING_CONFIG);
report("zxing", "脚本已加载，等待首次解码");


function distance(pointA, pointB) {
    const dx = pointA.x - pointB.x;
    const dy = pointA.y - pointB.y;

    return Math.sqrt(dx * dx + dy * dy);
}


function getSymbolSize(qr) {
    const top = distance(qr.points[0], qr.points[1]);
    const bottom = distance(qr.points[2], qr.points[3]);
    const left = distance(qr.points[0], qr.points[3]);
    const right = distance(qr.points[1], qr.points[2]);

    return Math.max(top, bottom, left, right);
}


function convertZXingResult(result, variant) {
    if (!result.position) {
        return null;
    }

    const scaleX = variant.scaleX || 1;
    const scaleY = variant.scaleY || 1;

    const mapPoint =
        variant.mapPoint ||
        function (point) {
            return point;
        };

    const points = [
        {
            x: result.position.topLeft.x / scaleX,
            y: result.position.topLeft.y / scaleY
        },
        {
            x: result.position.topRight.x / scaleX,
            y: result.position.topRight.y / scaleY
        },
        {
            x: result.position.bottomRight.x / scaleX,
            y: result.position.bottomRight.y / scaleY
        },
        {
            x: result.position.bottomLeft.x / scaleX,
            y: result.position.bottomLeft.y / scaleY
        }
    ].map(mapPoint);

    const centerX =
        points.reduce(function (sum, point) {
            return sum + point.x;
        }, 0) / points.length;

    const centerY =
        points.reduce(function (sum, point) {
            return sum + point.y;
        }, 0) / points.length;

    return {
        text: result.text || "",
        format: result.format || "QRCode",
        points: points,
        center: {
            x: centerX,
            y: centerY
        },
        source: variant.name
    };
}


function splitZXingResults(results, variant) {
    const decoded = [];
    const candidates = [];

    results.forEach(function (result) {
        const converted = convertZXingResult(
            result,
            variant
        );

        if (!converted) {
            return;
        }

        if (result.isValid === false) {
            candidates.push(converted);
            return;
        }

        decoded.push(converted);
    });

    return {
        decoded: decoded,
        candidates: candidates
    };
}


function isSameQRCode(first, second) {
    if (
        first.text !== second.text ||
        first.format !== second.format
    ) {
        return false;
    }

    const allowedDistance = Math.max(
        20,
        Math.max(
            getSymbolSize(first),
            getSymbolSize(second)
        ) * 0.35
    );

    return (
        distance(first.center, second.center) <=
        allowedDistance
    );
}


function isSameCandidate(first, second) {
    const allowedDistance = Math.max(
        20,
        Math.max(
            getSymbolSize(first),
            getSymbolSize(second)
        ) * 0.35
    );

    return (
        distance(first.center, second.center) <=
        allowedDistance
    );
}


function deduplicateResults(results) {
    return results.filter(function (candidate, index) {
        return !results.slice(0, index).some(
            function (existing) {
                return isSameQRCode(existing, candidate);
            }
        );
    });
}


function deduplicateCandidates(candidates) {
    return candidates.filter(function (candidate, index) {
        return !candidates.slice(0, index).some(
            function (existing) {
                return isSameCandidate(existing, candidate);
            }
        );
    });
}


async function* profiledVariants(variants, trace) {
    const iterator = variants[Symbol.asyncIterator]?.() || variants[Symbol.iterator]();
    try {
        while (true) {
            const end=trace?.start('preprocess_next');
            let next;
            try { next=await iterator.next();end?.('ok',{variant:next.value?.name||null,done:next.done}); }
            catch(error){end?.('error',{error:error.message||String(error)});throw error;}
            if (next.done) break;
            yield next.value;
        }
    } finally { await iterator.return?.(); }
}
function recordCoverage(trace, codes) {
    if (!trace) return;
    for(const [index,candidate] of (trace.record.zxingCandidates||[]).entries()){
        candidate.covered=codes.some(qr=>isSameCandidate(candidate,qr));
        const matched=trace.record.regions.find(region=>isRegionCovered(region.box,candidate));
        if(matched){(matched.zxingCandidateIds||=[]).push(index+1);continue;}
        const xs=candidate.points.map(p=>p.x),ys=candidate.points.map(p=>p.y);
        trace.record.regions.push({id:'Z'+(index+1),origin:'zxing',
            box:{x:Math.min(...xs),y:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)},
            covered:candidate.covered,outcome:'zxing-candidate',reason:candidate.covered?null:'zxing-undecoded'});
    }
    for (const region of trace.record.regions) {
        if(region.origin!=='zxing')region.covered = codes.some(qr => isRegionCovered(region.box, qr));
        if (!region.covered && !region.reason) region.reason = region.outcome === 'pending' ? 'pipeline-aborted' : 'not-covered';
    }
}
export async function decodeQRCode(
    sourceCanvas,
    trace = null,
    options = {}
) {
    options = normalizeQROptions(options);
    const variants = iterateBackgroundVariants(sourceCanvas,{originalOnly:true});
    const decoded = [];
    const candidates = [];

    let successfulVariants = 0;
    let failedVariants = 0;
    for await (const variant of profiledVariants(variants, trace)) {
        const variantRecord = {name:variant.name, width:variant.imageData.width, height:variant.imageData.height,
            preprocessBackend:variant.preprocessBackend, readerBackend:getReaderBackend()};
        if(trace)variantRecord.uniqueBefore=deduplicateResults(decoded).length;
        trace?.record.variants.push(variantRecord);
        report("zxing", (getReaderBackend()==='worker'?'后台解码 · ':'兼容解码 · ')+(variant.preprocessBackend==='worker'?'后台预处理 · ':variant.preprocessBackend==='main'?'兼容预处理 · ':'')+"正在解码：" + variant.name);
        try {
            const results = await measureQR(trace, 'full_decode', {variant:variant.name}, () => readBarcodes(
                variant.imageData,
                {
                    formats: ["QRCode"],
                    tryHarder: true
                }
            ));

            successfulVariants++;
            const split = splitZXingResults(
                results,
                variant
            );

            decoded.push(...split.decoded);
            candidates.push(...split.candidates);
            if(trace)Object.assign(variantRecord, {status:'ok', decoded:split.decoded.length,
                rawResultCount:results.length,reason:split.decoded.length?null:'no-valid-result',
                readerBackend:getReaderBackend(),
                uniqueAfter:deduplicateResults(decoded).length,
                failedCandidates:split.candidates.map(qr=>({points:qr.points,center:qr.center}))});
        } catch (error) {
            failedVariants++;
            Object.assign(variantRecord, {status:'error',error:error.message || String(error)});
            report("zxing", variant.name + " 失败：" + error.message, "error");
            console.warn(
                `“${variant.name}”版本识别失败`,
                error
            );
        } finally {if(variant.releaseAfterDecode)variant.imageData=null;}
        // One independent full-image pass; continue searching in WeChat regions below.
        await new Promise(resolve=>setTimeout(resolve,0));
        break;
    }

    const uniqueDecoded = deduplicateResults(decoded);
    if(trace)trace.record.zxingCandidates=deduplicateCandidates(candidates).map(qr=>({points:qr.points,center:qr.center}));
    report("zxing", successfulVariants ? "已识别 " + uniqueDecoded.length + " 个" + (failedVariants ? "；" + failedVariants + " 个版本失败" : "") : "所有版本解码失败，继续尝试区域兜底", failedVariants ? "error" : "ready");
    report("curved", "本图尚未触发");

    try {
        const recovered = await decodeWechatFallback(sourceCanvas, uniqueDecoded, trace, options);
        const final = deduplicateResults([...uniqueDecoded, ...recovered]);
        recordCoverage(trace, final);
        return final;
    } catch (error) {
        report("wechat", "兜底失败：" + (error.message || String(error)), "error");
        console.error("WeChat 检测兜底失败", error);

        if (trace) trace.record.fallbackError = error.message || String(error);
        recordCoverage(trace, uniqueDecoded);
        return uniqueDecoded;
    }
}
