function distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;

    return Math.sqrt(dx * dx + dy * dy);
}


function orderPoints(points) {
    const pts = points.map(function (point) {
        return {
            x: point.x,
            y: point.y
        };
    });

    const sums = pts.map(function (point) {
        return point.x + point.y;
    });

    const diffs = pts.map(function (point) {
        return point.x - point.y;
    });

    const topLeft = pts[sums.indexOf(Math.min(...sums))];
    const bottomRight = pts[sums.indexOf(Math.max(...sums))];
    const topRight = pts[diffs.indexOf(Math.max(...diffs))];
    const bottomLeft = pts[diffs.indexOf(Math.min(...diffs))];

    return [
        topLeft,
        topRight,
        bottomRight,
        bottomLeft
    ];
}


function getCropSize(points) {
    const [
        topLeft,
        topRight,
        bottomRight,
        bottomLeft
    ] = orderPoints(points);

    const widthTop = distance(topLeft, topRight);
    const widthBottom = distance(bottomLeft, bottomRight);

    const heightLeft = distance(topLeft, bottomLeft);
    const heightRight = distance(topRight, bottomRight);

    return {
        width: Math.max(
            1,
            Math.round(Math.max(widthTop, widthBottom))
        ),
        height: Math.max(
            1,
            Math.round(Math.max(heightLeft, heightRight))
        )
    };
}


function solveLinearSystem(matrix, values) {
    const n = values.length;

    const augmented = matrix.map(function (row, index) {
        return row.slice().concat(values[index]);
    });

    for (let column = 0; column < n; column++) {
        let pivotRow = column;

        for (let row = column + 1; row < n; row++) {
            if (
                Math.abs(augmented[row][column]) >
                Math.abs(augmented[pivotRow][column])
            ) {
                pivotRow = row;
            }
        }

        if (Math.abs(augmented[pivotRow][column]) < 1e-10) {
            throw new Error("透视变换矩阵不可逆");
        }

        [
            augmented[column],
            augmented[pivotRow]
        ] = [
            augmented[pivotRow],
            augmented[column]
        ];

        const pivot = augmented[column][column];

        for (let index = column; index <= n; index++) {
            augmented[column][index] /= pivot;
        }

        for (let row = 0; row < n; row++) {
            if (row === column) {
                continue;
            }

            const factor = augmented[row][column];

            for (let index = column; index <= n; index++) {
                augmented[row][index] -=
                    factor * augmented[column][index];
            }
        }
    }

    return augmented.map(function (row) {
        return row[n];
    });
}


function getPerspectiveTransform(src, dst) {
    const matrix = [];
    const values = [];

    for (let index = 0; index < 4; index++) {
        const x = src[index].x;
        const y = src[index].y;
        const u = dst[index].x;
        const v = dst[index].y;

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
    const [
        topLeft,
        topRight,
        bottomRight,
        bottomLeft
    ] = orderPoints(points);

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
        {
            x: padding + innerWidth,
            y: padding + innerHeight
        },
        { x: padding, y: padding + innerHeight }
    ];

    // 输出图坐标 → 原图坐标，供逐像素反向采样使用。
    const transform = getPerspectiveTransform(dst, src);

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

    const h00 = transform[0];
    const h01 = transform[1];
    const h02 = transform[2];
    const h10 = transform[3];
    const h11 = transform[4];
    const h12 = transform[5];
    const h20 = transform[6];
    const h21 = transform[7];

    for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {
            const denominator =
                h20 * x +
                h21 * y +
                1;

            const sourceX =
                (
                    h00 * x +
                    h01 * y +
                    h02
                ) / denominator;

            const sourceY =
                (
                    h10 * x +
                    h11 * y +
                    h12
                ) / denominator;

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


export {
    orderPoints,
    getCropSize,
    getPerspectiveTransform,
    perspectiveCrop
};
