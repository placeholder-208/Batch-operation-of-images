// Explicit persistence boundary: keep user work, never DOM nodes, runtime URLs or credentials.
const ITEM_FIELDS = ['file', 'result', 'crops', 'error', 'elapsedMs', 'auto', 'manual',
    'decodedCount', 'candidateCount', 'detected', 'errorStatus', 'errorDiagnostic',
    'cropError', 'attemptPrompt', 'prompt', 'source', 'qrStatistics','qrStatisticsHistory'];

function packCrop(crop) {
    const { image, url, canvas, ...saved } = crop;
    return saved;
}

export function packItem(item) {
    const saved = {};
    for (const field of ITEM_FIELDS) if (item[field] !== undefined) saved[field] = item[field];
    if (saved.result) {
        const { image, ...result } = saved.result;
        saved.result = { ...result };
        if (result.crops) saved.result.crops = result.crops.map(packCrop);
    }
    if (saved.crops) saved.crops = saved.crops.map(packCrop);
    return saved;
}

export function unpackItem(saved) {
    if (!(saved?.file instanceof Blob)) throw new Error('保存的原图文件无效');
    for (const crops of [saved.result?.crops, saved.crops]) {
        if (crops !== undefined && (!Array.isArray(crops) || crops.some(crop => !(crop?.blob instanceof Blob)))) throw new Error('保存的裁图文件无效');
    }
    const item = packItem(saved);
    item.url = URL.createObjectURL(item.file);
    item.processing = false;
    if(item.qrStatistics?.status==='处理中'){
        item.qrStatistics={...item.qrStatistics,status:'上次处理已中断',
            stages:item.qrStatistics.stages.map(stage=>stage.status?stage:{...stage,status:'interrupted'})};
    }
    if (item.result) {
        item.result.image = item.url;
        if (item.result.crops) item.result.crops = item.result.crops.map(crop => ({
            ...crop, image: URL.createObjectURL(crop.blob)
        }));
    }
    if (item.crops) item.crops = item.crops.map(crop => ({ ...crop, url: URL.createObjectURL(crop.blob) }));
    return item;
}
