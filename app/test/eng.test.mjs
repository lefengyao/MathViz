/* 工程类运行时的真实渲染测试（Chromium 里跑，不是模拟）
   覆盖：MK.schematic / MK.pcb / MK.eng 的几何契约，以及提示词里 8 个模式的示例能否跑通。
   用法：node test/eng.test.mjs */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = path.join(ROOT, 'dist', 'extension', 'viewer.html');
const P = require2(path.join(ROOT, 'src', 'prompt.js'));

if (!fs.existsSync(VIEWER)) {
  console.error('找不到 dist/extension/viewer.html，先跑 npm run build');
  process.exit(2);
}

let pass = 0, fail = 0;
function group(name) { console.log('\n[' + name + ']'); }
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > (tol || 1e-6)) throw new Error((msg || '') + ' 期望 ≈' + b + '，实际 ' + a); }

const browser = await chromium.launch({
  executablePath: 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 780, height: 620 } });
await page.goto(pathToFileURL(VIEWER).href);

/* 在页面里执行一段代码，返回 {ok, err, ret} */
async function run(code) {
  return page.evaluate((src) => {
    const fig = document.getElementById('fig');
    fig.innerHTML = '';
    const box = document.getElementById('mv-err');
    box.style.display = 'none'; box.textContent = '';
    try { return { ok: true, err: '', ret: (new Function(src))() }; }
    catch (e) { return { ok: false, err: e && e.message ? e.message : String(e), ret: null }; }
  }, code);
}
async function texts() {
  return page.evaluate(() => Array.from(document.querySelectorAll('#fig svg text')).map((n) => n.textContent));
}

/* ============================================================ */
group('运行时都挂上了');
{
  const r = await run('return [typeof MK.schematic, typeof MK.pcb, typeof MK.eng].join(",")');
  t('MK.schematic / MK.pcb / MK.eng 存在', () => eq(r.ret, 'function,function,function'));
}

/* ============================================================ */
group('提示词示例：每个模式都能真跑通');
for (const m of P.MODES) {
  if (m.id === 'off') continue;
  const body = P.exampleBody(m.id);
  const isSvg = /^\s*<svg[\s>]/i.test(body);
  const r = await page.evaluate(({ src, isSvg }) => {
    const fig = document.getElementById('fig');
    fig.innerHTML = '';
    const box = document.getElementById('mv-err');
    box.style.display = 'none'; box.textContent = '';
    try {
      if (isSvg) fig.innerHTML = src; else (new Function(src))();
      return { ok: true, err: '', n: fig.querySelectorAll('svg *').length };
    } catch (e) { return { ok: false, err: e && e.message ? e.message : String(e), n: 0 }; }
  }, { src: body, isSvg });
  if (r.ok && r.n >= 3) { pass++; console.log('  ✓ ' + m.id + ' 的示例可执行（图元 ' + r.n + '）'); }
  else { fail++; console.log('  ✗ ' + m.id + ' 的示例跑不通：' + (r.err || '图元太少 ' + r.n)); }
}

/* ============================================================ */
group('MK.schematic：网格坐标 + 端口连线');
{
  const base = [
    "var C = MK.schematic({box:[40,26,600,320], cell:50});",
    "document.getElementById('fig').appendChild(C.svg);",
    "C.battery({id:'B1', at:[1,3]});",
    "C.resistor({id:'R1', at:[4,3]});",
    "C.led({id:'D1', at:[7,3]});",
    "C.wire('B1.r','R1.l');",
    "C.wire('R1.r','D1.l');",
    "C.wire('D1.r','B1.l');"
  ].join('\n');
  const r = await run(base + "\nreturn C.report();");
  t('画完一条完整回路后没有悬空端口', () => eq(r.ret.floating.join(','), ''));
  t('走线条数 > 0', () => ok(r.ret.wires >= 3, 'wires=' + r.ret.wires));
  const wrap = await run([
    "var C = MK.schematic({box:[40,26,600,320], cell:50});",
    "document.getElementById('fig').appendChild(C.svg);",
    "C.battery({id:'B1', at:[1,3]});",
    "C.resistor({id:'R1', at:[4,3]});",
    "var pts = C.wire('R1.r','B1.l');",
    "var bad = 0;",
    "for (var i = 1; i < pts.length; i++) {",
    "  if (Math.abs(pts[i][0]-pts[i-1][0]) > 1e-9 && Math.abs(pts[i][1]-pts[i-1][1]) > 1e-9) bad++;",
    "}",
    "return {n: pts.length, bad: bad};"
  ].join('\n'));
  t('两引脚背对背时绕行（≥4 个顶点）且仍正交', () => {
    ok(wrap.ret.n >= 4, '顶点数=' + wrap.ret.n);
    eq(wrap.ret.bad, 0, '斜段数');
  });

  const j = await run(base + "\nreturn document.querySelectorAll('#fig .mv-layer-junc circle').length;");
  t('没有 T 型连接时不乱打结点', () => eq(j.ret, 0));

  /* 正交：相邻点必须共 x 或共 y */
  const o = await run([
    "var C = MK.schematic({box:[40,26,600,320], cell:50});",
    "document.getElementById('fig').appendChild(C.svg);",
    "C.resistor({id:'R1', at:[2,2]});",
    "C.resistor({id:'R2', at:[6,6]});",
    "var pts = C.wire('R1.r','R2.l');",
    "var bad = 0;",
    "for (var i = 1; i < pts.length; i++) {",
    "  if (Math.abs(pts[i][0]-pts[i-1][0]) > 1e-9 && Math.abs(pts[i][1]-pts[i-1][1]) > 1e-9) bad++;",
    "}",
    "return {bad:bad, n:pts.length, first:pts[0], last:pts[pts.length-1]};"
  ].join('\n'));
  t('自动走线全是正交折线（无斜段）', () => eq(o.ret.bad, 0, '斜段数'));
  t('走线起点落在源端口上', () => { near(o.ret.first[0], 3, 1e-9, 'x'); near(o.ret.first[1], 2, 1e-9, 'y'); });
  t('走线终点落在目标端口上', () => { near(o.ret.last[0], 5, 1e-9, 'x'); near(o.ret.last[1], 6, 1e-9, 'y'); });

  /* T 型必须打结点，且只打一个：R1 的右引脚同时是横线端点与竖线端点 */
  const jt = await run([
    "var C = MK.schematic({box:[40,26,600,320], cell:50});",
    "document.getElementById('fig').appendChild(C.svg);",
    "C.resistor({id:'R1', at:[2,3]});",
    "C.resistor({id:'R2', at:[6,3]});",
    "C.resistor({id:'R3', at:[3,6], rot:90});",
    "C.wire('R1.r','R2.l');",
    "C.wire('R3.l','R1.r');",
    "return document.querySelectorAll('#fig .mv-layer-junc circle').length;"
  ].join('\n'));
  t('三线交汇处正好打一个结点', () => eq(jt.ret, 1));

  /* 悬空自检 */
  const fl = await run([
    "var C = MK.schematic({box:[40,26,600,320], cell:50});",
    "document.getElementById('fig').appendChild(C.svg);",
    "C.resistor({id:'R1', at:[2,2]});",
    "return C.floating();"
  ].join('\n'));
  t('floating() 能报出没接线的端口', () => eq(fl.ret.sort().join(','), 'R1.l,R1.r'));

  /* 错误信息要中文、要指名端口 */
  const e1 = await run("var C = MK.schematic({box:[40,26,600,320]});document.getElementById('fig').appendChild(C.svg);C.resistor({id:'R1',at:[2,2]});C.wire('R9.l','R1.r');");
  t('元件 id 写错时给中文提示', () => { ok(!e1.ok, '本应报错'); ok(/还没放置元件 R9/.test(e1.err), e1.err); });

  const e2 = await run("var C = MK.schematic({box:[40,26,600,320]});document.getElementById('fig').appendChild(C.svg);C.resistor({id:'R1',at:[2,2]});C.wire('R1.x','R1.r');");
  t('端口名写错时列出可用端口', () => { ok(!e2.ok, '本应报错'); ok(/没有端口 x/.test(e2.err) && /l, r/.test(e2.err), e2.err); });

  const e3 = await run("var C = MK.schematic({box:[40,26,600,320]});document.getElementById('fig').appendChild(C.svg);C.resistor({id:'R1',at:[2,2]});C.wire('R1','R1.r');");
  t('端口格式不对时给出正确写法', () => { ok(!e3.ok, '本应报错'); ok(/元件id\.端口名/.test(e3.err), e3.err); });
}

/* ============================================================ */
group('MK.pcb：毫米坐标 + 45° 布线');
{
  const r = await run([
    "var P = MK.pcb({box:[40,24,600,380], board:[50,32]});",
    "document.getElementById('fig').appendChild(P.svg);",
    "P.outline({r:2});",
    "return {s:P.s, p00:P.at(0,0), p10:P.at(10,0), p01:P.at(0,10)};"
  ].join('\n'));
  t('at() 是纯毫米线性变换（x 方向）', () => near(r.ret.p10[0] - r.ret.p00[0], 10 * r.ret.s, 1e-6));
  t('at() 的 y 向下（与屏幕一致）', () => ok(r.ret.p01[1] > r.ret.p00[1], 'PCB 的 y 应当向下'));

  const out = await run([
    "var P = MK.pcb({box:[40,24,600,380], board:[50,32]});",
    "document.getElementById('fig').appendChild(P.svg);",
    "P.outline({r:2});",
    "var rc = document.querySelector('#fig .mv-layer-base rect');",
    "return rc ? {w:+rc.getAttribute('width'), h:+rc.getAttribute('height')} : null;"
  ].join('\n'));
  t('outline 画出板框矩形', () => { ok(out.ret, '没有 rect'); ok(out.ret.w > 0 && out.ret.h > 0, '宽高为 0'); });

  const rt = await run([
    "var P = MK.pcb({box:[40,24,600,380], board:[50,32]});",
    "document.getElementById('fig').appendChild(P.svg);",
    "P.outline();",
    "P.route([5,5],[25,15], {w:0.6});",
    "var d = document.querySelector('#fig .mv-layer-wire path').getAttribute('d');",
    "var pts = d.replace('M','').split('L').map(function(s){var a=s.trim().split(/\\s+/);return [+a[0],+a[1]];});",
    "return pts;"
  ].join('\n'));
  t('route 至少拐一次（不是一条斜线直连）', () => ok(rt.ret.length >= 3, '点数=' + rt.ret.length));
  t('route 每段只能是 0° / 45° / 90°', () => {
    for (let i = 1; i < rt.ret.length; i++) {
      const dx = Math.abs(rt.ret[i][0] - rt.ret[i - 1][0]);
      const dy = Math.abs(rt.ret[i][1] - rt.ret[i - 1][1]);
      if (dx < 1e-6 || dy < 1e-6) continue;
      near(Math.abs(dx - dy) / Math.max(dx, dy), 0, 0.02, '第 ' + i + ' 段角度');
    }
  });

  const tr = await run([
    "var P = MK.pcb({box:[40,24,600,380], board:[50,32]});",
    "document.getElementById('fig').appendChild(P.svg);",
    "P.outline();",
    "P.trace([[2,2],[10,2],[10,8]], {w:0.5});",
    "var d = document.querySelector('#fig .mv-layer-wire path').getAttribute('d');",
    "return (d.match(/[ML]/g)||[]).length;"
  ].join('\n'));
  t('trace 按给定的拐点画（3 点 → 3 个顶点）', () => eq(tr.ret, 3));

  const fp = await run("var P = MK.pcb({box:[40,24,600,380], board:[50,32]});document.getElementById('fig').appendChild(P.svg);P.footprint('zzz',{at:[1,1]});");
  t('未知封装报错并列出可用封装', () => { ok(!fp.ok, '本应报错'); ok(/0805/.test(fp.err) && /sot23/.test(fp.err), fp.err); });

  const fpk = await run([
    "var P = MK.pcb({box:[40,24,600,380], board:[50,32]});",
    "document.getElementById('fig').appendChild(P.svg);",
    "P.footprint('0805', {at:[12,9], ref:'R1', value:'10k'});",
    "var t = Array.from(document.querySelectorAll('#fig .mv-layer-over text')).map(function(n){return n.textContent;});",
    "return t;"
  ].join('\n'));
  t('封装自动标出位号与参数', () => { ok(fpk.ret.includes('R1'), '缺位号'); ok(fpk.ret.includes('10k'), '缺参数'); });
}

/* ============================================================ */
group('MK.eng：毫米坐标 + y 向上 + 国标标注');
{
  const r = await run([
    "var E = MK.eng({box:[40,30,600,380], ext:[140,90]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "return {p00:E.at(0,0), p10:E.at(10,0), p01:E.at(0,10)};"
  ].join('\n'));
  t('y 轴向上（y 越大像素 y 越小）', () => ok(r.ret.p01[1] < r.ret.p00[1], '工程图 y 应当向上'));
  t('x 轴向右', () => ok(r.ret.p10[0] > r.ret.p00[0], 'x 应当向右'));

  const d = await run([
    "var E = MK.eng({box:[40,30,600,380], ext:[140,90]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.dimX([20,20],[120,20], {offset:10});",
    "return Array.from(document.querySelectorAll('#fig .mv-layer-over text')).map(function(n){return n.textContent;});"
  ].join('\n'));
  t('dimX 自动写出真实长度（100）', () => ok(d.ret.includes('100'), JSON.stringify(d.ret)));

  const d2 = await run([
    "var E = MK.eng({box:[40,30,600,380], ext:[140,90]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.dimX([20,20],[120,20], {offset:10, text:'100±0.1'});",
    "return Array.from(document.querySelectorAll('#fig .mv-layer-over text')).map(function(n){return n.textContent;});"
  ].join('\n'));
  t('dimX 支持自定义文字（公差）', () => ok(d2.ret.includes('100±0.1'), JSON.stringify(d2.ret)));

  const dia = await run([
    "var E = MK.eng({box:[40,30,600,380], ext:[140,90]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.circle([70,45], 12);",
    "E.dimDia([70,45],[70,33]);",
    "return Array.from(document.querySelectorAll('#fig .mv-layer-over text')).map(function(n){return n.textContent;});"
  ].join('\n'));
  t('dimDia 自动写 φ + 直径', () => ok(dia.ret.includes('φ24'), JSON.stringify(dia.ret)));

  const h = await run([
    "var E = MK.eng({box:[40,30,600,380], ext:[140,90]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "var poly = [[20,20],[80,20],[80,60],[20,60]];",
    "E.poly(poly, {close:true});",
    "E.hatch(poly, {angle:45, gap:4});",
    "return document.querySelectorAll('#fig .mv-layer-sym line').length;"
  ].join('\n'));
  t('hatch 在闭合轮廓里打出多条剖面线', () => ok(h.ret >= 5, '剖面线只有 ' + h.ret + ' 条'));

  const st = await run([
    "var E = MK.eng({box:[40,30,600,380], ext:[140,90]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.line([10,40],[130,40], {style:'center'});",
    "E.line([10,20],[130,20], {style:'solid'});",
    "var ls = Array.from(document.querySelectorAll('#fig .mv-layer-sym line'));",
    "return ls.map(function(n){return [n.getAttribute('stroke-dasharray'), n.getAttribute('stroke-width')];});"
  ].join('\n'));
  t('中心线是点划线，轮廓是粗实线', () => {
    ok(/^\d/.test(st.ret[0][0] || ''), '中心线应有 dasharray，实际 ' + st.ret[0][0]);
    eq(st.ret[1][0], null, '实线不该有 dasharray');
    ok(+st.ret[1][1] > +st.ret[0][1], '轮廓线应比中心线粗');
  });

  const rough = await run([
    "var E = MK.eng({box:[40,30,600,380], ext:[140,90]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.roughness([120,70], 'Ra 3.2');",
    "return Array.from(document.querySelectorAll('#fig .mv-layer-over text')).map(function(n){return n.textContent;});"
  ].join('\n'));
  t('粗糙度符号带文字', () => ok(rough.ret.includes('Ra 3.2'), JSON.stringify(rough.ret)));
}

/* ============================================================ */
group('MK.schematic：行数写多了不会被裁');
{
  const r = await page.evaluate(async () => {
    const fig = document.getElementById('fig');
    fig.innerHTML = '';
    const src = [
      "var C = MK.schematic({box:[40,26,600,330], cell:46, title:'12 行原理图'});",
      "document.getElementById('fig').appendChild(C.svg);",
      "for (var i = 0; i < 12; i++) { C.resistor({id:'R'+i, at:[2, i*1.6], label:'R'+i}); }"
    ].join('\n');
    (new Function(src))();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const svg = fig.querySelector('svg');
    const bb = svg.querySelector('.mv-fit').getBBox();
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    return {
      vb: vb, bb: [bb.x, bb.y, bb.width, bb.height].map(Math.round),
      inside: bb.x >= vb[0] - 1 && bb.y >= vb[1] - 1
        && bb.x + bb.width <= vb[0] + vb[2] + 1 && bb.y + bb.height <= vb[1] + vb[3] + 1
    };
  });
  t('12 行元件超出原 box 时画幅自动变高，元件全在画面里', () => {
    ok(r.inside, '内容被裁：' + JSON.stringify(r.vb) + ' vs ' + JSON.stringify(r.bb));
    ok(r.vb[3] > 660, '画幅高度只有 ' + r.vb[3] + '，没跟着长高');
  });
}

/* ============================================================ */
group('MK.eng：ext 写错也不能缩到角落 / 被裁掉');
{
  /* 等一帧：自适应是在脚本跑完后的 rAF 里做的 */
  async function runFit(code) {
    return page.evaluate(async (src) => {
      const fig = document.getElementById('fig');
      fig.innerHTML = '';
      try { (new Function(src))(); } catch (e) { return { ok: false, err: String(e.message || e) }; }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const svg = fig.querySelector('svg');
      const wrap = svg.querySelector('.mv-fit');
      const bb = wrap.getBBox();
      const vb = svg.getAttribute('viewBox').split(' ').map(Number);
      const title = svg.querySelector('text');
      return {
        ok: true,
        vb: vb,
        bb: [bb.x, bb.y, bb.width, bb.height],
        fill: bb.width / vb[2],
        inside: bb.x >= vb[0] - 1 && bb.y >= vb[1] - 1
          && bb.x + bb.width <= vb[0] + vb[2] + 1 && bb.y + bb.height <= vb[1] + vb[3] + 1,
        titleY: title ? +title.getAttribute('y') : null,
        rect: [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height]
      };
    }, code);
  }

  const big = await runFit([
    "var E = MK.eng({box:[40,26,600,390], ext:[280,192], title:'ext 大一倍'});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.poly([[20,20],[120,20],[120,76],[20,76]], {close:true});",
    "E.circle([70,48], 14);"
  ].join('\n'));
  t('ext 写大一倍：缩放到填满，不再是左下角一小块', () => {
    ok(big.ok, big.err);
    ok(big.fill > 0.85, '内容只占画幅 ' + big.fill.toFixed(2) + '，仍偏小');
    ok(big.vb[2] < 500, 'viewBox 应收到内容大小附近，实际宽 ' + big.vb[2]);
  });
  t('ext 写大一倍：画幅保持横长（不因标题被拉成竖条）', () => {
    const ar = big.vb[2] / big.vb[3];
    ok(ar > 1.2, '宽高比 ' + ar.toFixed(2) + '，太窄了');
    ok(big.rect[1] < 620, '卡片高度 ' + Math.round(big.rect[1]) + 'px，过高');
  });

  const small = await runFit([
    "var E = MK.eng({box:[40,26,600,390], ext:[90,60], title:'ext 太小'});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.poly([[20,20],[120,20],[120,76],[20,76]], {close:true});",
    "E.circle([70,48], 14);"
  ].join('\n'));
  t('ext 写小：图形溢出时自动扩画幅，不再被裁', () => {
    ok(small.ok, small.err);
    ok(small.inside, '内容超出 viewBox：' + JSON.stringify(small.vb) + ' vs ' + JSON.stringify(small.bb));
  });

  const fixed = await runFit([
    "var E = MK.eng({box:[40,26,600,390], ext:[280,192], scale:2, title:'固定比例'});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.poly([[20,20],[120,20],[120,76],[20,76]], {close:true});"
  ].join('\n'));
  t('显式 scale 的图不自动适配（尊重固定的出图比例）', () => {
    ok(fixed.ok, fixed.err);
    eq(fixed.vb[2], 680, 'viewBox 宽应保持 680');
  });

  const noTitle = await runFit([
    "var E = MK.eng({box:[40,26,600,390], ext:[280,192]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.poly([[10,10],[90,10],[90,50],[10,50]], {close:true});"
  ].join('\n'));
  t('没写 title 时也能自适应（不留标题的空行）', () => {
    ok(noTitle.ok, noTitle.err);
    ok(noTitle.fill > 0.85, '填充率 ' + noTitle.fill.toFixed(2));
    eq(noTitle.titleY, null);
  });
}

/* ============================================================ */
group('主题适配：不写死黑白');
{
  const dark = await page.evaluate(() => { document.documentElement.setAttribute('data-mv-theme', 'dark'); return true; });
  ok(dark);
  const r = await run([
    "var E = MK.eng({box:[40,30,600,380], ext:[100,60]});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.poly([[10,10],[90,10],[90,50],[10,50]], {close:true});",
    "var ln = document.querySelector('#fig .mv-layer-sym line, #fig .mv-layer-sym path');",
    "return ln ? (ln.getAttribute('stroke')||'') : '';"
  ].join('\n'));
  t('深色主题下描边不是黑色', () => ok(!/^#0|^black$/i.test(r.ret), '实际 ' + r.ret));
  await page.evaluate(() => { document.documentElement.removeAttribute('data-mv-theme'); });
}

await browser.close();

console.log('\n' + '-'.repeat(40));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) process.exit(1);
