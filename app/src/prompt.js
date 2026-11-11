/* MathViz for DeepSeek —— 提示词模板（纯逻辑，无 DOM 依赖，可单测） */
(function (g) {
  'use strict';

  var MARK = '【MathViz 作图模式】';
  var QUESTION = '【我的问题】';

  var MODES = [
    { id: 'off',      label: '关闭',              desc: '不插入提示词' },
    { id: 'auto',     label: '通用 · 自动选产线',  desc: '模型按题目自己选手写 SVG / 2D / 3D / 图论' },
    { id: 'plot2d',   label: '函数与 2D',          desc: '强制 MK.frame，曲线、参数方程、向量' },
    { id: 'solid3d',  label: '立体与 3D',          desc: '强制 MK.space，多面体、截面、空间向量' },
    { id: 'discrete', label: '图论与离散',          desc: '强制 MK.graph / MK.venn / MK.matrix' },
    { id: 'svg',      label: '纯 SVG · 简单图',     desc: '零运行时，只适合图元 ≤ 8 的简单示意图' }
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
    '- 颜色名：`blue coral teal amber purple red green pink gray`（用名字，不要写死黑白）。',
    '- 所有坐标参数都是**数学坐标**，不是像素；画布宽固定 680，内容落在 x=40~640。'
  ].join('\n');

  var RULES = {
    auto: [
      '## 选哪条产线',
      '图元 ≤ 8 且坐标是简单整数 → 手写 `<svg>`；有曲线、参数方程或刻度 → `MK.frame`；',
      '有第三个维度 → `MK.space`；涉及布局（图论 / 哈斯图 / 自动机 / 文氏图）→ `MK.graph` / `MK.venn`。',
      '判断口诀：有曲线走运行时，有第三个维度走运行时，有「布局」走运行时，其余手写。'
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
