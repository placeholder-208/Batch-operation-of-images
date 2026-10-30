# 人像与发丝边缘对照

2026-10-29 已作为可选「人物精细抠图」接入主页面，使用与验证见 [INTEGRATION.md](INTEGRATION.md)。下文与 REPORT.md 保留 2026-10-28 的选型实验协议。

本轮研究已完成：10 对真实人像、4 个模型精度组合，40 项浏览器推理全部成功。结论与限制见 [REPORT.md](REPORT.md)，原始统计在 [results/](results/portrait-2026-10-28.json)。研究工具与主页面独立，没有替换生产 SlimSAM，没有部署或推送。

## 复现

在 `web` 目录运行，Python 无需第三方包：

```sh
python3 benchmarks/segmentation/portrait/prepare-models.py
python3 benchmarks/segmentation/portrait/prepare-data.py
python3 benchmarks/segmentation/portrait/serve.py
```

打开 <http://127.0.0.1:8771/benchmarks/segmentation/portrait/>，点击运行。模型和样本均存于 `/tmp/xincai-portrait-research/`，不在产品资源目录；整个 `benchmarks/` 已由 `.assetsignore` 排除。服务只监听本机回环地址。样本准备使用 ZIP Range，不下载整个 262 MB 归档；服务若不支持准确 Range 将直接报错，不把错误页面当作图片。

自动运行需要本机 Playwright、Chromium 和必要 Linux 共享库。工具不修改系统依赖；可沿用自己的 Playwright 环境：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/browser-cache \
node benchmarks/segmentation/portrait/run.mjs
```

自动结果默认写入独立时间戳目录，含 JSON 和 alpha / 黑白蓝底预览。评分直接使用 Float32 alpha，保存的 8 位 PNG 只供查看。可通过 `PORTRAIT_RESULTS` 自定输出目录（请使用新目录），`PORTRAIT_REPEATS=2` 重复测量，`PORTRAIT_VARIANTS=modnet-fp32,modnet-q8` 仅运行指定模型。默认使用 `prompts.json` 中固定的人像框和一个保留点；`PORTRAIT_PROMPTS=full-image` 单独诊断整图框行为。两种提示协议不能混为同一实验。

## 模型和数据

- SlimSAM-77-uniform q8 / FP32，固定版本 `5850ab45f587c112167512ffef949107115e26a0`；来源与 SHA-256 沿用上级 [prepare.py](../prepare.py)。
- MODNet FP32 / q8，固定 [Xenova/modnet](https://huggingface.co/Xenova/modnet/tree/fa2fa546052fba4c08921230a26cc69a333fca12) 版本 `fa2fa546052fba4c08921230a26cc69a333fca12`。文件尺寸与 SHA-256 写在 [prepare-models.py](prepare-models.py)，下载后再次验证。MODNet 原项目和模型卡标注 Apache-2.0。
- 官方 [PPM-100](https://github.com/ZHKKKe/PPM) 归档中的 image 条目按原 ZIP 顺序取零基索引 `0,10,...,90`，在观察模型表现前固定。保留官方 RGB 与 alpha JPEG 原字节，用 ZIP CRC 校验；结果 JSON 记录每张图的 SHA-256、原尺寸和来源条目。
- 官方 alpha 许可为 **CC BY-NC-SA 4.0**，只在本地作非商业研究，不打包到网站。RGB 的 Flickr 许可按原项目说明核对。JPEG alpha 有压缩噪声，不应视为无噪声的精确物理透明度。
- `prompts.json` 的框和点仅根据 RGB 图像人工固定，没有使用 alpha 生成框、选点、选候选或调参数。它不是穷尽式交互调优，也不代表 SAM 的最佳可能结果。

## 评分协议

所有模型使用同一 RGB 工作图，长边最多 1024；真值在同一评估尺寸上用中心对齐连续双线性插值。模型各自使用已固定的官方转换版预处理：SAM pad 至 1024²、解码原始 logits 为 256²，按现有产品方法输出窄边抗锯齿 alpha；MODNet 短边 512、满足 32 倍数，直接插值连续 alpha，不经过 SAM 的阈值函数。

每个模型预热一次，每张图测一次。模型加载、推理、后处理与指标耗时分开。表中耗时不含模型加载、指标或预览保存；这是本开发机单线程 WASM 测量，不是手机性能保证。FP32 MODNet 输出存在最多约 `1.19e-7` 的范围溢出；限幅前记录 min/max/count，超出 `1e-5` 或出现非有限值直接失败。不会将严重异常静默修成有效结果。

指标包括：

- IoU：alpha ≥ 0.5 的二值交并比；F1@2px：欧氏距离 2 px 的前景边界匹配。
- 整图 alpha MAE/MSE 与 SAD（归一化 alpha 的绝对差之和 /1000）。
- `transitionMAE`：所有 `0 < GT < 1` 像素的平均误差，可能包含 JPEG 噪声。
- `coreTransitionMAE`：仅 `0.05 < GT < 0.95`，减少近黑/近白压缩噪声的影响。它不是独立人工标注的发丝区域。
- `geometricEdgeMAE`：GT 二值边界周围欧氏半径 5 px 内的 alpha MAE。
- `edgeBandMAE`：上述几何边缘带与全部过渡像素的并集。与纯几何边缘指标分开命名，避免 JPEG 噪声扩大区域后被误解。

这些局部指标不是标准 matting Grad / Conn；不能直接与论文不同分辨率、不同 trimap 的数字比较。背景颜色污染与 alpha 错误分开观察：预览保留原 RGB，没有做前景颜色解混。

## 测试

```sh
node --test benchmarks/segmentation/metrics.test.mjs benchmarks/segmentation/portrait/*.test.mjs
python3 -m unittest discover -s benchmarks/segmentation/portrait -p '*_test.py'
```

27 项 JS 指标/连续插值测试、6 项 Python 样本解析/本机服务测试通过。自动浏览器实验额外确认 40/40 成功、无页面异常或失败网络请求，并拦截所有非本机请求。旧分割服务的 2 项测试也通过。
