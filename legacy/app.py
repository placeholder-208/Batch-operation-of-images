from pathlib import Path
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile, ZIP_DEFLATED

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse

from processor import processor


app = FastAPI()


# ============================================================
# ZIP 临时存储
# ============================================================

zip_storage = {}


# ============================================================
# HTML
# ============================================================

HTML = r"""
<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>QR Code Splitter</title>

    <style>

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 32px;
            background: #f5f6f8;
            color: #222;
            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                "Microsoft YaHei",
                sans-serif;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        h1 {
            margin-top: 0;
            margin-bottom: 24px;
        }

        .control-panel {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow:
                0 2px 10px rgba(0, 0, 0, 0.06);
        }

        .file-input {
            margin-bottom: 16px;
        }

        .options {
            display: flex;
            align-items: center;
            gap: 18px;
            flex-wrap: wrap;
        }

        .checkbox-label {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;
        }

        .buttons {
            display: flex;
            gap: 12px;
            margin-top: 18px;
            flex-wrap: wrap;
        }

        button {
            border: none;
            border-radius: 8px;
            padding: 10px 18px;
            font-size: 14px;
            cursor: pointer;
        }

        .primary-button {
            background: #1677ff;
            color: white;
        }

        .primary-button:hover {
            background: #0958d9;
        }

        .secondary-button {
            background: #eef1f5;
            color: #333;
        }

        .download-button {
            background: #52c41a;
            color: white;
        }

        button:disabled {
            background: #d9d9d9 !important;
            color: #999 !important;
            cursor: not-allowed;
        }

        .status {
            margin-top: 16px;
            color: #666;
            min-height: 22px;
        }

        .results {
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        .result-card {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow:
                0 2px 10px rgba(0, 0, 0, 0.06);
        }

        .result-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .result-title {
            font-size: 18px;
            font-weight: 600;
        }

        .result-count {
            color: #666;
            font-size: 14px;
        }

        .image-wrapper {
            position: relative;
            display: inline-block;
            max-width: 100%;
            line-height: 0;
        }

        .source-image {
            display: block;
            max-width: 100%;
            height: auto;
            border-radius: 6px;
        }

        .qr-marker {
            position: absolute;

            transform: translate(-50%, -50%);

            width: 30px;
            height: 30px;

            padding: 0;
            margin: 0;

            border: 2px solid white;
            border-radius: 50%;

            background: rgba(22, 119, 255, 0.90);

            color: white;

            font-size: 12px;
            font-weight: 600;

            display: flex;
            align-items: center;
            justify-content: center;

            line-height: 1;

            text-align: center;

            cursor: pointer;

            box-shadow:
                0 2px 6px rgba(0, 0, 0, 0.25);

            z-index: 10;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                "Microsoft YaHei",
                sans-serif;
        }

        .qr-marker:hover {
            background: rgba(9, 88, 217, 0.95);

            transform:
                translate(-50%, -50%)
                scale(1.12);
        }
        
        .result-footer {
            margin-top: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }

        .filename {
            color: #666;
            font-size: 13px;
        }

        .empty {
            padding: 40px;
            text-align: center;
            color: #888;
        }

        /* ============================
           Modal
           ============================ */

        .modal {
            display: none;

            position: fixed;

            inset: 0;

            background:
                rgba(0, 0, 0, 0.45);

            z-index: 1000;

            padding: 20px;

            align-items: center;
            justify-content: center;
        }

        .modal.show {
            display: flex;
        }

        .modal-content {
            width: min(700px, 100%);

            max-height: 90vh;

            overflow-y: auto;

            background: white;

            border-radius: 12px;

            padding: 24px;

            box-shadow:
                0 10px 40px
                rgba(0, 0, 0, 0.25);
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;

            margin-bottom: 20px;
        }

        .modal-title {
            font-size: 20px;
            font-weight: 600;
        }

        .close-button {
            width: 34px;
            height: 34px;

            padding: 0;

            border-radius: 50%;

            background: #f0f0f0;

            font-size: 20px;
        }

        .info-row {
            margin-bottom: 16px;
        }

        .info-label {
            display: block;

            margin-bottom: 6px;

            color: #666;

            font-size: 13px;
        }

        .qr-text {
            padding: 12px;

            background: #f5f5f5;

            border-radius: 8px;

            white-space: pre-wrap;
            word-break: break-word;

            font-family:
                Consolas,
                Monaco,
                monospace;

            font-size: 14px;

            line-height: 1.5;
        }

        .modal-actions {
            display: flex;
            gap: 10px;

            margin-top: 20px;

            flex-wrap: wrap;
        }

    </style>
</head>


<body>

<div class="container">

    <h1>QR Code Splitter</h1>


    <!-- ======================================================
         控制区域
         ====================================================== -->

    <div class="control-panel">

        <div class="file-input">

            <input
                id="fileInput"
                type="file"
                accept="image/*"
                multiple
            >

        </div>


        <div class="options">

            <label class="checkbox-label">

                <input
                    id="createZip"
                    type="checkbox"
                >

                <span>
                    输出切割后的图片 ZIP
                </span>

            </label>

        </div>


        <div class="buttons">

            <button
                id="processButton"
                class="primary-button"
            >
                开始识别
            </button>


            <button
                id="downloadAllButton"
                class="download-button"
                disabled
            >
                下载全部裁剪结果 ZIP
            </button>

        </div>


        <div
            id="status"
            class="status"
        ></div>

    </div>


    <!-- ======================================================
         结果
         ====================================================== -->

    <div
        id="results"
        class="results"
    ></div>

</div>


<!-- ==========================================================
     Modal
     ========================================================== -->

<div
    id="qrModal"
    class="modal"
>

    <div class="modal-content">

        <div class="modal-header">

            <div
                id="modalTitle"
                class="modal-title"
            >
                二维码
            </div>

            <button
                id="closeModalButton"
                class="close-button"
            >
                ×
            </button>

        </div>


        <div class="info-row">

            <span class="info-label">
                格式
            </span>

            <div id="modalFormat">
                -
            </div>

        </div>


        <div class="info-row">

            <span class="info-label">
                内容
            </span>

            <div
                id="modalText"
                class="qr-text"
            ></div>

        </div>


        <div class="modal-actions">

            <button
                id="copyButton"
                class="secondary-button"
            >
                复制内容
            </button>


            <button
                id="openUrlButton"
                class="primary-button"
                style="display:none;"
            >
                打开网页 ↗
            </button>

        </div>

    </div>

</div>


<script>

let currentResults = [];

let totalZipId = null;

let zipEnabled = false;

let currentQR = null;


// ============================================================
// DOM
// ============================================================

const fileInput =
    document.getElementById("fileInput");

const createZipCheckbox =
    document.getElementById("createZip");

const processButton =
    document.getElementById("processButton");

const downloadAllButton =
    document.getElementById("downloadAllButton");

const statusElement =
    document.getElementById("status");

const resultsElement =
    document.getElementById("results");

const modal =
    document.getElementById("qrModal");

const modalTitle =
    document.getElementById("modalTitle");

const modalFormat =
    document.getElementById("modalFormat");

const modalText =
    document.getElementById("modalText");

const copyButton =
    document.getElementById("copyButton");

const openUrlButton =
    document.getElementById("openUrlButton");

const closeModalButton =
    document.getElementById("closeModalButton");


// ============================================================
// ZIP 按钮状态
// ============================================================

function updateAllZipButton() {

    if (zipEnabled && totalZipId) {

        downloadAllButton.disabled = false;

    } else {

        downloadAllButton.disabled = true;

    }
}


// ============================================================
// URL 判断
// ============================================================

function isURL(text) {

    try {

        const url = new URL(text);

        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );

    } catch (error) {

        return false;

    }

}


// ============================================================
// 打开二维码详情
// ============================================================

function showQR(qr) {

    currentQR = qr;

    modalTitle.textContent =
        `二维码 #${qr.id}`;

    modalFormat.textContent =
        qr.format || "-";

    modalText.textContent =
        qr.text || "(二维码没有解码出文本内容)";


    if (isURL(qr.text)) {

        openUrlButton.style.display =
            "inline-block";

    } else {

        openUrlButton.style.display =
            "none";

    }


    modal.classList.add("show");

}


// ============================================================
// 关闭 Modal
// ============================================================

function closeModal() {

    modal.classList.remove("show");

    currentQR = null;

}


closeModalButton.addEventListener(
    "click",
    closeModal
);


modal.addEventListener(
    "click",
    function(event) {

        if (event.target === modal) {

            closeModal();

        }

    }
);


// ============================================================
// 复制
// ============================================================

copyButton.addEventListener(
    "click",
    async function() {

        if (!currentQR) {
            return;
        }

        try {

            await navigator.clipboard.writeText(
                currentQR.text || ""
            );

            copyButton.textContent =
                "已复制";

            setTimeout(
                function() {

                    copyButton.textContent =
                        "复制内容";

                },
                1200
            );

        } catch (error) {

            alert("复制失败，请手动复制。");

        }

    }
);


// ============================================================
// 打开网页
// ============================================================

openUrlButton.addEventListener(
    "click",
    function() {

        if (!currentQR) {
            return;
        }

        if (!isURL(currentQR.text)) {
            return;
        }

        window.open(
            currentQR.text,
            "_blank",
            "noopener,noreferrer"
        );

    }
);


// ============================================================
// 下载 ZIP
// ============================================================

function downloadZip(zipId) {

    if (!zipId) {
        return;
    }

    window.location.href =
        `/download/${zipId}`;

}


// ============================================================
// 渲染二维码标记
// ============================================================

function createMarkers(result, wrapper, image) {

    result.qrcodes.forEach(
        function(qr) {

            const marker =
                document.createElement("button");

            marker.className =
                "qr-marker";

            marker.textContent =
                qr.id;

            marker.title =
                `二维码 #${qr.id}`;


            function updatePosition() {

                const displayWidth =
                    image.clientWidth;

                const displayHeight =
                    image.clientHeight;


                if (
                    displayWidth <= 0 ||
                    displayHeight <= 0
                ) {
                    return;
                }


                const scaleX =
                    displayWidth /
                    result.width;

                const scaleY =
                    displayHeight /
                    result.height;


                const x =
                    qr.center.x *
                    scaleX;

                const y =
                    qr.center.y *
                    scaleY;


                marker.style.left =
                    `${x}px`;

                marker.style.top =
                    `${y}px`;

            }


            marker.addEventListener(
                "click",
                function(event) {

                    event.stopPropagation();

                    showQR(qr);

                }
            );


            wrapper.appendChild(marker);


            if (image.complete) {

                updatePosition();

            } else {

                image.addEventListener(
                    "load",
                    updatePosition,
                    { once: true }
                );

            }


            window.addEventListener(
                "resize",
                updatePosition
            );

        }
    );

}


// ============================================================
// 渲染单张图片
// ============================================================

function renderResult(result) {

    const card =
        document.createElement("div");

    card.className =
        "result-card";


    // --------------------------------------------------------
    // Header
    // --------------------------------------------------------

    const header =
        document.createElement("div");

    header.className =
        "result-header";


    const title =
        document.createElement("div");

    title.className =
        "result-title";

    title.textContent =
        result.filename;


    const count =
        document.createElement("div");

    count.className =
        "result-count";

    count.textContent =
        `识别到 ${result.count} 个二维码`;


    header.appendChild(title);

    header.appendChild(count);

    card.appendChild(header);


    // --------------------------------------------------------
    // Image
    // --------------------------------------------------------

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "image-wrapper";


    const image =
        document.createElement("img");

    image.className =
        "source-image";

    image.src =
        result.image;

    image.alt =
        result.filename;


    wrapper.appendChild(image);

    createMarkers(
        result,
        wrapper,
        image
    );

    card.appendChild(wrapper);


    // --------------------------------------------------------
    // Footer
    // --------------------------------------------------------

    const footer =
        document.createElement("div");

    footer.className =
        "result-footer";


    const filename =
        document.createElement("div");

    filename.className =
        "filename";

    filename.textContent =
        `${result.width} × ${result.height}`;


    footer.appendChild(filename);


    // --------------------------------------------------------
    // 单图片 ZIP 按钮
    // --------------------------------------------------------

    const downloadButton =
        document.createElement("button");

    downloadButton.className =
        "download-button";

    downloadButton.textContent =
        "下载此图片的裁剪 ZIP";


    const hasZip =
        zipEnabled &&
        !!result.zip_id;


    downloadButton.disabled =
        !hasZip;


    if (hasZip) {

        downloadButton.addEventListener(
            "click",
            function() {

                downloadZip(
                    result.zip_id
                );

            }
        );

    }


    footer.appendChild(
        downloadButton
    );


    card.appendChild(footer);


    return card;

}


// ============================================================
// 开始识别
// ============================================================

processButton.addEventListener(
    "click",
    async function() {

        const files =
            fileInput.files;


        if (!files || files.length === 0) {

            alert(
                "请先选择至少一张图片。"
            );

            return;

        }


        // ----------------------------------------------------
        // 重置状态
        // ----------------------------------------------------

        currentResults = [];

        totalZipId = null;

        zipEnabled =
            createZipCheckbox.checked;


        updateAllZipButton();


        resultsElement.innerHTML =
            "";


        statusElement.textContent =
            "正在识别，请稍候……";


        processButton.disabled =
            true;


        try {

            const formData =
                new FormData();


            for (
                const file of files
            ) {

                formData.append(
                    "files",
                    file
                );

            }


            formData.append(
                "create_zip",
                zipEnabled
                    ? "true"
                    : "false"
            );


            const response =
                await fetch(
                    "/process",
                    {
                        method: "POST",
                        body: formData
                    }
                );


            if (!response.ok) {

                const errorText =
                    await response.text();

                throw new Error(
                    errorText ||
                    `HTTP ${response.status}`
                );

            }


            const data =
                await response.json();


            currentResults =
                data.results || [];


            totalZipId =
                data.total_zip_id || null;


            // ------------------------------------------------
            // 渲染结果
            // ------------------------------------------------

            if (
                currentResults.length === 0
            ) {

                resultsElement.innerHTML =
                    `
                    <div class="result-card empty">
                        没有返回识别结果。
                    </div>
                    `;

            } else {

                currentResults.forEach(
                    function(result) {

                        resultsElement.appendChild(
                            renderResult(result)
                        );

                    }
                );

            }


            updateAllZipButton();


            const total =
                currentResults.reduce(
                    function(sum, item) {

                        return sum + item.count;

                    },
                    0
                );


            statusElement.textContent =
                `处理完成：${currentResults.length} 张图片，共识别 ${total} 个二维码。`;


        } catch (error) {

            console.error(error);


            statusElement.textContent =
                "处理失败。";


            resultsElement.innerHTML =
                `
                <div class="result-card empty">
                    处理失败：
                    ${escapeHtml(error.message)}
                </div>
                `;

        } finally {

            processButton.disabled =
                false;

        }

    }
);


// ============================================================
// 下载全部
// ============================================================

downloadAllButton.addEventListener(
    "click",
    function() {

        if (!totalZipId) {
            return;
        }

        downloadZip(
            totalZipId
        );

    }
);


// ============================================================
// HTML 转义
// ============================================================

function escapeHtml(text) {

    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}

</script>

</body>
</html>
"""


# ============================================================
# 首页
# ============================================================

@app.get("/", response_class=HTMLResponse)
async def index():
    return HTML


# ============================================================
# 图片处理
# ============================================================

@app.post("/process")
async def process_files(
    files: list[UploadFile] = File(...),
    create_zip: bool = Form(False),
):

    results = []

    individual_zips = []

    for file in files:

        image_bytes = await file.read()

        result = processor.process_image(
            image_bytes,
            file.filename,
            create_zip=create_zip,
        )


        # ----------------------------------------------------
        # 如果需要 ZIP：
        #
        # 每张图片创建一个独立 ZIP
        # ----------------------------------------------------

        if (
            create_zip
            and result.get("_zip_bytes") is not None
        ):

            zip_bytes = result["_zip_bytes"]

            # 为当前图片生成独立 zip_id
            zip_id = str(uuid4())

            zip_filename = (
                f"{Path(file.filename).stem}.zip"
            )


            zip_storage[zip_id] = {
                "filename": zip_filename,
                "data": zip_bytes,
            }


            # 给当前图片绑定自己的 ZIP
            result["zip_id"] = zip_id


            # 保存给“全部下载”使用
            individual_zips.append(
                {
                    "filename": zip_filename,
                    "data": zip_bytes,
                }
            )


        # 不把 ZIP 二进制数据传给浏览器
        result.pop(
            "_zip_bytes",
            None,
        )


        results.append(result)


    # ========================================================
    # 创建“全部下载” ZIP
    # ========================================================

    total_zip_id = None


    if (
        create_zip
        and individual_zips
    ):

        total_buffer = BytesIO()


        with ZipFile(
            total_buffer,
            mode="w",
            compression=ZIP_DEFLATED,
        ) as total_zip:

            for item in individual_zips:

                total_zip.writestr(
                    item["filename"],
                    item["data"],
                )


        total_zip_id = str(uuid4())


        zip_storage[total_zip_id] = {
            "filename": "qrcode_results.zip",
            "data": total_buffer.getvalue(),
        }


    return {
        "results": results,
        "zip_enabled": create_zip,
        "total_zip_id": total_zip_id,
    }


# ============================================================
# ZIP 下载
# ============================================================

@app.get("/download/{zip_id}")
async def download_zip(zip_id: str):

    item = zip_storage.get(zip_id)


    if item is None:

        return {
            "error": "ZIP 文件不存在或已经失效。"
        }


    return StreamingResponse(
        BytesIO(item["data"]),
        media_type="application/zip",
        headers={
            "Content-Disposition":
                f'attachment; filename="{item["filename"]}"'
        },
    )