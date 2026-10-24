// Profiling is opt-in per call. No image pixels, link requests or decoded text are stored here.
export const QR_STATISTICS_VERSION = 2;
export const normalizeQRExperiments = (options = {}) => ({
    reordered:options.reordered===true,useTPS:options.useTPS===true
});
const round = value => Math.round(value * 100) / 100;
export function createQRStatistics(file, source, run = {}, options = {}) {
    const origin = performance.now();
    const experiments=normalizeQRExperiments(options);
    return {
        record: {
            schemaVersion: QR_STATISTICS_VERSION, startedAt: new Date().toISOString(),
            filename: file.name, fileBytes: file.size, source: source || null, run,
            settings: {...experiments,fullVariants:experiments.reordered?1:7, tryHarder: true, returnErrors: false,
                decoderRevision:'3.9-gray-retry',continuousResample:experiments.reordered,
                continuousModelLimit:experiments.reordered?3:0,
                regionLimit: 8, curvedRegionLimit: 2, curvedModelLimit: 12, geometryBudgetMs: 2000,
                tpsExtraGeometryBudgetMs:experiments.useTPS?2000:0,tpsExtraModelLimit:experiments.useTPS?12:0},
            manualReview: {missedQRCodeCount: null, falseCandidateCount: null, notes: ''},
            status: '处理中', stages: [], variants: [], regions: [], codes: []
        },
        start(name, metadata = {}) {
            const began = performance.now();
            const stage = {name, offsetMs: round(began - origin), ...metadata};
            this.record.stages.push(stage);
            let finished = false;
            return (status = 'ok', extra = {}) => {
                if (finished) return;
                finished = true;
                Object.assign(stage, {elapsedMs: round(performance.now() - began), status}, extra);
            };
        },
        finish(codes = [], error = null) {
            const record = this.record;
            record.codes = codes.map((qr, i) => ({id: qr.id ?? i + 1, source: qr.source, points: qr.points}));
            record.decodedCount = codes.length;
            record.totalMs = round(performance.now() - origin);
            record.finishedAt = new Date().toISOString();
            const unresolved = record.regions.filter(region => !region.covered);
            record.unresolvedRegionCount = unresolved.length;
            record.failedStageCount = record.stages.filter(stage => stage.status === 'error').length;
            record.status = error ? '处理失败' : record.detection?.status !== 'ok' ? '检测未完成'
                : unresolved.length ? '候选未全部识别' : codes.length ? '全部识别' : '未识别';
            if (error) record.error = error.message || String(error);
            return record;
        }
    };
}
export async function measureQR(trace, name, metadata, task) {
    if (!trace) return task();
    const end = trace.start(name, metadata);
    try { const value = await task(); end(); return value; }
    catch (error) { end('error', {error: error.message || String(error)}); throw error; }
}
export function measureQRSync(trace, name, metadata, task) {
    if (!trace) return task();
    const end = trace.start(name, metadata);
    try { const value = task(); end(); return value; }
    catch (error) { end('error', {error: error.message || String(error)}); throw error; }
}
const sum = (record, names) => round((record?.stages || []).filter(s => names.includes(s.name))
    .reduce((total, s) => total + (s.elapsedMs || 0), 0));
const reasonLabels = {
    'finder-triple-not-found': '未找到可靠的三个定位方块',
    'no-accepted-model': '未得到通过结构检查的几何模型',
    'geometry-budget-reached': '几何分析达到时间预算',
    'source-memory-limit': '区域超过原图采样内存限制',
    'region-too-large': '分析区域超过像素限制',
    'models-undecodable': '已尝试校正模型但均未成功解码',
    'resampling-failed': '模型无法完成有效采样',
    'region-budget': '超过区域重试数量上限',
    'curved-budget': '超过曲面校正区域数量上限',
    'invalid-crop': '候选区域无法裁剪',
    'pipeline-aborted': '前序异常导致后续区域未处理',
    'not-covered': '结果未匹配到该候选区域',
    'runtime-error': '运行异常',
    'zxing-undecoded': 'ZXing返回定位但未解码，未匹配到WeChat区域'
};
function reasons(record) {
    if(record.error)return record.error;
    if(record.detection?.status!=='ok')return record.detection?.error||record.fallbackError||'检测未完成';
    if(!record.codes.length&&!record.regions.length)return 'ZXing未成功解码且WeChat未返回候选，原因待人工核对';
    return record.regions.filter(r => !r.covered).map(r =>
        '#' + r.id + ' ' + (reasonLabels[r.reason] || r.reason || r.outcome || '未完成')
        + (r.error ? ': ' + r.error : '')).join('；');
}
const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
export function qrStatisticsCSV(items) {
    const columns = ['序号','文件名','PDF来源','PDF页码','状态','识别数量','WeChat候选数','合并候选区域数',
        '未解决候选数','阶段异常数','总耗时ms','读图ms','预处理及传输ms','整图ZXingms',
        'WeChat初始化等待ms','WeChat检测ms','区域裁剪及探测ms','区域ZXingms',
        '曲面几何分析ms','曲面重采样ms','校正图ZXingms','输出裁图ms',
        '曲面尝试区域数','未解决原因','阶段异常详情','轮次ID','调整检测顺序','使用TPS',
        '局部增强预处理ms','TPS几何分析ms','TPS重采样ms','TPS解码ms',
        '人工补记漏检二维码数','人工标记误检候选数','人工备注',
        '解码实现版本','连续灰度重试','灰度重试次数','灰度重采样ms','灰度解码ms'];
    const attempts=items.flatMap((item,index)=>[...(item.qrStatisticsHistory||[]).map(r=>({item,index,r})),
        {item,index,r:item.qrStatistics}]);
    const familySum=(record,name,family)=>round((record?.stages||[])
        .filter(s=>s.name===name&&s.family===family).reduce((n,s)=>n+(s.elapsedMs||0),0));
    const rows = attempts.map(({item,index,r}) => {
        const source = item.source || r?.source;
        return [index+1,item.file.name,source?.type==='pdf'?source.name:'',source?.page ?? '',
            r?.status || (item.result?'历史结果无统计':'未运行'),r?.decodedCount ?? item.result?.count,
            r?.detection?.candidateCount,r?.regions.length,r?.unresolvedRegionCount,r?.failedStageCount,r?.totalMs,
            sum(r,['image_read']),sum(r,['preprocess_next']),sum(r,['full_decode']),
            sum(r,['wechat_init']),sum(r,['wechat_prepare','wechat_inference','wechat_postprocess']),
            sum(r,['region_crop','region_read']),sum(r,['region_decode']),sum(r,['curved_geometry']),
            sum(r,['curved_resample']),sum(r,['curved_decode']),sum(r,['output_crop']),
            r?.regions.filter(region=>region.curvedAttempted).length,r?reasons(r):'',
            r?.stages.filter(s=>s.status==='error').map(s=>s.name+': '+s.error).join('；'),
            r?.run?.id,r?r.settings?.reordered===true?'是':'否':'',r?r.settings?.useTPS===true?'是':'否':'',
            sum(r,['region_preprocess']),familySum(r,'curved_geometry','tps'),
            familySum(r,'curved_resample','tps'),familySum(r,'curved_decode','tps'),
            r?.manualReview.missedQRCodeCount,r?.manualReview.falseCandidateCount,r?.manualReview.notes,
            r?.settings?.decoderRevision,r?r.settings?.continuousResample===true?'是':'否':'',
            r?.stages.filter(s=>s.name==='curved_decode'&&s.samplingMode==='continuous-gray').length,
            round((r?.stages||[]).filter(s=>s.name==='curved_resample'&&s.samplingMode==='continuous-gray').reduce((n,s)=>n+(s.elapsedMs||0),0)),
            round((r?.stages||[]).filter(s=>s.name==='curved_decode'&&s.samplingMode==='continuous-gray').reduce((n,s)=>n+(s.elapsedMs||0),0))];
    });
    return '\ufeff' + [columns,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function qrStatisticsJSON(items) {
    const records = items.map((item,index)=>({index:index+1,filename:item.file.name,
        statistics:item.qrStatistics || null,history:item.qrStatisticsHistory||[]}));
    const measured = records.map(r=>r.statistics).filter(Boolean);
    return {
        schemaVersion: QR_STATISTICS_VERSION, exportedAt:new Date().toISOString(),
        definitions: {
            allRecognized:'全部识别仅表示本轮发现的候选已覆盖且有成功解码，未判定未知漏检；人工补记漏检数默认空白，不能视为零。',
            coverage:'WeChat候选按现有空间匹配规则与最终解码结果匹配，可能受过大框、重复框或误检影响。',
            timings:'毫秒为浏览器墙钟耗时，含线程排队、复制、首次运行库编译及调度等待；各图片按顺序处理。preprocess_next含后台启动/传输及末次迭代清理，不是纯算法CPU时间。',
            nesting:'curved_total与tps_total是父阶段，不得与子阶段重复相加。CSV曲面几何/重采样/解码总列包含TPS及原模型；另列TPS耗时是其中子集，也不能再加一次。totalMs含输出裁图及界面调度开销。',
            initialization:'run.decoderModuleInitMs为该批共享模块初始化时间，不计入逐图totalMs；wechat_init为检测会话获取等待，首次含下载/编译，后续通常为缓存命中。full_decode首次可能含ZXing WASM初始化。',
            limits:'两个实验开关关闭时保留原流程。调整顺序使用一次整图解码、局部四种增强、再对失败区域校正。TPS是额外的优先尝试，失败后给原柱面模型保留完整预算；最多增加每区域2000ms几何分析和12个校正图解码尝试。几何预算不是严格整区域超时。失败原因不自动推断为模糊或反光。',
            history:'每张图片最多保留最近8次旧统计加当前统计。CSV按图片与轮次展开；JSON当前statistics与history分别保存。不同开关组合不可混为同一实验结果。',
            continuousResample:'3.9版仅在调整检测顺序开启时启用连续灰度重采样；原模块二值模型全部失败后，最多重试排名前三的模型。TPS与柱面分支各自受此上限约束。samplingMode记录实际路径；灰度耗时已包含在曲面总列，不应重复相加。',
            privacy:'不保存像素、不主动收集解码文本；包含文件名、尺寸、坐标和原始异常信息。统计文件仅下载到本机。',
            manualReview:'missedQRCodeCount和falseCandidateCount默认null，需人工检查；修改CSV不会回写网页或JSON，后续分析时一并提供人工填写后的CSV与原始JSON。'
        },
        summary:{images:items.length,measured:measured.length,
            attempts:measured.length+records.reduce((n,r)=>n+r.history.length,0),
            allRecognized:measured.filter(r=>r.status==='全部识别').length,
            decoded:measured.reduce((n,r)=>n+(r.decodedCount||0),0),
            totalImageMs:round(measured.reduce((n,r)=>n+(r.totalMs||0),0))},
        records
    };
}
