# MODNet FP32 主页面接入 · 2026-10-29

## 使用

进入「本地分割」，在右侧「处理 → 分割模式」选择「人物精细抠图 · MODNet FP32」，添加图片，按需用白框限定输入，再点击生成。首次按需下载约 26 MB 模型，之后使用浏览器缓存；无需新增 API、密钥或 GPU 服务。

人物模式不使用蓝框和保留/排除提示点，它可能同时保留多个人物；想指定其中一个人时先调整白色裁剪范围，或在结果上用画笔删除。通用对象仍使用原 SlimSAM 路径。人物结果的候选、SAM 阈值和窄边抗锯齿控件禁用，避免把连续 alpha 当 logits 再二值化；反转、圆形/曲线修整、区域清理和导出继续可用。

模式选项影响后续生成，不立即替换现有蒙版。批量生成使用当前模式，跳过已经生成的图片；可逐图重新生成以混用模型。同一裁剪范围内重新生成保留画笔和已执行的区域清理，新推理失败保留旧结果。修改裁剪范围或通用模型提示仍按原规则使结果失效。批量 CSV 保留原列，末尾追加模型、精度；人物结果的 SAM 阈值列为空。

## 实现与资源

- `runtime-library.js` 共用本地 Transformers.js / ONNX WASM 初始化，禁止远程模型回退。
- `portrait-runtime.js` 按需创建 FP32 会话，通过既有后台 Worker 推理；RGB 标准化保持上游配置，短边 512、最长边封顶 1024、尺寸为 32 倍数。大于 16:1 的裁剪范围先拒绝，避免极狭长输入膨胀。
- 切到人物推理会释放 SAM 编码与模型会话；切回 SAM 编码时释放人物会话。浏览器缓存的模型文件保留。
- `alpha-utils.js` 明确区分连续 alpha 和 logits。旧缓存未标类型时继续按 SAM logits 处理；新人物缓存带 `valueType: alpha`。为兼容既有压缩缓存，浮点缓冲字段仍名为 `logits`，实际含义由 `valueType` 决定。
- 原尺寸透明 PNG 使用连续 alpha 插值后重放人工修整；灰度蒙版保留既有工作图尺寸约定。修整、曲线、区域清理和刷新恢复共用原实现。
- 只新增 `models/segmentation/modnet/onnx/model.onnx` 的 FP32 权重及配置/许可，不发布未采用的 q8 权重。模型版本、SHA-256 见 [MODEL.md](../../../models/segmentation/modnet/MODEL.md)。ONNX 文件 25,888,640 B，小于 25 MiB；沿用现有 Workers Static Assets 部署。推理在浏览器，不在 Worker 服务端执行。

## 已验证

自动浏览器回归通过真实主页面与后台线程，使用模型卡公开人像，不上传图片：

1. 打开页面与选择模式时不加载人物权重；首次生成才加载，人物初次推理不加载 SAM。
2. 返回大量 0–255 之间的 alpha，阈值、窄边抗锯齿与候选控件禁用。
3. 画笔能修改蒙版；同范围重新生成后逐像素保持修整结果；刷新后模式、连续 alpha、修改逐像素一致。
4. 实际下载透明 PNG、灰度蒙版和 ZIP。
5. 人工阻断 SAM 模型下载时，新推理失败而人物旧结果、修整保留；解除阻断后可正常推理，再切回人物模式仍保留修整。
6. 添加两张图，白框裁剪其中一张；批量任务生成两张未完成图并跳过一张已有结果。诊断记录确认裁剪范围与不使用提示的模式。
7. 三图中混用两个模型导出；ZIP CRC 验证通过，包含 6 张 PNG 与 3 行 CSV 记录，模型/精度对应正确。

当前单元/接口测试共 41 项通过（含原有指标与 Worker 部署入口测试），涵盖连续 alpha/旧 logits 分流、数值异常、浮点舍入、手动修整进入 RGBA、混合缓存刷新兼容和生产权重完整性。可执行：

```sh
node --experimental-default-type=module --test \
  benchmarks/segmentation/metrics.test.mjs \
  benchmarks/segmentation/portrait/*.test.mjs \
  benchmarks/worker/deployment.test.mjs
```

主页面回归须先用本地 HTTP 服务启动 `web`（默认端口 8772），并提供一张本机人像和 Playwright 环境：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/browser-cache \
PORTRAIT_SAMPLE=/absolute/path/to/portrait.jpg \
node benchmarks/segmentation/portrait/main-page.mjs
```

结果保存至独立 `/tmp/xincai-portrait-main-时间戳/`；测试使用隔离浏览器上下文，不动用户浏览器中的图片与保存记录。测试中的模型下载阻断是预期的故障注入，不是未解决的运行错误。

## 尚未验证

没有部署或推送；尚需实际 Cloudflare 资源传输与手机/低内存设备验证。当前工作分辨率与选型实验不同宽高比下可能受最长边封顶影响，不能照搬小样本分数保证所有素材。多人、动物毛发、原生大图精度与背景颜色污染仍是后续工作；本次不做自动去色边。
