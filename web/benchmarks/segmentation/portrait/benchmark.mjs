import { measurePortrait } from './metrics.mjs';
import { resizeAlphaBilinear } from './alpha.mjs';
import { boxPrompt } from '../../../js/segmentation/mask-utils.js';
import { interpolatedAlpha } from '../../../js/segmentation/postprocess.js';

const $ = id => document.getElementById(id);
const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const variants = [
    { id: 'slimsam-q8', model: 'slimsam', dtype: 'q8' },
    { id: 'slimsam-fp32', model: 'slimsam', dtype: 'fp32' },
    { id: 'modnet-fp32', model: 'modnet', dtype: 'fp32' },
    { id: 'modnet-q8', model: 'modnet', dtype: 'q8' },
];
let busy = false, library;

async function json(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
}
async function readCanvas(path) {
    const response = await fetch('/_portrait-data/' + path);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const source = await createImageBitmap(await response.blob());
    const result = canvas(source.width, source.height);
    result.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0);
    source.close(); return result;
}
async function readSample(record, fixedPrompt) {
    const image = await readCanvas(record.image), mask = await readCanvas(record.alpha);
    if (mask.width !== image.width || mask.height !== image.height) throw new Error('Image/alpha size mismatch: ' + record.id);
    const pixels = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
    const originalTruth = new Float32Array(mask.width * mask.height);
    let maxGrayDeviation = 0;
    for (let i = 0; i < originalTruth.length; i++) {
        const p = i * 4;
        if (pixels[p + 3] !== 255) throw new Error('GT must be opaque grayscale: ' + record.id);
        maxGrayDeviation = Math.max(maxGrayDeviation, Math.abs(pixels[p] - pixels[p + 1]), Math.abs(pixels[p] - pixels[p + 2]));
        originalTruth[i] = (pixels[p] + pixels[p + 1] + pixels[p + 2]) / (3 * 255);
    }
    if (maxGrayDeviation > 2) throw new Error('GT is not grayscale: ' + record.id);
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    const work = canvas(width, height), ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, width, height);
    const truth = resizeAlphaBilinear(originalTruth, image.width, image.height, width, height);
    // Match the production boxPrompt API: [left, top, right, bottom]. Never
    // derive a prompt or select a candidate from the ground-truth alpha.
    const normalized = fixedPrompt?.box ?? record.promptBoxNormalized ?? [0, 0, 1, 1];
    if (normalized.length !== 4 || !normalized.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
        normalized[2] <= normalized[0] || normalized[3] <= normalized[1]) throw new Error('Invalid fixed prompt box');
    const box = normalized.map((v, i) => v * (i % 2 === 0 ? width : height));
    const points = fixedPrompt?.point ? [{ x: fixedPrompt.point[0] * width, y: fixedPrompt.point[1] * height, label: 1 }] : [];
    const metadata = { id: record.id, originalWidth: image.width, originalHeight: image.height,
        width, height, maxGrayDeviation, promptBox: box, promptPoints: points,
        promptSource: fixedPrompt ? 'fixed-RGB-only-human-box-and-positive-point' : record.promptBoxNormalized ? 'fixed-RGB-only-human-box' : 'full-image-box-no-GT' };
    image.width = image.height = mask.width = mask.height = 1;
    return { id: record.id, image: work, truth, box, points, metadata };
}
async function runtime() {
    if (library) return library;
    library = await import('../../../vendor/segmentation/transformers.local.js');
    const { env } = library;
    env.allowRemoteModels = false; env.allowLocalModels = true; env.useBrowserCache = false;
    env.localModelPath = new URL('/_benchmark-models/', location.href).href;
    env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.wasmPaths = {
        mjs: new URL('../../../vendor/segmentation/ort-wasm-simd-threaded.mjs', import.meta.url).href,
        wasm: new URL('../../../vendor/segmentation/ort-wasm-simd-threaded.wasm', import.meta.url).href,
    };
    return library;
}
async function inferSam(engine, sample) {
    const { model, processor, RawImage, Tensor } = engine, { image, box } = sample;
    let inputs, embeddings, labels, outputs, masks;
    const start = performance.now();
    try {
        inputs = await processor(RawImage.fromCanvas(image));
        const preprocessMs = performance.now() - start, encodedAt = performance.now();
        embeddings = await model.get_image_embeddings(inputs);
        const encodeMs = performance.now() - encodedAt;
        const prompt = boxPrompt(box, sample.points, 1, 1);
        const coords = processor.reshape_input_points([prompt.coords], inputs.original_sizes, inputs.reshaped_input_sizes);
        labels = new Tensor('int64', BigInt64Array.from(prompt.labels, BigInt), [1, 1, prompt.labels.length]);
        const decodeAt = performance.now();
        outputs = await model({ ...embeddings, input_points: coords, input_labels: labels });
        masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes, { binarize: false });
        const decodeMs = performance.now() - decodeAt, scores = Array.from(outputs.iou_scores.data);
        if (!scores.length || !scores.every(Number.isFinite)) throw new Error('Invalid SAM scores');
        const selected = scores.indexOf(Math.max(...scores)), n = image.width * image.height;
        if (masks[0].data.length !== n * scores.length) throw new Error('Invalid SAM mask shape');
        const postAt = performance.now();
        const alpha = interpolatedAlpha(masks[0].data.subarray(selected * n, (selected + 1) * n), image.width, image.height, image.width, image.height, 0, false, true);
        return { alpha, selectedCandidate: selected, scores, preprocessMs, encodeMs, decodeMs,
            postprocessMs: performance.now() - postAt, inferencePipelineMs: performance.now() - start,
            inputShape: inputs.pixel_values.dims, rawMaskShape: outputs.pred_masks.dims,
            alphaType: 'production-logits-threshold-narrow-antialias' };
    } finally {
        inputs?.pixel_values?.dispose(); labels?.dispose(); outputs?.pred_masks?.dispose(); outputs?.iou_scores?.dispose();
        for (const t of Object.values(embeddings || {})) t?.dispose?.();
        for (const t of masks || []) t.dispose?.();
    }
}
async function inferModnet(engine, sample) {
    const { model, processor, RawImage } = engine, { image } = sample;
    let inputs, output;
    const start = performance.now();
    try {
        inputs = await processor(RawImage.fromCanvas(image));
        const preprocessMs = performance.now() - start, inferAt = performance.now();
        output = await model({ input: inputs.pixel_values });
        const inferenceMs = performance.now() - inferAt, tensor = output.output;
        if (!tensor || tensor.dims.length !== 4 || tensor.dims[0] !== 1 || tensor.dims[1] !== 1) throw new Error('Invalid MODNet output');
        const postAt = performance.now(), [height, width] = tensor.dims.slice(-2);
        let min = Infinity, max = -Infinity, nonfinite = 0, rounded = 0;
        const bounded = Float32Array.from(tensor.data, value => {
            if (!Number.isFinite(value)) nonfinite++;
            min = Math.min(min, value); max = Math.max(max, value);
            if (value < 0 || value > 1) rounded++;
            return Math.min(1, Math.max(0, value));
        });
        if (nonfinite || min < -1e-5 || max > 1 + 1e-5) throw new Error(`Invalid MODNet alpha: min=${min}, max=${max}, nonfinite=${nonfinite}`);
        // A WASM sigmoid can exceed 1 by a float rounding ULP; report this,
        // clamp only such numerical round-off, and reject substantial errors.
        const alpha = resizeAlphaBilinear(bounded, width, height, image.width, image.height);
        return { alpha, preprocessMs, inferenceMs, postprocessMs: performance.now() - postAt,
            inferencePipelineMs: performance.now() - start, inputShape: inputs.pixel_values.dims,
            rawMaskShape: tensor.dims, outputRange: { min, max, rounded }, alphaType: 'continuous-alpha-float32-bilinear-no-threshold' };
    } finally {
        inputs?.pixel_values?.dispose();
        for (const t of Object.values(output || {})) t?.dispose?.();
    }
}
async function artifact(sample, alpha, name) {
    if (!window.writeArtifact) return;
    const { width, height } = sample.image, mask = canvas(width, height), ctx = mask.getContext('2d');
    const rgba = ctx.createImageData(width, height);
    for (let i = 0; i < alpha.length; i++) {
        rgba.data[i * 4] = rgba.data[i * 4 + 1] = rgba.data[i * 4 + 2] = Math.round(alpha[i] * 255);
        rgba.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(rgba, 0, 0);
    await window.writeArtifact(`${sample.id}-${name}-alpha.png`, mask.toDataURL('image/png').split(',')[1]);
    const foreground = canvas(width, height), fgctx = foreground.getContext('2d');
    fgctx.drawImage(sample.image, 0, 0);
    const fg = fgctx.getImageData(0, 0, width, height);
    for (let i = 0; i < alpha.length; i++) fg.data[i * 4 + 3] = Math.round(alpha[i] * 255);
    fgctx.putImageData(fg, 0, 0);
    const composite = canvas(width * 3, height), c = composite.getContext('2d');
    ['#161a20', '#ffffff', '#4a87bb'].forEach((color, i) => {
        c.fillStyle = color; c.fillRect(width * i, 0, width, height); c.drawImage(foreground, width * i, 0);
    });
    await window.writeArtifact(`${sample.id}-${name}-backgrounds.jpg`, composite.toDataURL('image/jpeg', .88).split(',')[1]);
    mask.width = mask.height = foreground.width = foreground.height = composite.width = composite.height = 1;
}

export async function runPortraitBenchmark(options = {}) {
    if (busy) throw new Error('Benchmark already running');
    const repeats = options.repeats ?? 1;
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('Invalid repeats');
    busy = true; $('run').disabled = true; $('download').disabled = true; $('rows').replaceChildren();
    let manifest;
    try { manifest = await json('/_portrait-data/manifest.json'); }
    catch (error) { busy = false; $('run').disabled = false; throw error; }
    const selectedVariants = variants.filter(v => !options.variants || options.variants.includes(v.id));
    if (!selectedVariants.length) { busy = false; $('run').disabled = false; throw new Error('No valid variants selected'); }
    const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), userAgent: navigator.userAgent,
        backend: 'wasm', threads: 1, hardwareConcurrency: navigator.hardwareConcurrency, data: manifest,
        protocol: { maxEvaluationEdge: 1024, rgbResize: 'canvas-high-quality', alphaResize: 'continuous-bilinear-half-pixel',
            samPrompt: 'fixed-before-inference-RGB-only-box-if-present-otherwise-full-image', candidate: 'highest-predicted-IoU',
            gtUsage: 'scoring-only-no-prompts-no-candidate-selection', warmupsPerVariant: 1, repeats,
            modnetPreprocess: 'frozen-HF-processor-shortest-edge-512-divisible-32', memory: 'not-measured',
            artifacts: '8-bit-alpha-previews-only-metrics-use-float32', rgb: 'original-composite-RGB-no-foreground-unmixing' },
        assets: {}, samples: [], variants: [], rows: [] };
    try {
        const prompts = (options.promptSet ?? 'rgb-boxes') === 'rgb-boxes' ? await json('./prompts.json') : null;
        result.protocol.promptSet = prompts ?? 'full-image-box-no-GT';
        const samples = [];
        for (const record of manifest.samples) {
            $('status').textContent = '读取配对样本 ' + record.id; await tick();
            if (prompts && !prompts.samples[record.id]) throw new Error('No fixed prompt for ' + record.id);
            const sample = await readSample(record, prompts?.samples[record.id]); samples.push(sample); result.samples.push(sample.metadata);
            await artifact(sample, sample.truth, 'truth');
        }
        if (!samples.length) throw new Error('No paired samples');
        const state = await runtime();
        for (const variant of selectedVariants) {
            let model;
            const meta = { ...variant, status: 'loading' }; result.variants.push(meta);
            try {
                $('status').textContent = '加载 ' + variant.id; await tick();
                result.assets[variant.model] ||= await json('/_benchmark-models/' + variant.model + '/audit.json');
                const start = performance.now();
                const Model = variant.model === 'slimsam' ? state.SamModel : state.AutoModel;
                model = await Model.from_pretrained(variant.model, { dtype: variant.dtype, device: 'wasm', local_files_only: true });
                const processor = await state.AutoProcessor.from_pretrained(variant.model, { local_files_only: true });
                meta.loadMs = performance.now() - start;
                const engine = { ...state, model, processor }, infer = variant.model === 'slimsam' ? inferSam : inferModnet;
                $('status').textContent = '预热 ' + variant.id; await tick();
                const warmup = await infer(engine, samples[0]); meta.warmupMs = warmup.inferencePipelineMs;
                for (const sample of samples) for (let repeat = 0; repeat < repeats; repeat++) {
                    $('status').textContent = `${variant.id} · ${sample.id} · ${repeat + 1}/${repeats}`; await tick();
                    try {
                        const { alpha, ...timing } = await infer(engine, sample), metricsAt = performance.now();
                        const metrics = measurePortrait(alpha, sample.truth, sample.image.width, sample.image.height);
                        const row = { variant: variant.id, sample: sample.id, repeat, status: 'ok', ...timing,
                            ...metrics, metricsMs: performance.now() - metricsAt };
                        result.rows.push(row);
                        if (repeat === 0) await artifact(sample, alpha, variant.id);
                        const tr = document.createElement('tr');
                        for (const v of [variant.id, sample.id, metrics.iou.toFixed(4), metrics.boundaryF1.toFixed(4),
                            metrics.transitionMAE?.toFixed(4) ?? '—', metrics.edgeBandMAE?.toFixed(4) ?? '—', timing.inferencePipelineMs.toFixed(0)]) {
                            const td = document.createElement('td'); td.textContent = v; tr.append(td);
                        }
                        $('rows').append(tr);
                        if (window.recordProgress) await window.recordProgress(row);
                    } catch (error) {
                        result.rows.push({ variant: variant.id, sample: sample.id, repeat, status: 'failed', error: error.message });
                    }
                }
                meta.status = 'complete';
            } catch (error) { meta.status = 'failed'; meta.error = error.message; }
            finally { await model?.dispose(); }
        }
        const expected = samples.length * repeats * result.variants.length;
        result.status = result.variants.every(v => v.status === 'complete') && result.rows.length === expected && result.rows.every(r => r.status === 'ok') ? 'complete' : 'partial';
        window.portraitResult = result; $('download').disabled = false;
        $('summary').textContent = JSON.stringify({ status: result.status, variants: result.variants }, null, 2);
        $('status').textContent = '研究完成：' + result.status;
        return result;
    } finally { busy = false; $('run').disabled = false; }
}
$('run').onclick = () => runPortraitBenchmark().catch(error => { $('status').textContent = error.message; });
$('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(window.portraitResult, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'portrait-benchmark.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.runPortraitBenchmark = runPortraitBenchmark;
