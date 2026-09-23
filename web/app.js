window.ZXingWASM.prepareZXingModule({
    overrides: {
        locateFile: function (path, prefix) {
            if (path.endsWith(".wasm")) {
                return "./zxing/" + path;
            }
            return prefix + path;
        }
    }
});

const fileInput = document.getElementById("fileInput");
const folderInput = document.getElementById("folderInput");
const pickFilesButton = document.getElementById("pickFilesButton");
const pickFolderButton = document.getElementById("pickFolderButton");
const clearButton = document.getElementById("clearButton");
const dropZone = document.getElementById("dropZone");
const notice = document.getElementById("notice");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const resultsContainer = document.getElementById("results");
const zipOutput = document.getElementById("zipOutput");
const downloadAllZip = document.getElementById("downloadAllZip");

// 一次最多处理多少个文件，避免误拖整个磁盘目录把页面拖死
const MAX_FILE_COUNT = 500;

// 剪贴板里的图片常常没有文件名，或者统一叫 image.png
const GENERIC_FILE_NAME =
    /^(image|clipboard|blob|untitled)(\.[a-z0-9]+)?$/i;

const IMAGE_EXTENSION =
    /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|tiff?)$/i;

let currentResults = [];
let processing = false;
let pastedCount = 0;

function updateDownloadButtonState() {
    const enabled =
        zipOutput.checked &&
        currentResults.length > 0;

    downloadAllZip.disabled = !enabled;
    clearButton.disabled = currentResults.length === 0;

    document
        .querySelectorAll(".download-image-zip")
        .forEach(function (button) {
            button.disabled = !zipOutput.checked;
        });
}

function updateProgress(current, total, filename) {
    const percentage =
        total > 0
            ? Math.round((current / total) * 100)
            : 0;

    progressText.textContent =
        `正在识别第 ${current} / ${total} 张：${filename}`;

    progressBar.style.width = `${percentage}%`;
}

function nextFrame() {
    return new Promise(function (resolve) {
        requestAnimationFrame(function () {
            resolve();
        });
    });
}

function showNotice(text) {
    notice.textContent = text || "";
    notice.hidden = !text;
}

function isImageFile(file) {
    if (!file) {
        return false;
    }

    if (file.type && file.type.indexOf("image/") === 0) {
        return true;
    }

    return IMAGE_EXTENSION.test(file.name || "");
}

function createPastedName() {
    pastedCount += 1;

    const now = new Date();

    const pad = function (value) {
        return String(value).padStart(2, "0");
    };

    const stamp =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}` +
        `${pad(now.getDate())}-${pad(now.getHours())}` +
        `${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    return `pasted-${stamp}-${pastedCount}.png`;
}

function toEntry(file, fallbackName) {
    let name = "";

    if (
        file &&
        typeof file.webkitRelativePath === "string" &&
        file.webkitRelativePath.trim()
    ) {
        // 整文件夹上传时保留相对路径，方便区分同名图片
        name = file.webkitRelativePath;
    } else if (
        file &&
        file.name &&
        file.name.trim() &&
        !GENERIC_FILE_NAME.test(file.name)
    ) {
        name = file.name;
    } else if (fallbackName) {
        name = fallbackName;
    } else if (file && file.name) {
        name = file.name;
    } else {
        name = "image";
    }

    return {
        file: file,
        name: String(name).replace(/\\/g, "/")
    };
}

function normalizeInputs(inputs) {
    const entries = [];

    inputs.forEach(function (item) {
        if (!item) {
            return;
        }

        if (item.file) {
            entries.push({
                file: item.file,
                name: String(item.name || item.file.name || "image")
                    .replace(/\\/g, "/")
            });

            return;
        }

        entries.push(toEntry(item));
    });

    return entries;
}



function convertZXingResults(results) {
    return results.map(function (result, index) {

        const points = [
            {
                x: result.position.topLeft.x,
                y: result.position.topLeft.y
            },
            {
                x: result.position.topRight.x,
                y: result.position.topRight.y
            },
            {
                x: result.position.bottomRight.x,
                y: result.position.bottomRight.y
            },
            {
                x: result.position.bottomLeft.x,
                y: result.position.bottomLeft.y
            }
        ];

        const centerX =
            points.reduce((sum, point) => sum + point.x, 0) / 4;

        const centerY =
            points.reduce((sum, point) => sum + point.y, 0) / 4;

        return {
            id: index + 1,
            text: result.text || "",
            format: result.format || "",
            points: points,
            center: {
                x: centerX,
                y: centerY
            }
        };
    });
}


const qrModalBackdrop = document.getElementById("qrModalBackdrop");
const qrModalClose = document.getElementById("qrModalClose");
const qrModalTitle = document.getElementById("qrModalTitle");
const qrModalMeta = document.getElementById("qrModalMeta");
const qrModalContent = document.getElementById("qrModalContent");
const qrModalActions = document.getElementById("qrModalActions");

function closeQRModal() {
    qrModalBackdrop.classList.remove("show");
}

function isHttpUrl(text) {
    return /^https?:\/\/\S+$/i.test(text.trim());
}

function showQR(qr) {
    const text = qr.text || "";

    qrModalTitle.textContent = `二维码 #${qr.id}`;

    qrModalMeta.textContent =
        `格式：${qr.format || "未知"}`;

    qrModalContent.textContent =
        text || "(空内容)";

    qrModalActions.innerHTML = "";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "复制内容";
    copyButton.className = "primary";

    copyButton.addEventListener("click", async function () {
        try {
            await navigator.clipboard.writeText(text);

            const oldText = copyButton.textContent;
            copyButton.textContent = "已复制";

            setTimeout(function () {
                copyButton.textContent = oldText;
            }, 1200);
        } catch (error) {
            console.error(error);
            alert("复制失败，请手动复制内容。");
        }
    });

    qrModalActions.appendChild(copyButton);

    if (isHttpUrl(text)) {
        const openButton = document.createElement("a");

        openButton.href = text;
        openButton.target = "_blank";
        openButton.rel = "noopener noreferrer";
        openButton.textContent = "打开网页";

        qrModalActions.appendChild(openButton);
    }

    qrModalBackdrop.classList.add("show");
}

function distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function crossProduct(a, b, c) {
    return (
        (b.x - a.x) * (c.y - b.y) -
        (b.y - a.y) * (c.x - b.x)
    );
}

function isUsableQuad(points) {
    /**
     * 判断四个角点是不是已经按顺序排好：
     * 坐标必须是有限数字、边长不能为零，而且四条边的转向要一致
     * （也就是凸四边形、不自交），否则顺序不可信。
     */
    if (!points || points.length !== 4) {
        return false;
    }

    for (let i = 0; i < 4; i++) {
        const current = points[i];
        const next = points[(i + 1) % 4];

        if (
            !current ||
            !Number.isFinite(current.x) ||
            !Number.isFinite(current.y) ||
            !next ||
            !Number.isFinite(next.x) ||
            !Number.isFinite(next.y)
        ) {
            return false;
        }

        if (distance(current, next) < 1) {
            return false;
        }
    }

    let direction = 0;

    for (let i = 0; i < 4; i++) {
        const cross = crossProduct(
            points[i],
            points[(i + 1) % 4],
            points[(i + 2) % 4]
        );

        if (Math.abs(cross) < 1e-6) {
            continue;
        }

        const sign = cross > 0 ? 1 : -1;

        if (direction === 0) {
            direction = sign;
        } else if (sign !== direction) {
            return false;
        }
    }

    return direction !== 0;
}

function orderPointsByPosition(points) {
    const pts = points.map(function (p) {
        return { x: p.x, y: p.y };
    });

    const sums = pts.map(function (p) {
        return p.x + p.y;
    });

    const diffs = pts.map(function (p) {
        return p.x - p.y;
    });

    const topLeft = pts[sums.indexOf(Math.min(...sums))];
    const bottomRight = pts[sums.indexOf(Math.max(...sums))];
    const topRight = pts[diffs.indexOf(Math.max(...diffs))];
    const bottomLeft = pts[diffs.indexOf(Math.min(...diffs))];

    return [topLeft, topRight, bottomRight, bottomLeft];
}

function orderPoints(points) {
    /**
     * ZXing 返回的角点顺序本来就是
     * topLeft → topRight → bottomRight → bottomLeft，
     * 二维码旋转、倾斜时这个顺序依然成立，直接用才是对的。
     *
     * 以前这里无条件按「坐标极值」重排，遇到旋转 45 度左右
     * 或者透视比较明显的二维码时会把角点认错，
     * 裁剪结果就会歪斜甚至上下颠倒。
     * 现在只有角点顺序确实不可用（自交、退化、坐标非法）时，
     * 才退回按坐标极值排序。
     */
    if (isUsableQuad(points)) {
        return points.map(function (p) {
            return { x: p.x, y: p.y };
        });
    }

    return orderPointsByPosition(points);
}

function getCropSize(points) {
    const [topLeft, topRight, bottomRight, bottomLeft] = orderPoints(points);

    const widthTop = distance(topLeft, topRight);
    const widthBottom = distance(bottomLeft, bottomRight);

    const heightLeft = distance(topLeft, bottomLeft);
    const heightRight = distance(topRight, bottomRight);

    return {
        width: Math.max(1, Math.round(Math.max(widthTop, widthBottom))),
        height: Math.max(1, Math.round(Math.max(heightLeft, heightRight)))
    };
}

function solveLinearSystem(matrix, values) {
    const n = values.length;

    const a = matrix.map(function (row, i) {
        return row.slice().concat(values[i]);
    });

    for (let col = 0; col < n; col++) {
        let pivotRow = col;

        for (let row = col + 1; row < n; row++) {
            if (Math.abs(a[row][col]) > Math.abs(a[pivotRow][col])) {
                pivotRow = row;
            }
        }

        if (Math.abs(a[pivotRow][col]) < 1e-10) {
            throw new Error("透视变换矩阵不可逆");
        }

        [a[col], a[pivotRow]] = [a[pivotRow], a[col]];

        const pivot = a[col][col];

        for (let j = col; j <= n; j++) {
            a[col][j] /= pivot;
        }

        for (let row = 0; row < n; row++) {
            if (row === col) continue;

            const factor = a[row][col];

            for (let j = col; j <= n; j++) {
                a[row][j] -= factor * a[col][j];
            }
        }
    }

    return a.map(function (row) {
        return row[n];
    });
}

function getPerspectiveTransform(src, dst) {
    const matrix = [];
    const values = [];

    for (let i = 0; i < 4; i++) {
        const x = src[i].x;
        const y = src[i].y;
        const u = dst[i].x;
        const v = dst[i].y;

        matrix.push([
            x, y, 1, 0, 0, 0,
            -u * x, -u * y
        ]);
        values.push(u);

        matrix.push([
            0, 0, 0, x, y, 1,
            -v * x, -v * y
        ]);
        values.push(v);
    }

    const h = solveLinearSystem(matrix, values);

    return [
        h[0], h[1], h[2],
        h[3], h[4], h[5],
        h[6], h[7], 1
    ];
}

function perspectiveCrop(sourceCanvas, points, padding = 20) {
    const [topLeft, topRight, bottomRight, bottomLeft] =
        orderPoints(points);

    const cropSize = getCropSize(points);

    const innerWidth = cropSize.width;
    const innerHeight = cropSize.height;

    const outputWidth = innerWidth + padding * 2;
    const outputHeight = innerHeight + padding * 2;

    const src = [
        topLeft,
        topRight,
        bottomRight,
        bottomLeft
    ];

    const dst = [
        { x: padding, y: padding },
        { x: padding + innerWidth, y: padding },
        { x: padding + innerWidth, y: padding + innerHeight },
        { x: padding, y: padding + innerHeight }
    ];

    const H = getPerspectiveTransform(dst, src);

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;

    const outputContext = outputCanvas.getContext("2d");

    const sourceImageData = sourceCanvas
        .getContext("2d")
        .getImageData(
            0,
            0,
            sourceCanvas.width,
            sourceCanvas.height
        );

    const sourceData = sourceImageData.data;

    const outputImageData = outputContext.createImageData(
        outputWidth,
        outputHeight
    );

    const outputData = outputImageData.data;

    const h00 = H[0];
    const h01 = H[1];
    const h02 = H[2];
    const h10 = H[3];
    const h11 = H[4];
    const h12 = H[5];
    const h20 = H[6];
    const h21 = H[7];

    for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {

            const denominator =
                h20 * x +
                h21 * y +
                1;

            const sourceX =
                (h00 * x +
                 h01 * y +
                 h02) /
                denominator;

            const sourceY =
                (h10 * x +
                 h11 * y +
                 h12) /
                denominator;

            const sourceXi = Math.round(sourceX);
            const sourceYi = Math.round(sourceY);

            const outputIndex =
                (y * outputWidth + x) * 4;

            if (
                sourceXi < 0 ||
                sourceXi >= sourceCanvas.width ||
                sourceYi < 0 ||
                sourceYi >= sourceCanvas.height
            ) {
                outputData[outputIndex + 3] = 0;
                continue;
            }

            const sourceIndex =
                (sourceYi * sourceCanvas.width + sourceXi) * 4;

            outputData[outputIndex] =
                sourceData[sourceIndex];

            outputData[outputIndex + 1] =
                sourceData[sourceIndex + 1];

            outputData[outputIndex + 2] =
                sourceData[sourceIndex + 2];

            outputData[outputIndex + 3] =
                sourceData[sourceIndex + 3];
        }
    }

    outputContext.putImageData(outputImageData, 0, 0);

    return outputCanvas;
}

function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error("PNG 编码失败"));
            }
        }, "image/png");
    });
}

function escapeCSV(value) {
    const text = String(value ?? "");

    if (
        text.includes('"') ||
        text.includes(",") ||
        text.includes("\n") ||
        text.includes("\r")
    ) {
        return '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
}

function createCSV(result) {
    const rows = [
        ["id", "format", "text", "center_x", "center_y"]
    ];

    result.qrcodes.forEach(function (qr) {
        rows.push([
            qr.id,
            qr.format,
            qr.text,
            qr.center.x,
            qr.center.y
        ]);
    });

    return rows
        .map(function (row) {
            return row.map(escapeCSV).join(",");
        })
        .join("\r\n");
}

async function createImageZip(result) {
    const zip = new JSZip();

    for (const crop of result.crops) {
        const blob = await canvasToBlob(crop.canvas);

        const filename =
            String(crop.id).padStart(3, "0") + ".png";

        zip.file(filename, blob);
    }

    zip.file("result.csv", createCSV(result));

    return await zip.generateAsync({
        type: "blob"
    });
}

function sanitizeZipPath(name) {
    return String(name || "")
        .replace(/\\/g, "/")
        .split("/")
        .filter(function (segment) {
            return segment &&
                segment !== "." &&
                segment !== "..";
        })
        .join("/");
}


function stripExtension(path) {
    return path.replace(/\.[^/.]+$/, "");
}


async function createAllZip(results) {
    const totalZip = new JSZip();
    const usedNames = new Set();

    for (const result of results) {
        const imageZip = await createImageZip(result);

        const baseName =
            stripExtension(sanitizeZipPath(result.filename)) ||
            "image";

        // 整文件夹上传时可能有同名图片，重名就加序号，避免互相覆盖
        let name = `${baseName}.zip`;
        let index = 2;

        while (usedNames.has(name)) {
            name = `${baseName}-${index}.zip`;
            index += 1;
        }

        usedNames.add(name);

        totalZip.file(name, imageZip);
    }

    return await totalZip.generateAsync({
        type: "blob"
    });
}

qrModalClose.addEventListener("click", closeQRModal);

qrModalBackdrop.addEventListener("click", function (event) {
    if (event.target === qrModalBackdrop) {
        closeQRModal();
    }
});

document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
        closeQRModal();
    }
});

function createMarkers(result, wrapper) {

    result.qrcodes.forEach(function (qr) {

        const marker = document.createElement("button");

        marker.type = "button";
        marker.className = "qr-marker";
        marker.textContent = qr.id;
        marker.title = `二维码 #${qr.id}`;
        marker.setAttribute(
            "aria-label",
            `二维码 #${qr.id}，点击查看内容`
        );

        // 用百分比定位：图片怎么缩放，标记都自动跟着走。
        // 这样既不用监听 resize，也不会在处理大量图片时
        // 累积一大堆永远不解绑的事件监听器。
        marker.style.left =
            `${(qr.center.x / result.width) * 100}%`;

        marker.style.top =
            `${(qr.center.y / result.height) * 100}%`;

        marker.addEventListener("click", function (event) {
            event.stopPropagation();
            showQR(qr);
        });

        wrapper.appendChild(marker);
    });
}


function createNoQRCodeNotice() {
    const warning = document.createElement("div");

    warning.className = "result-warning";
    warning.textContent =
        "这张图片里没有识别到二维码。" +
        "可以试试更清晰、二维码更完整的图片，" +
        "或者先把二维码区域裁剪出来再上传。";

    return warning;
}


function renderErrorEntry(entry, error) {
    const container = document.createElement("div");
    container.className = "result";

    const title = document.createElement("h2");
    title.textContent = `${entry.name} — 处理失败`;
    title.style.margin = "0";

    const message = document.createElement("div");
    message.className = "result-error";

    const reason = String(
        error && error.message ? error.message : error
    ).replace(/[。.\s]+$/, "");

    message.textContent =
        `无法处理这张图片：${reason}。` +
        "请确认文件是浏览器能正常打开的图片格式" +
        "（PNG / JPEG / WebP 等）。";

    container.appendChild(title);
    container.appendChild(message);

    resultsContainer.appendChild(container);
}


function renderEmptyState() {
    const container = document.createElement("div");
    container.className = "empty-state";

    const title = document.createElement("h2");
    title.textContent = "没有识别到任何二维码";

    const tips = document.createElement("ul");

    [
        "确认二维码没有被裁掉、没有严重模糊或反光",
        "二维码太小时，可以先把二维码区域裁剪出来再试",
        "如果二维码是镜像或大面积旋转的，换一张更正的图片试试"
    ].forEach(function (text) {
        const item = document.createElement("li");

        item.textContent = text;

        tips.appendChild(item);
    });

    container.appendChild(title);
    container.appendChild(tips);

    resultsContainer.appendChild(container);
}


function renderResult(result) {
    const container = document.createElement("div");
    container.className = "result";

    // ===== 标题 + 单图 ZIP 下载 =====

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "16px";
    header.style.marginBottom = "12px";

    const title = document.createElement("h2");
    title.textContent = `${result.filename} — ${result.count} 个二维码`;
    title.style.margin = "0";

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.textContent = "下载本图裁剪 ZIP";
    downloadButton.disabled = !zipOutput.checked;
    downloadButton.className = "download-image-zip";

    downloadButton.addEventListener("click", async function () {
        if (!zipOutput.checked) {
            return;
        }

        try {
            downloadButton.disabled = true;
            downloadButton.textContent = "正在生成...";

            const blob = await createImageZip(result);

            const url = URL.createObjectURL(blob);

            const link = document.createElement("a");
            link.href = url;

            const baseName = result.filename
                .replace(/\.[^/.]+$/, "");

            link.download = `${baseName}.zip`;

            document.body.appendChild(link);
            link.click();
            link.remove();

            URL.revokeObjectURL(url);
        } catch (error) {
            console.error(error);

            alert(
                "生成 ZIP 失败：\n" +
                (error.message || String(error))
            );
        } finally {
            downloadButton.disabled = !zipOutput.checked;
            downloadButton.textContent = "下载本图裁剪 ZIP";
        }
    });

    header.appendChild(title);
    header.appendChild(downloadButton);

    container.appendChild(header);

    // ===== 原图 + 二维码标记 =====

    const wrapper = document.createElement("div");
    wrapper.className = "image-wrapper";

    const image = document.createElement("img");
    image.className = "source-image";
    image.src = result.image;
    image.alt = result.filename;

    wrapper.appendChild(image);
    container.appendChild(wrapper);

    resultsContainer.appendChild(container);

    createMarkers(result, wrapper);

    // 没识别到二维码时给出明确提示，
    // 而不是只在标题里写「0 个二维码」
    if (result.count === 0) {
        container.appendChild(createNoQRCodeNotice());

        return;
    }

    // ===== 裁剪结果折叠区域 =====

    const cropsDetails = document.createElement("details");
    cropsDetails.open = false;

    const cropsSummary = document.createElement("summary");
    cropsSummary.textContent =
        `裁剪结果（${result.crops.length} 张）`;

    cropsSummary.style.cursor = "pointer";
    cropsSummary.style.marginBottom = "12px";

    const cropsContainer = document.createElement("div");

    cropsContainer.style.display = "flex";
    cropsContainer.style.flexWrap = "wrap";
    cropsContainer.style.gap = "12px";

    // ===== 创建裁剪缩略图 =====

    result.crops.forEach(function (crop) {
        const cropWrapper = document.createElement("div");

        cropWrapper.style.width = "140px";
        cropWrapper.style.padding = "6px";
        cropWrapper.style.background = "white";
        cropWrapper.style.border = "1px solid #ddd";
        cropWrapper.style.borderRadius = "8px";

        const cropImage = document.createElement("img");

        cropImage.src = crop.image;
        cropImage.alt = `二维码 #${crop.id}`;

        cropImage.style.display = "block";
        cropImage.style.width = "100%";
        cropImage.style.height = "auto";

        const cropLabel = document.createElement("div");

        cropLabel.textContent = `#${crop.id}`;
        cropLabel.style.marginTop = "6px";
        cropLabel.style.textAlign = "center";
        cropLabel.style.fontSize = "13px";

        cropWrapper.appendChild(cropImage);
        cropWrapper.appendChild(cropLabel);

        cropsContainer.appendChild(cropWrapper);
    });

    cropsDetails.appendChild(cropsSummary);
    cropsDetails.appendChild(cropsContainer);

    container.appendChild(cropsDetails);
}


async function processFile(file) {

    const bitmap = await createImageBitmap(file);

    const canvas = document.createElement("canvas");

    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d");

    context.drawImage(bitmap, 0, 0);

    const imageData = {
        image: canvas.toDataURL("image/png"),
        width: bitmap.width,
        height: bitmap.height,
        canvas: canvas
    };

    // ImageBitmap 不会自动释放，批量处理大图时很容易把内存吃满
    bitmap.close();

    return imageData;
}


async function processSingleFile(entry) {

    const file = entry.file;

    const imageData = await processFile(file);

    const zxingResults =
        await window.ZXingWASM.readBarcodes(file, {
            formats: ["QRCode"],
            tryHarder: true
        });

    const qrcodes =
        convertZXingResults(zxingResults);

    const crops = qrcodes.map(function (qr) {
        const cropCanvas = perspectiveCrop(
            imageData.canvas,
            qr.points,
            20
        );

        return {
            id: qr.id,
            canvas: cropCanvas,
            image: cropCanvas.toDataURL("image/png")
        };
    });

    return {
        filename: entry.name,
        width: imageData.width,
        height: imageData.height,
        image: imageData.image,
        count: qrcodes.length,
        qrcodes: qrcodes,
        crops: crops
    };
}


function buildSummaryText(fileCount, totalCount, failedCount, emptyCount) {

    if (fileCount > 0 && failedCount === fileCount) {
        return `处理失败：${fileCount} 张图片都没能被读取`;
    }

    const parts = [];

    if (totalCount === 0) {
        parts.push(
            `识别完成：${fileCount} 张图片，没有识别到二维码`
        );
    } else {
        parts.push(
            `识别完成：${fileCount} 张图片，共识别 ${totalCount} 个二维码`
        );

        if (emptyCount > 0) {
            parts.push(`其中 ${emptyCount} 张没有识别到二维码`);
        }
    }

    if (failedCount > 0) {
        parts.push(`${failedCount} 张处理失败`);
    }

    return parts.join("，");
}


function resetResults() {
    currentResults = [];

    resultsContainer.innerHTML = "";

    progressText.textContent = "等待图片...";
    progressBar.style.width = "0%";

    showNotice("");

    updateDownloadButtonState();
}


async function handleFiles(inputs) {

    if (processing) {
        showNotice("正在处理上一批图片，请稍候……");

        return;
    }

    const entries = [];
    const seen = new Set();
    const notices = [];

    let skipped = 0;
    let duplicated = 0;

    normalizeInputs(inputs).forEach(function (entry) {

        const file = entry.file;

        if (!isImageFile(file)) {
            skipped += 1;

            return;
        }

        // 用「相对路径 + 大小 + 修改时间」判断重复：
        // 同一个文件被重复加入时跳过，但不同文件夹里的同名图片会照常处理
        const key =
            `${entry.name}|${file.size}|${file.lastModified}`;

        if (seen.has(key)) {
            duplicated += 1;

            return;
        }

        seen.add(key);
        entries.push(entry);
    });

    if (skipped > 0) {
        notices.push(`已忽略 ${skipped} 个非图片文件`);
    }

    if (duplicated > 0) {
        notices.push(`已跳过 ${duplicated} 个重复文件`);
    }

    if (entries.length > MAX_FILE_COUNT) {
        notices.push(
            `一次最多处理 ${MAX_FILE_COUNT} 个文件，多余的已忽略`
        );

        entries.length = MAX_FILE_COUNT;
    }

    showNotice(notices.join("；"));

    if (!entries.length) {
        if (!notices.length) {
            showNotice("没有找到可以处理的图片。");
        }

        return;
    }

    processing = true;

    updateDownloadButtonState();

    let totalCount = 0;
    let failedCount = 0;
    let emptyCount = 0;

    try {

        if (!window.ZXingWASM) {
            throw new Error("ZXingWASM 尚未加载");
        }

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            updateProgress(
                i + 1,
                entries.length,
                entry.name
            );

            // 先让浏览器把进度条画出来，再开始耗时的裁剪计算
            await nextFrame();

            try {
                const result = await processSingleFile(entry);

                currentResults.push(result);
                totalCount += result.count;

                if (result.count === 0) {
                    emptyCount += 1;
                }

                renderResult(result);

            } catch (error) {
                // 单张图片失败不影响这一批里其他图片
                failedCount += 1;

                console.error(error);

                renderErrorEntry(entry, error);
            }
        }

        // 整批都没有二维码时给一个总提示；
        // 只有一张图片时，行内提示已经足够
        if (
            totalCount === 0 &&
            failedCount === 0 &&
            entries.length > 1
        ) {
            renderEmptyState();
        }

    } catch (error) {
        console.error(error);

        failedCount = entries.length;

        progressText.textContent =
            "识别失败：" +
            (error.message || String(error));

    } finally {
        processing = false;

        if (failedCount < entries.length) {
            progressText.textContent = buildSummaryText(
                entries.length,
                totalCount,
                failedCount,
                emptyCount
            );
        }

        progressBar.style.width = "100%";

        updateDownloadButtonState();
    }
}


function collectDroppedEntries(dataTransfer) {
    const items = Array.from(dataTransfer.items || []);
    const entries = [];

    items.forEach(function (item) {

        if (item.kind !== "file") {
            return;
        }

        const entry = item.webkitGetAsEntry
            ? item.webkitGetAsEntry()
            : null;

        if (entry) {
            entries.push(entry);
        }
    });

    return entries;
}


async function walkEntry(entry, out, prefix) {

    if (!entry || out.length >= MAX_FILE_COUNT) {
        return;
    }

    if (entry.isFile) {
        const file = await new Promise(function (resolve, reject) {
            entry.file(resolve, reject);
        });

        out.push({
            file: file,
            name: prefix + (file.name || "image")
        });

        return;
    }

    if (!entry.isDirectory) {
        return;
    }

    const reader = entry.createReader();
    const folder = prefix + entry.name + "/";

    while (out.length < MAX_FILE_COUNT) {
        const batch = await new Promise(function (resolve, reject) {
            reader.readEntries(resolve, reject);
        });

        if (!batch.length) {
            break;
        }

        for (const child of batch) {
            await walkEntry(child, out, folder);
        }
    }
}


async function walkEntries(entries) {
    const out = [];

    for (const entry of entries) {
        await walkEntry(entry, out, "");
    }

    return out;
}


function handlePaste(event) {

    const clipboard = event.clipboardData;

    if (!clipboard) {
        return;
    }

    const files = [];

    Array.from(clipboard.items || []).forEach(function (item) {

        if (item.kind !== "file") {
            return;
        }

        const file = item.getAsFile
            ? item.getAsFile()
            : null;

        if (file) {
            files.push(file);
        }
    });

    if (!files.length) {
        Array.from(clipboard.files || []).forEach(function (file) {
            files.push(file);
        });
    }

    if (!files.length) {
        return;
    }

    event.preventDefault();

    handleFiles(
        files.map(function (file) {
            return toEntry(file, createPastedName());
        })
    );
}


function initUploadEvents() {

    pickFilesButton.addEventListener("click", function () {
        fileInput.click();
    });

    pickFolderButton.addEventListener("click", function () {
        folderInput.click();
    });

    clearButton.addEventListener("click", function () {
        fileInput.value = "";
        folderInput.value = "";

        resetResults();
    });

    fileInput.addEventListener("change", function () {
        const files = Array.from(fileInput.files || []);

        fileInput.value = "";

        if (files.length) {
            handleFiles(files);
        }
    });

    folderInput.addEventListener("change", function () {
        const files = Array.from(folderInput.files || []);

        folderInput.value = "";

        if (files.length) {
            handleFiles(files);
        }
    });

    ["dragenter", "dragover"].forEach(function (type) {
        dropZone.addEventListener(type, function (event) {
            event.preventDefault();
            event.stopPropagation();

            dropZone.classList.add("drag-over");
        });
    });

    ["dragleave", "dragend"].forEach(function (type) {
        dropZone.addEventListener(type, function (event) {
            event.preventDefault();
            event.stopPropagation();

            dropZone.classList.remove("drag-over");
        });
    });

    dropZone.addEventListener("drop", async function (event) {
        event.preventDefault();
        event.stopPropagation();

        dropZone.classList.remove("drag-over");

        const dataTransfer = event.dataTransfer;

        if (!dataTransfer) {
            return;
        }

        // dataTransfer 只在事件处理期间可靠，先把文件和条目取出来
        const plainFiles = Array.from(dataTransfer.files || []);
        const droppedEntries = collectDroppedEntries(dataTransfer);

        let inputs = [];

        if (droppedEntries.length) {
            try {
                inputs = await walkEntries(droppedEntries);
            } catch (error) {
                console.error(error);
            }
        }

        if (!inputs.length) {
            inputs = plainFiles;
        }

        if (inputs.length) {
            handleFiles(inputs);
        }
    });

    // 拖到页面其他位置时，别让浏览器直接打开图片
    ["dragover", "drop"].forEach(function (type) {
        window.addEventListener(type, function (event) {
            if (!dropZone.contains(event.target)) {
                event.preventDefault();
            }
        });
    });

    document.addEventListener("paste", handlePaste);
}

zipOutput.addEventListener("change", function () {
    updateDownloadButtonState();
});

downloadAllZip.disabled =
    !zipOutput.checked ||
    currentResults.length === 0;

downloadAllZip.addEventListener("click", async function () {
    if (!zipOutput.checked || !currentResults.length) {
        return;
    }

    try {
        downloadAllZip.disabled = true;
        downloadAllZip.textContent = "正在生成 ZIP...";

        const blob = await createAllZip(currentResults);

        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = "qrcode_results.zip";

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    } catch (error) {
        console.error(error);
        alert(
            "生成 ZIP 失败：\n" +
            (error.message || String(error))
        );
    } finally {
        downloadAllZip.disabled = false;
        downloadAllZip.textContent =
            "下载全部裁剪结果 ZIP";
    }
});

initUploadEvents();
