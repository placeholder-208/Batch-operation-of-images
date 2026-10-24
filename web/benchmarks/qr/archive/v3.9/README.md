# QR 连续灰度重采样验证与更新包

本目录保留本地评估程序、结果和 v3.9 覆盖文件。`benchmarks/` 已由现有 `.assetsignore` 排除部署。测试图片留在 `test/QRcode`，不打包、不上传。

## 应用更新

`artifacts/xincai-qr-v3.9.zip` 是基于当前 v3.8 的增量更新。压缩包内的 `web/js/` 合并覆盖项目的 `web/js/`，共替换三个文件：`curved-region.js`、`wechat-decoder.js`、`qr-statistics.js`。不需要替换模型、主页或其他功能文件。刷新页面时建议强制刷新。

当前源文件存在 `nobody` 所有的只读文件，因此本次开发没有将三项修改部分写入产品目录；可替换代码保存在 `update/web/js/`。包内的基线哈希可在合并前核对，避免覆盖后续修改。

测试时开启“调整检测顺序”；TPS 可以独立勾选。本轮新增路径仅在调整顺序开启时启用。两个开关关闭，或仅开 TPS，仍使用此前的采样流程。开关的默认值与持久化规则没有改动。

## 改动

原曲面流程在几何模型上估计模块值，然后先阈值化并绘制为规则黑白模块。这在部分曲面图中损失了可用于解码的灰度信息。新流程保留原有模型二值解码顺序；全部失败后，对已通过结构检查、已入选的前三个模型，按模型映射从原始区域连续双线性采样灰度图，再交给 ZXing。四模块静区和坐标反映射沿用原约定。

原每区域最多 12 个二值模型；新路径最多再增加 3 次灰度解码。TPS 和原柱面回退分别受这个上限约束。几何搜索预算、区域数量限制、定位和候选检测均未扩大。透明像素先按白色背景合成，越界或非有限映射记为采样跳过。

CSV 原有列及人工补记字段保留，在末尾追加实现版本、灰度开关、实际次数及灰度重采样/解码耗时。JSON 的 `settings` 和阶段 `samplingMode` 同步记录。新增耗时是曲面总耗时的子集，不能重复相加。

## 评估协议

101 个图片文件按内容 SHA-256 去重为 95 张；共有 125 个四角标注。blurred 为 45 张/65 个码，curved 为 50 张/60 个码。TXT 是位置标注，并没有提供解码文字真值。

42 张独立图片带 EXIF 方向标记。评估先将原始标注转换到实际 Canvas 方向。预测与真值按四边形 IoU≥0.3 一对一匹配，保留每个结果的实际 IoU；该阈值用于判断是否对应同一二维码，不代表精确框定位标准。已解码文本只保留 SHA-256，比较旧结果是否丢失，不能据此宣称内容准确率。

离线评估运行网站实际 ZXing WASM、WeChat ONNX/ORT 和 JS 几何代码，Canvas 使用原生图像库；没有替代或模拟解码结果。它使用兼容主线程路径，不包含浏览器 Worker 传输、网页操作、裁图生成。另做 Chromium Worker 路径样本验证。详见 `REPORT.md` 和 `results/`。

## 复现

需要 Node.js 22，另在评估环境安装 `@napi-rs/canvas`。本次依赖安装在临时目录，未改动项目依赖。以下命令从 `web` 目录运行：

```sh
node benchmarks/qr/inventory.mjs
QR_CANVAS_MODULE=/path/to/node_modules/@napi-rs/canvas node --experimental-vm-modules benchmarks/qr/bench.mjs current
```

`QR_CANVAS_MODULE` 可省略，此时按常规 Node 模块路径查找。`QR_DATASET` 可指定数据集目录，`QR_SOURCE` 可指定另一份完整 JS 目录，`QR_OUTPUT` 指定独立结果路径，`QR_MANIFEST` 指定清单路径，`QR_WEB_ROOT` 指定包含模型/WASM 的网站根目录。默认读取 `test/QRcode`，默认输出在本目录 `results/`。

默认开启调整顺序、关闭 TPS；加 `--legacy` 关闭调整顺序，加 `--tps` 开启 TPS。`--files=curved/image017.jpg,curved/image026.jpg` 可选择样本。每次覆盖指定结果文件，比较前应指定不同输出路径。

```sh
node --test benchmarks/qr/verification.test.mjs
```

上面的三项测试覆盖连续采样梯度/静区、无效映射拒绝和统计字段兼容。浏览器脚本记录在 `browser.mjs`，需 Playwright、Chromium 与相应 Linux 共享库；本次使用仅绑定回环地址的临时测试服务，没有向外部发送样本。
