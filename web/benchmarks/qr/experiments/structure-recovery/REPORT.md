# v3.14：以模块结构约束剩余模糊二维码恢复

本轮基线是工作区中已完成的v3.13，非Git HEAD中的v3.12。开始实验前将完整`js/`快照至本机临时目录，以该快照重跑全量对照。未修改用户图片、标注、Cloudflare配置，未推送或部署。

## 论文提供的思路及边界

1. [Fast Blur Removal for Wearable QR Code Scanners，ISWC 2015](https://vs.inf.ethz.ch/publ/papers/soeroesg-iswc2015-BlurryQRScanning.pdf)：交替恢复、估计模糊核与尝试解码，利用二维码的边缘和结构约束，在成功解码时停止。论文也讨论相机非线性亮度处理对模糊模型的影响。本轮借鉴结构约束与解码验证，另测试亮度补偿；没有复现其完整盲核估计或宣称获得论文成绩。
2. [A Regularization Approach to Blind Deblurring and Denoising of QR Barcodes](https://arxiv.org/html/1410.6333v3)：利用已知定位图案估计PSF，结合TV去噪/反卷积与阈值化。其定位先验、噪声和模糊假设不能直接等同于手机照片。本轮只做了固定核、有限迭代TV原型，未复现整套算法。
3. [Blind Deblurring of Barcodes via Kullback–Leibler Divergence](https://www.math.mcgill.ca/rchoksi/pub/KL.pdf)：将条码的离散符号结构用于恢复约束。这支持把恢复对象从一般图像转为模块结构的研究方向；产品实现是小尺度Wiener启发式，并非论文的KL优化器。相关开源实现[deblurrinator](https://github.com/coltonomous/deblurrinator)可供后续对照，本轮没有引入其代码或依赖。
4. [ADNet，2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC13468810/)显式引入二维码边缘先验，并组合轻重两种恢复网络。作者[代码库](https://github.com/leejianping/ADNet)提供LENet和训练权重链接；本轮查阅了结构与测试流程，尚未验证权重在本数据上的收益、浏览器速度和分发许可，因此没有下载模型或加入网页依赖。

共同启发是保留二维码的模块与功能图案结构，并用实际解码判断收益。视觉上变清晰不等于内容可恢复。本轮新方法由上述思路与实际失败区域实验形成，不能视为任何论文的完整复现。

## 失败原因与本轮处理

| 观察到的失败环节 | 对应处理 | 验证结果 |
| --- | --- | --- |
| 固定模糊核与相机亮度处理可能不匹配 | 亮度幂变换→Wiener→反变换 | 12个失败区域、1564次解码，新增0；不接入 |
| 反卷积振铃可能干扰二值化 | 固定核TV约束恢复，5/10/20次迭代输出 | image005两区域及036、037共4区域、96次解码，新增0；不接入 |
| 灰度采样已形成网格，但模块之间仍有混合 | 在模块灰度网格上进行小尺度恢复后阈值化 | 原图拟合直接处理12区域、1344次解码，新增0；先恢复图像再拟合时新增1 |
| 原始图的定位结构不足，或候选因每图2区域限制跳过几何校正 | 原恢复阶段完成后，允许剩余候选从恢复图重新寻找定位结构 | image021第三候选原先被几何预算跳过，新步骤补出该目标 |

以上原因不是自动判定的退化分类，也不能认定全部剩余图片具有同一种模糊。负结果仅限上述参数与样本，不能证明方法普遍无效。

离线网格实验在12个缓存WeChat区域上测试原图及17种恢复版本，合计13742次解码、约45.84秒，只有1处新增，因此未把该遍历方案直接接入产品。既有定位方块评分能将该成功恢复版本排第二，保留前4张足以覆盖；评分最高的版本没有通过几何模型筛选，不能只取第一名或将分数视作概率。

## 新增目标与消融

新增为`blurred/image021.jpg`候选3。384像素工作边，像素恢复核length=13、angle=45°、sigma=0.6、regularization=0.02；拟合25×25网格、axis=0、curvature=0.4。在模块灰度上采用sigma=0.3模块、regularization=0.01，cutoff=0.45后成功解码。结果逆映射到原图，与标注IoU约0.95628；内容只记录SHA-256：`fe7162532814ab74e3ea14c27b573534bf8f4384bf5da07887d297f4126e09d3`。

同一恢复图、相同几何预算与模型上，原有二值+连续灰度路径返回0；仅将阈值扩展至0.35/0.4/0.45/0.5/0.55/0.6/0.65/0.75也返回0；模块恢复返回1。新路径在第107次模块解码尝试成功，Node本轮模块阶段约250ms。这是选定案例的消融，不代表泛化准确率。

既有TXT只有位置，没有独立解码文本真值。位置匹配和保留旧内容哈希可验证增益及回归，但不能据此宣称文本正确率达到某个比例。没有将人工标注角点、已知内容或其他副本的结果注入识别程序。

## 产品中的受限实现

- 新步骤沿用“精细模糊恢复”，默认关闭，与TPS独立；不新增选项。普通流程的识别步骤保持不变。
- 先完整运行全部既有阶段，再补做恢复后校正；优先处理此前已有模型的区域，后续也允许预算跳过或无旧模型的候选。最多3区域，区域7000ms、整图14000ms，384像素、17恢复核、前4张结构评分候选；每次探测200ms、几何600ms。
- 每张入选恢复图先运行既有二值与连续灰度解码。均失败后，对最多12个不同几何模型的模块灰度做Wiener恢复，sigma=0.3/0.45/0.6模块、正则项0.01，阈值0.4/0.45/0.5/0.55/0.6。重复几何模型不因旧阈值不同而重复试验。
- 最多180次模块解码，或1000ms即停；预算在任务之间检查，不能中断一次WASM调用。只生成当前小网格版本，及时释放恢复图Canvas。所有新增结果都必须经ZXing有效解码，再映射回原图并参与既有空间去重。
- 不替换模块为已知功能图案，不重写文本，不改变原图、裁图与其他功能。此小尺度模糊核是假设，不是已从照片估计出的真实PSF。

模块恢复独立于原流程预算；对一个模型恢复失败仍会继续其他入选模型和候选。精细模式的增加成本主要还包括其他失败区域的恢复和重新定位，并非只有新增成功目标的250ms。

## 全量及浏览器验证

Node v22.23.4、实际ZXing/ORT WASM、原生Canvas，95张去重图片、123个去重标注位置；按四边形IoU≥0.3一对一匹配，三个配置顺序独立运行。初始化计入本轮逐图耗时，非浏览器交互性能承诺。

| 配置 | 模糊组 | 曲面组 | 合计 | 总耗时 |
| --- | ---: | ---: | ---: | ---: |
| v3.13精细模式快照重跑 | 51/63 | 60/60 | 111/123 | 105.98秒 |
| v3.14默认 | 49/63 | 60/60 | 109/123 | 62.09秒 |
| v3.14精细模式 | 52/63 | 60/60 | 112/123 | 141.44秒 |

新精细模式增加1处，批次耗时增加约35.46秒。三个配置均无标注外预测或运行异常；新精细模式没有丢失旧精细模式的内容哈希。默认模式未执行恢复后校正与模块恢复。曲面成绩只说明本测试集，不保证任意曲面全识别。数据集参与了参数选择，需要未参与开发的独立照片进一步验证。

原始输出：`results/local-3.13-control-research-results.jsonl`、`local-production-3.14-results.jsonl`、`local-production-3.14-detailed-results.jsonl`，默认不提交。实际Chromium通过13张精细回归，image021返回2个并确认经过模块恢复；TPS+精细组合的image021、image019、curved/image017分别返回2、1、2个。页面检查通过设置迁移、精细开关持久化、双码结果、统计/ZIP下载、刷新恢复、二维码遮盖、五个功能标签页和EAN13识别。25项QR/FFT/Worker自动检查及研究数学控制检查通过，`git diff --check`无错误。

## 统计与复跑

CSV保留全部旧列和人工字段，在末尾添加模块恢复次数、准备耗时、ZXing耗时和预算跳过数。JSON在恢复图试验中记录模块尝试次数、预算、选定核与阈值。`moduleRecoverySkipped`表示未完成预算内全部尝试，不等同于算法失败；异常仍单独标记。模块恢复解码计时是恢复后ZXing总计的子集，准备和解码又包含在fit父阶段内，不能重复相加。

研究程序与产品分开。先按QR评估说明生成清单、旧精细结果；设置`QR_CANVAS_MODULE`并使用Node22，从`web`运行：

```sh
node --experimental-vm-modules benchmarks/qr/experiments/structure-recovery/check.mjs
node --experimental-vm-modules benchmarks/qr/experiments/structure-recovery/run.mjs --mode=gamma --edges=384,576
node --experimental-vm-modules benchmarks/qr/experiments/structure-recovery/run.mjs --mode=tv --edges=384 --files=blurred/image005.jpg,blurred/image036.jpg,blurred/image037.jpg
node --experimental-vm-modules benchmarks/qr/experiments/structure-recovery/grid.mjs
node --experimental-vm-modules benchmarks/qr/experiments/structure-recovery/grid.mjs --restored --output=benchmarks/qr/results/local-research-grid-restored.jsonl
node --experimental-vm-modules benchmarks/qr/experiments/structure-recovery/ablation.mjs
```

`QR_RESEARCH_BASELINE`默认指向`benchmarks/qr/results/local-3.13-control-research-results.jsonl`，可显式指定旧版完整bench结果。脚本核对图片SHA-256，读取未覆盖WeChat区域，不读取标注进行解码；输出带`diagnosticOnly:true`、`cachedDetection:true`，不能作为完整产品成绩。`ablation.mjs`固定到研究中发现的单例作机制核验，不被产品导入。`check.mjs`检查FFT恢复一致性、恒定亮度、TV无正则恒等及真实解码器控制样本。临时依赖和实验图片不进入产品发布。

剩余11个位置失败：image005两处、019两处、020三处、021一处、036、037、045。下一步更值得评估定位方块约束的局部PSF估计，或经独立样本验证的小型恢复网络；本轮没有证据证明继续增加相同固定核组合能普遍改善这些目标。
