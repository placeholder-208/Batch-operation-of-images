export async function processFile(file) {
    const bitmap = await createImageBitmap(file);

    const canvas = document.createElement("canvas");

    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    try { context.drawImage(bitmap, 0, 0); } finally { bitmap.close(); }

    return {
        image: null,
width: canvas.width,
        height: canvas.height,
        canvas: canvas
    };
}


export function canvasToBlob(canvas) {
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
