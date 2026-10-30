// Profiling is opt-in per call. No image pixels, link requests or decoded text are stored here.
export const QR_STATISTICS_VERSION = 2;
export const normalizeQROptions = (options = {}) => ({useTPS:options?.useTPS===true,detailedRecovery:options?.detailedRecovery===true});
const round = value => Math.round(value * 100) / 100;
export function createQRStatistics(file, source, run = {}, options = {}) {
    const origin = performance.now();
    const settings=normalizeQROptions(options);
    return {
        record: {
            schemaVersion: QR_STATISTICS_VERSION, startedAt: new Date().toISOString(),
            filename: file.name, fileBytes: file.size, source: source || null, run,
            settings: {...settings,reordered:true,pipeline:'region-first',fullVariants:1, tryHarder: true, returnErrors: false,
                decoderRevision:'3.16-dense-sheet',continuousResample:true,continuousModelLimit:3,
                restoration:{enabled:true,baseEdge:384,maxEdge:settings.detailedRecovery?576:448,maxRegions:3,
                    maxFilters:settings.detailedRecovery?39:22,regionBudgetMs:settings.detailedRecovery?3500:1500,
                    imageBudgetMs:settings.detailedRecovery?10500:4500},
                restoredGeometry:{enabled:settings.detailedRecovery,maxEdge:384,maxRegions:3,maxCandidates:4,
                    budgetMs:7000,imageBudgetMs:14000,probeMs:200,geometryMs:600},
                moduleRecovery:{enabled:settings.detailedRecovery,maxModels:12,maxAttempts:180,budgetMs:1000,
                    sigmas:[.3,.45,.6],cutoffs:[.4,.45,.5,.55,.6],regularization:.01},
                structureSampling:{enabled:settings.detailedRecovery,baseEdge:384,maxEdge:448,maxRegions:3,maxModels:12,
                    maxAttempts:96,regionMs:2500,imageMs:7500,geometryMs:600,samplingMs:1000,
                    sampleRadius:0,cutoffs:[.5,.6,.7,.75],phaseSearch:false,pure:false},
                regionLimit: 8, curvedRegionLimit: 2, curvedModelLimit: 12, geometryBudgetMs: 2000,
                tpsExtraGeometryBudgetMs:settings.useTPS?2000:0,tpsExtraModelLimit:settings.useTPS?12:0},
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
    'dense-phase-budget': '密集相位重采样达到次数或时间预算',
    'dense-phase-size-budget': '区域超过密集相位采样尺寸限制',
    'dense-phase-undecodable': '密集相位重采样未成功解码',
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
    'zxing-undecoded': 'ZXing返回定位但未解码，未匹配到WeChat区域',
    'restoration-budget': '模糊恢复达到时间或区域预算',
    'restoration-undecodable': '已完成受限模糊恢复但未成功解码',
    'restored-geometry-budget': '恢复后校正达到时间或区域预算',
    'restored-geometry-undecodable': '已校正筛选的恢复图但未成功解码',
    'restored-finders-not-found': '恢复图未得到可用定位结构',
    'module-recovery-budget': '模块恢复达到时间或尝试数量预算',
    'structure-sampling-budget': '结构灰度校准达到时间或区域预算',
    'structure-sampling-undecodable': '已完成受限结构灰度校准但未成功解码'
};
function reasons(record) {
    if(record.error)return record.error;
    if(record.detection?.status!=='ok')return record.detection?.error||record.fallbackError||'检测未完成';
    if(!record.codes.length&&!record.regions.length)return 'ZXing未成功解码且WeChat未返回候选，原因待人工核对';
    return record.regions.filter(r => !r.covered).map(r =>
        '#' + r.id + ' ' + (reasonLabels[r.reason] || r.reason || r.outcome || '未完成')
        + (r.restoredGeometry?.reason ? '；追加校正：' + (reasonLabels[r.restoredGeometry.reason] || r.restoredGeometry.reason) : '')
        + (r.structureSampling?.reason ? '；灰度校准：' + (reasonLabels[r.structureSampling.reason] || r.structureSampling.reason) : '')
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
        '解码实现版本','连续灰度重试','灰度重试次数','灰度重采样ms','灰度解码ms',
        '模糊恢复尝试区域数','模糊恢复滤波次数','模糊恢复准备ms','模糊恢复滤波ms','模糊恢复解码ms','精细模糊恢复',
        '恢复后校正尝试区域数','恢复后校正滤波次数','恢复后准备及滤波ms','恢复后定位探测ms','恢复后校正ms','恢复后校正预算跳过数',
        '恢复后几何ms','恢复后采样ms','恢复后ZXingms',
        '模块恢复解码次数','模块恢复准备ms','模块恢复ZXingms','模块恢复预算跳过数',
        '结构灰度校准区域数','结构灰度校准次数','结构灰度准备ms','结构灰度几何ms','结构灰度采样ms','结构灰度ZXingms','结构灰度预算跳过数',
        '密集补检状态','密集补检分块数','密集补检新增候选','密集补检ms','密集相位尝试次数','密集相位总ms','密集相位几何ms','密集相位采样ms','密集相位ZXingms','密集相位预算跳过数'];
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
            round((r?.stages||[]).filter(s=>s.name==='curved_decode'&&s.samplingMode==='continuous-gray').reduce((n,s)=>n+(s.elapsedMs||0),0)),
            r?.regions.filter(region=>(region.restoration?.attempted||0)>0).length,
            (r?.regions||[]).reduce((n,region)=>n+(region.restoration?.filtersAttempted||0),0),
            sum(r,['deblur_prepare']),sum(r,['deblur_restore']),sum(r,['deblur_decode']),
            r?r.settings?.detailedRecovery===true?'是':'否':'',
            (r?.regions||[]).filter(region=>region.restoredGeometry?.probed>0).length,
            (r?.regions||[]).reduce((n,region)=>n+(region.restoredGeometry?.filtersAttempted||0),0),
            sum(r,['restored_geometry_prepare','restored_geometry_restore']),sum(r,['restored_geometry_probe']),
            sum(r,['restored_geometry_fit']),
            (r?.regions||[]).filter(region=>region.restoredGeometry?.status==='skipped').length,
            sum(r,['restored_curved_geometry']),sum(r,['restored_curved_resample']),sum(r,['restored_curved_decode']),
            (r?.stages||[]).filter(s=>s.name==='restored_curved_decode'&&s.samplingMode==='module-recovery').length,
            sum(r,['restored_curved_module_restore']),
            round((r?.stages||[]).filter(s=>s.name==='restored_curved_decode'&&s.samplingMode==='module-recovery').reduce((n,s)=>n+(s.elapsedMs||0),0)),
            (r?.regions||[]).reduce((n,region)=>n+(region.restoredGeometry?.trials||[]).filter(t=>t.geometry?.moduleRecoverySkipped).length,0),
            (r?.regions||[]).filter(region=>region.structureSampling?.tiers?.length>0).length,
            (r?.regions||[]).reduce((n,region)=>n+(region.structureSampling?.attempted||0),0),
            sum(r,['structure_prepare']),sum(r,['structure_geometry']),sum(r,['structure_sample']),sum(r,['structure_decode']),
            (r?.regions||[]).filter(region=>region.structureSampling?.status==='skipped').length,
            r?.denseDetection?.status||'',(r?.denseDetection?.tiles||[]).filter(t=>t.status==='ok').length,r?.denseDetection?.addedCandidates||0,round(r?.denseDetection?.elapsedMs||0),
            (r?.regions||[]).reduce((n,region)=>n+(region.denseSampling?.attempted||0),0),sum(r,['dense_phase_total']),sum(r,['dense_phase_geometry']),sum(r,['dense_phase_sample']),sum(r,['dense_phase_decode']),
            (r?.regions||[]).filter(region=>region.denseSampling?.status==='skipped').length];
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
            limits:'3.10起固定使用一次整图解码、WeChat候选补充、局部四种增强、再对失败区域校正。CSV保留调整检测顺序列以读取旧轮次，新轮次恒为是。TPS仍是可选的额外优先尝试，失败后给原柱面模型保留完整预算；最多增加每区域2000ms几何分析和12个校正图解码尝试。几何预算不是严格整区域超时。失败原因不自动推断为模糊或反光。',
            history:'每张图片最多保留最近8次旧统计加当前统计。CSV按图片与轮次展开；JSON当前statistics与history分别保存。不同开关组合不可混为同一实验结果。',
            continuousResample:'原模块二值模型全部失败后，最多对入选的前三个模型补做连续灰度重采样。TPS与柱面分支各自受此上限约束。samplingMode记录实际路径；灰度耗时已包含在曲面总列，不应重复相加。',
            denseSheets:'3.16起仅当整图已解出至少8码、长宽均不小于600且WeChat候选少于已解数量的75%时，补做6个重叠块检测；单块最长边1024、协作式6000ms预算。保留原候选及其优先级，只追加合并后的新候选。密集路径仍失败时末尾补试最多2区域的结构校准相位采样，每区域1500ms、整图3000ms、最多160次解码。次数/时间/尺寸跳过与算法未解码分别记录。dense_phase_total是父阶段，不与几何、采样、解码子项重复相加；所有结果必须通过实际ZXing解码。',
            restoration:'对未解决且已裁剪的候选补做受限Wiener恢复。3.12起保留384像素17种滤波，失败后在448像素补试5种高斯核；精细模式再在576像素补试17种滤波。所有尺寸均不超过原区域大小，不重复相同尺寸，核宽按工作分辨率同比缩放。每图最多3区域；默认区域1500ms/整图4500ms，精细模式3500ms/10500ms，均为协作式预算。deblur_total是父阶段，不与子阶段重复相加。geometryReason保留恢复前的原因；tiers/selectedEdge记录实际分级尝试。',
            restoredGeometry:'仅精细模式在原有全部恢复结束后补做恢复后校正。3.14起最多3个未覆盖候选，优先处理原几何已产生模型的区域，其余候选也允许在恢复后寻找定位方块。固定最长边384像素，17种原恢复核按7×7定位结构匹配度保留最多4张图，再分别拟合与解码。结构分数不是置信度。区域7000ms/整图14000ms、探测200ms/次、拟合600ms/图，均为协作式预算。restored_geometry_total为父阶段，不与prepare/restore/probe/fit重复相加；fit含restored_curved_*子阶段及模块恢复，不应重复计时。预算跳过与未解码分别记录；默认模式不运行。',
            moduleRecovery:'3.14起仅上述恢复图拟合的原二值与连续灰度解码全部失败后，对已采样模块灰度补做小尺度Wiener恢复。最多12个不同几何模型、每个3种核与5个阈值，180次解码或1000ms即停止；仅通过ZXing有效解码才返回结果，不填入已知文本或定位方块。模块恢复ZXingms是恢复后ZXingms的子集；准备与解码均已包含在fit父阶段内。moduleRecoverySkipped为预算未尝试完，不能归作算法失败。',
            structureSampling:'3.15起仅精细模式在分级模糊恢复之后、恢复后校正之前，对最多3个未解决原区域补做结构灰度校准。工作边384，失败后448，均不超过原图且不重复相同实际尺寸。每级拟合最多12个模型，用三个定位方块与时序线估计黑白亮度，中心采样、阈值0.5/0.6/0.7/0.75，普通ZXing验证，不搜索相位、不写入已知图案或文本。每区域最多96次解码、2500ms，整图7500ms；拟合600ms/级，采样1000ms/级，均为协作式预算。失败给后续恢复后校正保留完整原预算。structure_total是父阶段，不与prepare/geometry/sample/decode相加；tiers保留逐级结果，预算跳过与有限尝试失败、运行异常分别记录。',
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
