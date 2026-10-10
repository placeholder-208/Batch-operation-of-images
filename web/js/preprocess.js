function preprocessingCanvas(){
    return typeof document==='undefined' ? new OffscreenCanvas(1,1) : document.createElement('canvas');
}

export function clonePointMapper(width,height,direction,curvature=.55){
    return createCylindricalMapper(width,height,direction,curvature);
}

function cloneImageData(imageData) {
    return new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
    );
}


function getCanvasImageData(canvas) {
    const context = canvas.getContext("2d");

    return context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
    );
}


function createCanvasFromImageData(imageData) {
    const canvas = preprocessingCanvas();

    canvas.width = imageData.width;
    canvas.height = imageData.height;

    canvas
        .getContext("2d")
        .putImageData(imageData, 0, 0);

    return canvas;
}


function toGrayscaleContrast(imageData, contrast = 1.45) {
    const result = cloneImageData(imageData);
    const data = result.data;

    for (let index = 0; index < data.length; index += 4) {
        const gray =
            data[index] * 0.299 +
            data[index + 1] * 0.587 +
            data[index + 2] * 0.114;

        const value = Math.max(
            0,
            Math.min(
                255,
                (gray - 128) * contrast + 128
            )
        );

        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
    }

    return result;
}


function sharpen(imageData, strength = 0.85) {
    const width = imageData.width;
    const height = imageData.height;

    const source = imageData.data;
    const result = cloneImageData(imageData);
    const output = result.data;

    function getChannel(x, y, channel) {
        const clampedX = Math.max(0, Math.min(width - 1, x));
        const clampedY = Math.max(0, Math.min(height - 1, y));

        return source[
            (clampedY * width + clampedX) * 4 + channel
        ];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixelIndex = (y * width + x) * 4;

            for (let channel = 0; channel < 3; channel++) {
                const center = getChannel(x, y, channel);

                const blurred =
                    (
                        getChannel(x - 1, y - 1, channel) +
                        getChannel(x, y - 1, channel) * 2 +
                        getChannel(x + 1, y - 1, channel) +
                        getChannel(x - 1, y, channel) * 2 +
                        center * 4 +
                        getChannel(x + 1, y, channel) * 2 +
                        getChannel(x - 1, y + 1, channel) +
                        getChannel(x, y + 1, channel) * 2 +
                        getChannel(x + 1, y + 1, channel)
                    ) / 16;

                output[pixelIndex + channel] = Math.max(
                    0,
                    Math.min(
                        255,
                        center + (center - blurred) * strength
                    )
                );
            }

            output[pixelIndex + 3] = source[pixelIndex + 3];
        }
    }

    return result;
}


function upscaleImageData(imageData, maxLongSide = 2400) {
    const longestSide = Math.max(
        imageData.width,
        imageData.height
    );

    const scale = Math.min(2, maxLongSide / longestSide);

    if (scale <= 1) {
        return cloneImageData(imageData);
    }

    const sourceCanvas = createCanvasFromImageData(imageData);

    const outputCanvas = preprocessingCanvas();

    outputCanvas.width = Math.round(imageData.width * scale);
    outputCanvas.height = Math.round(imageData.height * scale);

    const context = outputCanvas.getContext("2d");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
        sourceCanvas,
        0,
        0,
        outputCanvas.width,
        outputCanvas.height
    );

    try { return getCanvasImageData(outputCanvas); }
    finally { sourceCanvas.width=sourceCanvas.height=1;outputCanvas.width=outputCanvas.height=1; }
}


function adaptiveThreshold(imageData, radius = 15, bias = 8) {
    const width = imageData.width;
    const height = imageData.height;
    const source = imageData.data;

    const gray = new Uint8Array(width * height);

    for (let index = 0; index < gray.length; index++) {
        const sourceIndex = index * 4;

        gray[index] = Math.round(
            source[sourceIndex] * 0.299 +
            source[sourceIndex + 1] * 0.587 +
            source[sourceIndex + 2] * 0.114
        );
    }

    const integralWidth = width + 1;

    const integral = new Float64Array(
        integralWidth * (height + 1)
    );

    for (let y = 1; y <= height; y++) {
        let rowSum = 0;

        for (let x = 1; x <= width; x++) {
            rowSum += gray[(y - 1) * width + (x - 1)];

            integral[y * integralWidth + x] =
                integral[(y - 1) * integralWidth + x] +
                rowSum;
        }
    }

    const result = new ImageData(width, height);
    const output = result.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const left = Math.max(0, x - radius);
            const top = Math.max(0, y - radius);
            const right = Math.min(width - 1, x + radius);
            const bottom = Math.min(height - 1, y + radius);

            const area =
                (right - left + 1) *
                (bottom - top + 1);

            const sum =
                integral[
                    (bottom + 1) * integralWidth + (right + 1)
                ] -
                integral[
                    top * integralWidth + (right + 1)
                ] -
                integral[
                    (bottom + 1) * integralWidth + left
                ] +
                integral[
                    top * integralWidth + left
                ];

            const mean = sum / area;

            const value =
                gray[y * width + x] < mean - bias
                    ? 0
                    : 255;

            const outputIndex = (y * width + x) * 4;

            output[outputIndex] = value;
            output[outputIndex + 1] = value;
            output[outputIndex + 2] = value;
            output[outputIndex + 3] = 255;
        }
    }

    return result;
}

function createCylindricalMapper(
    width,
    height,
    direction,
    curvature = 0.55
) {
    const dimension =
        direction === "horizontal"
            ? width
            : height;

    const half = dimension / 2;
    const radius = half / curvature;
    const maxAngle = Math.asin(curvature);

    return function (point) {
        const axis =
            direction === "horizontal"
                ? point.x
                : point.y;

        const normalized = (axis - half) / half;

        const mappedAxis =
            half +
            radius *
                Math.sin(normalized * maxAngle);

        if (direction === "horizontal") {
            return {
                x: mappedAxis,
                y: point.y
            };
        }

        return {
            x: point.x,
            y: mappedAxis
        };
    };
}


function createCylindricalVariant(
    imageData,
    direction,
    curvature = 0.55
) {
    const width = imageData.width;
    const height = imageData.height;

    const source = imageData.data;
    const result = new ImageData(width, height);
    const output = result.data;

    const mapPoint = createCylindricalMapper(
        width,
        height,
        direction,
        curvature
    );

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sourcePoint = mapPoint({ x, y });

            const sourceX = Math.round(sourcePoint.x);
            const sourceY = Math.round(sourcePoint.y);

            const outputIndex = (y * width + x) * 4;

            if (
                sourceX < 0 ||
                sourceX >= width ||
                sourceY < 0 ||
                sourceY >= height
            ) {
                output[outputIndex + 3] = 0;
                continue;
            }

            const sourceIndex =
                (sourceY * width + sourceX) * 4;

            output[outputIndex] = source[sourceIndex];
            output[outputIndex + 1] = source[sourceIndex + 1];
            output[outputIndex + 2] = source[sourceIndex + 2];
            output[outputIndex + 3] = source[sourceIndex + 3];
        }
    }

    return {
        imageData: result,
        mapPoint: mapPoint
    };
}

export function createDecodeVariants(canvas, { curved = true } = {}) {
    const original = getCanvasImageData(canvas);

    const contrast = toGrayscaleContrast(original);

    const sharpened = sharpen(contrast);

    const enlarged = upscaleImageData(sharpened);

    const enlargedSharpened = sharpen(enlarged, 0.45);

    const adaptive = adaptiveThreshold(contrast);

    const curvedHorizontal = curved && createCylindricalVariant(
        contrast,
        "horizontal"
    );

    const curvedVertical = curved && createCylindricalVariant(
        contrast,
        "vertical"
    );

    return [
        {
            name: "original",
            imageData: original,
            scaleX: 1,
            scaleY: 1
        },
        {
            name: "contrast",
            imageData: contrast,
            scaleX: 1,
            scaleY: 1
        },
        {
            name: "sharpen",
            imageData: sharpened,
            scaleX: 1,
            scaleY: 1
        },
        {
            name: "upscale-sharpen",
            imageData: enlargedSharpened,
            scaleX: enlargedSharpened.width / original.width,
            scaleY: enlargedSharpened.height / original.height
        },
        {
            name: "adaptive-threshold",
            imageData: adaptive,
            scaleX: 1,
            scaleY: 1
        },
        ...(curved ? [{
            name: "cylindrical-horizontal",
            imageData: curvedHorizontal.imageData,
            scaleX: 1,
            scaleY: 1,
            mapPoint: curvedHorizontal.mapPoint
        },
        {
            name: "cylindrical-vertical",
            imageData: curvedVertical.imageData,
            scaleX: 1,
            scaleY: 1,
            mapPoint: curvedVertical.mapPoint
        }] : [])
    ];
}

// Same transforms and order as createDecodeVariants, with bounded live buffers.
export function iterateDecodeVariants(canvas,{curved=true}={}){
 function* generate(){
  let original=getCanvasImageData(canvas);
  yield {name:'original',imageData:original,scaleX:1,scaleY:1,releaseAfterDecode:true};
  const contrast=toGrayscaleContrast(original);original=null;
  yield {name:'contrast',imageData:contrast,scaleX:1,scaleY:1,releaseAfterDecode:true};
  let sharpened=sharpen(contrast);
  yield {name:'sharpen',imageData:sharpened,scaleX:1,scaleY:1,releaseAfterDecode:true};
  let enlarged=upscaleImageData(sharpened);sharpened=null;
  let enhanced=sharpen(enlarged,.45);enlarged=null;
  yield {name:'upscale-sharpen',imageData:enhanced,scaleX:enhanced.width/canvas.width,scaleY:enhanced.height/canvas.height,releaseAfterDecode:true};enhanced=null;
  yield {name:'adaptive-threshold',imageData:adaptiveThreshold(contrast),scaleX:1,scaleY:1,releaseAfterDecode:true};
  if(curved)for(const axis of ['horizontal','vertical']){
   const variant=createCylindricalVariant(contrast,axis);
   yield {name:'cylindrical-'+axis,imageData:variant.imageData,mapPoint:variant.mapPoint,scaleX:1,scaleY:1,releaseAfterDecode:true};
  }
 }
 const iterator=generate();iterator.length=curved?7:5;return iterator;
}
