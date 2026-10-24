# QR 本地评估

评估程序现在直接测试产品 `js/`，不维护额外的候选源码副本。v3.9 增量包、旧说明和报告保存在 `archive/v3.9/`，供追溯使用，**不要将旧包覆盖到当前正式流程上**。`results/` 保存此前逐图结果；`local-*` 为本机后续运行输出，默认不提交。

## 数据与协议

`test/QRcode/blurred` 和 `curved` 共 101 个图片文件；内容去重后 95 张。TXT 共 125 条四角记录，但 blurred/image022.txt 与 image025.txt 各含一条完全重复记录，去重后为 123 个独立位置（blurred 63，curved 60）。原 TXT 不修改，清单保留 `rawPolygons` 与重复索引。仅坐标集合完全相同的框去重，接近或重叠的不同框仍保留。TXT 没有解码文本真值。42 张图片存在 EXIF 旋转信息，需要同步变换标注坐标。

预测与真值按四边形 IoU≥0.3 一对一匹配，逐图保留实际 IoU。统计比例用于判断成功解码与标注实体是否匹配，不能当成解码文本准确率或高精度定位指标。解码内容只记录 SHA-256，用于比较是否丢失旧结果。

## 运行

需要 Node.js 22 与 `@napi-rs/canvas`。依赖可装在外部临时目录，`QR_CANVAS_MODULE` 指向其模块目录，避免给产品添加依赖。从 `web` 运行：

```sh
node benchmarks/qr/inventory.mjs
QR_CANVAS_MODULE=/path/to/node_modules/@napi-rs/canvas node --experimental-vm-modules benchmarks/qr/bench.mjs local-current
node --test benchmarks/qr/verification.test.mjs
node --test benchmarks/qr/experiments/blur-restoration/frequency.test.mjs
```

默认关闭 TPS 与精细恢复；分别加 `--tps`、`--detailed` 开启，`--files=curved/image017.jpg,curved/image026.jpg` 选择部分图片。旧的 `--legacy` 已退役。`QR_MANIFEST`、`QR_OUTPUT`、`QR_DATASET`、`QR_SOURCE`、`QR_WEB_ROOT` 可分别覆盖清单、结果、数据集、完整 JS 目录、含模型/WASM 的网站根目录。输出路径每次覆盖，比较不同轮次时使用不同名称。

`--oracle-position` 是离线定位诊断：使用人工标注进行透视裁剪，再尝试原图及四种局部增强。输出明确标记 `diagnosticOnly: true`，不能与产品识别结果混合计分，标注不进入产品代码。诊断失败也不证明二维码不可恢复；标注误差、采样方法和图像退化都可能影响结果。

离线程序运行实际 ZXing / ORT WASM，采用原生 Canvas 与主线程兼容路径，未模拟解码结果；不计浏览器 Worker 传输、界面、裁图与导出耗时。

## 浏览器验证

```sh
python3 benchmarks/qr/serve.py
QR_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node benchmarks/qr/browser.mjs
QR_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node benchmarks/qr/ui-smoke.mjs
```

需已安装 Chromium 和系统依赖，并按 Playwright 设置浏览器路径。服务仅绑定 `127.0.0.1:8768`，样本不上传。`browser.mjs --tps` 可检查 TPS 路径；`ui-smoke.mjs` 使用全新的临时浏览器上下文，检查旧设置迁移、图片导入、识别、统计/ZIP 导出、刷新恢复、遮盖与标签页切换，不使用用户已有浏览器数据。

## v3.10 检查结果

按重复标注修正后的口径，正式默认流程全量 95 张：103/123，blurred 43/63、curved 60/60；旧版重新计分为 98/123。解码结果没有因计分修正而增加，无旧结果丢失。每图整图解码次数均为 1，TPS 默认为关闭。旧开关不会再改变流程。先前的 103/125、43/65 使用了未去重的原始标注，已不作为当前指标。

5 项单元测试通过，包含新增的重复标注审计。此前的 Chromium 实际页面检查通过：TPS 默认值与旧设置迁移、双码图片导入/识别、统计 JSON 和 ZIP 下载、刷新后结果恢复、二维码遮盖、五个标签页及 EAN13 解码。另在 TPS 开启时检查 7 张困难/回归图片，结果符合预期。5 个共享局部增强版本与 v3.8 的逐像素对照一致。106 个本地 JS 导入与资源引用无缺失，运行库清理后的页面检查没有出现 404。

历史比较、样本范围和局限见 `archive/v3.9/REPORT.md`；其原始分母包含上述两条重复记录。剩余失败均在模糊组，不能从这些测试推断任意曲面图片都能正确识别。重新计分结果在 `results/local-production-3.10-audited.jsonl`，原始轮次保留。新几何补试与已知位置诊断见 [experiments/gray-proposals/REPORT.md](experiments/gray-proposals/REPORT.md)。

## v3.11 模糊恢复

对原流程失败区域补充受限 Wiener 恢复，最长边384、每区域17种滤波、每图最多3区域，并记录协作式时间预算。全量95张测试为108/123，blurred 48/63、curved 60/60；与v3.10相比新增5个，未丢失旧内容哈希、未出现标注外预测。原始记录在 `results/local-production-3.11-results.jsonl`，详细参数、成本、可控模糊试验和局限见 [experiments/blur-restoration/REPORT.md](experiments/blur-restoration/REPORT.md)。

CSV在末尾追加模糊恢复区域数、滤波次数和准备/滤波/解码耗时，保留原列与人工字段。JSON中 `deblur_total` 为父阶段，不要与子阶段重复相加；`geometryReason` 保留恢复前的失败原因。恢复预算跳过与滤波完成但未解码分别记录，不自动判定真实模糊种类。

## v3.12 分级恢复

默认保留384像素17种恢复，失败后在448像素补试5种高斯核。新的“精细模糊恢复”默认关闭，与TPS独立；开启后再以576像素尝试17种恢复。核宽按实际工作尺寸同比调整，实际尺寸不超过原区域，不重复相同尺寸。默认每区域最多22次滤波，精细模式最多39次。

正式代码95张全量测试：默认109/123，开启精细恢复110/123；曲面仍60/60。两项对照均无旧成功内容丢失、无标注外预测、无运行异常。阶段、实际尺寸、滤波参数和“精细模糊恢复”设置均记录到统计。结果见 `results/local-production-3.12-results.jsonl`、`local-production-3.12-detailed-results.jsonl`；[实验报告](experiments/blur-restoration/REPORT-3.12.md)包含失败尝试与资源成本。

`browser.mjs --detailed` 检查精细模式，`--detailed --tps` 检查组合；可用 `--files=blurred/image005.jpg,blurred/image008.jpg,curved/image017.jpg` 缩小浏览器样本范围。界面检查新增了开关默认值、持久化和统计设置验证。
