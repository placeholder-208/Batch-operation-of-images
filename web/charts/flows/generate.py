"""Generate report-ready SVG diagrams with standard flowchart symbols."""
from html import escape
from pathlib import Path


HERE = Path(__file__).resolve().parent


class Diagram:
    def __init__(self, title, width=1700, height=690):
        self.width, self.height = width, height
        self.parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img">
<title>{escape(title)}</title>
<defs><marker id="arrow" markerWidth="11" markerHeight="11" refX="9" refY="5.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 11 5.5 L 0 11 z" fill="#627b74"/></marker></defs>
<style>
text{{font-family:"Microsoft YaHei","SimHei","Noto Sans CJK SC",sans-serif}}
.title{{font-size:39px;font-weight:700;fill:#173a32}}
.node{{font-size:25px;font-weight:600;fill:#183d34;text-anchor:middle}}
.white{{fill:white}}
.edge-label{{font-size:20px;font-weight:700;fill:#45645b;text-anchor:middle}}
.note{{font-size:20px;fill:#657b74}}
</style>
<rect width="100%" height="100%" fill="#fcfdfb"/>
<rect width="100%" height="10" fill="#197866"/>
<text class="title" x="70" y="77">{escape(title)}</text>
''']

    def node(self, lines, x, y, w=250, h=94, kind="process"):
        colors = {
            "process": ("#eaf4f0", "#2d806d"),
            "input": ("#f5f8f6", "#90aaa0"),
            "output": ("#176d5e", "#176d5e"),
            "cloud": ("#edf2fa", "#5682a5"),
            "remote": ("#f7eef8", "#9b6aa0"),
        }
        fill, stroke = colors[kind]
        self.parts.append(f'<rect x="{x-w/2:g}" y="{y-h/2:g}" width="{w:g}" height="{h:g}" rx="17" fill="{fill}" stroke="{stroke}" stroke-width="2.5"/>')
        self._lines(lines, x, y, white=kind == "output")

    def diamond(self, lines, x, y, w=252, h=154):
        points = f'{x:g},{y-h/2:g} {x+w/2:g},{y:g} {x:g},{y+h/2:g} {x-w/2:g},{y:g}'
        self.parts.append(f'<polygon points="{points}" fill="#fff4df" stroke="#cf9c43" stroke-width="2.5"/>')
        self._lines(lines, x, y, size=23)

    def _lines(self, lines, x, y, size=25, white=False):
        if isinstance(lines, str):
            lines = lines.split('\n')
        step = 33 if size == 25 else 30
        first_y = y - step * (len(lines)-1)/2 + 8
        cls = 'node white' if white else 'node'
        for index, line in enumerate(lines):
            self.parts.append(f'<text class="{cls}" x="{x:g}" y="{first_y+index*step:g}" style="font-size:{size}px">{escape(line)}</text>')

    def edge(self, points, label=None, label_xy=None, dashed=False, arrow=True):
        coordinate = ' '.join(f'{x:g},{y:g}' for x, y in points)
        dash = ' stroke-dasharray="8 7"' if dashed else ''
        end = ' marker-end="url(#arrow)"' if arrow else ''
        self.parts.append(f'<polyline points="{coordinate}" fill="none" stroke="#627b74" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"{end}{dash}/>')
        if label:
            x, y = label_xy
            self.parts.append(f'<text class="edge-label" x="{x:g}" y="{y:g}">{escape(label)}</text>')

    def note(self, text, x, y):
        self.parts.append(f'<text class="note" x="{x:g}" y="{y:g}">{escape(text)}</text>')

    def save(self, name):
        (HERE / f'{name}.svg').write_text('\n'.join([*self.parts, '</svg>\n']), encoding='utf-8')


def architecture():
    d = Diagram('总体架构', 1800, 1100)
    d.node('用户输入\n图片、PDF、描述与提示', 260, 203, 310, 110, 'input')
    d.node('Cloudflare Workers\n提供页面、模型与运行库', 900, 155, 390, 115, 'cloud')
    d.node('浏览器工作区', 900, 306, 300, 92)
    d.edge([(415,203),(530,203),(530,306),(750,306)])
    d.edge([(900,212),(900,259)])
    d.edge([(900,352),(900,413)],arrow=False)
    d.edge([(220,413),(1580,413)],arrow=False)
    modules = [('二维码识别',220),('条形码识别',560),('二维码遮盖',900),('语义裁剪',1240),('本地分割',1580)]
    for name,x in modules:
        d.edge([(x,413),(x,462)])
        d.node(name,x,512,265,98)
    d.node('Worker 语义接口\n与 Groq API',1240,650,282,105,'remote')
    d.edge([(1240,561),(1240,597)], label='按需联网',label_xy=(1350,590))
    for x in (220,560,900,1580):
        d.edge([(x,561),(x,730)],arrow=False)
    d.edge([(1240,703),(1240,730)],arrow=False)
    d.edge([(220,730),(1580,730)],arrow=False)
    d.edge([(900,730),(900,777)])
    d.node('结果预览与人工修整',900,830,355,105)
    d.node('浏览器本地保存',640,990,310,82,'input')
    d.node('按功能导出图片、ZIP、CSV',1190,990,370,82,'output')
    d.edge([(820,883),(820,925),(640,925),(640,949)])
    d.edge([(980,883),(980,925),(1190,925),(1190,949)])
    d.save('01-architecture')


def qr():
    d = Diagram('二维码识别与裁剪 · 实际处理顺序', 2500, 1250)
    d.node('导入图片／PDF',175,215,250,104,'input')
    d.node('PDF 逐页转图片\n原分辨率读入',485,215,270,112)
    d.node('整图原图 ZXing 一次\nQRCode · tryHarder',830,215,330,112)
    d.node('WeChat 检测\n整图候选区域',1205,215,285,112)
    d.diamond('触发密集图\n分区补检？',1580,215,265,160)
    d.node('6 个重叠分区\nWeChat 补检并去重',2050,215,330,112)
    for a,b in [(300,350),(620,665),(995,1062),(1348,1447)]:d.edge([(a,215),(b,215)])
    d.edge([(1713,215),(1885,215)],label='是',label_xy=(1800,187))
    d.note('分区触发条件：整图已解码 ≥8 个；WeChat 候选数 ＜ 已解码数的 75%；图像宽、高均 ≥600 px。',75,1170)
    d.diamond('存在未覆盖\n的候选？',1580,500,265,160)
    d.edge([(1580,295),(1580,420)],label='否',label_xy=(1614,363))
    d.edge([(2050,271),(2235,271),(2235,500),(1713,500)])
    d.node('按候选裁剪\n原区域 ZXing 解码',1205,500,310,112)
    d.node('仅未解码时依次尝试\n灰度对比度、锐化\n放大后锐化、自适应二值化',810,500,390,150)
    d.diamond('当前区域\n已解码？',395,500,265,160)
    d.edge([(1447,500),(1360,500)],label='是',label_xy=(1402,474))
    d.edge([(1050,500),(1005,500)])
    d.edge([(615,500),(528,500)])
    d.node('几何校正\n透视／柱面；TPS 可选\n模块二值及连续灰度采样',395,810,390,156)
    d.node('仍失败：模糊恢复\n频域滤波后重解码',855,810,340,126)
    d.diamond('开启\n精细模式？',1240,810,250,160)
    d.node('增加结构灰度校准\n恢复后再做几何校正',1570,810,305,126)
    d.node('密集图未解决区域\n尝试相位重采样',2020,810,310,126)
    d.edge([(395,580),(395,732)],label='否',label_xy=(429,664))
    d.edge([(590,810),(685,810)])
    d.edge([(1025,810),(1115,810)])
    d.edge([(1365,810),(1418,810)],label='是',label_xy=(1394,782))
    d.edge([(1723,810),(1865,810)])
    d.edge([(1240,890),(1240,975),(2020,975),(2020,873)],label='否',label_xy=(1290,945))
    d.node('逐候选完成后\n合并去重、裁图、导出',2050,1100,360,124,'output')
    d.edge([(2020,873),(2020,1038)])
    d.edge([(263,500),(150,500),(150,1100),(1870,1100)],label='是：跳过本区域后续处理',label_xy=(590,1080))
    d.edge([(1713,500),(2370,500),(2370,1100),(2230,1100)],label='否',label_xy=(2310,475))
    d.note('候选局部解码最多 8 区域；几何校正最多 2 区域。各区域一旦覆盖，就跳过其后续阶段，继续处理其他候选。',75,1205)
    d.save('02-qr-flow')


def barcode():
    d = Diagram('条形码识别与裁剪', 2050, 1030)
    d.node('文件导入与图像增强\n同二维码共用处理',205,220,310,112,'input')
    d.node('补充旋转版本',600,220,270,112)
    d.node('ZXing 一维码解码',990,220,310,112)
    d.diamond('有有效结果？',1390,220,255,156)
    d.node('映射原图坐标',1790,220,300,112)
    d.edge([(360,220),(465,220)])
    d.edge([(735,220),(835,220)])
    d.edge([(1145,220),(1263,220)])
    d.edge([(1518,220),(1640,220)],label='是',label_xy=(1575,192))
    d.diamond('条形码定位框\n呈细条状？',1790,490,265,164)
    d.edge([(1790,276),(1790,408)])
    d.node('估计条纹范围',1390,490,280,112)
    d.edge([(1658,490),(1530,490)],label='是',label_xy=(1595,463))
    d.diamond('扩展证据可靠？',990,490,265,164)
    d.edge([(1250,490),(1123,490)])
    d.node('采用修正范围',600,490,275,112)
    d.edge([(858,490),(738,490)],label='是',label_xy=(798,462))
    d.node('保留原框并提示检查',990,760,330,112,'input')
    d.edge([(990,572),(990,704)],label='否',label_xy=(1025,650))
    d.node('空间去重与冲突提示',600,760,330,112)
    d.edge([(600,546),(600,704)])
    d.edge([(825,760),(765,760)])
    d.edge([(1923,490),(1985,490),(1985,900),(600,900),(600,816)],label='否',label_xy=(1955,665))
    d.node('结果预览与批量导出\n同二维码共用处理',205,760,310,112,'output')
    d.edge([(435,760),(360,760)])
    d.node('记录未识别／异常',1390,350,300,70,'input')
    d.edge([(1390,298),(1390,315)],label='否',label_xy=(1430,313))
    d.note('共用导入、增强与导出能力；条形码单独执行一维码解码、条纹范围修正及结果冲突处理。',75,990)
    d.save('03-barcode-flow')


def masking():
    d = Diagram('二维码遮盖 · 自动候选与人工复查', 2100, 1000)
    d.node('导入图片／PDF',160,220,255,104,'input')
    d.node('PDF 逐页转图片\n建立批次列表',485,220,270,112)
    d.diamond('启动自动\n检测？',820,220,245,158)
    d.node('复用二维码解码流程\n得到已解码位置',1190,170,320,112)
    d.node('WeChat 候选检测\n保留未解码候选',1580,170,320,112)
    d.node('映射至原图坐标\n保留所有自动遮盖框',1860,410,360,112)
    d.node('直接手动画框\n或补充漏检区域',820,490,330,112)
    d.diamond('逐图复查\n范围足够？',1490,650,245,158)
    d.node('设黑／白填充和边距\n原尺寸绘制实心矩形',1850,650,350,112)
    d.node('导出单图 PNG\n或批量 ZIP',1850,875,330,112,'output')
    d.edge([(288,220),(350,220)])
    d.edge([(620,220),(698,220)])
    d.edge([(943,220),(1030,220),(1030,170)],label='是',label_xy=(985,192))
    d.edge([(1350,170),(1420,170)])
    d.edge([(1740,170),(1860,170),(1860,354)])
    d.edge([(820,299),(820,434)],label='否',label_xy=(855,375))
    d.edge([(1860,466),(1860,545),(1490,545),(1490,571)])
    d.edge([(985,490),(1320,490),(1320,650),(1368,650)])
    d.edge([(1613,650),(1675,650)],label='是',label_xy=(1645,622))
    d.edge([(1850,706),(1850,819)])
    d.edge([(1490,729),(1490,795),(820,795),(820,546)],label='否：补框／撤销',label_xy=(1160,780))
    d.note('自动检测不能证明已经覆盖全部二维码；导出前需检查漏检与误盖。遮盖框以原图坐标保存。',75,955)
    d.save('04-cover-flow')


def semantic():
    d = Diagram('语义裁剪 · 云端定位与本地裁图', 2300, 980)
    d.node('批量导入图片',155,220,250,104,'input')
    d.node('填写目标描述\n每图独立或统一应用',485,220,300,112)
    d.diamond('授权联网且\n口令、描述完整？',850,220,270,164)
    d.node('本地生成 JPEG 缩图\n长边不超过 1024 px',1245,220,350,112)
    d.node('Worker 转发请求\nGroq 返回目标框',1640,220,330,112,'remote')
    d.diamond('返回有效\n目标坐标？',2010,220,250,164)
    for a,b in [(280,335),(635,715),(985,1070),(1420,1475),(1805,1885)]:d.edge([(a,220),(b,220)])
    d.node('提示补全设置\n或确认联网',850,485,310,100,'input')
    d.edge([(850,302),(850,435)],label='否',label_xy=(886,376))
    d.node('显示无目标、坐标异常\n或接口错误',2010,755,330,120,'input')
    d.edge([(2135,220),(2250,220),(2250,755),(2175,755)],label='否',label_xy=(2210,615))
    d.node('坐标映射回原图\n仅裁出目标矩形区域',2010,490,350,112)
    d.edge([(2010,302),(2010,434)],label='是',label_xy=(1960,387))
    d.diamond('勾选转入\n本地分割？',1610,490,260,164)
    d.edge([(1835,490),(1740,490)])
    d.node('首个裁图交给\n本地分割生成蒙版',1235,490,320,112)
    d.edge([(1480,490),(1395,490)],label='是',label_xy=(1436,465))
    d.node('预览并导出\n裁图 ZIP、坐标 CSV',1235,790,345,112,'output')
    d.edge([(1235,546),(1235,734)])
    d.edge([(1610,572),(1610,790),(1408,790)],label='否',label_xy=(1650,665))
    d.note('只有检测缩图和描述会按需发送；实际裁图使用浏览器内的原图像素。',75,925)
    d.save('05-semantic-flow')


def segmentation():
    d = Diagram('本地分割 · 模型选择与可编辑蒙版', 2250, 1050)
    d.node('导入单张或多张图片',170,220,280,108,'input')
    d.node('可选白框限定\n裁剪输入范围',520,220,300,116)
    d.diamond('选择模型',875,220,220,150)
    d.node('通用 SlimSAM\n蓝框、保留点、排除点',1250,155,340,116)
    d.node('人物 MODNet FP32\n不使用蓝框与提示点',1250,390,340,116)
    d.node('本地 WASM 推理\n生成候选蒙版／连续透明度',1660,260,350,116)
    d.node('通用：选候选、调阈值\n人物：直接使用连续透明度',2050,260,330,116)
    d.edge([(310,220),(370,220)])
    d.edge([(670,220),(765,220)])
    d.edge([(985,220),(1080,220),(1080,155)],label='通用',label_xy=(1035,192))
    d.edge([(875,295),(875,390),(1080,390)],label='人物',label_xy=(917,354))
    d.edge([(1420,155),(1485,155),(1485,260)])
    d.edge([(1420,390),(1460,390),(1460,260),(1485,260)])
    d.edge([(1835,260),(1885,260)])
    d.node('叠加预览\n检查主体与边缘',2040,560,320,112)
    d.edge([(2040,318),(2040,504)])
    d.diamond('结果\n需要修整？',1620,560,250,164)
    d.edge([(1880,560),(1745,560)])
    d.node('重新调整提示并推理\n或画笔、曲线、小区域清理',1195,560,370,130)
    d.edge([(1495,560),(1380,560)],label='是',label_xy=(1436,532))
    d.edge([(1195,495),(1195,470),(1990,470),(1990,504)],label='重新预览',label_xy=(1580,457))
    d.node('按原图分辨率合成\n透明 PNG、蒙版及批量 ZIP',1620,905,400,130,'output')
    d.edge([(1620,642),(1620,840)],label='否',label_xy=(1655,750))
    d.note('白框限制输入和输出范围；仅通用模式使用目标提示。画笔与曲线修改会进入最终导出结果。',75,1010)
    d.save('06-segmentation-flow')


if __name__ == '__main__':
    for make in (architecture, qr, barcode, masking, semantic, segmentation):
        make()
