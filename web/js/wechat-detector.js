import { report } from "./runtime-status.js";
const MODEL_URL = new URL(
    "../models/detect-web.onnx",
    import.meta.url
).href;

const CONFIG_URL = new URL(
    "../models/detect-web.json",
    import.meta.url
).href;

const RUNTIME_DIRECTORY = new URL(
    "../vendor/ort-1.22.0/",
    import.meta.url
).href;

let detectorPromise = null;

async function fetchRuntimeBinary() {
    const url = new URL(
        "ort-wasm-simd-threaded.wasm",
        RUNTIME_DIRECTORY
    );

    // 与此前独立下载检查采用相同方式。
    url.searchParams.set("check", String(Date.now()));

    const response = await fetch(url.href, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(
            `WASM 下载失败：HTTP ${response.status}`
        );
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const expectedHeader = [
        0, 97, 115, 109, 1, 0, 0, 0
    ];

    if (
        bytes.length < expectedHeader.length ||
        !expectedHeader.every(
            (value, index) => bytes[index] === value
        )
    ) {
        throw new Error(
            "下载内容不是有效的 WASM 文件，请检查文件或服务器响应"
        );
    }

    // 未压缩的响应可以直接比较下载长度。
    const declaredLength =
        response.headers.get("content-length");

    const encoding =
        response.headers.get("content-encoding");

    if (
        declaredLength !== null &&
        (!encoding || encoding === "identity") &&
        Number(declaredLength) !== bytes.byteLength
    ) {
        throw new Error(
            `WASM 长度不一致：声明 ${declaredLength}，` +
            `实际 ${bytes.byteLength}`
        );
    }

    console.log("[ORT WASM 下载完成]", {
        bytes: bytes.byteLength,
        header: Array.from(bytes.subarray(0, 8))
    });

    report("wechat", "WASM 下载完成：" + bytes.byteLength + " 字节");
    return bytes;
}

async function loadDetector() {
    report("wechat", "加载配置与运行库…");
    const runtime = globalThis.ort;

    if (!runtime) {
        throw new Error(
            "ONNX Runtime 未加载，请检查 index.html 中的脚本路径"
        );
    }

    const response = await fetch(CONFIG_URL);

    if (!response.ok) {
        throw new Error(
            `检测配置加载失败：HTTP ${response.status}`
        );
    }

    const config = await response.json();

    runtime.env.wasm.numThreads = 1;
    runtime.env.wasm.proxy = false;

    // MJS 仍需正常加载；WASM 使用下面手动下载的字节。
    runtime.env.wasm.wasmPaths = {
        mjs: new URL(
            "ort-wasm-simd-threaded.mjs",
            RUNTIME_DIRECTORY
        ).href
    };

    runtime.env.wasm.wasmBinary =
        await fetchRuntimeBinary();

    report("wechat", "正在创建检测会话…");
    console.log("[WeChat] 开始创建检测会话");

    const session = await runtime.InferenceSession.create(
        MODEL_URL,
        {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all"
        }
    );

    report("wechat", "检测会话已就绪", "ready");
    console.log("[WeChat] 检测会话创建成功");

    return {
        config,
        session
    };
}


function getDetector() {
    if (!detectorPromise) {
        detectorPromise = loadDetector().catch(function (error) {
            detectorPromise = null;
            report("wechat", "加载失败：" + (error.message || String(error)), "error");
            throw error;
        });
    }

    return detectorPromise;
}


function prepareInput(sourceCanvas, size) {
    const canvas = document.createElement("canvas");

    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext("2d", {
        willReadFrequently: true
    });

    // 透明像素以白色作为背景。
    context.fillStyle = "white";
    context.fillRect(0, 0, size, size);

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    // 直接缩放；候选框按横纵两个比例映射回原图。
    context.drawImage(sourceCanvas, 0, 0, size, size);

    const rgba = context.getImageData(0, 0, size, size).data;
    const grayscale = new Float32Array(size * size);

    for (let index = 0; index < grayscale.length; index++) {
        const offset = index * 4;

        grayscale[index] = (
            rgba[offset] * 0.299 +
            rgba[offset + 1] * 0.587 +
            rgba[offset + 2] * 0.114
        ) / 255;
    }

    return new globalThis.ort.Tensor(
        "float32",
        grayscale,
        [1, 1, size, size]
    );
}


function createAnchors(config, outputs) {
    const anchors = [];
    const size = config.inputSize;

    for (const layer of config.priorLayers) {
        const feature = outputs[layer.featureOutput];

        if (!feature || feature.dims.length !== 4) {
            throw new Error(
                `缺少特征图：${layer.featureOutput}`
            );
        }

        const height = feature.dims[2];
        const width = feature.dims[3];

        const attributes = layer.attributes;

        const stepX = attributes.step_w ||
            attributes.step || size / width;

        const stepY = attributes.step_h ||
            attributes.step || size / height;

        const offset = attributes.offset ?? 0.5;
        const variances = attributes.variance ||
            [0.1, 0.1, 0.2, 0.2];

        const aspectRatios = [1];

        for (const ratio of attributes.aspect_ratio || []) {
            if (!aspectRatios.some(
                existing => Math.abs(existing - ratio) < 1e-6
            )) {
                aspectRatios.push(ratio);

                if (attributes.flip) {
                    const inverse = 1 / ratio;

                    if (!aspectRatios.some(
                        existing =>
                            Math.abs(existing - inverse) < 1e-6
                    )) {
                        aspectRatios.push(inverse);
                    }
                }
            }
        }

        function appendAnchor(cx, cy, boxWidth, boxHeight) {
            let xmin = (cx - boxWidth / 2) / size;
            let ymin = (cy - boxHeight / 2) / size;
            let xmax = (cx + boxWidth / 2) / size;
            let ymax = (cy + boxHeight / 2) / size;

            if (attributes.clip) {
                xmin = clamp01(xmin);
                ymin = clamp01(ymin);
                xmax = clamp01(xmax);
                ymax = clamp01(ymax);
            }

            anchors.push({
                cx: (xmin + xmax) / 2,
                cy: (ymin + ymax) / 2,
                width: xmax - xmin,
                height: ymax - ymin,
                variances
            });
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const cx = (x + offset) * stepX;
                const cy = (y + offset) * stepY;

                for (
                    let index = 0;
                    index < attributes.min_size.length;
                    index++
                ) {
                    const minimum = attributes.min_size[index];

                    appendAnchor(cx, cy, minimum, minimum);

                    const maximum = attributes.max_size?.[index];

                    if (maximum !== undefined) {
                        const side = Math.sqrt(minimum * maximum);

                        appendAnchor(cx, cy, side, side);
                    }

                    for (const ratio of aspectRatios) {
                        if (Math.abs(ratio - 1) < 1e-6) {
                            continue;
                        }

                        const root = Math.sqrt(ratio);

                        appendAnchor(
                            cx,
                            cy,
                            minimum * root,
                            minimum / root
                        );
                    }
                }
            }
        }
    }

    return anchors;
}


function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}


function intersectionOverUnion(first, second) {
    const width = Math.max(
        0,
        Math.min(first.xmax, second.xmax) -
        Math.max(first.xmin, second.xmin)
    );

    const height = Math.max(
        0,
        Math.min(first.ymax, second.ymax) -
        Math.max(first.ymin, second.ymin)
    );

    const intersection = width * height;

    const firstArea =
        (first.xmax - first.xmin) *
        (first.ymax - first.ymin);

    const secondArea =
        (second.xmax - second.xmin) *
        (second.ymax - second.ymin);

    const union = firstArea + secondArea - intersection;

    return union > 0 ? intersection / union : 0;
}


function decodeBoxes(config, outputs, anchors) {
    const location = outputs[config.locationOutput].data;
    const confidence = outputs[config.confidenceOutput].data;
    const attributes = config.detectionAttributes;

    if (
        location.length !== anchors.length * 4 ||
        confidence.length !== anchors.length * 2
    ) {
        throw new Error(
            `anchor 数量不匹配：anchors=${anchors.length}, ` +
            `loc=${location.length}, conf=${confidence.length}`
        );
    }

    if (
        attributes.code_type !== 2 ||
        attributes.num_classes !== 2 ||
        attributes.background_label_id !== 0 ||
        !attributes.share_location
    ) {
        throw new Error("检测后处理参数与当前实现不匹配");
    }

    const threshold = attributes.confidence_threshold ?? 0.2;
    const candidates = [];

    for (let index = 0; index < anchors.length; index++) {
        // 模型已做 Softmax，第二类为二维码。
        const score = confidence[index * 2 + 1];

        if (!Number.isFinite(score) || score < threshold) {
            continue;
        }

        const anchor = anchors[index];
        const variance = anchor.variances;
        const offset = index * 4;

        const cx = anchor.cx +
            location[offset] * variance[0] * anchor.width;

        const cy = anchor.cy +
            location[offset + 1] * variance[1] * anchor.height;

        const width = anchor.width *
            Math.exp(location[offset + 2] * variance[2]);

        const height = anchor.height *
            Math.exp(location[offset + 3] * variance[3]);

        const box = {
            score,
            xmin: cx - width / 2,
            ymin: cy - height / 2,
            xmax: cx + width / 2,
            ymax: cy + height / 2
        };

        if (
            [box.xmin, box.ymin, box.xmax, box.ymax]
                .every(Number.isFinite) &&
            width > 0 &&
            height > 0
        ) {
            candidates.push(box);
        }
    }

    candidates.sort((first, second) => second.score - first.score);

    const topK = attributes.top_k ?? 100;
    const sorted = topK > 0
        ? candidates.slice(0, topK)
        : candidates;

    const selected = [];
    const nmsThreshold = attributes.nms_threshold ?? 0.45;
    const keepTopK = attributes.keep_top_k ?? 100;

    for (const candidate of sorted) {
        if (selected.some(function (existing) {
            return intersectionOverUnion(
                existing,
                candidate
            ) > nmsThreshold;
        })) {
            continue;
        }

        selected.push(candidate);

        if (keepTopK > 0 && selected.length >= keepTopK) {
            break;
        }
    }

    return selected;
}


export async function detectWechatRegions(sourceCanvas) {
    const startedAt = performance.now();
    const { config, session } = await getDetector();

    report("wechat", "正在检测候选区域…");
    const input = prepareInput(
        sourceCanvas,
        config.inputSize
    );

    let outputs;

    try {
        outputs = await session.run({
            [config.input]: input
        });

        const anchors = createAnchors(config, outputs);
        const boxes = decodeBoxes(config, outputs, anchors);

        const regions = boxes.map(function (box) {
            return {
                score: box.score,
                x: clamp01(box.xmin) * sourceCanvas.width,
                y: clamp01(box.ymin) * sourceCanvas.height,
                right: clamp01(box.xmax) * sourceCanvas.width,
                bottom: clamp01(box.ymax) * sourceCanvas.height
            };
        }).filter(function (region) {
            return region.right > region.x &&
                region.bottom > region.y;
        });

        console.log("[WeChat 检测]", {
            anchors: anchors.length,
            regions: regions.length,
            elapsedMs: Math.round(performance.now() - startedAt),
            boxes: regions
        });

        report("wechat", "候选 " + regions.length + " 个 · " + Math.round(performance.now() - startedAt) + " ms", "ready");
        return regions;
    } finally {
        input.dispose();

        if (outputs) {
            for (const tensor of Object.values(outputs)) {
                tensor.dispose();
            }
        }
    }
}
