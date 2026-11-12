/* 模型回复合规检查：把模型针对作图题的原始回复（含 ```mathviz 围栏）丢进来，
   逐块判定「有没有按协议用运行时」，可选 --render 在真实 Chromium 里跑一遍。

   用法：
     node test/compliance.mjs reply.txt              # 静态检查
     node test/compliance.mjs reply.txt --render     # 再真跑一遍渲染
     node test/compliance.mjs a.txt b.txt --json     # 多文件 / 机器可读
     cat reply.txt | node test/compliance.mjs -      # 从 stdin 读
     node test/compliance.mjs --selftest             # 用测试集 + 反例自检规则本身

   退出码：0 全部合规或有告警；1 存在违规（fail）。

   判定分三级：
     ❌ 违规 —— 协议明令禁止，或必然在运行时抛错（自造交互、跨模块调 API、截断）
     ⚠️ 告警 —— 能跑但走了弯路（手算采样、写死颜色、画布宽度不合协议）
     ✅ 合规 —— 只调运行时 API，坐标交给运行时

   规则编号写在每条结果里，反馈问题时带上编号更快定位。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ---------- 代码块提取 ---------- */

/* 模型可能写 ```mathviz / ```js / ```javascript，也可能裸 ```。
   围栏语言写错不影响判定——内容像 MK 代码就当 js 处理。 */
export function parseBlocks(text) {
  const out = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m, i = 0;
  while ((m = re.exec(text))) {
    const lang = (m[1] || '').trim().toLowerCase();
    const code = m[2].replace(/\s+$/, '');
    if (!code.trim()) continue;
    out.push({ index: ++i, lang, code });
  }
  return out;
}

/* ---------- 产线识别 ---------- */

export function detectModule(code) {
  if (/\bMK\.schematic\b/.test(code)) return 'schematic';
  if (/\bMK\.pcb\b/.test(code)) return 'pcb';
  if (/\bMK\.eng\b/.test(code)) return 'edraw';
  if (/\bMK\.space\b/.test(code) || /\bS\.(?:solid|face|sphere|box|prism|pyramid|plane|cylinder|polyline|scene)\b/.test(code)) return '3d';
  if (/\bMK\.(?:graph|matrix|venn)\b/.test(code)) return 'graph';
  if (/\bMK\.frame\b/.test(code)) return '2d';
  return 'none';
}

/* ---------- 规则 ---------- */

const RULES = {
  R1: '没有 ```mathviz 围栏：扩展认不出，图不会渲染',
  R2: '协议明令禁止的注入：<script> / import / require',
  R3: '代码不完整：省略号、占位说明或括号不配对（扩展会一直扣住不渲染）',
  R4: '自造交互：拖拽/缩放/拾取已内置，自己实现会与运行时抢事件',
  R5: '手搓 SVG：可用图元应走运行时，自己拼 DOM 会丢主题与避让',
  R6: '自己维护视角（yaw/pitch/rotate）：拖拽重放会与你的变量打架',
  R7: '跨模块调 API：这个模块里没有这个函数，运行时会 TypeError',
  R8: '图没挂到 #fig：渲染容器拿不到 svg',
  R9: '画布宽度偏离协议（680），或 2D 未给 box 用默认尺寸',
  R10: 'edges 写成对象：协议要求数组',
  R11: '手写 path/polyline：采样点自己算的，断点与渐近线会出错',
  R12: '写死颜色：深色/浅色主题切换后会看不清',
  R13: '2D 块里没有 title（不影响渲染，读者少了一层信息）',
  R14: '电路图里用绝对坐标连线：应写端口名，否则元件一挪线就断',
  R15: '电路图里没有 C.wire：只摆了符号，图不成立',
  R16: '工程图里用 E.text 手写尺寸数字：尺寸线、箭头、数值应由 dim 系列生成',
  R17: 'PCB 没有走线：只有封装和板框，看不出连接关系'
};

function at(code, idx) {
  return code.slice(0, idx).split('\n').length;
}

function report(code, id, level, msg, idx) {
  return { id, level, msg, line: idx === undefined ? null : at(code, idx) };
}

/* 括号配对（忽略字符串与注释里的括号，够用即可） */
function balanced(code) {
  let s = 0, p = 0, b = 0, i = 0;
  const st = [];   // 栈：记录最近进入的字符串/注释状态
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    const top = st[st.length - 1];
    if (top === 'line') { if (c === '\n') st.pop(); i++; continue; }
    if (top === 'block') { if (c === '*' && n === '/') { st.pop(); i += 2; continue; } i++; continue; }
    if (top) {  // 字符串内
      if (c === '\\') { i += 2; continue; }
      if (c === top) st.pop();
      i++; continue;
    }
    if (c === '/' && n === '/') { st.push('line'); i += 2; continue; }
    if (c === '/' && n === '*') { st.push('block'); i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { st.push(c); i++; continue; }
    if (c === '{') s++; else if (c === '}') s--;
    if (c === '(') p++; else if (c === ')') p--;
    if (c === '[') b++; else if (c === ']') b--;
    i++;
  }
  return s === 0 && p === 0 && b === 0;
}

const MODULE_API = {
  '2d': ['frame', 'plot', 'curve', 'param', 'polar', 'seg', 'arrow', 'dot', 'label', 'tag',
    'poly', 'circle', 'arc', 'angle', 'rightAngle', 'mark', 'area', 'rect', 'legend',
    'sample', 'grid', 'axes'],
  '3d': ['space', 'redraw', 'p', 'd', 'scale', 'yaw', 'pitch', 'clear', 'line', 'arrow',
    'axes', 'point', 'label', 'face', 'polyline', 'solid', 'box', 'prism', 'pyramid',
    'plane', 'sphere', 'cylinder', 'angle', 'drag', 'onPick', 'reset'],
  graph: ['graph', 'matrix', 'venn', 'layout', 'layoutCircle', 'layoutGrid', 'layoutTree',
    'layoutLayered', 'layoutForce', 'radius', 'clear', 'invalidate', 'draw', 'onPick',
    'pick', 'path', 'mark']
};

export function lintBlock(block) {
  const code = block.code;
  const findings = [];
  const isSvg = /^\s*<svg[\s>]/i.test(code) || (/<svg[\s>]/i.test(code) && !/\bMK\./.test(code));
  const mod = isSvg ? 'svg' : detectModule(code);

  if (isSvg) {
    /* 手写 SVG 是合法产线（图元少、无坐标计算），只做完整性检查 */
    if (!/<\/svg>\s*$/i.test(code)) {
      findings.push(report(code, 'R3', 'fail', 'SVG 没有闭合 </svg>，扩展会当成没写完', code.length - 1));
    }
  }

  if (!isSvg) {
    /* R2 注入 */
    let m;
    if ((m = /<script[\s>]/i.exec(code))) findings.push(report(code, 'R2', 'fail', '出现 <script> 标签', m.index));
    if ((m = /(^|[\s;{])(?:import\s+[\w{*]|require\s*\()/m.exec(code))) findings.push(report(code, 'R2', 'fail', '出现 import / require', m.index));

    /* R3 截断 */
    const tail = code.trimEnd().split('\n').pop() || '';
    /* 模型的典型截断写法：末尾一行省略号，或注释里写「…省略」 */
    const trunc = /(\.\.\.|…)\s*$/.test(tail)
      || /(?:以下省略|其余同上|省略若干|同理略|其余部分)/.test(code)
      || /(?:\/\/|\/\*|^\s*\*)[^\n]*(?:\.\.\.|…|省略|略去)/m.test(code);
    if (trunc) {
      findings.push(report(code, 'R3', 'fail', '代码含省略号/省略说明，不是完整代码（扩展会扣住不渲染）', code.lastIndexOf(tail)));
    } else if (!balanced(code)) {
      findings.push(report(code, 'R3', 'fail', '括号或引号没闭合，代码不完整', code.length - 1));
    }

    /* R4 自造交互 —— 交接单里的重点 */
    const interact = [
      [/addEventListener\s*\(\s*['"`](?:pointer|mouse|touch|wheel|key)/, '自己加了 pointer/mouse/touch 监听'],
      [/requestAnimationFrame\s*\(/, '自己跑了重绘循环（requestAnimationFrame）'],
      [/\bS\.drag\s*\(/, '调了 S.drag(，拖拽已内置，这是旧写法'],
      [/\bon(?:pointer|mouse|touch|wheel)(?:down|move|up|start|end|over|out)?\s*=/, '挂了 onXXX 内联事件'],
      [/setPointerCapture\s*\(/, '自己抢指针捕获（setPointerCapture）'],
      [/\.style\.cursor\s*=/, '自己改光标，说明在手写交互']
    ];
    for (const [re, why] of interact) {
      const mm = re.exec(code);
      if (mm) findings.push(report(code, 'R4', 'fail', why, mm.index));
    }

    /* R6 自己维护视角 */
    const yawVar = /(?:var|let|const)\s+(?:yaw|pitch|rot(?:X|Y|x|y)?|theta)\s*=/.exec(code);
    if (yawVar) findings.push(report(code, 'R6', 'fail', '自己声明 yaw/pitch/旋转角，交给 S.yaw / S.pitch', yawVar.index));

    /* R5 手搓 DOM */
    if ((m = /createElementNS|document\.createElement\(\s*['"`]svg/i.exec(code))) {
      findings.push(report(code, 'R5', 'warn', 'createElementNS 手搓 SVG 图元', m.index));
    }

    /* R7 跨模块 —— 每个产线只认自己的对象名 */
    const OWN = { '2d': 'V', '3d': 'S', 'graph': 'G', 'schematic': 'C', 'pcb': 'P', 'edraw': 'E' };
    const LABEL = { '2d': '2D', '3d': '3D', 'graph': '图论', 'schematic': '电路', 'pcb': 'PCB', 'edraw': '工程图' };
    if (OWN[mod]) {
      for (const k in OWN) {
        if (k === mod) continue;
        const re = new RegExp('\\b' + OWN[k] + '\\.([a-zA-Z_$]\\w*)');
        const mm = re.exec(code);
        if (mm) {
          findings.push(report(code, 'R7', 'fail',
            LABEL[mod] + '块里调了 ' + (LABEL[k] || k) + ' 的 ' + mm[0] + '（这个模块里没有它）', mm.index));
        }
      }
    }
    if (mod === 'none') {
      const anyApi = /\b(?:V|S|G|C|P|E)\.[a-zA-Z_$]\w*/.exec(code);
      if (anyApi) findings.push(report(code, 'R7', 'fail',
        '调了 ' + anyApi[0] + ' 却没创建画布（缺 MK.frame / MK.space / MK.graph / MK.schematic / MK.pcb / MK.eng）', anyApi.index));
    }

    /* R8 挂载 */
    if (mod !== 'none' && !/getElementById\(\s*['"`]fig['"`]\s*\)\s*\.appendChild|appendChild\(\s*[VSGCPE]\.svg/.test(code)) {
      findings.push(report(code, 'R8', 'warn', '没把 svg 挂到 #fig', 0));
    }

    /* R9 画布尺寸 */
    const box = /box\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(code);
    if (box) {
      const w = +box[3];
      if (w < 560 || w > 680) findings.push(report(code, 'R9', 'warn', 'box 宽度 ' + w + '，协议画布是 680', box.index));
    } else if (mod === '2d') {
      findings.push(report(code, 'R9', 'warn', '2D 未给 box，用默认 600×340（多数题该给 600×330 左右并显式声明）', 0));
    }

    /* R10 edges 对象 */
    if ((m = /edges\s*:\s*\{/.exec(code))) findings.push(report(code, 'R10', 'warn', 'edges 写成对象了，协议要求数组', m.index));

    /* R11 手算采样 */
    if (mod === '2d' && (m = /(<polyline|\bd\s*=\s*['"`]M)/.exec(code))) {
      findings.push(report(code, 'R11', 'warn', '手写 path/polyline，采样点是自己算的', m.index));
    }

    /* R12 写死颜色 */
    const hex = /#[0-9a-fA-F]{6}\b/.exec(code);
    if (hex) findings.push(report(code, 'R12', 'warn', '写死颜色 ' + hex[0] + '，用颜色名（blue/coral/teal…）', hex.index));

    /* R13 缺 title */
    if (mod === '2d' && !/title\s*:/.test(code)) findings.push(report(code, 'R13', 'warn', '没有 title', 0));

    /* R14 电路连线全用绝对坐标（一条端口名都没写） */
    if (mod === 'schematic' && /C\.wire\s*\(/.test(code) && !/C\.wire\s*\(\s*['"`]/.test(code)) {
      findings.push(report(code, 'R14', 'warn', '连线全用绝对坐标，应写端口名 "R1.r"（元件一挪线就断）', code.indexOf('C.wire')));
    }

    /* R15 只摆元件不连线 */
    if (mod === 'schematic' && !/C\.(?:wire|wires)\s*\(/.test(code)) {
      findings.push(report(code, 'R15', 'warn', '没有调用 C.wire，元件之间是断开的', 0));
    }

    /* R16 工程图手写尺寸数字 */
    if (mod === 'edraw' && (m = /E\.text\(\s*\[[^\]]*\]\s*,\s*['"`][φΦ]?\d/.exec(code))) {
      findings.push(report(code, 'R16', 'warn', '用 E.text 写了尺寸数值，改用 dimX/dimY/dimDia/dimRad', m.index));
    }

    /* R17 PCB 没有走线 */
    if (mod === 'pcb' && !/P\.(?:trace|route)\s*\(/.test(code)) {
      findings.push(report(code, 'R17', 'warn', '没有 P.trace / P.route，看不出电气连接', 0));
    }
  }

  const fails = findings.filter((f) => f.level === 'fail');
  const warns = findings.filter((f) => f.level === 'warn');
  return {
    verdict: fails.length ? 'fail' : warns.length ? 'warn' : 'pass',
    module: mod,
    kind: isSvg ? 'svg' : 'js',
    findings,
    lines: code.split('\n').length
  };
}

/* ---------- 可选：真跑渲染 ---------- */

async function renderAll(blocks) {
  const viewer = path.join(ROOT, 'dist', 'extension', 'viewer.html');
  if (!fs.existsSync(viewer)) {
    throw new Error('缺少 ' + viewer + '，先跑 npm run build');
  }
  const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
  const CHROME = 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';
  const D = require2(path.join(ROOT, 'src', 'detect.js'));
  const { pathToFileURL } = await import('url');

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(viewer).href);

  const out = [];
  for (const b of blocks) {
    const kind = D.classify(b.code);
    const r = await page.evaluate(({ code, kind }) => {
      const fig = document.getElementById('fig');
      const errBox = document.getElementById('mv-err');
      fig.innerHTML = '';
      errBox.style.display = 'none'; errBox.textContent = '';
      const errors = [];
      try {
        if (kind === 'svg') fig.innerHTML = code;
        else (new Function(code))();
      } catch (e) { errors.push(e && e.message ? e.message : String(e)); }
      if (errBox.style.display !== 'none' && errBox.textContent) errors.push(errBox.textContent);
      return { errors, svgs: fig.querySelectorAll('svg').length, nodes: fig.querySelectorAll('svg *').length };
    }, { code: b.code, kind });
    out.push({ index: b.index, ...r });
  }
  await browser.close();
  return out;
}

/* ---------- 自检：规则本身有没有判歪 ---------- */

async function selftest() {
  const { CASES } = await import('./testset.mjs');
  let bad = 0;

  /* 正例：19 条用例都是运行时正确写法，一条都不许判 fail */
  for (const c of CASES) {
    const blocks = (c.codes || [c.code]).map((code, i) => ({ index: i + 1, lang: 'mathviz', code }));
    const res = blocks.map(lintBlock);
    const fails = res.flatMap((r) => r.findings.filter((f) => f.level === 'fail'));
    if (fails.length) {
      bad++;
      console.log('✗ 正例被误判 ' + c.id + '：' + fails.map((f) => f.id + ' ' + f.msg).join('；'));
    }
  }
  console.log('正例：' + CASES.length + ' 条，误判 ' + bad + ' 条');

  /* 反例：每条都该命中指定规则 */
  const NEG = [
    ['自造拖拽', 'R4', "var V = MK.frame({box:[40,26,600,330],x:[-5,5],y:[-3,3],title:'t'});" +
      "svg.addEventListener('pointermove', function(e){ yaw += e.movementX; });"],
    ['S.drag 旧写法', 'R4', "var S = MK.space({}); S.drag(function(){ S.redraw(); });"],
    ['3D 里用 V.plot', 'R7', "var S = MK.space({}); S.solid([[0,0,0]]); V.plot(function(x){return x;});"],
    ['代码截断', 'R3', "var V = MK.frame({box:[40,26,600,330]});\nV.plot(function(x){return Math.sin(x);});\n// 其余部分...省略"],
    ['自己维护 yaw', 'R6', "var yaw = 0.4, pitch = 0.6;\nvar S = MK.space({});"],
    ['hand-made svg in js', 'R5', "var s = document.createElementNS('http://www.w3.org/2000/svg','svg');"],
    ['edges 对象', 'R10', "var G = MK.graph({nodes:[{id:'A'},{id:'B'}], edges:{A:['B']}});"],
    ['电路用绝对坐标连线', 'R14', "var C = MK.schematic({box:[40,26,600,330]});\nC.wire([2,2],[5,2]);\ndocument.getElementById('fig').appendChild(C.svg);"],
    ['电路只摆元件不连线', 'R15', "var C = MK.schematic({box:[40,26,600,330]});\nC.resistor({id:'R1',at:[2,2]});\ndocument.getElementById('fig').appendChild(C.svg);"],
    ['工程图手写尺寸数字', 'R16', "var E = MK.eng({box:[40,30,600,380],ext:[100,60]});\nE.text([50,10],'40');\ndocument.getElementById('fig').appendChild(E.svg);"],
    ['PCB 不画走线', 'R17', "var P = MK.pcb({box:[40,24,600,380],board:[50,32]});\nP.outline();\ndocument.getElementById('fig').appendChild(P.svg);"],
    ['电路块里用 2D 的 V.plot', 'R7', "var C = MK.schematic({box:[40,26,600,330]});\nV.plot(function(x){return x;});\ndocument.getElementById('fig').appendChild(C.svg);"]
  ];
  let miss = 0;
  for (const [name, rule, code] of NEG) {
    const r = lintBlock({ index: 1, lang: 'mathviz', code });
    const hit = r.findings.some((f) => f.id === rule);
    if (!hit) { miss++; console.log('✗ 反例漏检 ' + name + '（期望 ' + rule + '，实际 ' + r.findings.map((f) => f.id).join(',') + '）'); }
  }
  console.log('反例：' + NEG.length + ' 条，漏检 ' + miss + ' 条');
  process.exit(bad || miss ? 1 : 0);
}

/* ---------- 主流程 ---------- */

const ICON = { pass: '✅', warn: '⚠️ ', fail: '❌' };

function printFile(name, blocks, lints, renders) {
  console.log('\n=== ' + name + ' ===');
  if (!blocks.length) {
    console.log('❌ R1 ' + RULES.R1);
    return { pass: 0, warn: 0, fail: 1 };
  }
  const tally = { pass: 0, warn: 0, fail: 0 };
  blocks.forEach((b, i) => {
    const L = lints[i];
    tally[L.verdict]++;
    const tag = L.kind === 'svg' ? 'svg' : L.module + ' 运行时';
    console.log('\n [' + b.index + '] ' + ICON[L.verdict] + ' ' + tag + ' / ' + L.lines + ' 行 / 围栏 ' + (b.lang || '空'));
    for (const f of L.findings) {
      const loc = f.line === null ? '' : ' 第 ' + f.line + ' 行';
      console.log('     ' + ICON[f.level] + ' ' + f.id + loc + '：' + f.msg);
    }
    if (!L.findings.length) console.log('     只调运行时 API，坐标交给运行时');
    if (renders) {
      const r = renders[i];
      if (r.errors.length) console.log('     ❌ 渲染失败：' + r.errors.join(' | '));
      else console.log('     ✅ 渲染通过（svg=' + r.svgs + '，图元=' + r.nodes + '）');
    }
  });
  console.log('\n 小结：合规 ' + tally.pass + ' / 告警 ' + tally.warn + ' / 违规 ' + tally.fail);
  return tally;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();

  const render = argv.includes('--render');
  const json = argv.includes('--json');
  const files = argv.filter((a) => !a.startsWith('--'));

  let inputs = [];
  if (!files.length || files.includes('-')) {
    const text = fs.readFileSync(0, 'utf8');
    inputs.push({ name: '<stdin>', text });
  }
  for (const f of files) {
    if (f === '-') continue;
    inputs.push({ name: f, text: fs.readFileSync(f, 'utf8') });
  }

  const all = [];
  let fails = 0;
  for (const inp of inputs) {
    const blocks = parseBlocks(inp.text);
    const lints = blocks.map(lintBlock);
    const renders = render && blocks.length ? await renderAll(blocks) : null;
    if (json) all.push({ file: inp.name, blocks: blocks.map((b, i) => ({ ...lints[i], lang: b.lang })), renders });
    else {
      const t = printFile(inp.name, blocks, lints, renders);
      fails += t.fail;
    }
    if (json) fails += lints.filter((l) => l.verdict === 'fail').length;
  }
  if (json) console.log(JSON.stringify(all, null, 2));
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('检查器自身出错：' + e.message); process.exit(2); });
