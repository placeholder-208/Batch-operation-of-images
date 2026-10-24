import { measure, truthBox } from './metrics.mjs';
import { boxPrompt } from '../../js/segmentation/mask-utils.js';
import { interpolatedAlpha } from '../../js/segmentation/postprocess.js';
const $ = id => document.getElementById(id), tick = () => new Promise(r => setTimeout(r, 0));
const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
let library, custom = [], busy = false;

function fixture(name, draw) {
    const mask = canvas(256, 256), c = mask.getContext('2d'); c.fillStyle = '#e07126'; draw(c);
    const rgba = c.getImageData(0, 0, 256, 256).data;
    const truth = Float32Array.from({ length: 65536 }, (_, i) => rgba[i * 4 + 3] / 255);
    const image = canvas(256, 256), ctx = image.getContext('2d');
    ctx.fillStyle = '#e6eee9'; ctx.fillRect(0, 0, 256, 256); ctx.drawImage(mask, 0, 0);
    return { name, image, truth, kind: 'synthetic-smoke', box: truthBox(truth, 256, 256) };
}
function fixtures() {
    return [fixture('solid', c => { c.beginPath(); c.roundRect(48, 48, 160, 160, 22); c.fill(); }),
        fixture('hole', c => { c.fillRect(48, 48, 160, 160); c.clearRect(88, 88, 80, 80); }),
        fixture('thin-parts', c => { c.fillRect(80, 64, 96, 128); for (let y = 72; y < 185; y += 16) { c.fillRect(48, y, 32, 2); c.fillRect(176, y, 32, 2); } })];
}
async function bitmap(file) {
    const source = await createImageBitmap(file), result = canvas(source.width, source.height);
    result.getContext('2d').drawImage(source, 0, 0); source.close(); return result;
}
function preview(samples) {
    $('samples').replaceChildren();
    for (const s of samples) {
        const figure = document.createElement('figure'), label = document.createElement('figcaption');
        label.textContent = s.name + ' · ' + s.kind; figure.append(s.image, label); $('samples').append(figure);
    }
}
$('files').onchange = async event => {
    try {
        const files = Array.from(event.target.files), samples = [], names = new Set();
        for (const file of files) {
            if (/_alpha\.[^.]+$/i.test(file.name)) continue;
            const stem = file.name.replace(/\.[^.]+$/, '');
            if (names.has(stem)) throw new Error('样本名称重复：' + stem); names.add(stem);
            const matches = files.filter(f => f.name === stem + '_alpha.png');
            if (matches.length !== 1) throw new Error('需要唯一配对蒙版：' + stem + '_alpha.png');
            const image = await bitmap(file), mask = await bitmap(matches[0]);
            if (image.width !== mask.width || image.height !== mask.height) throw new Error(stem + '：图片与蒙版尺寸不一致');
            if (image.width * image.height > 4_000_000) throw new Error('样本不能超过 400 万像素');
            const pixels = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data, truth = new Float32Array(mask.width * mask.height);
            for (let i = 0; i < truth.length; i++) {
                const p = i * 4;
                if (pixels[p + 3] !== 255 || pixels[p] !== pixels[p + 1] || pixels[p] !== pixels[p + 2]) throw new Error(stem + '：蒙版须为不透明灰度 PNG');
                truth[i] = pixels[p] / 255;
            }
            samples.push({ name: stem, kind: 'user-supplied-ground-truth', image, truth, box: truthBox(truth, image.width, image.height) });
        }
        if (!samples.length) throw new Error('没有成对样本');
        custom = samples; preview(custom); $('status').textContent = '已加载 ' + custom.length + ' 个真实样本。';
    } catch (error) { custom = []; $('samples').replaceChildren(); $('status').textContent = error.message; }
};
async function runtime() {
    if (library) return library;
    library = await import('../../vendor/segmentation/transformers.local.js');
    const { env } = library;
    env.allowRemoteModels = false; env.allowLocalModels = true; env.useBrowserCache = false;
    env.localModelPath = new URL('/_benchmark-models/', location.href).href;
    env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.wasmPaths = {
        mjs: new URL('../../vendor/segmentation/ort-wasm-simd-threaded.mjs', import.meta.url).href,
        wasm: new URL('../../vendor/segmentation/ort-wasm-simd-threaded.wasm', import.meta.url).href
    }; return library;
}
async function infer(state, sample) {
    const { model, processor, RawImage, Tensor } = state, { image, box } = sample;
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const work = canvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    const ctx = work.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, work.width, work.height); ctx.drawImage(image, 0, 0, work.width, work.height);
    let inputs, embeddings, labels, outputs, masks;
    try {
        const begin = performance.now(); inputs = await processor(RawImage.fromCanvas(work));
        const preprocessMs = performance.now() - begin, encodedAt = performance.now();
        embeddings = await model.get_image_embeddings(inputs); const encodeMs = performance.now() - encodedAt;
        const p = boxPrompt(box, [], work.width / image.width, work.height / image.height);
        const coords = processor.reshape_input_points([p.coords], inputs.original_sizes, inputs.reshaped_input_sizes);
        labels = new Tensor('int64', BigInt64Array.from(p.labels, BigInt), [1, 1, p.labels.length]);
        const decodeAt = performance.now(); outputs = await model({ ...embeddings, input_points: coords, input_labels: labels });
        masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes, { binarize: false });
        const decodeMs = performance.now() - decodeAt, scores = Array.from(outputs.iou_scores.data);
        if (!scores.length || !scores.every(Number.isFinite)) throw new Error('Invalid candidate scores');
        const selected = scores.indexOf(Math.max(...scores)), n = work.width * work.height;
        if (masks[0].data.length !== n * scores.length) throw new Error('Invalid mask shape');
        const logits = masks[0].data.subarray(selected * n, (selected + 1) * n), postAt = performance.now();
        const alpha = interpolatedAlpha(logits, work.width, work.height, image.width, image.height, 0, false, true);
        return { alpha, selectedCandidate: selected, scores, preprocessMs, encodeMs, decodeMs,
            postprocessMs: performance.now() - postAt, inferencePipelineMs: performance.now() - begin };
    } finally {
        inputs?.pixel_values?.dispose(); labels?.dispose(); outputs?.pred_masks?.dispose(); outputs?.iou_scores?.dispose();
        for (const t of Object.values(embeddings || {})) t?.dispose?.();
        for (const t of masks || []) t.dispose?.(); work.width = work.height = 1;
    }
}
export async function runBenchmark(repeats = 2) {
    if (busy) throw new Error('Benchmark already running');
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('测量次数应为 1～5');
    busy = true; $('run').disabled = $('files').disabled = $('repeats').disabled = true; $('download').disabled = true;
    $('rows').replaceChildren(); $('summary').textContent = ''; window.benchmarkResult = null;
    const samples = custom.length ? custom : fixtures(); preview(samples);
    const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency, backend: 'wasm', threads: 1, model: 'slimsam-77-uniform',
        protocol: { prompt: 'ground-truth-tight-box', candidate: 'highest-predicted-IoU', threshold: 0,
            warmupsPerVariant: 2, repeats, maxWorkingEdge: 1024, antialias: 'production-interpolatedAlpha',
            boundaryTolerancePixels: 2, memory: 'not-measured', loading: 'includes-initialization; not-network-only' },
        samples: samples.map(s => ({ name: s.name, kind: s.kind, width: s.image.width, height: s.image.height, box: s.box })), rows: [], variants: [] };
    try {
        const response = await fetch('/_benchmark-models/slimsam/audit.json');
        if (!response.ok) throw new Error('模型未准备完成，请运行 prepare.py，再用 serve.py 启动服务');
        result.assets = await response.json(); const state = await runtime();
        for (const dtype of ['q8', 'fp32']) {
            let model;
            try {
                $('status').textContent = '加载 ' + dtype + '…'; await tick(); const start = performance.now();
                model = await state.SamModel.from_pretrained('slimsam', { dtype, device: 'wasm', local_files_only: true });
                const processor = await state.AutoProcessor.from_pretrained('slimsam', { local_files_only: true });
                result.variants.push({ dtype, loadMs: performance.now() - start, status: 'loaded' });
                const engine = { ...state, model, processor };
                for (let w = 0; w < 2; w++) { $('status').textContent = dtype + ' 预热 ' + (w + 1); await tick(); await infer(engine, samples[0]); }
                for (const sample of samples) for (let repeat = 0; repeat < repeats; repeat++) {
                    $('status').textContent = dtype + ' · ' + sample.name + ' · ' + (repeat + 1); await tick();
                    try {
                        const prediction = await infer(engine, sample), metrics = measure(prediction.alpha, sample.truth, sample.image.width, sample.image.height);
                        const { alpha, ...timing } = prediction;
                        result.rows.push({ dtype, sample: sample.name, repeat, status: 'ok', ...metrics, ...timing });
                        const tr = document.createElement('tr');
                        for (const v of [dtype, sample.name, metrics.iou.toFixed(4), metrics.boundaryF1.toFixed(4), metrics.alphaMAE.toFixed(4), timing.encodeMs.toFixed(1), timing.decodeMs.toFixed(1)]) {
                            const td = document.createElement('td'); td.textContent = v; tr.append(td);
                        } $('rows').append(tr);
                    } catch (error) { result.rows.push({ dtype, sample: sample.name, repeat, status: 'failed', error: error.message }); }
                }
            } catch (error) { result.variants.push({ dtype, status: 'failed', error: error.message }); }
            finally { await model?.dispose(); }
        }
        result.status = result.variants.length === 2 && result.variants.every(v => v.status === 'loaded') && result.rows.length === samples.length * repeats * 2 && result.rows.every(r => r.status === 'ok') ? 'complete' : 'partial';
        window.benchmarkResult = result; $('download').disabled = false;
        $('summary').textContent = JSON.stringify({ status: result.status, variants: result.variants, successful: result.rows.filter(r => r.status === 'ok').length, failed: result.rows.filter(r => r.status === 'failed').length }, null, 2);
        $('status').textContent = result.status === 'complete' ? '评估完成。合成图仅用于验证流程，请勿据此宣称真实任务最优。' : '部分失败，请检查 JSON 中的错误。';
        return result;
    } finally { busy = false; $('run').disabled = $('files').disabled = $('repeats').disabled = false; }
}
$('run').onclick = () => runBenchmark(Number($('repeats').value)).catch(e => { $('status').textContent = e.message; });
$('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(window.benchmarkResult, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'segmentation-benchmark.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.runBenchmark = runBenchmark;
