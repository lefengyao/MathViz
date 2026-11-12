/* 画布手势：滚轮缩放 / 拖动平移 / 双指缩放平移 / 双击复位。
   全部用真实事件驱动（Playwright 的 mouse 与 CDP 的 touch），不调内部函数，
   这样测的就是用户手指真正会碰到的那条路径。

     node test/nav.test.mjs
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'module';
import { fileURLToPath } from 'node:url';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'extension');

/* iframe 贴左上角，所以 frame 内坐标 == 页面坐标，事件注入少一层换算 */
const HOST = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}iframe{border:0;width:720px;height:380px;display:block}</style>
<iframe id="fw" sandbox="allow-scripts"></iframe>
<div style="height:2400px"></div>
<script>
  var f = document.getElementById('fw');
  var ID = 'n1';
  window.__log = [];
  window.__send = function (msg) { msg.__mv = true; msg.id = ID; f.contentWindow.postMessage(msg, '*'); };
  window.__boot = function () { window.__log = []; f.src = '/viewer.html?theme=light&id=' + ID; };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.__mv === true) window.__log.push({ type: d.type, message: d.message, dataUrl: d.dataUrl });
  });
<\/script>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/host') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HOST);
    return;
  }
  if (url === '/viewer.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(DIST, 'viewer.html'), 'utf8'));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  executablePath: 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 760, height: 600 }, hasTouch: true });
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
await page.goto(BASE + '/host');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + ' —— ' + ((e && e.message) || e)); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 1); }

let frame = null;

async function boot() {
  await page.evaluate(() => window.__boot());
  await page.waitForFunction(
    () => window.__log.some((m) => m.type === 'mv:ready'), null, { timeout: 20000 });
  frame = page.frames().find((f) => f.url().includes('viewer.html'));
}

async function render(code) {
  await page.evaluate(() => { window.__log = []; });
  await page.evaluate((c) => window.__send({ type: 'mv:render', code: c, kind: 'js' }), code);
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (await page.evaluate(() => window.__log.some((m) => m.type === 'mv:done'))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 150));
}

/* 读当前画布的变换：scale 与 translate 直接从矩阵拿，比解析字符串可靠 */
const state = () => frame.evaluate(() => {
  const s = document.querySelector('#fig svg');
  if (!s) return null;
  const cs = getComputedStyle(s).transform;
  const m = cs && cs !== 'none' ? new DOMMatrix(cs) : new DOMMatrix();
  const r = s.getBoundingClientRect();
  return {
    s: m.a, tx: m.e, ty: m.f,
    left: r.left, top: r.top,
    rw: r.width, rh: r.height,        // 视觉尺寸（含缩放）
    vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
    inline: s.style.transform || '',
    chip: (document.getElementById('mv-zoom') || {}).textContent || '',
    chipHidden: !!(document.getElementById('mv-zoom') || {}).hidden
  };
});

/* 屏幕上 (x,y) 这个点对应图内哪个位置（用未缩放的图内像素表示） */
function insideOf(st, x, y) {
  return { ux: (x - st.left) / st.s, uy: (y - st.top) / st.s };
}

const box = async () => (await frame.locator('#fig svg').boundingBox());

const P2D = [
  "var V = MK.frame({box:[40,26,600,330], x:[-6.8,6.8], y:[-1.9,1.9], grid:true, axes:true, title:'sin'});",
  "document.getElementById('fig').appendChild(V.svg);",
  "V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2.2});"
].join('\n');

const P3D = [
  "var S = MK.space({box:[40,26,600,340], yaw:-30, pitch:20, range:3, title:'立方体'});",
  "document.getElementById('fig').appendChild(S.svg);",
  "S.box([0,0,0], [1,1,1], {color:'blue', opacity:0.1});",
  "S.line([0,0,0], [1.5,0,0], {color:'gray'});",
  "S.point([0,0,0], {color:'coral', label:'O'});"
].join('\n');

/* ---------------- 1. 二维图 ---------------- */
console.log('\n画布手势 · 二维图');
await boot();
await render(P2D);

let st = await state();
t('初始为 1×、无 transform（不白白建合成层）', () => {
  ok(near(st.s, 1), 'scale=' + st.s);
  ok(st.inline === '', 'inline=' + st.inline);
  ok(st.chipHidden, '徽标不该出现');
});

/* 滚轮：直接把事件打进 svg，坐标可控 */
async function wheelAt(x, y, dy) {
  return frame.evaluate(({ x, y, dy }) => {
    const s = document.querySelector('#fig svg');
    const ev = new WheelEvent('wheel', {
      clientX: x, clientY: y, deltaY: dy, bubbles: true, cancelable: true
    });
    s.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { x, y, dy });
}

const before = insideOf(st, 260, 180);
const prevented = await wheelAt(260, 180, -120);
st = await state();
const after = insideOf(st, 260, 180);

t('滚轮上滚会放大（并吃掉默认滚动）', () => {
  ok(st.s > 1.05, 'scale=' + st.s.toFixed(3));
  ok(prevented, '没有 preventDefault，页面会跟着滚');
});
t('缩放锚在指针上：指针下的图内点不动', () => {
  ok(near(after.ux, before.ux, 1.5), 'ux ' + before.ux.toFixed(2) + ' → ' + after.ux.toFixed(2));
  ok(near(after.uy, before.uy, 1.5), 'uy ' + before.uy.toFixed(2) + ' → ' + after.uy.toFixed(2));
});

/* 已经平移过（tx≠0）再缩放，锚点仍要准 —— 这里是最容易写漏 tx 的地方 */
const b2 = insideOf(st, 210, 150);
await wheelAt(210, 150, -260);
st = await state();
const a2 = insideOf(st, 210, 150);
t('平移过之后再缩放，锚点依然不跳', () => {
  ok(near(a2.ux, b2.ux, 1.5), 'ux ' + b2.ux.toFixed(2) + ' → ' + a2.ux.toFixed(2));
  ok(near(a2.uy, b2.uy, 1.5), 'uy ' + b2.uy.toFixed(2) + ' → ' + a2.uy.toFixed(2));
});
t('右上角胶囊显示当前百分比', () => {
  ok(!st.chipHidden, '徽标没出现');
  ok(/^\d+%$/.test(st.chip.trim()), '文字=' + st.chip);
  ok(Math.abs(parseInt(st.chip, 10) - Math.round(st.s * 100)) <= 1, '文字 ' + st.chip + ' vs ' + st.s);
});

/* 上限 */
for (let i = 0; i < 40; i++) await wheelAt(300, 200, -240);
st = await state();
t('放大有上限（6×），不会无限放大到糊掉', () => {
  ok(st.s <= 6.001, 'scale=' + st.s);
  ok(st.s > 5.9, '没到上限？scale=' + st.s);
});

/* 回到 1× */
for (let i = 0; i < 80; i++) await wheelAt(300, 200, 240);
st = await state();
t('滚回 1× 后 transform 被清空', () => {
  ok(near(st.s, 1), 'scale=' + st.s);
  ok(st.inline === '', 'inline=' + st.inline);
});
const free = await wheelAt(300, 200, 240);
t('已在 1× 还继续缩小，就放行让页面自己滚', () => ok(!free, '被吃掉了，页面滚不动'));

/* 真实滚轮（不是合成事件）：1× 时应该把滚动交还给外面的聊天页 */
await page.evaluate(() => window.scrollTo(0, 0));
await page.mouse.move(400, 200);
await page.mouse.wheel(0, 400);
await new Promise((r) => setTimeout(r, 300));
const scrolled = await page.evaluate(() => window.scrollY);
t('1× 时滚轮向下滚 → 页面自己滚（图不会卡住聊天）', () => ok(scrolled > 50, 'scrollY=' + scrolled));
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 100));

/* 放大 → 拖动 */
await wheelAt(300, 200, -400);
await wheelAt(300, 200, -400);
st = await state();
const s0 = st.s;
const b = await box();

const beforeDrag = st;
await page.mouse.move(300, 250);
await page.mouse.down();
await page.mouse.move(340, 275, { steps: 6 });
await page.mouse.up();
const dragged = await state();

t('鼠标左键拖动会平移画布', () => {
  ok(dragged.tx - beforeDrag.tx > 20, 'tx ' + beforeDrag.tx.toFixed(1) + ' → ' + dragged.tx.toFixed(1));
  ok(dragged.ty - beforeDrag.ty > 10, 'ty ' + beforeDrag.ty.toFixed(1) + ' → ' + dragged.ty.toFixed(1));
  ok(near(dragged.s, s0, 0.001), '拖动不该改变倍率');
});
t('平移被夹住：不会把图拖出视野留下空白', () => {
  ok(dragged.tx <= 0.5, 'tx 越界 ' + dragged.tx.toFixed(1));
  ok(dragged.tx >= -(dragged.rw - dragged.vw) - 0.5, 'tx 越过头了：' + dragged.tx.toFixed(1));
  ok(dragged.ty >= -(dragged.rh - dragged.vh) - 0.5, 'ty 越过头了：' + dragged.ty.toFixed(1));
});

/* 拖到极限 */
for (let i = 0; i < 9; i++) {
  await page.mouse.move(640, 320);
  await page.mouse.down();
  await page.mouse.move(140, 80, { steps: 6 });
  await page.mouse.up();
}
const edge = await state();
t('一直往右下拖会停在图的右下角（不留白）', () => {
  ok(edge.s > 1.5, '前置：应仍在放大状态，s=' + edge.s.toFixed(2));
  ok(near(edge.tx, -Math.max(0, edge.rw - edge.vw), 1.5), 'tx=' + edge.tx.toFixed(1));
  ok(near(edge.ty, -Math.max(0, edge.rh - edge.vh), 1.5), 'ty=' + edge.ty.toFixed(1));
});

/* 双击复位 */
await page.mouse.dblclick(300, 250);
st = await state();
t('双击复位回 100%', () => {
  ok(near(st.s, 1), 'scale=' + st.s);
  ok(st.inline === '', 'inline=' + st.inline);
  ok(st.chipHidden, '复位后徽标应隐藏');
});

/* 徽标点击复位 */
await wheelAt(300, 200, -300);
st = await state();
t('缩放后徽标可点', () => ok(!st.chipHidden && st.s > 1));
await frame.locator('#mv-zoom').click();
st = await state();
t('点徽标也能复位', () => {
  ok(near(st.s, 1), 'scale=' + st.s);
  ok(st.chipHidden, '徽标还在');
});

/* ---------------- 2. 双指 ---------------- */
console.log('\n画布手势 · 双指');
const cdp = await page.context().newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i }))
});

await touch('touchStart', [[300, 200], [400, 200]]);
for (let k = 1; k <= 6; k++) {
  await touch('touchMove', [[300 - k * 5, 200], [400 + k * 5, 200]]);   // 100 → 160
}
await touch('touchEnd', []);
st = await state();
t('两指张开 → 放大（100px 拉到 160px ≈ 1.6×）', () => {
  ok(st.s > 1.3, 'scale=' + st.s.toFixed(3));
  ok(st.s < 1.9, '放太多了：' + st.s.toFixed(3));
});

/* 两指同向移动 → 平移，位移要对得上，不能回跳 */
const beforePan = await state();
await touch('touchStart', [[300, 200], [400, 200]]);
for (let k = 1; k <= 5; k++) await touch('touchMove', [[300 - k * 8, 200], [400 - k * 8, 200]]);
await touch('touchEnd', []);
const afterPan = await state();
t('两指一起移动 → 画布跟着走，位移不放大也不回跳', () => {
  ok(near(afterPan.tx - beforePan.tx, -40, 2), 'tx ' + beforePan.tx.toFixed(1) + ' → ' + afterPan.tx.toFixed(1));
  ok(near(afterPan.s, beforePan.s, 0.02), '平移不该改变倍率');
});

/* 单指必须放行：手指在图上下滑，页面还得能滚 */
const finger = await frame.evaluate(() => {
  const s = document.querySelector('#fig svg');
  const mk = (pts) => pts.map((p, i) => new Touch({ identifier: i, target: s, clientX: p[0], clientY: p[1] }));
  const one = mk([[200, 150]]);
  const e1 = new TouchEvent('touchstart', { touches: one, targetTouches: one, changedTouches: one, bubbles: true, cancelable: true });
  s.dispatchEvent(e1);
  const two = mk([[180, 150], [260, 150]]);
  const e2 = new TouchEvent('touchstart', { touches: two, targetTouches: two, changedTouches: two, bubbles: true, cancelable: true });
  s.dispatchEvent(e2);
  s.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: two, bubbles: true, cancelable: true }));
  return { one: e1.defaultPrevented, two: e2.defaultPrevented };
});
t('单指不抢手势（图上下滑还能滚页面）', () => ok(!finger.one, '单指 touchstart 被 preventDefault 了'));
t('双指才拦截（不然浏览器会自己缩放整页）', () => ok(finger.two, '双指没有 preventDefault'));

/* ---------------- 3. 三维图的手势分工 ---------------- */
console.log('\n画布手势 · 三维图');
await boot();
await render(P3D);

st = await state();
const orbit = await frame.evaluate(() => {
  const s = document.querySelector('#fig svg');
  return {
    attr: s.getAttribute('data-mv-orbit'),
    touchAction: getComputedStyle(s).touchAction
  };
});
t('3D 图被标记为 orbit，且不改成 pan-y（单指要留给旋转）', () => {
  ok(orbit.attr === '1', '属性=' + orbit.attr);
  ok(orbit.touchAction === 'none', 'touch-action=' + orbit.touchAction);
});

const b3 = await box();
await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2);
await page.mouse.down();
await page.mouse.move(b3.x + b3.width / 2 + 50, b3.y + b3.height / 2, { steps: 5 });
await page.mouse.up();
st = await state();
t('3D 图左键拖动是旋转，画布不平移', () => ok(st.inline === '', '被平移了：' + st.inline));

/* 滚轮对 3D 同样有效 */
await wheelAt(340, 220, -400);
await wheelAt(340, 220, -400);
st = await state();
t('3D 图也能用滚轮放大', () => ok(st.s > 1.2, 'scale=' + st.s.toFixed(2)));

await page.mouse.move(20, 20);          /* 先把 hover 状态清掉 */
const beforeAlt = await state();
await page.keyboard.down('Alt');
await page.mouse.move(300, 250);
await page.mouse.down();
await page.mouse.move(340, 270);
await page.mouse.up();
await page.keyboard.up('Alt');
st = await state();
t('Alt+左键拖动才是平移（不破坏旋转）', () => {
  ok(st.tx - beforeAlt.tx > 20, 'tx ' + beforeAlt.tx.toFixed(1) + ' → ' + st.tx.toFixed(1));
});

/* ---------------- 4. 缩放不影响导出 ---------------- */
console.log('\n缩放与导出');
for (let i = 0; i < 2; i++) await wheelAt(300, 200, -400);
const zoomed = await state();
ok(zoomed.s > 1.5, '前置条件：应已放大');

const shot = await page.evaluate(() => new Promise((res) => {
  window.__log = [];
  window.__send({ type: 'mv:export', scale: 2 });
  const until = Date.now() + 20000;
  const tick = () => {
    const hit = window.__log.filter((m) => m.type === 'mv:exported');
    if (hit.length) return res(hit[hit.length - 1]);
    if (Date.now() > until) return res(null);
    setTimeout(tick, 120);
  };
  tick();
}));
if (!shot || !shot.dataUrl) {
  const bad = await page.evaluate(() => window.__log.filter((m) => m.type === 'mv:export-error').pop() || null);
  console.log('  [导出没回来] ' + JSON.stringify(bad));
}
const png = shot && shot.dataUrl
  ? (() => {
      const buf = Buffer.from(shot.dataUrl.split(',')[1], 'base64');
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    })()
  : null;

const bb = await frame.evaluate(() => {
  const s = document.querySelector('#fig svg');
  const b = s.getBBox();
  return { w: b.width, h: b.height };
});
t('放大后导出的是整张图，不是当前视口那块（宽 = bbox×2+留白）', () => {
  ok(png, '导出失败');
  const want = Math.round((bb.w + 20) * 2) + 32;
  ok(Math.abs(png.w - want) <= 4, png.w + ' vs ' + want);
});

await browser.close();
server.close();

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
