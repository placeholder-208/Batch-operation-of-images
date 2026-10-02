import { canvasToBlob } from "./image.js";


function escapeCSV(value) {
    const text = String(value ?? "");

    if (
        text.includes("\"") ||
        text.includes(",") ||
        text.includes("\n") ||
        text.includes("\r")
    ) {
        return "\"" + text.replace(/"/g, "\"\"") + "\"";
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


export async function createImageZip(result) {
    const zip = new JSZip();

    for (const crop of result.crops) {
        const blob = await canvasToBlob(crop.canvas);

        const filename =
            String(crop.id).padStart(3, "0") + ".png";

        zip.file(filename, blob);
    }

    zip.file("result.csv", createCSV(result));

    return zip.generateAsync({
        type: "blob"
    });
}


export async function createAllZip(results) {
    const totalZip = new JSZip();

    for (const result of results) {
        const imageZip = await createImageZip(result);

        const baseName = result.filename.replace(
            /\.[^/.]+$/,
            ""
        );

        totalZip.file(
            `${baseName}.zip`,
            imageZip
        );
    }

    return totalZip.generateAsync({
        type: "blob"
    });
}