function distance(pointA, pointB) {
    const dx = pointA.x - pointB.x;
    const dy = pointA.y - pointB.y;

    return Math.sqrt(dx * dx + dy * dy);
}


function getSymbolSize(qr) {
    const top = distance(qr.points[0], qr.points[1]);
    const bottom = distance(qr.points[2], qr.points[3]);
    const left = distance(qr.points[0], qr.points[3]);
    const right = distance(qr.points[1], qr.points[2]);

    return Math.max(top, bottom, left, right);
}


function getCanvasImageData(canvas) {
    return canvas
        .getContext("2d")
        .getImageData(
            0,
            0,
            canvas.width,
            canvas.height
        );
}


function waitForOpenCV(timeout = 10000) {
    return new Promise(function (resolve) {
        const startedAt = Date.now();

        const timer = setInterval(function () {
            if (
                window.cv &&
                typeof window.cv.Mat === "function" &&
                typeof window.cv.QRCodeDetector === "function"
            ) {
                clearInterval(timer);
                resolve(true);
                return;
            }

            if (Date.now() - startedAt >= timeout) {
                clearInterval(timer);
                resolve(false);
            }
        }, 50);
    });
}


function createPointsMat(points) {
    const values = points.flatMap(function (point) {
        return [point.x, point.y];
    });

    return cv.matFromArray(
        1,
        4,
        cv.CV_32FC2,
        values
    );
}


export async function decodeCurvedCandidates(
    sourceCanvas,
    candidates
) {
    if (!candidates.length) {
        return [];
    }

    const openCVReady = await waitForOpenCV();

    if (!openCVReady) {
        console.warn("OpenCV 未能在规定时间内完成初始化");
        return [];
    }

    const selectedCandidates = candidates
        .filter(function (candidate) {
            return getSymbolSize(candidate) >= 50;
        })
        .sort(function (first, second) {
            return getSymbolSize(second) - getSymbolSize(first);
        })
        .slice(0, 8);

    if (!selectedCandidates.length) {
        return [];
    }

    const imageData = getCanvasImageData(sourceCanvas);

    const sourceMat = cv.matFromImageData(imageData);
    const detector = new cv.QRCodeDetector();

    const decoded = [];

    try {
        for (const candidate of selectedCandidates) {
            const pointsMat = createPointsMat(
                candidate.points
            );

            try {
                const text = detector.decodeCurved(
                    sourceMat,
                    pointsMat
                );

                if (!text) {
                    continue;
                }

                decoded.push({
                    text: text,
                    format: "QRCode",
                    points: candidate.points,
                    center: candidate.center,
                    source: "opencv-curved"
                });
            } catch (error) {
                console.warn(
                    "OpenCV 曲面解码失败",
                    error
                );
            } finally {
                pointsMat.delete();
            }
        }
    } finally {
        detector.delete();
        sourceMat.delete();
    }

    return decoded;
}