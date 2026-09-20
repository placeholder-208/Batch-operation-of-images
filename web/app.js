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
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const resultsContainer = document.getElementById("results");
const zipOutput = document.getElementById("zipOutput");
const downloadAllZip = document.getElementById("downloadAllZip");

let currentResults = [];
function updateDownloadButtonState() {
    const enabled =
        zipOutput.checked &&
        currentResults.length > 0;

    downloadAllZip.disabled = !enabled;

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

console.log("app.js loaded");


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

function orderPoints(points) {
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

async function createAllZip(results) {
    const totalZip = new JSZip();

    for (const result of results) {
        const imageZip = await createImageZip(result);

        const baseName = result.filename
            .replace(/\.[^/.]+$/, "");

        totalZip.file(
            `${baseName}.zip`,
            imageZip
        );
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

function createMarkers(result, wrapper, image) {

    result.qrcodes.forEach(function (qr) {

        const marker = document.createElement("button");

        marker.className = "qr-marker";
        marker.textContent = qr.id;
        marker.title = `二维码 #${qr.id}`;

        function updatePosition() {

            const displayWidth = image.clientWidth;
            const displayHeight = image.clientHeight;

            if (displayWidth <= 0 || displayHeight <= 0) {
                return;
            }

            const scaleX = displayWidth / result.width;
            const scaleY = displayHeight / result.height;

            const x = qr.center.x * scaleX;
            const y = qr.center.y * scaleY;

            marker.style.left = `${x}px`;
            marker.style.top = `${y}px`;
        }

        marker.addEventListener("click", function (event) {
            event.stopPropagation();
            showQR(qr);
        });

        wrapper.appendChild(marker);

        if (image.complete) {
            updatePosition();
        } else {
            image.addEventListener("load", updatePosition, {
                once: true
            });
        }

        window.addEventListener("resize", updatePosition);
    });
}


function renderResult(file, result) {
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
    title.textContent = `${file.name} — ${result.count} 个二维码`;
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
    image.alt = file.name;

    wrapper.appendChild(image);
    container.appendChild(wrapper);

    resultsContainer.appendChild(container);

    createMarkers(result, wrapper, image);

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

    return {
        image: canvas.toDataURL("image/png"),
        width: bitmap.width,
        height: bitmap.height,
        canvas: canvas
    };
}


fileInput.addEventListener("change", async function () {

    const files = Array.from(fileInput.files);

    if (!files.length) {
        return;
    }

    resultsContainer.innerHTML = "";
    currentResults = [];
    progressText.textContent = "准备识别...";
    progressBar.style.width = "0%";

    updateDownloadButtonState();
    resultsContainer.innerHTML = "";
    currentResults = [];
    progressText.textContent = "准备识别...";
    progressBar.style.width = "0%";

    updateDownloadButtonState();

    try {

        if (!window.ZXingWASM) {
            throw new Error("ZXingWASM 尚未加载");
        }

        let totalCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            updateProgress(
                i + 1,
                files.length,
                file.name
            );

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

            const result = {
                filename: file.name,
                width: imageData.width,
                height: imageData.height,
                image: imageData.image,
                count: qrcodes.length,
                qrcodes: qrcodes,
                crops: crops
            };

            totalCount += qrcodes.length;

            currentResults.push(result);

            renderResult(file, result);

            updateProgress(
                i + 1,
                files.length,
                file.name
            );
        }

        progressText.textContent =
            `识别完成：${files.length} 张图片，共识别 ${totalCount} 个二维码`;

        progressBar.style.width = "100%";

        updateDownloadButtonState();

    } catch (error) {
        console.error(error);

        progressText.textContent =
            "识别失败：" +
            (error.message || String(error));

        progressBar.style.width = "0%";

        updateDownloadButtonState();
    }

});

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