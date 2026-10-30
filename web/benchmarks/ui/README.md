# 3.17 工作台交互验证

本轮范围：导出可达性、结果卡与缩略图、SAM上下文工具、查看缩放、触屏滚动、停止后继续、清空确认和刷新恢复。沿用现有Canvas/控件节点及功能ID；主识别和分割算法保持既有实现。

## 运行

先在web目录启动本地静态服务器（本组测试不调用Worker API）：

```sh
python3 -m http.server 8787 --bind 127.0.0.1
```

提供本机Playwright模块和本机人像样例路径：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PORTRAIT_SAMPLE=/absolute/path/to/portrait.jpg \
node benchmarks/ui/studio.mjs

PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node benchmarks/ui/cancellation.mjs

PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node benchmarks/ui/touch.mjs
```

视环境提供`PLAYWRIGHT_BROWSERS_PATH`与浏览器所需共享库路径。`UI_BASE_URL`可覆盖默认本地地址，`UI_OUTPUT`可覆盖默认`/tmp/xincai-ui-check`证据目录。后两个脚本复用第一个脚本生成的合成30码图片，按顺序运行。

`fixtures/qr-matrices.json`为使用Python qrcode生成的30个公开示例域名内容的合成模块矩阵，测试在浏览器Canvas中渲染为PNG。条形码为合成EAN-13 `5901234123457`。人像只从用户提供的本机路径读取；这些脚本不调用Groq、不访问二维码网址。

## 已完成验证

- 真实ZXing/ORT识别合成30码，生成30张结果卡和ZIP。
- 1440×900、1280×720、1024×768、768×1024、390×844五视口，逐一切换五工作区：无横向页面溢出、无重复ID，标准页桌面导出区/移动操作条可达。
- 缩放、卡片定位、清空两次确认、刷新恢复，以及白图无结果、损坏图片错误与重试提示。
- 真实MODNet生成、修整控件移位后画笔可用、右键与分段按钮同步、连续Alpha的不适用控件隐藏。
- QR、条形码、遮盖两图任务的停止、当前图完成、下一图保留及继续处理；条形码实际内容核对通过。
- Chromium触屏输入在QR Canvas内滑动可滚页，滑动不触发卡片定位。
- 相关QR、分割、Worker测试共61项通过。浏览器证据由脚本生成；真机触屏、软键盘与不同移动浏览器仍需实机验证。

语义页本轮验证布局与控件结构，实际Groq调用未在本轮执行。性能/精度对照仍参考既有`benchmarks/qr`和`benchmarks/segmentation`记录。
