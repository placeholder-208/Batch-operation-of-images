const fileInput = document.getElementById("fileInput");

const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");

const resultsContainer = document.getElementById("results");

const zipOutput = document.getElementById("zipOutput");
const downloadAllZip = document.getElementById("downloadAllZip");

const qrModalBackdrop =
    document.getElementById("qrModalBackdrop");

const qrModalClose =
    document.getElementById("qrModalClose");

const qrModalTitle =
    document.getElementById("qrModalTitle");

const qrModalMeta =
    document.getElementById("qrModalMeta");

const qrModalContent =
    document.getElementById("qrModalContent");

const qrModalActions =
    document.getElementById("qrModalActions");


function updateDownloadButtonState(hasResults) {
    downloadAllZip.disabled =
        !zipOutput.checked || !hasResults;

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

    qrModalContent.textContent = text || "(空内容)";

    qrModalActions.innerHTML = "";

    const copyButton = document.createElement("button");

    copyButton.type = "button";
    copyButton.className = "primary";
    copyButton.textContent = "复制内容";

    copyButton.addEventListener("click", async function () {
        try {
            await navigator.clipboard.writeText(text);

            copyButton.textContent = "已复制";

            setTimeout(function () {
                copyButton.textContent = "复制内容";
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

            marker.style.left =
                `${qr.center.x * scaleX}px`;

            marker.style.top =
                `${qr.center.y * scaleY}px`;
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


function createCropPreview(crop) {
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

    return cropWrapper;
}


function renderResult(file, result, downloadImageZip) {
    const container = document.createElement("div");

    container.className = "result";

    const header = document.createElement("div");

    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "16px";
    header.style.marginBottom = "12px";

    const title = document.createElement("h2");

    title.textContent =
        `${file.name} — ${result.count} 个二维码`;

    title.style.margin = "0";

    const downloadButton = document.createElement("button");

    downloadButton.type = "button";
    downloadButton.className = "download-image-zip";
    downloadButton.textContent = "下载本图裁剪 ZIP";
    downloadButton.disabled = !zipOutput.checked;

    downloadButton.addEventListener("click", async function () {
        if (!zipOutput.checked) {
            return;
        }

        try {
            downloadButton.disabled = true;
            downloadButton.textContent = "正在生成...";

            await downloadImageZip(result);
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

    const wrapper = document.createElement("div");

    wrapper.className = "image-wrapper";

    const image = document.createElement("img");

    image.className = "source-image";
    image.src = result.image;
    image.alt = file.name;

    wrapper.appendChild(image);
    container.appendChild(wrapper);

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

    result.crops.forEach(function (crop) {
        cropsContainer.appendChild(
            createCropPreview(crop)
        );
    });

    cropsDetails.appendChild(cropsSummary);
    cropsDetails.appendChild(cropsContainer);

    container.appendChild(cropsDetails);

    resultsContainer.appendChild(container);

    createMarkers(result, wrapper, image);
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


export {
    fileInput,
    progressText,
    progressBar,
    resultsContainer,
    zipOutput,
    downloadAllZip,
    updateDownloadButtonState,
    updateProgress,
    renderResult
};