# 浏览器 QR 解码器对照：定位、采样与解码核心

结论：当前数据没有支持“更换解码器即可解决剩余漏识别”。五款实现及更新的ZXing-C++包装均未补出产品v3.14精细模式剩余11处目标。另一方面，普通图像模式确有重定位/重采样限制，不能把这些失败全部归为纠错核心错误。

本轮仅新增研究适配器、评估程序与报告，没有替换产品解码器、修改既有识别流程、安装产品依赖或部署。研究依赖放在临时目录；图片只在本机读取，没有上传。此前未提交的v3.13/v3.14改动保留。

## 选择与部署条件

| 实现 | 本轮版本 | 浏览器运行方式 | 本轮可运行资源体积，不含地图/源码 |
| --- | --- | --- | ---: |
| 现有ZXing-C++ | zxing-wasm 3.1.4 | 现有JS+WASM | 沿用项目资源 |
| 更新ZXing-C++ | zxing-wasm 3.1.6 | 独立临时JS+WASM | WASM 946,860字节 |
| jsQR | 1.4.0 | 纯JS，UMD | JS 256,885字节 |
| ZBar WASM | @undecaf/zbar-wasm 0.11.0 | 浏览器ESM+WASM | JS 12,938 + WASM 238,653字节 |
| quirc | WASM核心1.0；npm quirc 1.0.0-alpha.4 | 无imports的WASM+本轮适配器 | WASM 26,796字节 |
| ZXing-JS | @zxing/library 0.23.0 | 纯JS，预打包UMD或实验bundle | 标准UMD 362,150字节 |

这些方案均可由Cloudflare静态资源托管，在用户浏览器执行，不需要Worker服务器推理、外部图片API或CUDA。ZXing-JS与ZXing-C++共享ZXing谱系，不能算作完全无关的两种算法；BarcodeDetector的ZXing polyfill也未重复计为独立实现。

quirc采用较旧的现成WASM，不能用其成绩代表最新quirc源码。没有安装编译工具重编所有上游版本。该npm包高层JS包装只读两个角，本轮绕过包装、读取完整四角，补齐销毁和镜像重试。ZBar限定QR、禁用跨图缓存；反色配置使用全局ZBAR_NONE，QR级该配置不受支持。jsQR/ZXing-JS为单码接口，成功后遮白外框重扫，最多8个；第一轮失败就不能靠该包装继续搜索。数据集每图最多3个标注目标，不能据此宣称普遍完整多码支持。

库许可来自各包及官方源码：jsQR、ZXing-JS为Apache-2.0；ZBar WASM为LGPL-2.1+；quirc包附ISC许可；zxing-wasm包装MIT、底层ZXing-C++为Apache-2.0。本轮不向产品分发这些新增库。未来正式接入应保留各自来源与许可，并固定JS/WASM配套版本。

## 数据与公平性

沿用95张去重图片、123个去重位置，EXIF方向随Canvas读图和标注变换处理。TXT只有位置，没有独立内容真值。按四边形IoU≥0.3一对一匹配；文本只记录SHA-256。不得把以下数量称为文本正确率或任意图片上的泛化精度。

实验分为四层，避免把不同前处理的成绩混比：

1. **整图**：全部95张，原始分辨率、相同RGBA，无额外锐化/缩放。比较包含定位、二值化、采样和纠错。各库先通过清晰单码控制，再计测试调用时间。
2. **共享候选**：同一轮WeChat的124个候选。对原流程已裁剪区域复用其实际裁剪范围，其余统一15%留边；最长边800、不超过原区域。所有库使用相同原区域和四种既有增强，某库首次读出有效结果后停止该区域重试，其他库继续；不使用标注决定停止。此层复用缓存候选，不含WeChat耗时，也不是各库独立检测全图的成绩。
3. **剩余区域生成图**：产品精细模式剩余11区域，384工作边，17种像素恢复版本按定位结构评分保留4张，加原图；相同几何模型、二值/连续灰度渲染及有限模块恢复。每图像接口均看到同样的2729份输入；两种直接网格接口均看到同样2678份二值矩阵。逐次保存imageHash/gridHash，并由汇总程序校验相等。生成图模型预算600ms，恢复版本探测200ms；模块恢复诊断只限180种/候选，不套产品1000ms截止，以免库耗时决定谁少测。只要实际解码成功即可停止相应库；未用标注选模型。
4. **原图提取网格**：quirc从95张原图提取61份位图，包含其失败候选，完全相同的矩阵送入各路径。quirc、ZXing-JS直解接口不再检测或重采样；ZXing isPure仍从渲染图提取位图，不能冒称C++底层BitMatrix接口。该语料由quirc提取，存在选择偏差，只用于分析接口差异。

所有返回位置都来自阅读器实际外框或内部采样变换；没有把ZXing-JS的三处定位中心冒充四角。直接网格的结果使用外部拟合模型映射原图，并明确标注`model-grid-derived`。相同内容在不同位置保留，不按文本全局去重。标注只在输出后评分，未提供给定位、去模糊、采样或解码。

## 整图与共享候选结果

| 阅读器 | 整图匹配 /123 | 共享候选+四种增强 /123 | 整图调用合计 | 候选调用合计 | 相对现产品新增 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ZXing-C++，包装3.1.4 | 68 | 78 | 4.39s | 1.96s | 0 |
| ZXing-C++，包装3.1.6 | 68 | 78 | 4.28s | 1.66s | 0 |
| jsQR 1.4.0 | 27 | 59 | 71.69s | 38.37s | 0 |
| ZBar WASM 0.11.0 | 44 | 63 | 24.64s | 14.59s | 0 |
| quirc核心1.0 | 28 | 52 | 6.27s | 3.52s | 0 |
| ZXing-JS 0.23.0 | 30 | 60 | 22.13s | 9.00s | 0 |

Node22+原生Canvas，顺序调用真实JS/WASM，无解码模拟。时间包含每库灰度转换、内部定位/解码与单码包装重扫；不含读图、公共增强生成、WeChat检测、网络下载、界面与浏览器Worker通信。库的多码接口、调度、JIT与内存行为不同，不能据此承诺所有设备上的速度倍数。初始化元数据中的旧CPP配置注册时间不含懒编译，因此本表只比较经过控制样本预热的调用，不用其作冷启动排名。

所有库的整图+候选结果合并可匹配81处，比单个ZXing该层的78处多3处，说明实现之间有局部互补。但这3处已被产品现有校正/恢复流程覆盖。将全部对照结果再合并到产品112处结果，仍为112/123，没有标注外结果。故本轮没有证据值得给生产网页增加四个备用库。

3.1.4的底层CPP提交为`0b2d9a8fc81f420f369928c24331091ff0525976`，3.1.6为`2c3dcfeffa7878950a58c1703c86774a428b0c91`；实际WASM SHA不同，非仅改版本名。更新版整图、候选和下述原图网格模式的数量仍相同。未修改用户现用WASM。

## 已有网格仍可能卡在“再定位”

相同61份quirc原图提取位图的结果：

| 路径 | 成功位图数 /61 |
| --- | ---: |
| ZXing-C++普通图像模式，两个版本均相同 | 24 |
| jsQR渲染图重定位 | 25 |
| ZBar渲染图重定位 | 25 |
| quirc渲染图重定位 | 25 |
| ZXing-JS渲染图重定位 | 26 |
| ZXing-C++ isPure渲染图，两个版本均相同 | 27 |
| quirc直接位图解码 | 28 |
| ZXing-JS直接BitMatrix解码 | 28 |

成功的内容哈希没有冲突。例：blurred/image011、curved/image008、curved/image022的同一位图，CPP普通模式失败，isPure成功；curved/image038同一位图，两种直接接口成功，而CPP isPure失败。以上图片原始产品流程均已识别，未带来剩余目标增益。

这证明“已经得到规则网格→绘图→重新交给图像阅读器”可能丢失可解码结果。它不能单凭这一点证明CPP纠错核心有bug：isPure仍要从像素提取模块，我们没有调用CPP内部的直接BitMatrix解码接口。quirc与ZXing-JS在这61份位图上同为28成功，其余失败也不能证明真正模块信息无法恢复。

## 剩余11区域的具体结论

五款图像接口每款2729次、CPP isPure 2729次、quirc和ZXing-JS直接网格每款2678次，新增均为0，最终无运行异常。

- 6区域没有得到可接受的几何模型：image019候选1/3、image020候选1/2、image021候选1、image045候选1。WeChat外框已找到，仍缺可靠内部定位/采样网格；不能归因为文本纠错失败。
- 5区域生成了有限模型：image005候选2/3、image020候选3、image036、image037。两种直接网格接口也失败。quirc报告1951次ECC失败、727次格式信息ECC失败；ZXing-JS报告2655次checksum、23次format失败。这支持继续核查模块位置、几何模型、模糊核和黑白判定，不能据此认定这些模型就是正确网格。

这里的“未得到模型”可能包含有限几何预算或筛选限制，不表示永远无法定位；“位图未解码”也不等于照片没有足够信息。没有加入未经验证的降质分类、未知文本补全或人工标注回填。

## 实现、控制及验证

研究代码只在本目录。`common.mjs`统一读图、CPP加载、坐标计分和空间去重；三个适配器封装可选库；`run.mjs`做整图/候选；`grid-run.mjs`做剩余区域；`native-grid-run.mjs`做相同位图；`summarize.mjs`输出[CSV](comparison.csv)和[证据摘要](evidence.json)。原始逐图、逐区域JSONL在`benchmarks/qr/results/local-decoders-*`，默认不提交，摘要保存这些文件的SHA-256。

清晰单码控制所有阅读器内容一致。规则无误码网格的图像/直接解码控制通过；同一内容不同位置的合成控制和不同大小/版本双码检查保留接口能力差异，不因正常定位失败把库当成未初始化。两个单码库在同大小并排的一些合成排列中首轮会失败，不应宣传其包装为原生多码。两个新增自动测试验证实体一对一匹配、空间去重、调用方像素不被修改、全部真实库清晰解码，以及直接网格和销毁后的错误行为。

适配器初版把quirc误检候选的无效网格尺寸当作运行异常；已改为正常解码失败，完整重跑quirc候选层和剩余生成图层，最终为零运行异常。原始第一次候选文件仍保留，汇总明确以修正后quirc结果替换对应行，避免把初版适配器错误归罪于底层库。

Chromium检查：jsQR与ZXing-JS通过真实清晰图、不同尺寸/版本双码及规则网格；quirc在主线程和Worker中通过同内容双位置、位图直解、镜像重试；ZBar通过本地HTTP加载ESM/WASM与真实图片识别。浏览器控制不等于全95张浏览器排名，本轮全量矩阵在Node运行。没有使用远端推理或用户已有浏览器会话。

## 复跑

从`web`运行，需要Node22、临时安装的Canvas和上述固定版本。实验不会把它们加入产品package或vendor。路径可以通过环境变量覆盖：`QR_CANVAS_MODULE`、`QR_JSQR_MODULE`、`QR_ZXING_JS_MODULE`、`QR_ZBAR_MODULE`、`QR_QUIRC_MODULE`、`QR_CPP_NEW_MODULE`；JS模块参数使用file URL，quirc可传WASM文件路径。

```sh
node --experimental-vm-modules benchmarks/qr/experiments/decoder-comparison/run.mjs --layer=whole
node --experimental-vm-modules benchmarks/qr/experiments/decoder-comparison/run.mjs --layer=regions
node --experimental-vm-modules benchmarks/qr/experiments/decoder-comparison/run.mjs --layer=regions --readers=quirc --output=benchmarks/qr/results/local-decoders-regions-quirc-corrected.jsonl
node --experimental-vm-modules benchmarks/qr/experiments/decoder-comparison/run.mjs --layer=whole --readers=zxing-cpp-new --output=benchmarks/qr/results/local-decoders-whole-new-cpp.jsonl
node --experimental-vm-modules benchmarks/qr/experiments/decoder-comparison/run.mjs --layer=regions --readers=zxing-cpp-new --output=benchmarks/qr/results/local-decoders-regions-new-cpp.jsonl
node --experimental-vm-modules benchmarks/qr/experiments/decoder-comparison/grid-run.mjs
node --experimental-vm-modules benchmarks/qr/experiments/decoder-comparison/native-grid-run.mjs --latest-cpp
node --experimental-vm-modules --test benchmarks/qr/experiments/decoder-comparison/verification.test.mjs
node benchmarks/qr/experiments/decoder-comparison/summarize.mjs
```

默认读取v3.14精细模式本机结果和当前manifest，可用`QR_COMPARE_BASELINE`覆盖。`--files=blurred/image005.jpg,curved/image017.jpg`可缩小范围，`--output`指定独立结果文件，避免覆盖完整矩阵。缓存来源和生成图输出均标注`diagnosticOnly`，不能与完整产品流程成绩混写。

## 原始来源

- [ZXing WASM官方项目](https://github.com/Sec-ant/zxing-wasm)：版本、配套WASM、浏览器与Node加载；`isPure`不是直接BitMatrix接口。
- [jsQR源码](https://github.com/cozmo/jsQR/blob/master/src/index.ts)：RGBA入口与单码结果。
- [ZBar WASM官方项目](https://github.com/undecaf/zbar-wasm)：浏览器模块、扫描器配置和生命周期。
- [quirc官方头文件](https://github.com/dlbeer/quirc/blob/master/lib/quirc.h)：分离识别/提取/解码接口、四角和模块位图；本轮具体二进制仍是包内1.0版本。
- [ZXing-JS QRCodeReader](https://github.com/zxing-js/library/blob/master/src/core/qrcode/QRCodeReader.ts)、[Detector](https://github.com/zxing-js/library/blob/master/src/core/qrcode/detector/Detector.ts)、[Decoder](https://github.com/zxing-js/library/blob/master/src/core/qrcode/decoder/Decoder.ts)：三定位中心、采样变换及直接BitMatrix解码。
