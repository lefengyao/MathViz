/* 纯逻辑测试：提示词模板 + 代码块识别
   node test/core.test.mjs */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = require(path.join(ROOT, 'src', 'prompt.js'));
const D = require(path.join(ROOT, 'src', 'detect.js'));

let pass = 0, fail = 0;
const groups = [];
function group(name) { groups.push(name); console.log('\n[' + name + ']'); }
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

group('提示词：模式与结构');
t('9 个模式，id 齐全', () => {
  assert.deepEqual(P.MODES.map((m) => m.id),
    ['off', 'auto', 'plot2d', 'solid3d', 'discrete', 'schematic', 'pcb', 'eng', 'svg']);
});
t('off 返回空串', () => assert.equal(P.buildPrompt('off'), ''));
t('未知模式返回空串', () => assert.equal(P.buildPrompt('nope'), ''));
t('auto 含协议标记', () => assert.ok(P.buildPrompt('auto').includes(P.MARK)));
t('含「我的问题」分隔标记', () => assert.ok(P.buildPrompt('auto').includes(P.QUESTION)));
t('规定唯一输出格式 mathviz 代码块', () => assert.ok(/```mathviz/.test(P.buildPrompt('auto'))));
t('所有运行时 API 都写进协议', () => {
  const s = P.buildPrompt('auto');
  for (const k of ['MK.frame', 'MK.space', 'MK.graph', 'MK.venn',
    'MK.schematic', 'MK.pcb', 'MK.eng']) assert.ok(s.includes(k), k);
});
t('说明把图挂到 #fig', () => assert.ok(P.buildPrompt('auto').includes("getElementById('fig')")));
t('明确禁止内联运行时 / script 标签', () => {
  const s = P.buildPrompt('auto');
  assert.ok(s.includes('不要输出运行时源码'));
  assert.ok(s.includes('`<script>` 标签'));
});
t('明确禁止访问网络与存储', () => assert.ok(P.buildPrompt('auto').includes('localStorage')));
t('说明代码块本身就是脚本，不要对外声称「不支持脚本」', () => {
  const s = P.buildPrompt('auto');
  assert.ok(s.includes('同步执行一次'), '没交代脚本只执行一次');
  assert.ok(s.includes('requestAnimationFrame'), '没说明不要做持续动画');
  assert.ok(s.includes('不要说成'), '没禁止「环境不支持脚本」这种错误说法');
});
t('8 种产线的提示词互不相同', () => {
  const ids = ['auto', 'plot2d', 'solid3d', 'discrete', 'schematic', 'pcb', 'eng', 'svg'];
  const set = new Set(ids.map((i) => P.buildPrompt(i)));
  assert.equal(set.size, 8);
});
t('svg 模式的示例是手写 svg 片段', () => assert.ok(P.buildPrompt('svg').includes('<svg xmlns=')));
t('协议仍明确要求 mathviz 代码块格式', () => assert.ok(P.buildPrompt('auto').includes('```mathviz')));
t('任何模式的提示词都不自造闭合 fence（否则会被自己误渲染）', () => {
  for (const id of ['auto', 'plot2d', 'solid3d', 'discrete', 'schematic', 'pcb', 'eng', 'svg']) {
    assert.equal(D.extractFenced(P.buildPrompt(id)).length, 0, id);
  }
});
t('3D 协议写明参数格式、挂载动作与常见禁用法', () => {
  const s = P.buildPrompt('solid3d');
  assert.ok(s.includes('appendChild(S.svg)'));
  assert.ok(s.includes('顶点数组'));
  assert.ok(s.includes('3D 对象没有 `V.plot`'));
  assert.ok(s.includes('S.drag(draw)'));
});
t('离散协议写明 edges 格式与 G.draw 顺序', () => {
  const s = P.buildPrompt('discrete');
  assert.ok(s.includes('appendChild(G.svg)'));
  assert.ok(s.includes('G.draw()'));
  assert.ok(s.includes('是数组，不要写成对象'));
});
t('所有模式都强制要求 appendChild 挂载 svg', () => {
  for (const id of ['auto', 'plot2d', 'solid3d', 'discrete']) {
    assert.ok(P.buildPrompt(id).includes('appendChild(S.svg)'), id);
  }
});
t('3D 模式强制 MK.space', () => assert.ok(P.buildPrompt('solid3d').includes('使用 `MK.space`')));
t('离散模式强制 MK.graph', () => assert.ok(P.buildPrompt('discrete').includes('使用 `MK.graph`')));
t('电路模式强制 MK.schematic，并禁止手拼导线', () => {
  const s = P.buildPrompt('schematic');
  assert.ok(s.includes('使用 `MK.schematic`'));
  assert.ok(s.includes('C.wire("R1.r","Q1.c")'));
  assert.ok(s.includes('C.report()'));
  assert.ok(s.includes('不要写 `V.seg`'));
});
t('PCB 模式强制 MK.pcb，并说明毫米坐标与 y 向下', () => {
  const s = P.buildPrompt('pcb');
  assert.ok(s.includes('使用 `MK.pcb`'));
  assert.ok(s.includes('毫米'));
  assert.ok(s.includes('y 轴向下'));
  assert.ok(s.includes('P.route'));
});
t('工程图模式强制 MK.eng，并禁止用 E.text 手写尺寸数字', () => {
  const s = P.buildPrompt('eng');
  assert.ok(s.includes('使用 `MK.eng`'));
  assert.ok(s.includes('y 轴向上'));
  assert.ok(s.includes('不要用 `E.text` 手写数字'));
  assert.ok(s.includes('E.hatch'));
});
t('auto 模式把电路 / PCB / 工程图路由到新产线', () => {
  const s = P.buildPrompt('auto');
  assert.ok(s.includes('MK.schematic'));
  assert.ok(s.includes('MK.pcb'));
  assert.ok(s.includes('MK.eng'));
  assert.ok(s.includes('有元件就别说坐标'));
});
t('新产线的示例都用到了各自的运行时', () => {
  assert.ok(/MK\.schematic\(/.test(P.buildPrompt('schematic')));
  assert.ok(/MK\.pcb\(/.test(P.buildPrompt('pcb')));
  assert.ok(/MK\.eng\(/.test(P.buildPrompt('eng')));
});
t('深色主题写进协议', () => assert.ok(P.buildPrompt('auto', 'dark').includes('深色主题')));
t('浅色主题写进协议', () => assert.ok(P.buildPrompt('auto', 'light').includes('浅色主题')));
t('协议长度可控（< 8000 字）', () => assert.ok(P.buildPrompt('auto').length < 8000));

group('提示词：与输入框的配合');
t('hasPrompt 认出已插入的协议', () => assert.equal(P.hasPrompt(P.buildPrompt('auto') + '\n画个抛物线'), true));
t('hasPrompt 对普通问题为 false', () => assert.equal(P.hasPrompt('画个抛物线'), false));
t('questionOf 只留用户问题', () => {
  const s = P.buildPrompt('auto') + '\n画 y=x² 的图';
  assert.equal(P.questionOf(s), '画 y=x² 的图');
});
t('questionOf 无标记时原样返回', () => assert.equal(P.questionOf('画 y=x² 的图'), '画 y=x² 的图'));
t('modeById 正确 / 未知返回 null', () => {
  assert.equal(P.modeById('plot2d').label, '函数与 2D');
  assert.equal(P.modeById('nope'), null);
});

group('代码块：提取');
t('提取单个闭合块', () => {
  const r = D.extractFenced('前言\n```mathviz\nvar V = MK.frame({});\n```\n后记');
  assert.equal(r.length, 1);
  assert.ok(r[0].code.startsWith('var V'));
});
t('提取多个块', () => {
  const r = D.extractFenced('```mathviz\nAAA\n```\n中间\n```mathviz\nBBB\n```');
  assert.deepEqual(r.map((x) => x.code), ['AAA', 'BBB']);
});
t('CRLF 正常', () => {
  const r = D.extractFenced('```mathviz\r\nAAA\r\n```');
  assert.equal(r[0].code, 'AAA');
});
t('语言名大小写 / 带后缀', () => {
  const r = D.extractFenced('```MathViz js\nAAA\n```');
  assert.equal(r.length, 1);
});
t('未闭合的块不会被渲染', () => assert.equal(D.extractFenced('```mathviz\nAAA').length, 0));
t('识别流式「有头无尾」', () => {
  assert.equal(D.hasOpenFence('```mathviz\nAAA'), true);
  assert.equal(D.hasOpenFence('```mathviz\nAAA\n```'), false);
});
t('普通 js 代码块不算', () => assert.equal(D.extractFenced('```js\nAAA\n```').length, 0));
t('digest 随内容变化且稳定', () => {
  assert.equal(D.digest('AAA'), D.digest('AAA'));
  assert.notEqual(D.digest('AAA'), D.digest('BBB'));
});

group('代码块：归一化与判定');
t('normalize 去首尾空行与 CRLF', () => assert.equal(D.normalize('\r\n\r\nAAA\r\n\r\n'), 'AAA'));
t('normalize 剥掉 <script> 包裹', () => assert.equal(D.normalize('<script>\nAAA\n</script>'), 'AAA'));
t('normalize 去掉首行语言标记', () => assert.equal(D.normalize('mathviz\nAAA'), 'AAA'));
t('normalize 去掉残留 fence', () => assert.equal(D.normalize('```mathviz\nAAA\n```'), 'AAA'));
t('classify 认出纯 svg', () => assert.equal(D.classify('<svg viewBox="0 0 680 200"></svg>'), 'svg'));
t('classify 认出 js', () => assert.equal(D.classify('var V = MK.frame({});'), 'js'));
t('classify 空内容 / html 文档为 unknown', () => {
  assert.equal(D.classify(''), 'unknown');
  assert.equal(D.classify('<html><body>x</body></html>'), 'unknown');
});
t('isMathvizCode：language-mathviz', () => assert.equal(D.isMathvizCode({ className: 'language-mathviz hljs', text: 'AAA' }), true));
t('isMathvizCode：lang-mathviz', () => assert.equal(D.isMathvizCode({ className: 'lang-mathviz', text: 'AAA' }), true));
t('isMathvizCode：data-language', () => assert.equal(D.isMathvizCode({ parentLang: 'mathviz', text: 'AAA' }), true));
t('isMathvizCode：代码块头部文字', () => assert.equal(D.isMathvizCode({ header: 'mathviz 复制', text: 'AAA' }), true));
t('isMathvizCode：协议正文里的 mathviz 字样不误判', () =>
  assert.equal(D.isMathvizCode({ header: '请输出一个 mathviz 代码块', text: 'var a = 1;' }), false));
t('isMathvizCode：模型写错语言标记但用了 MK.space，仍要认', () =>
  assert.equal(D.isMathvizCode({ className: 'language-javascript', text: 'var S = MK.space({range:2});' }), true));
t('isMathvizCode：language-js 且引用 #fig，仍要认', () =>
  assert.equal(D.isMathvizCode({ className: 'language-js', text: 'document.getElementById("fig").appendChild(V.svg);' }), true));
t('isMathvizCode：普通 js 块不误判', () =>
  assert.equal(D.isMathvizCode({ className: 'language-javascript', text: 'const a = 1; console.log(a);' }), false));
t('isMathvizCode：正文首行是 fence', () => assert.equal(D.isMathvizCode({ text: '```mathviz\nAAA\n```' }), true));
t('isMathvizCode：普通 js 块为 false', () => assert.equal(D.isMathvizCode({ className: 'language-js', text: 'var a = 1;' }), false));
t('isRenderable：svg 与 js 可渲染', () => {
  assert.equal(D.isRenderable('<svg viewBox="0 0 680 100"></svg>'), true);
  assert.equal(D.isRenderable('var V = MK.frame({});'), true);
});
t('isRenderable：空 / 半截代码不渲染', () => {
  assert.equal(D.isRenderable(''), false);
  assert.equal(D.isRenderable('var'), false);
  assert.equal(D.isRenderable('<html></html>'), false);
});

group('完整性预判：流式输出别渲染半截代码');
const FULL = "var V = MK.frame({x:[-2,2],y:[-2,2]});\ndocument.getElementById('fig').appendChild(V.svg);\nV.plot(function(x){ return x*x; }, {color:'blue'});";
t('完整 JS → 可渲染', () => assert.equal(D.looksComplete(FULL), true));
t('缺 }); 停在 size:13 → 不渲染', () =>
  assert.equal(D.looksComplete("var V = MK.frame({x:[-2,2]});\nV.label([0,0],'x',{color:'blue', size:13"), false));
t('末尾一行省略号 ... → 不渲染', () =>
  assert.equal(D.looksComplete("var V = MK.frame({x:[-2,2]});\nV.plot(function(x){return x;},{color:'blue'});\n..."), false));
t('字符串没闭合 → 不渲染', () =>
  assert.equal(D.looksComplete("var V = 1;\nV.label([0,0], 'y = tan"), false));
t('对象没闭合停在逗号 → 不渲染', () =>
  assert.equal(D.looksComplete("var V = 1;\nV.arc([0,0],1,0,1,{color:'amber',"), false));
t('手写 SVG 必须闭合 </svg>', () => {
  assert.equal(D.looksComplete('<svg viewBox="0 0 680 100"><circle cx="1" cy="1" r="1"/></svg>'), true);
  assert.equal(D.looksComplete('<svg viewBox="0 0 680 100"><circle cx="1"'), false);
});
t('提示词明确禁止省略号与中途截断', () => assert.ok(P.buildPrompt('auto').includes('不要写省略号')));

console.log('\n' + '-'.repeat(40));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) process.exit(1);
