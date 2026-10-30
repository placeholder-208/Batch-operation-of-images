# 本地分割精度对照

人物/发丝专项对照已在 [portrait/](portrait/README.md) 完成，含真实人像、MODNet FP32/q8 和 SlimSAM 对照，见 [2026-10-28 报告](portrait/REPORT.md)。下文保留早期 SlimSAM 几何冒烟协议，不能用其合成图结果替代人物评估。

MODNet FP32 的可选主页面模式已于 2026-10-29 接入，见 [接入与测试记录](portrait/INTEGRATION.md)。

本目录承接模型选型讨论中尚未完成的第一步：同一 SlimSAM-77-uniform、相同输入与提示，对照 q8 与 FP32。它独立于产品入口，整个 `benchmarks/` 已从 Cloudflare 静态部署中排除。应用模型、工作区存储与用户图片均不由此工具修改。

## 启动

在 `web` 目录运行：

```sh
python3 benchmarks/segmentation/prepare.py
python3 benchmarks/segmentation/serve.py
```

打开 <http://127.0.0.1:8767/benchmarks/segmentation/>。服务仅绑定回环地址；模型缓存默认位于 `/tmp/xincai-model-eval/models`，两条命令均支持 `--cache` 指定同一个其他目录。下载优先使用 curl，未安装时使用 Python urllib。无需安装 Python 第三方包。下载有完整性校验，失败文件不会代替已验证的模型。

模型来源：[Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform)，固定版本 `5850ab45f587c112167512ffef949107115e26a0`。q8 优先复用项目中校验通过的文件；FP32 只下载至实验缓存。保留上游 Apache-2.0 许可。

| 模型资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| FP32 编码器 | 23276014 | `9f8433273a6750b587779baa0cf5508111001bf7e7acfcf585d370139fd366d0` |
| FP32 解码器 | 16557892 | `f4514391764fbd56e08e119060d874ecd7d52994bfb1968af159e12d4943b5bb` |
| q8 编码器 | 8882165 | `cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971` |
| q8 解码器 | 4903810 | `cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2` |

四个 ONNX 文件均小于 25 MiB；总下载量另行计算。这不意味着它们的运行内存同样小。

## 样本与协议

- 默认生成三张确定性几何图：实心对象、内部孔洞、细小部件。标为 `synthetic-smoke`，仅用于推理与计分流程的冒烟验证，不能用于真实素材的选型排名。
- 真实样本成对选择：`名称.png` / `名称_alpha.png`；原图也可使用其他浏览器支持的图片格式。真实蒙版必须是同尺寸、不透明的灰度 PNG，白色保留、黑色删除，允许连续灰度。超出 400 万像素的样本拒绝处理。
- 从真实蒙版非零像素取得紧致框，两个精度使用完全相同的框。此为理想框提示条件，不评价检测器误差，也不代表普通用户框选表现。
- 输入工作图长边最多 1024，后续使用同一套项目 SAM 预处理。单线程 CPU WASM；每个精度预热两次，默认每个样本测两次；按 q8、FP32 的固定顺序执行。
- 按模型预测 IoU 选择候选，不按真实蒙版择优。使用产品中的 `interpolatedAlpha`、阈值 0 和窄边抗锯齿生成原图尺寸输出。**这是分割输出对照，不是专用 matting 的质量评测。**
- 加载耗时含初始化；第一种精度可能承担更多运行库初始化工作，不能据此比较网络冷启动下载。未测量峰值内存。预处理、编码、解码和后处理分别计时；指标计算不计入推理总耗时。
- 单项失败保留为 `failed`，任一失败则整体为 `partial`，不得删除失败记录后报告完整成功。

## 指标

`iou`：alpha ≥ 0.5 的二值交并比。空预测对非空真值计 0；两者均空计 1。

`boundaryF1`：二值前景四邻域边界，按原图欧氏距离不超过 2 px 分别统计精确率和召回率，再计算 F1。边界接触图像外侧时按背景处理。它不是论文中的 Boundary IoU，容差也没有按图像尺寸归一化。

`alphaMAE` / `alphaMSE`：整图 [0,1] 透明度的平均误差。这里不将其命名为标准 SAD，也未实现论文 Grad/Conn。跨分辨率和不同未知区域协议的文献数值不可直接混比。

JSON 包含模型文件校验、浏览器环境、提示、样本类别、逐项结果与时间。真实数据尚需覆盖 PPT/AHK 用途；建议额外观察孔洞、独立部件、细线以及黑白背景下的边缘。后续 EfficientSAM-Ti / EdgeSAM 和小型 matting 模型需分别适配与核验，当前工具没有假装支持这些模型。

## 验证

```sh
node --test benchmarks/segmentation/metrics.test.mjs
python3 -m unittest discover -s benchmarks/segmentation -p '*_test.py'
```

浏览器冒烟测试需要 Playwright 与 Chromium。可在临时目录安装依赖，避免改动项目依赖：

```sh
npm install --prefix /tmp/xincai-model-eval playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/xincai-model-eval/browsers /tmp/xincai-model-eval/node_modules/.bin/playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/xincai-model-eval/browsers node benchmarks/segmentation/run-smoke.mjs /tmp/xincai-model-eval/node_modules/playwright/index.mjs
```

须先启动上面的本地服务。Linux 运行 Chromium 需要系统共享库；本工具不自动安装或修改系统依赖。结果写入 `results/slimsam-smoke.json`；先保留原始记录，再作分析。开发机上的合成图与耗时仅代表该环境。
