export const workspaceTemplate=`
<div class="sam-main">
 <section class="panel sam-card" aria-labelledby="sam-sourceTitle">
  <div class="head"><div><span class="sam-step">01 · 范围与提示</span><h2 id="sam-sourceTitle">原图工作区</h2></div><button id="sam-choose">添加图片（可多选）</button></div>
  <div class="sam-section sam-batch-list"><p class="sam-hint" id="sam-batchInfo" aria-live="polite">0 张图片</p><div class="sam-image-list" id="sam-imageList" aria-label="本批图片，点击切换当前图片"></div><div class="sam-actions"><button id="sam-removeImage" disabled>移除当前图片</button><button id="sam-clearBatch" disabled>清空本批图片</button></div><p class="sam-hint">单批最多 20 张，逐张设置范围与修整；切换图片保留各自结果。所有处理留在本浏览器会话内。</p></div>
  <div class="stage" id="sam-stage"><div class="sam-empty" id="sam-empty">选择 JPEG、PNG 或 WebP 图片<br><span>也可将图片拖入这里</span></div><canvas id="sam-source" hidden aria-label="原图：拖动编辑裁剪框、提示框，或添加提示点"></canvas></div>
  <div class="sam-filebar"><span id="sam-filename">未选择图片</span><span>白框裁剪 · 蓝框提示</span></div>
  <div class="sam-section">
   <div class="sam-field"><label for="sam-mode">原图操作</label><select id="sam-mode"><option value="box">框选 / 编辑框（白色裁剪框）</option><option value="prompt">目标位置框选提示（蓝色提示框）</option><option value="positive">点击保留点 ＋</option><option value="negative">点击排除点 −</option></select></div>
   <div class="sam-actions"><button id="sam-undo" title="撤销最近添加的保留点或排除点" aria-describedby="sam-undoHelp">撤销点</button><button id="sam-clearPrompt">清除目标提示</button><button id="sam-clear">清除全部</button></div>
   <p class="sam-hint">白框决定模型读取范围；蓝框与提示点帮助指定对象。也可不画框，直接生成蒙版。</p>
   <details class="sam-help"><summary>框编辑与提示点说明</summary><div>
    <p>未画蓝框时，默认提示为当前裁剪图完整范围，不绘制蓝框；没有白框时使用原图。完整范围提示不保证选中预期对象。</p>
    <p>当前模式只编辑对应颜色的框。框内拖动移动，左右边水平缩放，上下边竖直缩放，四角按当前宽高比缩放。对应框外拖动，或按住 Alt 拖动，可重画。</p>
    <p>框内右击删除；两个框重叠时优先删除蓝框，再次右击删除白框。删框不删除提示点。</p>
    <p id="sam-undoHelp">撤销点：保留点与排除点按共同添加顺序撤销，先撤销最近的一个，与当前模式无关。</p>
    <p>修改白框需要重新编码；蓝框或提示点修改可复用图像编码，但仍须重新生成蒙版。</p>
   </div></details>
  </div>
 </section>
 <section class="panel sam-card" aria-labelledby="sam-previewTitle">
  <div class="head"><div><span class="sam-step">02 · 蒙版修整</span><h2 id="sam-previewTitle">结果预览与画笔</h2></div><label class="sam-check"><input type="checkbox" id="sam-overlay"> 叠加蒙版</label></div>
  <div class="sam-brushbar">
   <div class="sam-field"><label for="sam-brushTool">修整工具</label><select id="sam-brushTool"><option value="circle">圆形画笔</option><option value="curve">曲线闭合选区</option></select></div>
   <div class="sam-circle-tools" id="sam-circleTools">
   <div class="sam-field"><label for="sam-brushMode">画笔模式</label><select id="sam-brushMode"><option value="add">增加保留区域</option><option value="erase">删除保留区域</option></select></div>
   <div class="sam-field sam-radius"><label for="sam-brushRadius">圆形半径 <output id="sam-brushRadiusValue">12</output> px</label><input id="sam-brushRadius" type="range" min="1" max="80" step="1" value="12"></div>
   </div>
   <div class="sam-curve-tools" id="sam-curveTools" hidden><p class="sam-hint">按住拖动画轮廓，首尾靠近时自动闭合。在图形内部右击：大部分已保留则全部删除，大部分未保留则全部保留。</p><p class="sam-hint">少数状态须不超过 5%；超过时提示重画。图形不可重叠、相互包含或边界接触。</p><div class="sam-actions"><button id="sam-curveUndo" disabled>移除最近图形</button><button id="sam-curveClear" disabled>清除曲线图形</button></div><p class="sam-hint" id="sam-curveInfo" aria-live="polite">0 个图形</p></div>
   <div class="sam-actions"><button id="sam-brushUndo" disabled title="撤销最近一次圆形画笔或曲线填充操作">撤销最近修改</button><button id="sam-brushClear" disabled>清除全部修整</button></div>
  </div>
  <div class="stage mask-preview" id="sam-previewStage"><canvas id="sam-result" hidden aria-label="裁剪图完整范围：包括透明像素，左键涂画，右键切换增加或删除"></canvas><span class="sam-empty" id="sam-resultEmpty">生成蒙版后在这里修整</span></div>
  <div class="sam-preview-legend"><span><i class="sam-checker-chip" aria-hidden="true"></i>棋盘格：图片内透明像素，可补画</span><span><i class="sam-outside-chip" aria-hidden="true"></i>灰色外围：图片外留白，不可绘制</span></div>
  <div class="sam-section">
   <p class="sam-hint">仅在图片边界内操作。圆形画笔右键切换模式；曲线工具在封闭图形内部右击执行。修整会用于最终导出。</p>
   <details class="sam-help"><summary>画笔、预览与修改保留规则</summary><div>
    <p>绿色圆形光标增加保留区域，红色删除。半径按屏幕预览像素计算。透明区域也能直接补画，无需从已有蒙版拖过去。</p>
    <p>撤销最近修改按圆形画笔整笔操作或一次曲线填充撤销，与上方撤销提示点独立。清除全部修整会清除圆形画笔与曲线图形，区域清理独立保留，可通过“撤销区域清理”恢复。</p>
    <p>曲线首尾在约 12 个屏幕像素内允许自动闭合；自交、过小或过于复杂的图形会被拒绝。最多保留 30 个互不重叠的图形，橙色虚线表示待执行，绿色／红色轮廓表示最近一次保留／删除。</p>
    <p>右击时，按当前工作图蒙版透明度不低于 0.5 判断保留状态，统计图形内部像素。少数状态占比不超过 5% 才反向统一处理；超过时不修改蒙版，尚未处理的图形自动移除，方便重画。已处理图形可先移除或清除后重画。</p>
   <p>移除最近图形会撤回它的全部填充操作；清除曲线图形不清除圆形画笔。轮廓线仅辅助显示，不写入导出图片。每张图片各自保留修整，不将坐标直接套用到其他图片。</p>
    <p>切换候选、阈值、反转或叠加预览保留画笔修改；切图保留各图修改；重新生成蒙版、改变裁剪范围或模型提示会清除当前图片的修改。</p>
    <p>预览仅包含当前裁剪范围。叠加模式的绿色是保留区域；导出仍为透明 PNG，不包含绿色叠加、棋盘格或外围留白。</p>
   </div></details>
  </div>
 </section>
</div>
<aside class="sam-side" aria-label="本地分割设置与导出">
 <section class="panel sam-card sam-settings">
  <span class="sam-step">本地推理 · SlimSAM</span><h2>生成蒙版</h2><p class="sam-hint">图片留在浏览器中，模型首次使用时加载。</p>
  <button class="primary" id="sam-segment" disabled>生成当前图片蒙版</button>
  <div class="sam-actions"><button id="sam-batchGenerate" disabled>批量生成未完成图片</button><button id="sam-batchStop" disabled>停止批量任务</button></div>
  <p class="sam-hint" id="sam-batchProgress" role="status" aria-live="polite">等待批量任务</p>
  <div class="status" id="sam-status" role="status" aria-live="polite">等待图片与框选</div>
  <details class="sam-help" open><summary>模型与任务状态</summary><dl class="sam-runtime"><div><dt>模型</dt><dd id="sam-modelState">首次分割时加载</dd></div><div><dt>图像编码</dt><dd id="sam-encodeState">等待任务</dd></div><div><dt>蒙版解码</dt><dd id="sam-decodeState">等待任务</dd></div></dl></details>
 </section>
 <section class="panel sam-card sam-settings">
  <span class="sam-step">蒙版调整</span><h2>选择与边缘</h2>
  <div class="sam-field"><label for="sam-candidate">候选蒙版</label><select id="sam-candidate" disabled></select></div>
  <label class="sam-check"><input id="sam-invert" type="checkbox" disabled> 反转保留区域</label>
  <div class="sam-field"><label for="sam-threshold">蒙版阈值 <output id="sam-thresholdValue">0.0</output></label><input id="sam-threshold" type="range" min="-3" max="3" step="0.1" value="0" disabled></div>
  <label class="sam-check"><input id="sam-smooth" type="checkbox" checked> 窄边缘抗锯齿</label>
  <p class="sam-maskinfo" id="sam-maskInfo" aria-live="polite">等待蒙版</p>
  <button id="sam-batchApply" disabled>将当前参数应用到已生成图片</button>
  <p class="sam-hint">批量应用阈值、反转、抗锯齿和透明裁切设置。候选蒙版、框、提示点及画笔修整仍逐图保留；区域清理须重新执行。</p>
  <div class="sam-field"><label for="sam-minArea">最小区域面积（占裁剪图 %）</label><input id="sam-minArea" type="number" min="0" max="100" step="0.01" value="0.05" disabled></div>
  <div class="sam-actions"><button id="sam-cleanAreas" disabled>删除小于阈值的区域</button><button id="sam-undoAreas" disabled>撤销区域清理</button></div>
  <p class="sam-hint" id="sam-areaInfo" role="status" aria-live="polite">尚未执行区域清理</p>
  <details class="sam-help"><summary>如何调整候选与边缘</summary><div>
   <p>默认选择预测 IoU 较高的候选。这个数值表示模型估计的蒙版质量，不是目标正确概率；先比较候选，再补充提示点。</p>
   <p>阈值越高，保留区域通常越少。阈值和反转不重新推理；反转也会交换原有孔洞，不会恢复裁剪范围外的图片。画笔修改在模型蒙版调整之后应用。</p>
   <p>连续蒙版先插值，再生成约 1.5 个输出像素宽的透明过渡。关闭抗锯齿使用硬边界，画笔边缘仍有轻微抗锯齿。这不等同于毛发或玻璃的精细抠图。</p>
   <p>区域清理按八邻域计算连通区域，角点相接也视为一块。透明度不低于 1/255 的工作图像素参与计算。只删除面积严格小于阈值的区域，不填孔，也不切断与大区域相连的突起。</p>
   <p>调节面积数值后须点击按钮才执行，重复点击根据当前模型蒙版和画笔重新计算。撤销清理恢复所有被该功能删去的区域。清理是一次性操作，不随画笔重新分析。清理后的圆形画笔和曲线填充继续生效，可以补回删去的区域，其他删除结果保留。候选、蒙版阈值、反转或抗锯齿更改会撤销清理；叠加预览不影响清理。</p>
   <p>小区域可能是目标细节，不一定是噪点。面积由工作图估算，细桥、细线或降采样可能改变连通关系，执行后请检查预览。</p>
  </div></details>
 </section>
 <section class="panel sam-card sam-settings">
  <span class="sam-step">03 · 导出</span><h2>保存结果</h2>
  <label class="sam-check"><input id="sam-tight" type="checkbox" checked> 裁去外围透明留白</label>
  <div class="sam-export"><button class="primary" id="sam-download" disabled>下载透明 PNG</button><button id="sam-maskDownload" disabled>下载灰度蒙版 PNG</button></div>
  <div class="sam-field"><label for="sam-batchFormat">批量下载内容</label><select id="sam-batchFormat"><option value="transparent">透明 PNG</option><option value="mask">灰度蒙版 PNG</option><option value="both">透明 PNG 与灰度蒙版</option></select></div>
  <button id="sam-batchZip" disabled>批量下载 ZIP（含 CSV 清单）</button>
  <p class="sam-hint">透明 PNG 按原始裁剪尺寸导出，包含画笔修改和边缘处理。</p>
  <details class="sam-help"><summary>导出规格、限制与诊断</summary><div>
   <p>灰度蒙版使用分割工作图尺寸：白色保留，黑色删除，灰色为边缘过渡。原图已有透明度会保留。</p>
   <p>量化模型约 13.8 MB，另有专用运行库；单线程 CPU 推理，首次编码较慢。原图允许超过 1024 像素，上限 1600 万像素、20 MiB。网页工作图长边不超过 1024；模型预处理再将长边缩放至 1024 并补齐为 1024×1024 输入。透明 PNG 映射回原始裁剪尺寸，大图可处理，不等于模型以大图的全部像素识别。</p>
   <p>批量生成顺序执行，跳过已有结果，不覆盖已修整图片。停止按钮在当前图片结束后生效；灰度蒙版用工作图尺寸。ZIP 为各图创建独立目录，并附成功、失败与尺寸的 CSV 清单，不包含原图。</p>
   <p>蒙版缓存尽可能压缩，限 128 MiB；导出图片累计上限 256 MiB。刷新或清空批次会丢失本次设置与结果，请及时下载。切图后修改模型提示需要重新编码，模型本身不重复下载。</p>
   <p>背景相似、遮挡、玻璃和细小边缘可能分割不准，请检查结果后导出。</p>
   <button id="sam-diagnostic" disabled>下载诊断 JSON</button>
  </div></details>
 </section>
</aside>
<nav class="sam-quick-nav" id="sam-quickNav" aria-label="快速切换本批图片" hidden>
 <button id="sam-prevImage" title="上一张图片" aria-label="上一张图片">←</button>
 <div class="sam-quick-select"><label for="sam-imageSelect">当前图片 <span id="sam-imagePosition"></span></label><select id="sam-imageSelect" aria-label="切换图片，自动保留当前修改"></select></div>
 <button id="sam-nextImage" title="下一张图片" aria-label="下一张图片">→</button>
</nav>
<input id="sam-file" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
`;
