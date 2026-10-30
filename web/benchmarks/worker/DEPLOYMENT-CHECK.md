# Cloudflare 1101 本地验证记录

日期：2026-10-24。检查源码提交：`d0baaa83c43bb4d96c342dbae2d3f918d16daeda`。

用户线上首页和 `/api/deployment-status` 返回 Cloudflare 1101 HTML。该页面仅证明 Worker 执行存在异常，不包含具体异常或调用栈，也不能确认当前线上部署与本地源码一致。此前首页 Ray ID 为 `a4f614427ca70728-TPE`，不能将其当作后来自检请求的 Ray ID。

本轮未改动产品源码、部署配置或识别算法，未推送、部署或调用外部付费 API。

## 检查方式

临时安装官方 Node v22.23.4（核对 Node 官方 SHA-256 清单）与 Wrangler 4.152.0 到 `/tmp/xincai-cloudflare-check/`。未修改项目依赖或使用 Cloudflare 账号凭据。

使用现有 `wrangler.jsonc` 执行 `wrangler deploy --dry-run`：通过，读取 618 个静态文件，Worker 打包大小 29.93 KiB，输出 ASSETS 和两个限流绑定。dry-run 不上传资源。

随后使用 `wrangler dev --local` 在 `127.0.0.1:8877` 启动实际本地 Workers 运行时；不只是 Node 的绑定模拟。检查下列请求：

| 请求 | 状态 | 验证 |
| --- | --- | --- |
| `/` | 200 | 与源码 index.html 字节哈希一致 |
| `/api/deployment-status` | 200 | assetsBinding=true、homepageStatus=200、ok=true |
| `/js/app.js` | 200 | 与源码字节哈希一致 |
| `/js/blur-frequency.js` | 200 | 与源码字节哈希一致 |
| `/js/blur-restoration.js` | 200 | 与源码字节哈希一致 |
| `/models/detect-web.onnx` | 200 | 978101 字节，与原文件一致 |
| `/vendor/ort-1.22.0/ort-wasm-simd-threaded.wasm` | 200 | 11210254 字节，application/wasm，与原文件一致 |
| `/zxing/zxing_reader.wasm` | 200 | 953527 字节，application/wasm，与原文件一致 |
| `/api/link-preview` GET | 405 | 正常拒绝 GET，未访问外部网站 |
| `/api/semantic-detect` GET | 405 | 正常拒绝 GET，未调用 Groq |
| `/favicon.ico` | 404 | 不存在的文件返回 404，无 1101 |
| `/server/semantic.js` | 404 | 服务端源码未公开 |
| `/worker.js` | 404 | Worker 源码未公开 |

## 结论边界与下一步

现有源码可以在上述 Wrangler 本地运行时启动、读取真实静态资源并执行自检路由。本次未发现可复现的源码启动错误；这不证明 Cloudflare 生产环境一定正常，也未进行整站浏览器功能回归或线上修复。

用户随后确认 Active 部署对应上述提交，并提供了构建日志：Wrangler 4.152.0、Worker Startup Time 2 ms、ASSETS 与两个限流绑定均存在，部署成功；生产 Version ID 为 `8535b62b-836a-4048-a996-a1e34305430d`，完成时间为北京时间 2026-10-24 12:08:13。日志读取 575 个资源，Worker 打包大小同为 29.93 KiB。`No updated asset files to upload` 本身不证明资源部署失败，仅表示没有需要上传的新资源内容。

因此，已排除“本次构建失败”“只部署了旧提交”“构建中未配置 ASSETS”这些方向。构建启动检查通过不等于请求执行一定正常，仍需取得生产请求异常详情。

下一步优先访问现有 `/api/link-preview` GET 路由：预期返回 405 和 `{"error":"仅支持 POST"}`，该分支不读取 ASSETS、不调用限流绑定、不访问外部网页。它可以进一步区分应用入口可执行与静态资源链路异常。之前的 `/api/deployment-status` 会读取首页，因此它返回 1101 不能单独证明异常发生在进入处理函数之前。若需要生产日志，可用 `npx wrangler tail batch-operation-of-images --format pretty` 明确订阅此 Worker 后复现；不能凭通用 1101 页面认定具体根因。

临时机器可读结果保存在 `/tmp/xincai-cloudflare-check/runtime-results.json`，临时目录可能随会话环境清理。测试服务器检查完毕后关闭。

## 后续生产请求反馈

用户确认 `/api/link-preview` GET 也返回 1101。Windows Wrangler 起初因 UNC 工作目录退回 `C:\Windows` 后创建缓存失败；切到 Windows 用户目录解决。随后 CLI 出现本机 Node `connect ETIMEDOUT 31.13.73.9:443`；该堆栈不是当前服务端模块的异常栈，不能据此断言生产 Worker 的出站请求失败。

用户在 PowerShell 为 HTTP_PROXY / HTTPS_PROXY 设置 Clash Verge 的 `http://127.0.0.1:7897` 后，确认 CLI 显示 `Connected to batch-operation-of-images, waiting for logs...`，刷新仍无日志。

再通过同一个 HTTP 代理执行 curl GET `/api/link-preview?probe=20261024-1`，返回代理的 `HTTP/1.1 200 Connection established`，之后收到 Cloudflare 的 `HTTP/1.1 500 Internal Server Error`，响应正文 `error code: 1101`。该请求 Ray ID 为 `a4f693533eb88445-TPE`，时间为 2026-10-24 05:27:59 UTC。CONNECT 的 200 不代表网站返回 200。

目前已知本地运行时正常、生产构建成功、通过已确认连接的 tail 未见请求、经同一代理请求仍报 1101。仍不能从这些事实确定异常属于应用、平台内部路由还是代理访问链路。已有失败样本的 Ray 均带 TPE 后缀；可先使用另一个代理出口重复同一 GET（不改代码）进行路径对照，记录状态、Ray ID 与 tail 是否出现请求。该对照尚未执行，不能宣称地区或代理就是原因。

后续更正：用户指出代理节点位于日本，已撤回把TPE作为换地区依据的建议；CF-RAY响应后缀表示处理请求的Cloudflare机房，不代表代理节点所在地。用户先要求准备新Worker，随后取消，由其自行通过GitHub重建；取消前只做了只读准备，没有创建Worker或修改配置。2026-10-25用户告知已通过新账号和CLI重新部署；本地配置仍是原Worker名称，新账号域名和线上响应尚未提供，旧1101的具体根因仍未确认。本轮QR算法优化不修改上述部署配置。
