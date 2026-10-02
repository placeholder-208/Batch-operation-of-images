import { decodeQRCode } from "./decoder.js";
import { processFile } from "./image.js";
import { perspectiveCrop } from "./crop.js";
import { createDecodeVariants } from "./preprocess.js";
import {
    createImageZip,
    createAllZip
} from "./zip.js";

import {
    fileInput,
    progressText,
    progressBar,
    resultsContainer,
    zipOutput,
    downloadAllZip,
    updateDownloadButtonState,
    updateProgress,
    renderResult
} from "./ui.js";


let currentResults = [];


function assignIds(qrcodes) {
    return qrcodes.map(function (qr, index) {
        return {
            ...qr,
            id: index + 1
        };
    });
}


function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);

    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}


async function downloadImageZip(result) {
    const blob = await createImageZip(result);

    const baseName = result.filename.replace(
        /\.[^/.]+$/,
        ""
    );

    downloadBlob(blob, `${baseName}.zip`);
}


async function processQRCodeFile(file) {
    const imageData = await processFile(file);

    const variants = createDecodeVariants(imageData.canvas);

    const detected = await decodeQRCode(
        variants,
        imageData.canvas
    );

    const qrcodes = assignIds(detected);

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
        filename: file.name,
        width: imageData.width,
        height: imageData.height,
        image: imageData.image,
        count: qrcodes.length,
        qrcodes: qrcodes,
        crops: crops
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

    updateDownloadButtonState(false);

    try {
        let totalCount = 0;

        for (let index = 0; index < files.length; index++) {
            const file = files[index];

            updateProgress(
                index + 1,
                files.length,
                file.name
            );

            const result = await processQRCodeFile(file);

            totalCount += result.count;

            currentResults.push(result);

            renderResult(
                file,
                result,
                downloadImageZip
            );
        }

        progressText.textContent =
            `识别完成：${files.length} 张图片，共识别 ${totalCount} 个二维码`;

        progressBar.style.width = "100%";

        updateDownloadButtonState(
            currentResults.length > 0
        );
    } catch (error) {
        console.error(error);

        progressText.textContent =
            "识别失败：" +
            (error.message || String(error));

        progressBar.style.width = "0%";

        updateDownloadButtonState(
            currentResults.length > 0
        );
    }
});


zipOutput.addEventListener("change", function () {
    updateDownloadButtonState(
        currentResults.length > 0
    );
});


downloadAllZip.addEventListener("click", async function () {
    if (!zipOutput.checked || !currentResults.length) {
        return;
    }

    try {
        downloadAllZip.disabled = true;
        downloadAllZip.textContent = "正在生成 ZIP...";

        const blob = await createAllZip(currentResults);

        downloadBlob(blob, "qrcode_results.zip");
    } catch (error) {
        console.error(error);

        alert(
            "生成 ZIP 失败：\n" +
            (error.message || String(error))
        );
    } finally {
        updateDownloadButtonState(
            currentResults.length > 0
        );

        downloadAllZip.textContent =
            "下载全部裁剪结果 ZIP";
    }
});


updateDownloadButtonState(false);