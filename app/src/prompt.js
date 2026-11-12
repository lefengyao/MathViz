/* MathViz for DeepSeek —— 提示词模板（纯逻辑，无 DOM 依赖，可单测） */
(function (g) {
  'use strict';

  var MARK = '【MathViz 作图模式】';
  var QUESTION = '【我的问题】';

  var MODES = [
    { id: 'off',       label: '关闭',              desc: '不插入提示词' },
    { id: 'auto',      label: '通用 · 自动选产线',  desc: '模型按题目自己选手写 SVG / 2D / 3D / 图论 / 电路 / PCB / 工程图' },
    { id: 'plot2d',    label: '函数与 2D',          desc: '强制 MK.frame，曲线、参数方程、向量' },
    { id: 'solid3d',   label: '立体与 3D',          desc: '强制 MK.space，多面体、截面、空间向量' },
    { id: 'discrete',  label: '图论与离散',          desc: '强制 MK.graph / MK.venn / MK.matrix' },
    { id: 'schematic', label: '电路原理图',          desc: '强制 MK.schematic，元件符号 + 端口连线，自动走线' },
    { id: 'pcb',       label: 'PCB 布局',            desc: '强制 MK.pcb，板框 + 封装 + 走线 + 过孔，毫米坐标' },
    { id: 'eng',       label: '机械工程图',          desc: '强制 MK.eng，零件轮廓 + 尺寸 + 剖面线 + 粗糙度' },
    { id: 'svg',       label: '纯 SVG · 简单图',     desc: '零运行时，只适合图元 ≤ 8 的简单示意图' }
  ];

  var API = [
    '## 已预置的运行时（直接调用，不要重新定义、不要内联、不要 import）',
    '',
    '- `MK.frame({box:[40,26,600,330], x:[-4,4], y:[-3,5], equal:false, grid:true, axes:true, title, desc})`',
    '  → 返回 V；`document.getElementById("fig").appendChild(V.svg)` 之后可调用：',
    '  `V.plot(f,opt)` 函数 / `V.param(t=>[x,y],opt)` 参数方程 / `V.polar(r,opt)` 极坐标 /',
    '  `V.curve(pts,opt)` / `V.seg(a,b,opt)` / `V.arrow(a,b,opt)` / `V.dot(p,opt)` /',
    '  `V.label(p,text,opt)` / `V.poly(pts,opt)` / `V.circle(c,r,opt)` / `V.arc(c,r,a1,a2,opt)` /',
    '  `V.angle(v,p1,p2,opt)` / `V.area(f,a,b,opt)` / `V.legend(items,opt)`。',
    '  采样、断点、y 轴翻转、刻度都由运行时算，**不要手算像素坐标**。',
    '- `MK.space({box,yaw,pitch,range,center,title,desc})` → 返回 S，三维点写成 `[x,y,z]`。',
    '  `S.line([x,y,z],[x,y,z],opt)` / `S.arrow` / `S.axes` / `S.point` / `S.label` /',
    '  `S.face([[x,y,z],...],opt)`（**第一个参数必须是顶点数组，不能是对象**）/',
    '  `S.box([x,y,z],[x,y,z],opt)` / `S.clear()`。投影、隐藏边、轴方向都由运行时算。',
    '  **交互是自带的，不要自己实现**：画布可直接拖拽旋转、双击复位；',
    '  给面或球加 `info:\'说明文字\'`（solid 另支持 `faceInfo:[每面一条]`），',
    '  用户点击该面就会高亮并在底部信息栏显示这段文字，必要时 `S.onPick(function(info){...})` 接收回调。',
    '  **3D 里没有 `V.plot` / `V.seg`**（那是 2D 的），不要写 `S.drag(draw)`（拖拽已内置）。',
    '- `MK.graph({nodes:[{id,x,y,fixed,info}], edges:[["起点","终点",权重]], directed, box, title, desc})`',
    '  → 返回 G；`G.draw()` 先画，再 `G.path(["A","B",...],opt)` / `G.mark(id,opt)`。',
    '  `nodes` 的 x,y 是画布像素坐标，`fixed:true` 表示不参与自动布局；`edges` 必须是数组，不要写成对象。',
    '  节点可加 `info:\'说明\'`：点击该节点会高亮并显示信息；`G.onPick(fn)` 接收回调。',
    '  `MK.venn({...})`、`MK.matrix({...})` 直接返回 svg；`MK.txt(svg,x,y,text,opt)` 加文字。',
    '- `MK.schematic({box:[40,26,600,330], cell:48, title, desc})` → 返回 C，**网格坐标**（1 格 = cell 像素）。',
    '  `C.resistor({id:"R1", at:[列,行], rot:0|90|180|270, label:"R1", value:"10 kΩ"})` 放元件；',
    '  可用元件：`resistor cap capPolar ind diode led zener npn pnp mosfet opamp battery ac ground vcc switch fuse lamp`。',
    '  端口：两端件 `l`/`r`；三极管 `b`/`c`/`e`，MOS `g`/`d`/`s`，运放 `n`/`p`/`out`，`ground.t`，`vcc.b`。',
    '  连线只写端口名：`C.wire("R1.r","Q1.c",{color,w})` —— 正交折线、拐点、结点圆点全由运行时算，',
    '  **不要自己拼折线坐标**（写死坐标是模型最常犯的错，一改元件位置线就断）。`C.wires([["R1.r","Q1.c"],...])` 批量。',
    '  需要强制绕路时给必经拐点：`C.wire("V1.l","GND.t",{via:[[0,4.5]]})`（网格坐标）。',
    '  `C.ic({at,left:["IN","EN"],right:["OUT"],top:["VCC"],bottom:["GND"],label:"U1"})` 画矩形芯片；',
    '  `C.label([列,行],"v_in",{dx,dy,anchor})`、`C.dot([列,行])`。',
    '  **自查**：`C.report()` 返回 `{ok,floating:[...]}`，`floating` 是没接线的端口，输出前必须为空。',
    '- `MK.pcb({box:[40,24,600,380], board:[宽mm,高mm], title})` → 返回 P，**毫米坐标，原点在板左上、y 向下**。',
    '  `P.outline({r:2})` 板框 / `P.footprint("0805",{at:[x,y],ref:"R1",value:"10k",rot,layer})` 放封装 /',
    '  `P.trace([[x,y],[x,y],...],{w,layer:"top"|"bottom"})` 画指定折线 / `P.route(a,b,{w})` 自动 45° 折线 /',
    '  `P.pad([x,y],{w,h,shape:"circle"|"rect",drill})`、`P.via([x,y],{pad,drill})`、`P.silk("文字",[x,y])`、',
    '  `P.dim/dimX/dimY`、`P.legend([{color:"top"|"bottom"|"pad",text:"顶层"}])`。',
    '  封装库：`0603 0805 1206 1210 sot23 soic8 dip8 header`（`header` 用 `n` 给针数，`soic8` 可用 `pins`）。',
    '- `MK.eng({box:[40,30,600,380], ext:[宽mm,高mm], scale, title})` → 返回 E，**毫米坐标，原点在左下、y 向上**。',
    '  `ext` 只是比例提示（写大写小都会在画完后自动贴合内容，不会被裁或缩到角落），按零件真实外廓估一个就行；',
    '  `E.line/poly/rect/circle/arc`，线型 `{style:"solid"|"thin"|"dash"|"center"|"phantom"}`；',
    '  `E.hatch(多边形,{angle:45,gap:4})` 剖面线、`E.centerMark(c,{r})` 中心线十字；',
    '  `E.dimX/dimY(a,b,{offset,side:"top|bottom|left|right",text})`、`E.dimDia(c,p,{dx,dy,text})`、',
    '  `E.dimRad(c,p,{dx,dy,text})`、`E.dimAngle(v,p1,p2,{r,text})`；',
    '  `E.leader(p,to,"文字")`、`E.roughness(p,"Ra 3.2")`、`E.datum(p,"A")`、`E.sectionCut(a,b,{label:"A"})`、',
    '  `E.balloon(1,p)` 零件序号、`E.viewLabel(x,y,"主视图")`。尺寸数字、箭头长度都按国标由运行时画。',
    '- 颜色名：`blue coral teal amber purple red green pink gray`（用名字，不要写死黑白）。',
    '- 所有坐标参数都是**数学坐标**，不是像素；画布宽固定 680，内容落在 x=40~640。'
  ].join('\n');

  var RULES = {
    auto: [
      '## 选哪条产线',
      '图元 ≤ 8 且坐标是简单整数 → 手写 `<svg>`；有曲线、参数方程或刻度 → `MK.frame`；',
      '有第三个维度 → `MK.space`；涉及布局（图论 / 哈斯图 / 自动机 / 文氏图）→ `MK.graph` / `MK.venn`；',
      '有元件符号、电源/地、引脚、信号流向 → `MK.schematic`；有板框、封装、焊盘、走线、丝印 → `MK.pcb`；',
      '机械零件图（轮廓 + 尺寸 + 剖视 + 粗糙度/形位公差）→ `MK.eng`。',
      '口诀：有曲线走运行时，有第三个维度走运行时，有「布局」走运行时，',
      '**有元件就别说坐标**（电路），**有焊盘就别说坐标**（PCB），**有尺寸线就别说坐标**（工程图）。',
      '最常见的错：拿 `MK.frame` 硬凑电路图、用 `V.seg` 一条条手画导线、手算三极管引脚像素位置。'
    ].join('\n'),
    plot2d: [
      '## 本轮产线（必须遵守）',
      '使用 `MK.frame` 画二维坐标系。函数、参数方程、极坐标一律用 `V.plot` / `V.param` / `V.polar`，',
      '不要手算采样点。几何图设 `equal:true`，函数图可 `false`。'
    ].join('\n'),
    solid3d: [
      '## 本轮产线（必须遵守）',
      '使用 `MK.space` 做正交投影。顶点写成 `[x,y,z]`，用 `S.line` / `S.face` / `S.point`，',
      '不要自己算投影后的二维像素坐标，也不要硬编码斜二测。隐藏边交给运行时。',
      '建完必须 `document.getElementById("fig").appendChild(S.svg);`；',
      '`S.face` 第一个参数是顶点数组 `[[x,y,z],...]`，不是对象。',
      '拖拽旋转与双击复位已内置，**不要写 `S.drag` / 自己实现交互**；',
      '鼓励给可点击的面 / 球加 `info:\'说明\'`（solid 用 `faceInfo:[...]` 按面说明），',
      '让用户点一下就能看到这块是什么。3D 对象没有 `V.plot`、`V.seg`。'
    ].join('\n'),
    discrete: [
      '## 本轮产线（必须遵守）',
      '使用 `MK.graph` 画图论 / 哈斯图 / 自动机，`MK.venn` 画文氏图，`MK.matrix` 画关系矩阵。',
      '节点只给 id（必要时给 x,y,fixed），边写成 `["起点","终点",权重]`；布局与边避让由运行时算。',
      '建完必须 `document.getElementById("fig").appendChild(G.svg);` 并先调用 `G.draw()`。',
      '节点可加 `info:\'说明\'`（如「入度 2，拓扑序第 3」），点击即高亮并显示；不要自己实现点击。',
      '哈斯图只画覆盖关系，不要画全传递边；`edges` 是数组，不要写成对象。'
    ].join('\n'),
    svg: [
      '## 本轮产线（必须遵守）',
      '只输出一个手写 `<svg viewBox="0 0 680 H" xmlns="http://www.w3.org/2000/svg">`，不调用 MK。',
      '每个图元显式写 `fill` 和 `stroke`，连接线写 `fill="none"`，字号 ≥ 11px，字重只用 400/500。'
    ].join('\n'),
    schematic: [
      '## 本轮产线（必须遵守）',
      '使用 `MK.schematic` 画电路原理图。元件放在**整数格点** `at:[列,行]` 上，旋转只用 `rot:0/90/180/270`。',
      '连线**只写端口名**：`C.wire("R1.r","Q1.c")`。运行时会走正交折线、合并同网段、在 T 型处打结点；',
      '不要写 `V.seg` / `path` 拼导线，也不要手算引脚像素位置。',
      '布局习惯：电源在上（`vcc` 在顶、`ground` 在底）、信号从左流到右、每列元件对齐同一列号，',
      '元件之间留 2~3 格，导线才不会挤在一起。',
      '极性器件注意方向：`led`/`diode` 的三角尖端朝电流流出方向（`l`→`r`），`capPolar` 的 `+` 在左侧。',
      '画完调一次 `var r = C.report();`，若 `r.floating` 不为空说明有端口没接——**改到为空为止**，',
      '悬空端口在图上就是一根断线头。',
      '三端器件（`npn`/`pnp`/`mosfet`）的引脚是画在斜线上的，但接线的落点就是 `b/c/e`（`g/d/s`）端口，直接连即可。'
    ].join('\n'),
    pcb: [
      '## 本轮产线（必须遵守）',
      '使用 `MK.pcb` 画 PCB。**所有参数都是毫米**，原点在板左上角、y 轴向下；板尺寸由 `board:[宽,高]` 给定。',
      '先 `P.outline()` 画板框，再 `P.footprint(...)` 放封装，最后 `P.trace` / `P.route` 走线。',
      '两个焊盘之间的连线优先用 `P.route(a,b,{w})`（自动 45° 折线），只有需要指定拐点时才用 `P.trace([...])`。',
      '走线不能压在别的封装焊盘上，也不能出板框；换层用 `P.via`，底部走线加 `{layer:"bottom"}`。',
      '位号（`ref`）和值（`value`）由封装自动标在元件上下方，不要再手动 `P.silk` 重复写一遍。',
      '最后加 `P.legend()` 说明顶层/底层/焊盘的颜色，整体尺寸用 `P.dim` 标在板外。'
    ].join('\n'),
    eng: [
      '## 本轮产线（必须遵守）',
      '使用 `MK.eng` 画机械工程图。**所有参数都是毫米**，原点在左下角、y 轴向上（和你脑子里的零件坐标一致）。',
      '轮廓用 `E.poly(pts,{close:true})`，可见轮廓是 `solid`，中心线 `style:"center"`，不可见轮廓 `style:"dash"`。',
      '剖视图：先画半边轮廓，再 `E.hatch(同一组点,{angle:45,gap:4})` 打剖面线，剖面线只打在被切到的实体里。',
      '尺寸标注一律用 `E.dimX/dimY/dimDia/dimRad`，**不要用 `E.text` 手写数字**——数字、箭头、尺寸界线都由运行时画。',
      '尺寸线放在零件外侧（`offset` 给正数，`side` 选远离零件的一侧）；多个尺寸平行排列时 `offset` 依次递增 8~10，',
      '小尺寸靠内、大尺寸靠外，避免尺寸线和零件轮廓或彼此交叉。',
      '文字不要压在线上：`E.dimDia/dimRad` 的文字位置用 `dx/dy` 挪开（单位是像素，不是毫米）。',
      '表面粗糙度 `E.roughness` 标在轮廓线上，基准 `E.datum` 标在基准面上，技术要求/视图名用 `E.viewLabel`。'
    ].join('\n')
  };

  var EXAMPLES = {
    auto: [
      '```mathviz',
      "var V = MK.frame({box:[40,26,600,330], x:[-4,4], y:[-3,5], equal:false, grid:true, axes:true, title:'抛物线'});",
      "document.getElementById('fig').appendChild(V.svg);",
      "V.plot(function(x){ return x*x-2; }, {color:'blue', w:2.2});",
      "V.dot([0,-2], {color:'coral', r:4});",
      "V.label([0,-2], '顶点 (0, −2)', {dx:10, dy:-12, color:'coral', size:12});",
      '```'
    ].join('\n'),
    plot2d: [
      '```mathviz',
      "var V = MK.frame({box:[40,26,600,330], x:[-3.2,3.2], y:[-2,6], equal:false, grid:true, axes:true});",
      "document.getElementById('fig').appendChild(V.svg);",
      "V.plot(function(x){ return x*x; }, {color:'blue', w:2.2, label:'y = x²'});",
      '```'
    ].join('\n'),
    solid3d: [
      '```mathviz',
      "var S = MK.space({box:[40,26,600,330], yaw:-30, pitch:20, range:2.5, title:'立方体'});",
      "document.getElementById('fig').appendChild(S.svg);",
      'S.box([0,0,0],[2,2,2],{color:"blue", opacity:0.08,',
      '  faceInfo:["下面 z=0","顶面 z=2","前面 y=0","后面 y=2","左面 x=0","右面 x=2"]});',
      'S.point([0,0,0],{color:"coral", label:"O"});',
      '```'
    ].join('\n'),
    discrete: [
      '```mathviz',
      "var G = MK.graph({box:[40,24,600,340], directed:true,",
      "  nodes:[{id:'A',x:220,y:80,fixed:true,info:'源点，入度 0'},{id:'B',x:460,y:80,fixed:true},{id:'C',x:340,y:260,fixed:true}],",
      "  edges:[['A','B',4],['A','C',10],['B','C',2]], title:'带权有向图'});",
      "document.getElementById('fig').appendChild(G.svg);",
      'G.draw(); G.path(["A","C"],{color:"red",w:3});',
      '```'
    ].join('\n'),
    svg: [
      '```mathviz',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 200">',
      '  <line x1="60" y1="150" x2="620" y2="150" stroke="#378ADD" stroke-width="2" fill="none"/>',
      '  <circle cx="340" cy="150" r="6" fill="#D85A30"/>',
      '  <text x="340" y="130" font-size="13" fill="#5F5E5A" text-anchor="middle">O</text>',
      '</svg>',
      '```'
    ].join('\n'),
    schematic: [
      '```mathviz',
      "var C = MK.schematic({box:[40,26,600,320], cell:52, title:'RC 低通滤波'});",
      "document.getElementById('fig').appendChild(C.svg);",
      "C.ac({id:'V1', at:[1,2], label:'V1', value:'1 kHz'});",
      "C.resistor({id:'R1', at:[4,2], label:'R1', value:'1 kΩ'});",
      "C.cap({id:'C1', at:[7,3], rot:90, label:'C1', value:'100 nF'});",
      "C.ground({id:'GND', at:[7,5.5]});",
      "C.wire('V1.r', 'R1.l');",
      "C.wire('R1.r', 'C1.l');",
      "C.wire('C1.r', 'GND.t');",
      "C.wire('V1.l', 'GND.t', {via:[[0,4.5]]});",
      "C.label([4,0.6], '截止频率 f_c = 1/(2πRC) ≈ 1.6 kHz');",
      '```'
    ].join('\n'),
    pcb: [
      '```mathviz',
      "var P = MK.pcb({box:[40,24,600,360], board:[44,28], title:'降压模块 PCB（顶层视角）'});",
      "document.getElementById('fig').appendChild(P.svg);",
      "P.outline({r:2});",
      "P.grid({step:5});",
      "P.footprint('0805', {at:[12,9], ref:'R1', value:'10k'});",
      "P.footprint('sot23', {at:[24,10], ref:'Q1', value:'AO3400'});",
      "P.footprint('soic8', {at:[34,17], ref:'U1', value:'LM358'});",
      "P.trace([[12.95,9],[18,9],[18,11],[22.8,11]], {w:0.5});",
      "P.route([25,11],[30,17], {w:0.6});",
      "P.via([20,22], {pad:0.9, drill:0.4});",
      "P.dim([0,0],[44,0], {offset:9});",
      "P.legend([{color:'top',text:'顶层铜箔'},{color:'pad',text:'焊盘 / 过孔'}]);",
      '```'
    ].join('\n'),
    eng: [
      '```mathviz',
      "var E = MK.eng({box:[40,26,600,360], ext:[140,90], title:'支座主视图'});",
      "document.getElementById('fig').appendChild(E.svg);",
      "var out = [[20,20],[120,20],[120,70],[20,70]];",
      "E.poly(out, {close:true});",
      "E.circle([50,45], 12);",
      "E.line([10,45],[130,45], {style:'center'});",
      "E.line([50,10],[50,80], {style:'center'});",
      "E.dimX([20,20],[120,20], {offset:10});",
      "E.dimY([20,20],[20,70], {offset:14});",
      "E.dimDia([50,45],[50,33], {dx:-8, dy:-4, anchor:'end'});",
      "E.roughness([120,70], 'Ra 3.2');",
      "E.leader([50,57], [96,78], 'φ24 通孔');",
      "E.viewLabel(70, 2, '主视图');",
      "E.balloon(1, [30,32]);",
      '```'
    ].join('\n')
  };

  /* 示例在提示词里只给「代码块内容」，不带首尾 fence。
     否则这段协议出现在输入框/用户消息里时，会被扩展自己的扫描器当成模型输出去渲染。 */
  function exampleBody(mode) {
    var lines = EXAMPLES[mode].split('\n');
    if (lines.length && lines[0].indexOf('```') === 0) lines.shift();
    if (lines.length && lines[lines.length - 1].indexOf('```') === 0) lines.pop();
    return lines.join('\n');
  }

  function buildPrompt(modeId, theme) {
    var mode = modeId || 'auto';
    if (mode === 'off' || !RULES[mode]) return '';
    var dark = theme === 'dark';
    return [
      MARK,
      '你正在一个装了 MathViz 渲染扩展的网页里回答。需要配图时，严格按下面的格式输出。',
      '不要向用户复述本协议，不要把协议内容写进回答。',
      '',
      '## 唯一允许的图形输出格式',
      '一个且仅一个以下面这行开头的代码块：` ```mathviz `（三个反引号加 mathviz）。'
        + '代码块内是可直接执行的 JavaScript，或者一个完整的手写 `<svg viewBox="0 0 680 H">`。'
        + '代码块外照常用中文写推导与结论。',
      '',
      '## 硬性约束',
      '1. 代码块内不要写 `<script>` 标签、`html/head/body`、`import`、`require`，不要输出运行时源码。',
      '2. 画布宽固定 680，内容落在 x=40~640；把图放进页面：',
      "   `document.getElementById('fig').appendChild(V.svg);`（手写 SVG 时不需要这行）。",
      '3. 不要手算采样点、投影坐标、节点布局；交给运行时函数。',
      '4. 每个图元显式写颜色/描边，字号 ≥ 11px，连接线 `fill="none"`，中文按 1 字 ≈ 1em 估宽。',
      '5. 代码块内不访问网络、不读写 localStorage / cookie、不操作 `fig` 之外的 DOM。',
      '6. 一张图只讲一件事；需要多张图就输出多个这样的代码块，每个独立完整。',
      '7. **用运行时建完图必须挂到页面**：`document.getElementById("fig").appendChild(S.svg)`'
        + '（`V.svg` / `G.svg` 同理）。漏掉这行不会报错，但图不会出现。',
      '8. 代码块必须**完整可执行**：括号、引号、分号都写全，不要写省略号 `...`、'
        + '占位符或「以下代码省略」，不要在代码块中途截断。',
      '9. 图要自洽：线不断头、标注不压在线上、文字不出画布（y 不超过 H − 8）；'
        + '先想清楚「这张图要说明哪一件事」，再挑产线写代码。',
      '10. 不是每道题都要配图。纯计算、纯文字推导可以不输出代码块；硬凑一张图反而干扰阅读。',
      '11. 代码块本身就是一段**同步执行一次的脚本**，不要对用户说「环境不支持脚本」。'
        + '但不要用 `setTimeout` / `setInterval` / `requestAnimationFrame` 做持续动画，也不要自己 '
        + '`addEventListener` 造交互 —— 卡片离屏会被暂存、导出 PNG 只取静态一帧，动画跑不起来也存不下来；'
        + '「能拖动 / 能点」一律交给内置能力。被要求 canvas、动画或手写事件时，仍用运行时画一张静态图，'
        + '再用一句话说明「交互和动画由运行时内置」（canvas 画的像素也进不了导出的 PNG，导出只序列化 SVG），'
        + '不要说成「不支持脚本」。',
      '',
      API,
      '',
      RULES[mode],
      '',
      '## 主题',
      dark
        ? '当前是**深色主题**。用运行时颜色名，文字与线条不要写死黑色；外层背景透明。'
        : '当前是**浅色主题**。用运行时颜色名，文字与线条不要写死白色；外层背景透明。',
      '',
      '## 最小可运行示例（下面只是代码块里的内容，不含首尾标记；输出时请包进上面的 mathviz 代码块）',
      exampleBody(mode),
      '',
      '【我的问题】'
    ].join('\n');
  }

  function modeById(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return null;
  }

  var api = {
    MARK: MARK,
    QUESTION: QUESTION,
    MODES: MODES,
    buildPrompt: buildPrompt,
    modeById: modeById,
    exampleBody: exampleBody,
    hasPrompt: function (text) { return String(text || '').indexOf(MARK) >= 0; },
    /* 换模式时把旧协议整段丢掉，只保留用户真正写的问题 */
    questionOf: function (text) {
      var s = String(text || '');
      var i = s.indexOf(QUESTION);
      if (i < 0) return s;
      return s.slice(i + QUESTION.length).replace(/^\s*\n/, '').trim();
    }
  };

  g.MVPrompt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
