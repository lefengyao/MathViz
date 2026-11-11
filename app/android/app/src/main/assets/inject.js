/* ---- platform-android.js ---- */
/* MathViz 平台适配层：Android WebView 实现。
   content.js 只认 window.MVPlatform；这里把三处扩展能力接到 Java 的 MathVizBridge。 */
(function (g) {
  'use strict';
  var B = g.MathVizBridge;
  var FALLBACK = 'https://mathviz.local/viewer.html?';

  g.MVPlatform = {
    viewerUrl: function (query) {
      return B ? B.viewerUrl(query) : FALLBACK + query;
    },
    load: function (cb) {
      if (!B) { cb({ mvMode: 'auto', mvAuto: false }); return; }
      try { cb(JSON.parse(B.load())); }
      catch (e) { cb({ mvMode: 'auto', mvAuto: false }); }
    },
    save: function (obj) {
      if (!B) return;
      try { B.save(JSON.stringify(obj)); } catch (e) {}
    }
  };
})(window);

/* ---- prompt.js ---- */
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

/* ---- detect.js ---- */
/* MathViz for DeepSeek —— 代码块识别与归一化（纯逻辑，无 DOM 依赖，可单测） */
(function (g) {
  'use strict';

  var FENCE = /```[ \t]*mathviz[^\r\n]*\r?\n([\s\S]*?)```/gi;
  var FENCE_HEAD = /```[ \t]*mathviz[^\r\n]*\r?\n/i;
  var LANG_LINE = /^\s*(?:mathviz|javascript|js|svg)\s*(?:\r?\n|$)/i;

  /* 从任意文本里抽出所有闭合的 ```mathviz 块 */
  function extractFenced(text) {
    var out = [];
    var src = String(text || '').replace(/\r\n/g, '\n');
    FENCE.lastIndex = 0;
    var m;
    while ((m = FENCE.exec(src)) !== null) {
      var code = normalize(m[1]);
      if (code) out.push({ code: code, kind: classify(code), digest: digest(code) });
    }
    return out;
  }

  /* 流式输出时代码块还没闭合：有头无尾 */
  function hasOpenFence(text) {
    var src = String(text || '');
    FENCE_HEAD.lastIndex = 0;
    var head = FENCE_HEAD.test(src);
    if (!head) return false;
    var i = src.search(FENCE_HEAD);
    var tail = src.slice(i + src.slice(i).indexOf('\n') + 1);
    return tail.indexOf('```') < 0;
  }

  /* 归一化模型输出：去包裹、去语言行、统一换行 */
  function normalize(code) {
    var s = String(code || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    s = s.replace(/^\s*<script[^>]*>\s*/i, '').replace(/\s*<\/script>\s*$/i, '');
    s = s.replace(/^\s*```[^\n]*\n/, '').replace(/\n```\s*$/, '');
    if (LANG_LINE.test(s)) s = s.replace(LANG_LINE, '');
    return s.replace(/^\n+/, '').replace(/\s+$/, '');
  }

  /* 判断一段代码是纯 SVG 片段还是需要执行的 JS */
  function classify(code) {
    var s = String(code || '').trim();
    if (!s) return 'unknown';
    if (/^<svg[\s>]/i.test(s) && /<\/svg>/i.test(s)) return 'svg';
    if (/^\s*<(?:!doctype|html|head|body)\b/i.test(s)) return 'unknown';
    return 'js';
  }

  /* 判断 <code> 元素是不是 mathviz 块。
     className / data-lang 这类字段是短的语言标记，含 mathviz 即可命中；
     header 是自由文本，必须「以 mathviz 开头」才算，否则协议正文里出现
     「输出一个 mathviz 代码块」会把普通代码块误判成图。
     最后一层兜底：模型常把围栏写成 javascript / js，但内容一看就是 MathViz
     运行时调用（MK.space(...) 或 getElementById('fig')），这种也要认，
     否则用户看到的是「什么都没发生」，比渲染失败更难查。 */
  function isMathvizCode(meta) {
    meta = meta || {};
    var lang = [meta.className, meta.parentClassName, meta.parentLang, meta.dataLang]
      .filter(Boolean).join(' ').toLowerCase();
    if (/mathviz/.test(lang)) return true;
    var header = String(meta.header || '').trim().toLowerCase();
    if (/^mathviz\b/.test(header)) return true;
    var text = String(meta.text || '');
    var first = text.split(/\r?\n/, 1)[0].trim().toLowerCase();
    if (/^```?\s*mathviz\b/.test(first)) return true;
    if (/^mathviz\s*$/.test(first)) return true;
    return /\bMK\.(?:frame|space|graph|venn|matrix)\s*\(/.test(text) ||
      /getElementById\(\s*['"]fig['"]\s*\)/.test(text);
  }

  /* FNV-1a 32 位，用于「内容变没变」的判断，不用于安全 */
  function digest(str) {
    var h = 0x811c9dc5;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /* 一个块是否值得渲染（避免把流式半截代码画出来） */
  function isRenderable(code) {
    var k = classify(code);
    if (k === 'unknown') return false;
    if (k === 'svg') return true;
    return String(code).length >= 12 && !/^\s*(?:var|let|const)?\s*$/.test(code);
  }

  /* 流式输出时代码块常被截断在半截（缺括号、字符串没闭合、末尾省略号）。
     粗略但足够挡住这类残缺：括号/引号必须平衡，且末尾要是收尾字符。
     宁可晚几秒渲染，也不要闪出一张「渲染失败」。 */
  function looksComplete(code) {
    var s = String(code || '').trim();
    if (!s) return false;
    if (classify(s) === 'svg') return /<\/svg>\s*$/i.test(s);
    var brace = 0, paren = 0, bracket = 0, quote = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), prev = i ? s.charAt(i - 1) : '';
      if (quote) {
        if (ch === quote && prev !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') brace++;
      else if (ch === '}') brace--;
      else if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '[') bracket++;
      else if (ch === ']') bracket--;
    }
    if (quote || brace > 0 || paren > 0 || bracket > 0) return false;
    return /[;}\])>]\s*$/.test(s);
  }

  var api = {
    extractFenced: extractFenced,
    hasOpenFence: hasOpenFence,
    normalize: normalize,
    classify: classify,
    isMathvizCode: isMathvizCode,
    isRenderable: isRenderable,
    looksComplete: looksComplete,
    digest: digest
  };

  g.MVDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* ---- ui-css.js ---- */
window.MVCss = "/* MathViz 扩展：工具条与渲染卡片共用样式，全部挂在 Shadow DOM 内 */\n:host {\n  --mv-bg: #ffffff;\n  --mv-fg: #1a1a19;\n  --mv-sub: #6b6a66;\n  --mv-line: #e3e1da;\n  --mv-soft: #f4f3ee;\n  --mv-accent: #4d6bfe;\n  --mv-ok: #0f6e56;\n  --mv-err: #a32d2d;\n  font-family: system-ui, -apple-system, \"Segoe UI\", \"Microsoft YaHei\", sans-serif;\n  font-size: 13px;\n  line-height: 1.5;\n}\n:host([data-theme=\"dark\"]) {\n  --mv-bg: #22221f;\n  --mv-fg: #f1efe8;\n  --mv-sub: #a8a69f;\n  --mv-line: #3a3a36;\n  --mv-soft: #2c2c29;\n  --mv-accent: #85b7eb;\n  --mv-ok: #5dcaa5;\n  --mv-err: #f09595;\n}\n* { box-sizing: border-box; }\n[hidden] { display: none !important; }\nbutton, select, input { font: inherit; }\n\n.mv-bar { display: flex; align-items: center; gap: 8px; }\n.mv-toggle {\n  display: inline-flex; align-items: center; gap: 7px;\n  padding: 7px 13px; border: 1px solid var(--mv-line); border-radius: 999px;\n  background: var(--mv-bg); color: var(--mv-fg); cursor: pointer;\n  box-shadow: 0 2px 10px rgba(0, 0, 0, .12); font-size: 13px;\n}\n.mv-toggle:hover { border-color: var(--mv-accent); }\n.mv-toggle > span { font-weight: 500; }\n.mv-count {\n  padding: 4px 9px; border-radius: 999px; font-size: 11px;\n  background: var(--mv-soft); color: var(--mv-sub);\n}\n.mv-panel {\n  position: absolute; left: 0; bottom: 46px; width: 296px; padding: 14px;\n  border: 1px solid var(--mv-line); border-radius: 12px;\n  background: var(--mv-bg); color: var(--mv-fg);\n  box-shadow: 0 8px 28px rgba(0, 0, 0, .18);\n}\n.mv-row { display: flex; align-items: center; gap: 8px; }\n.mv-row label { font-size: 12px; color: var(--mv-sub); white-space: nowrap; }\n.mv-row select {\n  flex: 1; min-width: 0; padding: 6px 8px; border-radius: 8px;\n  border: 1px solid var(--mv-line); background: var(--mv-soft); color: var(--mv-fg);\n  font-size: 12px;\n}\n.mv-desc { margin: 9px 0 12px; font-size: 11px; color: var(--mv-sub); line-height: 1.6; }\n.mv-btns { display: flex; gap: 8px; }\n.mv-btns button, .mv-head button {\n  padding: 6px 11px; border: 1px solid var(--mv-line); border-radius: 8px;\n  background: var(--mv-soft); color: var(--mv-fg); cursor: pointer; font-size: 12px;\n}\n.mv-btns button:hover, .mv-head button:hover { border-color: var(--mv-accent); }\n.mv-btns .mv-primary { background: var(--mv-accent); border-color: var(--mv-accent); color: #fff; }\n.mv-check { display: flex; align-items: center; gap: 7px; margin-top: 12px; font-size: 11px; color: var(--mv-sub); }\n.mv-tip { margin-top: 10px; font-size: 11px; line-height: 1.6; color: var(--mv-sub); }\n.mv-toast {\n  position: absolute; left: 0; bottom: 46px; max-width: 296px; padding: 9px 12px;\n  border-radius: 8px; background: var(--mv-fg); color: var(--mv-bg); font-size: 12px;\n  box-shadow: 0 4px 16px rgba(0, 0, 0, .2);\n}\n\n.mv-card {\n  max-width: 720px; overflow: hidden; border: 0;\n  border-radius: 8px; background: transparent; color: var(--mv-fg);\n}\n.mv-head {\n  display: flex; align-items: center; gap: 6px; padding: 7px 2px 6px;\n  font-size: 12px;\n}\n.mv-badge {\n  padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 500;\n  background: var(--mv-soft); color: var(--mv-accent);\n}\n.mv-state { font-size: 11px; color: var(--mv-sub); }\n.mv-state.mv-ok { color: var(--mv-ok); }\n.mv-state.mv-err { color: var(--mv-err); }\n.mv-gap { flex: 1; }\n.mv-head button { padding: 4px 9px; }\n.mv-body { padding: 8px; }\n.mv-body iframe { display: block; width: 100%; min-height: 80px; border: 0; background: transparent; }\n.mv-src {\n  margin: 0; padding: 12px; max-height: 320px; overflow: auto;\n  border-top: 1px solid var(--mv-line); background: var(--mv-soft);\n  color: var(--mv-fg); font: 12px/1.6 ui-monospace, Menlo, Consolas, monospace;\n  white-space: pre-wrap; word-break: break-all;\n}\n\n.mv-sess { margin: 0 0 10px; font-size: 11px; line-height: 1.5; color: var(--mv-sub); }\n.mv-sess.mv-sess-on { color: var(--mv-ok); }\n\n/* 就地渲染：宿主直接挂在原来的 <pre> 里，不再套一层独立卡片 */\n:host([data-inline]) .mv-card { border: 0; border-radius: 0; background: transparent; }\n:host([data-inline]) .mv-head { border-bottom: 0; padding: 2px 2px 6px; }\n:host([data-inline]) .mv-badge { display: none; }\n:host([data-inline]) .mv-body { padding: 0; }\n\n/* 手机窄屏：工具条移到右上角（左下角会盖住输入框的按钮），面板向下展开 */\n@media (max-width: 480px) {\n  :host(.mv-toolbar-host) {\n    top: 10px !important; right: 12px !important;\n    left: auto !important; bottom: auto !important;\n  }\n  .mv-panel {\n    width: calc(100vw - 24px); max-width: 320px;\n    top: 46px; bottom: auto; right: 0; left: auto;\n  }\n  .mv-toast {\n    max-width: calc(100vw - 24px);\n    top: 46px; bottom: auto; right: 0; left: auto;\n  }\n  .mv-toggle { padding: 10px 16px; }\n  .mv-btns button, .mv-head button, .mv-row select { min-height: 38px; padding: 8px 12px; }\n  .mv-check input { width: 18px; height: 18px; }\n  .mv-card { max-width: 100%; }\n}\n";

/* ---- content.js ---- */
/* MathViz for DeepSeek —— content script
   只做三件事：① 往输入框插入/附加 skill 提示词 ② 认出回复里的 ```mathviz 块
   ③ 把代码交给沙箱页渲染，并把图插回消息里。
   不碰登录态、不发网络请求、不调用 DeepSeek 私有接口。 */
(function () {
  'use strict';

  if (window.__mvLoaded) return;
  window.__mvLoaded = true;

  var P = window.MVPrompt;
  var D = window.MVDetect;
  var Platform = window.MVPlatform;
  var CSS = window.MVCss || '';
  if (!P || !D || !Platform) return;

  var CFG = { mode: 'auto', auto: false };
  var cards = new Map();          // id -> card record
  var mounted = new WeakMap();    // anchor element -> { digest, id }
  var pending = new WeakMap();    // 还没写完的代码块 -> { code, since }
  var seq = 0;
  var theme = 'light';
  var scanTimer = null;
  var toastTimer = null;
  var ui = null;
  var injected = false;           // 本轮对话是否已经给过提示词（同一会话只给一次）
  var injectedMode = null;        // 当时用的模式；换模式才允许更新一次
  var scanning = false;           // 扫描期间抑制自己触发的 MutationObserver 回调

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function themeNow() {
    var s = '';
    try { s = getComputedStyle(document.body).backgroundColor; } catch (e) {}
    if (!s || s === 'rgba(0, 0, 0, 0)' || s === 'transparent') {
      try { s = getComputedStyle(document.documentElement).backgroundColor; } catch (e) {}
    }
    var m = String(s).match(/[\d.]+/g);
    if (m && m.length >= 3) {
      return (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114) < 128 ? 'dark' : 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function visible(n) {
    var r = n.getBoundingClientRect();
    if (r.width < 30 || r.height < 12) return false;
    var s = getComputedStyle(n);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  function composer() {
    var ta = [].slice.call(document.querySelectorAll('textarea')).filter(visible);
    if (ta.length) {
      ta.sort(function (a, b) { return (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight); });
      return ta[0];
    }
    return [].slice.call(document.querySelectorAll('[contenteditable="true"]')).filter(visible)[0] || null;
  }

  function readComposer(n) {
    return (n.tagName === 'TEXTAREA' || n.tagName === 'INPUT') ? (n.value || '') : (n.innerText || n.textContent || '');
  }

  /* React 受控输入框必须用原型上的原生 setter，否则 onChange 收不到 */
  function writeComposer(n, text) {
    if (n.tagName === 'TEXTAREA' || n.tagName === 'INPUT') {
      var proto = n.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, text);
      n.dispatchEvent(new Event('input', { bubbles: true }));
      try { n.setSelectionRange(text.length, text.length); } catch (e) {}
      return true;
    }
    if (n.isContentEditable) {
      n.focus();
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(n);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) {}
      if (!ok) {
        n.insertBefore(document.createTextNode(text), n.firstChild);
        n.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }
    return false;
  }

  function composedText(n) {
    var cur = readComposer(n);
    var q = P.hasPrompt(cur) ? P.questionOf(cur) : cur.trim();
    return P.buildPrompt(CFG.mode, theme) + '\n' + q;
  }

  /* 一次对话只需要给一次协议：模型在上下文里已经知道了，后面直接问就行。
     重复写入受控输入框正是「输入框一直闪烁」的来源，所以已注入时绝不改写 DOM。 */
  function insertPrompt() {
    if (CFG.mode === 'off') { toast('先在面板里选一个模式'); return; }
    var n = composer();
    if (!n) { toast('没找到输入框，先点一下 DeepSeek 的输入区'); return; }
    if (P.hasPrompt(readComposer(n))) {
      /* 只有「换了作图模式」才允许改写一次；其余情况绝不重复写，
         重复写受控输入框正是页面一直闪烁的来源。 */
      if (injectedMode && CFG.mode !== injectedMode) {
        writeComposer(n, composedText(n));
        injectedMode = CFG.mode;
        injected = true;
        syncSess();
        toast('已按新模式更新提示词');
        return;
      }
      injected = true;
      syncSess();
      toast('本轮对话已给过提示词，后面直接问就行');
      return;
    }
    if (injected) { toast('若开了新对话，点「新对话」再重新给一次'); return; }
    writeComposer(n, composedText(n));
    injected = true;
    injectedMode = CFG.mode;
    syncSess();
    toast('提示词已插入，发送一次即可，后续不用再给');
  }

  /* 自动附加同样只在「本轮还没给过」时补一次 */
  function ensurePrefix() {
    if (CFG.mode === 'off' || !CFG.auto || injected) return;
    var n = composer();
    if (!n || P.hasPrompt(readComposer(n))) return;
    writeComposer(n, composedText(n));
    injected = true;
    injectedMode = CFG.mode;
    syncSess();
  }

  function syncSess() {
    if (!ui) return;
    ui.sess.textContent = injected ? '本轮对话：已注入一次（后面直接问）' : '本轮对话：还没给提示词';
    ui.sess.className = 'mv-sess' + (injected ? ' mv-sess-on' : '');
  }

  /* ---------------------------------------------------------------- */
  /* 沙箱卡片                                                          */
  /* ---------------------------------------------------------------- */

  function cardMarkup() {
    return '<div class="mv-card" data-mv-ui="1">' +
      '<div class="mv-head">' +
        '<span class="mv-badge">MathViz</span>' +
        '<span class="mv-state" data-a="state">等待渲染…</span>' +
        '<span class="mv-gap"></span>' +
        '<button type="button" data-a="source">源码</button>' +
        '<button type="button" data-a="copy">复制</button>' +
        '<button type="button" data-a="reload">重渲染</button>' +
        '<button type="button" data-a="fold">折叠</button>' +
      '</div>' +
      '<div class="mv-body"><iframe title="MathViz 图形" sandbox="allow-scripts"></iframe></div>' +
      '<pre class="mv-src" hidden></pre>' +
    '</div>';
  }

  function makeCard(anchor, code, kind, digest) {
    var id = 'mv' + (++seq) + '-' + digest;
    var host = el('div', 'mv-card-host');
    var inline = anchor.tagName === 'PRE';
    host.style.cssText = inline ? 'display:block;margin:0;' : 'display:block;margin:12px 0;';
    host.setAttribute('data-mv-ui', '1');
    host.setAttribute('data-theme', theme);
    if (inline) host.setAttribute('data-inline', '1');
    var sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>' + CSS + '</style>' + cardMarkup();

    var rec = {
      id: id, host: host, sr: sr, anchor: anchor, code: code, kind: kind,
      inline: inline,
      digest: digest, sent: false, sentCode: '', src: sr.querySelector('.mv-src'),
      iframe: sr.querySelector('iframe'), state: sr.querySelector('[data-a="state"]'),
      body: sr.querySelector('.mv-body')
    };
    rec.src.textContent = code;
    rec.iframe.addEventListener('load', function () { renderInto(rec); });

    sr.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-a]') : null;
      if (!btn) return;
      var a = btn.getAttribute('data-a');
      if (a === 'source') {
        var show = rec.src.hasAttribute('hidden');
        if (show) rec.src.removeAttribute('hidden'); else rec.src.setAttribute('hidden', '');
        btn.textContent = show ? '收起源码' : '源码';
      } else if (a === 'copy') {
        copyText(rec.code, btn);
      } else if (a === 'reload') {
        /* 重渲染要读页面上的最新代码，不能用建卡时缓存的快照 */
        var fresh = readCodeFromAnchor(rec.anchor);
        if (fresh) {
          rec.code = fresh;
          rec.kind = D.classify(fresh);
          rec.digest = D.digest(fresh);
          rec.src.textContent = fresh;
          var m = mounted.get(rec.anchor);
          if (m) mounted.set(rec.anchor, { digest: rec.digest, id: m.id });
        }
        rec.sent = false;
        openViewer(rec);
      } else if (a === 'fold') {
        var folded = rec.body.hasAttribute('hidden');
        if (folded) rec.body.removeAttribute('hidden'); else rec.body.setAttribute('hidden', '');
        btn.textContent = folded ? '折叠' : '展开';
      }
    });

    cards.set(id, rec);
    openViewer(rec);
    return rec;
  }

  function openViewer(rec) {
    rec.host.setAttribute('data-theme', theme);
    rec.state.textContent = '等待渲染…';
    rec.state.className = 'mv-state';
    rec.sent = false;
    rec.sentCode = '';
    var url = Platform.viewerUrl('theme=' + theme + '&id=' + encodeURIComponent(rec.id));
    rec.iframe.setAttribute('src', url);
  }

  function renderInto(rec) {
    if (rec.sent && rec.sentCode === rec.code) return;
    rec.sent = true;
    rec.sentCode = rec.code;
    rec.state.textContent = '渲染中…';
    try {
      rec.iframe.contentWindow.postMessage({
        __mv: true, type: 'mv:render', id: rec.id, code: rec.code, kind: rec.kind
      }, '*');
    } catch (e) {
      rec.state.textContent = '沙箱通信失败';
    }
  }

  function copyText(text, btn) {
    var done = function (ok) {
      var old = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { btn.textContent = old; }, 1400);
    };
    try {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } catch (e) { done(false); }
  }

  /* ---------------------------------------------------------------- */
  /* 扫描页面里的 mathviz 代码块                                       */
  /* ---------------------------------------------------------------- */

  function skip(n) {
    if (!n || n === document.body || n === document.documentElement) return true;
    if (n.closest && n.closest('[data-mv-ui]')) return true;
    /* 输入框（尤其 contenteditable）里的提示词全文不是模型输出，绝不能拿来渲染 */
    if (n.closest && n.closest('[contenteditable]')) return true;
    var t = n.tagName;
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'INPUT' || t === 'NOSCRIPT') return true;
    var s = n.textContent || '';
    return s.length > 0 && s.indexOf(P.MARK) >= 0;
  }

  /* 用户消息气泡里若出现 language-mathviz 的示例 pre，也不算模型输出。
     只看直接父元素，不看更高层，避免把整页消息容器一起排除掉。 */
  function inUserBubble(pre) {
    var p = pre.parentElement;
    if (!p || p === document.body) return false;
    var s = p.textContent || '';
    return s.length < 12000 && s.indexOf(P.MARK) >= 0;
  }

  function depth(n) {
    var d = 0;
    while (n && n !== document.body) { d++; n = n.parentElement; }
    return d;
  }

  function collect() {
    var found = new Map();   // digest -> candidate（取最内层锚点）

    function add(code, anchor, kind) {
      code = D.normalize(code);
      if (!D.isRenderable(code)) return;
      var dg = D.digest(code);
      var prev = found.get(dg);
      if (prev && prev.depth >= depth(anchor)) return;
      found.set(dg, { code: code, kind: kind, digest: dg, anchor: anchor, depth: depth(anchor) });
    }

    /* ① 已经被 markdown 渲染成 <pre><code> 的块 */
    var pres = document.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (skip(pre) || inUserBubble(pre)) continue;
      var code = pre.querySelector('code') || pre;
      var text = code.textContent || '';
      var meta = {
        text: text,
        className: typeof code.className === 'string' ? code.className : '',
        parentClassName: typeof pre.className === 'string' ? pre.className : '',
        parentLang: pre.getAttribute('data-language') || pre.getAttribute('lang') || '',
        dataLang: code.getAttribute('data-language') || '',
        header: (pre.parentElement ? pre.parentElement.textContent : '').slice(0, 80)
      };
      if (D.isMathvizCode(meta)) {
        var body = D.normalize(text);
        var m = body.match(/^```[ \t]*mathviz[^\n]*\n/);
        if (m) {
          var fenced = D.extractFenced(body);
          for (var k = 0; k < fenced.length; k++) add(fenced[k].code, pre, fenced[k].kind);
        } else {
          add(body, pre, D.classify(body));
        }
      }
    }

    /* ② 流式输出时还没被渲染成 pre 的裸 ```mathviz 文本 */
    var all = document.querySelectorAll('div,p,section,article,li,span,td,blockquote');
    for (var j = 0; j < all.length; j++) {
      var n = all[j];
      if (skip(n)) continue;
      var txt = n.textContent || '';
      if (txt.length > 30000 || txt.indexOf('```mathviz') < 0) continue;
      var blocks = D.extractFenced(txt);
      for (var b = 0; b < blocks.length; b++) add(blocks[b].code, n, blocks[b].kind);
    }

    return found;
  }

  function setStyle(n, prop, val) {
    try { if (n.style.getPropertyValue(prop) !== val) n.style.setProperty(prop, val); } catch (e) {}
  }

  /* 把渲染宿主塞进原来的 <pre> 里 —— 代码块原地变成图，不再另起一张卡片。
     原代码文本保留但不显示，React 流式重渲染后 scan 会再收一次。 */
  function hideCodeInside(pre, host) {
    [].slice.call(pre.childNodes).forEach(function (n) {
      if (n === host) return;
      if (n.nodeType === 1) setStyle(n, 'display', 'none');
      else if (n.nodeType === 3 && n.textContent.trim()) {
        var span = document.createElement('span');
        span.setAttribute('data-mv-hidden', '1');
        span.style.display = 'none';
        span.textContent = n.textContent;
        try { pre.replaceChild(span, n); } catch (e) {}
      }
    });
    setStyle(pre, 'padding', '0px');
    setStyle(pre, 'background', 'transparent');
    setStyle(pre, 'overflow', 'visible');
    setStyle(pre, 'max-height', 'none');
    setStyle(pre, 'white-space', 'normal');
  }

  /* 流式中间态：整段几乎只有 ```mathviz 的元素，把原文收起来 */
  function foldFenceText(n) {
    if (!n || n.tagName === 'PRE' || n.style.display === 'none') return;
    var txt = n.textContent || '';
    var rest = txt.replace(/```[ \t]*mathviz[\s\S]*?```/g, '').trim();
    if (rest.length <= 40) n.style.setProperty('display', 'none');
  }

  function readCodeFromAnchor(a) {
    if (!a) return '';
    if (a.tagName === 'PRE') {
      var code = a.querySelector('code') || a;
      return D.normalize(code.textContent || '');
    }
    var blocks = D.extractFenced(a.textContent || '');
    return blocks.length ? blocks[0].code : '';
  }

  /* pre → 在代码块内部渲染；裸 fence → 紧邻兄弟节点 */
  function mountInto(rec) {
    var a = rec.anchor;
    if (!a || !a.parentNode) return;
    if (rec.inline) {
      if (rec.host.parentElement !== a) a.appendChild(rec.host);
      hideCodeInside(a, rec.host);
    } else {
      if (rec.host.parentElement !== a.parentNode) a.parentNode.insertBefore(rec.host, a.nextSibling);
      foldFenceText(a);
    }
  }

  function prune() {
    cards.forEach(function (rec, id) {
      if (!rec.host.isConnected || !rec.anchor || !rec.anchor.isConnected) {
        try { rec.host.remove(); } catch (e) {}
        cards.delete(id);
      }
    });
  }

  /* scan 期间我们自己在改 DOM（插 iframe、隐藏 code、改 pre 样式），
     这些变更会喂回 MutationObserver 造成自激循环 —— 输入框看起来就是「一直闪烁」。 */
  function scan() {
    if (scanning) return;
    scanning = true;
    try { scanBody(); } finally {
      setTimeout(function () { scanning = false; }, 0);
    }
  }

  function scanBody() {
    var t = themeNow();
    if (t !== theme) {
      theme = t;
      if (ui) ui.host.setAttribute('data-theme', theme);
      cards.forEach(function (rec) { openViewer(rec); });
    }
    prune();

    var found = collect();
    var incomplete = 0;
    found.forEach(function (c) {
      /* 模型输出被截断 / 写了省略号时，代码块是半截的。不要闪出「渲染失败」：
         保留原代码块，等它写完整再自动渲染；计数里如实告知有几段没写完。 */
      if (!D.looksComplete(c.code)) {
        pending.set(c.anchor, { code: c.code, since: Date.now() });
        incomplete++;
        return;
      }
      pending.delete(c.anchor);
      var prev = mounted.get(c.anchor);
      if (prev && prev.digest === c.digest && cards.has(prev.id)) {
        mountInto(cards.get(prev.id));
        return;
      }
      if (prev && cards.has(prev.id)) {
        try { cards.get(prev.id).host.remove(); } catch (e) {}
        cards.delete(prev.id);
      }
      var rec = makeCard(c.anchor, c.code, c.kind, c.digest);
      mountInto(rec);
      mounted.set(c.anchor, { digest: c.digest, id: rec.id });
    });

    if (ui) ui.count.textContent = cards.size + ' 张图'
      + (incomplete ? ' · ' + incomplete + ' 段未写完' : '');
  }

  function schedule() {
    if (scanning) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 280);
  }

  /* ---------------------------------------------------------------- */
  /* 工具条                                                            */
  /* ---------------------------------------------------------------- */

  function buildUI() {
    var host = el('div', 'mv-toolbar-host');
    host.id = 'mv-ext-root';
    host.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:2147483000;';
    host.setAttribute('data-mv-ui', '1');
    host.setAttribute('data-theme', theme);
    var sr = host.attachShadow({ mode: 'open' });

    var opts = P.MODES.map(function (m) {
      return '<option value="' + m.id + '">' + m.label + '</option>';
    }).join('');

    sr.innerHTML = '<style>' + CSS + '</style>' +
      '<div class="mv-bar">' +
        '<button type="button" class="mv-toggle" data-a="toggle">∑ <span>MathViz</span></button>' +
        '<span class="mv-count" data-a="count">0 张图</span>' +
      '</div>' +
      '<div class="mv-panel" hidden>' +
        '<div class="mv-row"><label for="mv-mode">作图模式</label><select id="mv-mode" data-a="mode">' + opts + '</select></div>' +
        '<div class="mv-desc" data-a="desc"></div>' +
        '<div class="mv-sess" data-a="sess">本轮对话：还没给提示词</div>' +
        '<div class="mv-btns">' +
          '<button type="button" class="mv-primary" data-a="insert">插入提示词</button>' +
          '<button type="button" data-a="reset">新对话</button>' +
          '<button type="button" data-a="rescan">重新扫描</button>' +
        '</div>' +
        '<label class="mv-check"><input type="checkbox" data-a="auto"> 新对话的首次发送自动附加（实验性）</label>' +
        '<div class="mv-tip">一整轮对话只需给一次提示词；之后模型会一直按协议输出代码块，'
          + '图直接显示在那个代码块里。Alt+M 开面板</div>' +
      '</div>' +
      '<div class="mv-toast" hidden></div>';

    document.body.appendChild(host);

    var q = function (a) { return sr.querySelector('[data-a="' + a + '"]'); };
    var modeSel = q('mode');
    var autoBox = q('auto');
    var desc = q('desc');
    var panel = sr.querySelector('.mv-panel');
    var toastEl = sr.querySelector('.mv-toast');

    function syncForm() {
      modeSel.value = CFG.mode;
      autoBox.checked = !!CFG.auto;
      var m = P.modeById(CFG.mode);
      desc.textContent = m ? m.desc : '';
    }

    function toggle(force) {
      var show = force === undefined ? panel.hasAttribute('hidden') : force;
      if (show) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    }

    sr.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-a]') : null;
      if (!btn) return;
      var a = btn.getAttribute('data-a');
      if (a === 'toggle') { toggle(); return; }
      if (a === 'insert') { insertPrompt(); toggle(false); return; }
      if (a === 'reset') {
        injected = false;
        injectedMode = null;
        syncSess();
        toast('已重置：下一次发送会重新给一次提示词');
        return;
      }
      if (a === 'rescan') { scan(); toast('已重新扫描'); return; }
    });
    modeSel.addEventListener('change', function () {
      CFG.mode = modeSel.value;
      syncForm();
      save();
      toast(CFG.mode === 'off' ? '已关闭提示词' : '模式：' + P.modeById(CFG.mode).label);
    });
    autoBox.addEventListener('change', function () {
      CFG.auto = autoBox.checked;
      save();
      toast(CFG.auto ? '自动附加已开（建议先手动试一次）' : '自动附加已关');
    });

    document.addEventListener('keydown', function (e) {
      if (e.altKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); toggle(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && CFG.auto) ensurePrefix();
    }, true);
    document.addEventListener('click', function (e) {
      if (!CFG.auto) return;
      var t = e.target;
      var btn = t && t.closest ? t.closest('button,[role="button"]') : null;
      if (!btn) return;
      var hint = [btn.getAttribute('aria-label'), btn.title, String(btn.className || ''), btn.textContent]
        .filter(Boolean).join(' ');
      if (/send|submit|发送|提交/i.test(hint) ||
          /ds-button--iconLabelPrimary/.test(String(btn.className || ''))) ensurePrefix();
    }, true);

    ui = { host: host, sr: sr, count: q('count'), toast: toastEl, sess: q('sess'), sync: syncForm };
    syncForm();
    syncSess();
  }

  function toast(msg) {
    if (!ui) return;
    ui.toast.textContent = msg;
    ui.toast.removeAttribute('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.setAttribute('hidden', ''); }, 2600);
  }

  /* 沙箱页回传 */
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__mv !== true || typeof d.type !== 'string') return;
    var rec = cards.get(d.id);
    if (!rec) return;
    if (e.source !== rec.iframe.contentWindow) return;
    if (d.type === 'mv:ready' || d.type === 'mv:pong') { renderInto(rec); return; }
    if (d.type === 'mv:done') {
      rec.state.textContent = '已渲染 ' + (d.figures || 1) + ' 张';
      rec.state.className = 'mv-state mv-ok';
      rec.iframe.style.height = Math.max(80, Number(d.height) || 320) + 'px';
      return;
    }
    if (d.type === 'mv:error') {
      rec.state.textContent = '渲染失败';
      rec.state.className = 'mv-state mv-err';
      rec.iframe.style.height = '0px';
      rec.src.removeAttribute('hidden');
      rec.src.textContent = String(d.message || '') + '\n\n---- 原始代码 ----\n' + rec.code;
    }
  });

  function save() {
    Platform.save({ mvMode: CFG.mode, mvAuto: CFG.auto });
  }

  function boot() {
    theme = themeNow();
    var done = function () {
      buildUI();
      scan();
      setTimeout(scan, 900);
      new MutationObserver(schedule).observe(document.body, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['style', 'class']
      });
      /* 主题切换 / SPA 换路由这类只改属性或干脆不触发 MO 的变化，靠低频兜底 */
      setInterval(function () { if (!document.hidden) scan(); }, 3000);
    };
    try {
      Platform.load(function (o) {
        CFG.mode = (o && o.mvMode) || 'auto';
        CFG.auto = !!(o && o.mvAuto);
        done();
      });
    } catch (e) { done(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
