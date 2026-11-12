/* P3 工程图自适应的边界用例（真实 Chromium 渲染）
   上一轮修「图缩到左下角 / 被裁」时只验证了常规尺寸 + 溢出原理图，
   这里补穷举：320px 窄容器（手机）、超长标题、空图、只画一个点、PCB。
   用法：node test/eng-boundary.test.mjs */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = path.join(ROOT, 'dist', 'extension', 'viewer.html');

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

const browser = await chromium.launch({
  executablePath: 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 780, height: 620 } });
await page.goto(pathToFileURL(VIEWER).href);

/* 跑一段代码 + 等两帧（自适应在 rAF 里做），返回 viewBox / bbox / svg 宽高 */
async function runFit(code, figWidth) {
  return page.evaluate(async ({ src, w }) => {
    const fig = document.getElementById('fig');
    fig.innerHTML = '';
    fig.style.width = w ? w + 'px' : '';
    try { (new Function(src))(); }
    catch (e) { fig.style.width = ''; return { ok: false, err: String(e.message || e) }; }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const svg = fig.querySelector('svg');
    const wrap = svg.querySelector('.mv-fit');
    const bb = wrap.getBBox();
    const vbRaw = svg.getAttribute('viewBox');
    const vb = String(vbRaw).split(/\s+/).map(Number);
    const finite = vb.length === 4 && vb.every((n) => isFinite(n) && n > 0 || (n <= 0 && isFinite(n)));
    const out = {
      ok: true,
      vb: vb,
      vbFinite: vb.length === 4 && vb.every(isFinite),
      vbPositive: vb[2] > 0 && vb[3] > 0,
      bb: [bb.x, bb.y, bb.width, bb.height].map(Math.round),
      fill: bb.width / vb[2],
      inside: bb.x >= vb[0] - 1 && bb.y >= vb[1] - 1
        && bb.x + bb.width <= vb[0] + vb[2] + 1 && bb.y + bb.height <= vb[1] + vb[3] + 1,
      rect: [Math.round(svg.getBoundingClientRect().width), Math.round(svg.getBoundingClientRect().height)]
    };
    fig.style.width = '';
    return out;
  }, { src: code, w: figWidth || 0 });
}

/* ============================================================ */
group('320px 窄容器（手机）');
{
  const r = await runFit([
    "var E = MK.eng({box:[40,26,600,390], ext:[280,192], title:'窄容器'});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.poly([[20,20],[120,20],[120,76],[20,76]], {close:true});",
    "E.circle([70,48], 14);",
    "E.dimX([20,84],[120,84], {offset:10, text:'100'});"
  ].join('\n'), 320);
  t('不报错，viewBox 是四个有限数', () => {
    ok(r.ok, r.err);
    ok(r.vbFinite, 'viewBox 含 NaN/Infinity：' + JSON.stringify(r.vb));
  });
  t('内容在画幅内（不被裁、不缩角落）', () => {
    ok(r.inside, '内容超出 viewBox：' + JSON.stringify(r.vb) + ' vs ' + JSON.stringify(r.bb));
    ok(r.fill > 0.6, '填充率 ' + r.fill.toFixed(2) + '，缩得太小');
  });
  t('svg 跟着容器收缩到 320px 宽（不横向溢出）', () => {
    ok(Math.abs(r.rect[0] - 320) <= 2, 'svg 实际 ' + r.rect[0] + 'px');
  });
}

/* ============================================================ */
group('超长标题');
{
  const r = await runFit([
    "var E = MK.eng({box:[40,26,600,390], ext:[280,192], title:'这是一个特别特别特别特别特别特别特别特别特别特别特别长的标题用来验证自适应不会被拉成竖条'});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.poly([[20,20],[120,20],[120,76],[20,76]], {close:true});"
  ].join('\n'));
  t('画幅保持横长，不被标题拉成竖条', () => {
    ok(r.ok, r.err);
    const ar = r.vb[2] / r.vb[3];
    ok(ar > 1.2, '宽高比 ' + ar.toFixed(2));
  });
  t('内容仍填满画幅、不被裁', () => {
    ok(r.inside, JSON.stringify(r.vb) + ' vs ' + JSON.stringify(r.bb));
    ok(r.fill > 0.6, '填充率 ' + r.fill.toFixed(2));
  });
}

/* ============================================================ */
group('空图（只有标题，什么都没画）');
{
  const r = await runFit([
    "var E = MK.eng({box:[40,26,600,390], ext:[280,192], title:'空图'});",
    "document.getElementById('fig').appendChild(E.svg);"
  ].join('\n'));
  t('不报错，viewBox 保持原值且有限', () => {
    ok(r.ok, r.err);
    ok(r.vbFinite && r.vbPositive, 'viewBox 异常：' + JSON.stringify(r.vb));
  });
  t('空内容不触发缩放（bbox 守卫生效）', () => {
    ok(r.vb[2] > 600, 'viewBox 被空内容改写：宽 ' + r.vb[2]);
  });
}

/* ============================================================ */
group('只画一个点');
{
  const r = await runFit([
    "var E = MK.eng({box:[40,26,600,390], ext:[280,192], title:'单点'});",
    "document.getElementById('fig').appendChild(E.svg);",
    "E.circle([60,40], 1);"
  ].join('\n'));
  t('不报错，viewBox 有限且为正', () => {
    ok(r.ok, r.err);
    ok(r.vbFinite && r.vbPositive, 'viewBox 异常：' + JSON.stringify(r.vb));
  });
  t('点在画面里，画幅不会被缩成奇点', () => {
    ok(r.inside, JSON.stringify(r.vb) + ' vs ' + JSON.stringify(r.bb));
    ok(r.vb[2] > 4 && r.vb[3] > 4, 'viewBox 被缩成 ' + r.vb[2] + 'x' + r.vb[3]);
  });
}

/* ============================================================ */
group('PCB：320px 窄容器 + 完整元素');
{
  const r = await runFit([
    "var B = MK.pcb({box:[40,24,600,380], board:[60,40], ext:[280,192], title:'PCB 窄容器'});",
    "document.getElementById('fig').appendChild(B.svg);",
    "B.outline();",
    "B.footprint('soic8', {at:[18,12], label:'U1'});",
    "B.footprint('0805', {at:[42,26]});",
    "B.trace([[22,16],[34,16],[34,28]], {layer:'top'});",
    "B.via([34,28]);"
  ].join('\n'), 320);
  t('不报错，viewBox 有限', () => {
    ok(r.ok, r.err);
    ok(r.vbFinite && r.vbPositive, 'viewBox 异常：' + JSON.stringify(r.vb));
  });
  t('板子 + 元件 + 走线都在画面内', () => {
    ok(r.inside, JSON.stringify(r.vb) + ' vs ' + JSON.stringify(r.bb));
  });
  t('svg 收缩到容器宽（不溢出 320px）', () => {
    ok(Math.abs(r.rect[0] - 320) <= 2, 'svg 实际 ' + r.rect[0] + 'px');
  });
}

await browser.close();

console.log('\n' + '-'.repeat(40));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) process.exit(1);
