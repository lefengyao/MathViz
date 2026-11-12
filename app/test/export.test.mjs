/* 导出 PNG 的端到端断言。
   不走"点一下按钮没报错"这种假验证，而是完整跑一遍线上链路：
   host 页 → sandbox="allow-scripts" iframe → postMessage → 运行时渲染 → 导出 → 解码 PNG 校验。

   重点验三件事：
   1. 沙箱是 opaque origin，canvas 没被污染（toDataURL 不抛 SecurityError）；
   2. 导出的是**当前**画面 —— 3D 拖一下视角，导出的字节必须变；
   3. 尺寸与底色对得上（viewBox × 倍率 + padding，底色取当前主题）。

     node test/export.test.mjs
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'node:url';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'extension');
const OUT = path.join(ROOT, 'test', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const HOST = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#fff}iframe{border:0;width:720px;height:560px;display:block}</style>
<iframe id="fw" sandbox="allow-scripts"></iframe>
<script>
  var f = document.getElementById('fw');
  var ID = 't1';
  window.__log = [];
  window.__send = function (msg) {
    msg.__mv = true; msg.id = ID;
    f.contentWindow.postMessage(msg, '*');
  };
  window.__boot = function (theme) {
    f.src = '/viewer.html?theme=' + (theme || 'light') + '&id=' + ID;
  };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__mv !== true) return;
    window.__log.push({ type: d.type, message: d.message, dataUrl: d.dataUrl });
  });
  /* 把导出的 data URL 画到本地 canvas 上取一个角像素，用来验底色 */
  window.__pixel = function (url, x, y) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        var g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        var d = g.getImageData(x, y, 1, 1).data;
        res([d[0], d[1], d[2], d[3]]);
      };
      img.onerror = function () { res(null); };
      img.src = url;
    });
  };
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
const page = await browser.newPage({ viewport: { width: 760, height: 600 } });
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
await page.goto(BASE + '/host');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + ' —— ' + ((e && e.message) || e)); }
}

let frame = null;

async function boot(theme) {
  await page.evaluate((th) => window.__boot(th), theme);
  await page.waitForFunction(
    () => window.__log.some((m) => m.type === 'mv:ready'), null, { timeout: 20000 });
  frame = page.frames().find((f) => f.url().includes('viewer.html'));
}

const send = (msg) => page.evaluate((m) => window.__send(m), msg);
const lastOf = (type) => page.evaluate((ty) => {
  const hit = window.__log.filter((m) => m.type === ty);
  return hit.length ? hit[hit.length - 1] : null;
}, type);

async function waitType(type, ms) {
  const until = Date.now() + (ms || 20000);
  while (Date.now() < until) {
    const m = await lastOf(type);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

async function renderOnce(code) {
  await page.evaluate(() => { window.__log = []; });
  await send({ type: 'mv:render', code, kind: 'js' });
  const done = await waitType('mv:done');
  if (!done) throw new Error('渲染没完成');
  await new Promise((r) => setTimeout(r, 150));
}

async function exportOnce(scale) {
  await page.evaluate(() => {
    window.__log = window.__log.filter(
      (m) => m.type !== 'mv:exported' && m.type !== 'mv:export-error');
  });
  await send({ type: 'mv:export', scale: scale || 2 });
  const ok = await waitType('mv:exported');
  if (!ok) {
    const bad = await lastOf('mv:export-error');
    throw new Error('导出失败：' + ((bad && bad.message) || '超时'));
  }
  return ok;
}

function pngInfo(dataUrl) {
  const b = Buffer.from(String(dataUrl).split(',')[1], 'base64');
  const sig = b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return {
    bytes: b.length, sig, w: b.readUInt32BE(16), h: b.readUInt32BE(20),
    sha: crypto.createHash('sha1').update(b).digest('hex').slice(0, 12)
  };
}
const save = (name, dataUrl) =>
  fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

/* ---------------- 1. 2D：PNG 头、尺寸、底色 ---------------- */
console.log('\n导出 PNG');
await boot('light');
await renderOnce([
  "var V = MK.frame({box:[40,26,600,330], x:[-6.8,6.8], y:[-1.9,1.9], grid:true, axes:true,",
  "  title:'y = sin x 与 y = cos x', desc:'周期 2π，值域 [-1,1]'});",
  "document.getElementById('fig').appendChild(V.svg);",
  "V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2.2});",
  "V.plot(function(x){return Math.cos(x);}, {color:'coral', w:2.2, dash:true});",
  "V.dot([Math.PI/2,1],{color:'coral',r:3.5});",
  "V.label([Math.PI/2,1],'峰值 (π/2, 1)',{dx:6,dy:-14,color:'coral'});",
  "V.legend([{text:'sin x',color:'blue'},{text:'cos x',color:'coral',dash:true}]);"
].join('\n'));

const vb = await frame.evaluate(() => {
  const s = document.querySelector('#fig svg');
  const b = s.getBBox();
  return {
    vbW: s.viewBox.baseVal.width, vbH: s.viewBox.baseVal.height,
    bbW: b.width, bbH: b.height
  };
});
const e1 = await exportOnce(2);
const p1 = pngInfo(e1.dataUrl);
save('export-2d.png', e1.dataUrl);

t('回来的是合法 PNG（签名 + 有宽高）', () => {
  if (!p1.sig) throw new Error('不是 PNG');
  if (!(p1.w > 100 && p1.h > 100)) throw new Error('尺寸异常 ' + p1.w + 'x' + p1.h);
});
t('尺寸 = 内容 bbox × 2 + 留白（' + vb.bbW.toFixed(0) + '×2+…)', () => {
  const want = Math.round((vb.bbW + 20) * 2) + 32;
  if (Math.abs(p1.w - want) > 4) throw new Error('宽 ' + p1.w + '，期望 ' + want);
});
t('高度按同一倍率放大（不是只放大宽）', () => {
  const want = Math.round((vb.bbH + 20) * 2) + 32;
  if (Math.abs(p1.h - want) > 4) throw new Error('高 ' + p1.h + '，期望 ' + want);
});
t('空白被裁掉（比整帧导出小）', () => {
  if (!(p1.w < vb.vbW * 2 + 32)) {
    throw new Error('宽 ' + p1.w + ' 没比整帧 ' + (vb.vbW * 2 + 32) + ' 窄，说明没紧裁');
  }
});
t('图像不是空白（PNG 大于 3KB）', () => {
  if (p1.bytes < 3000) throw new Error('只有 ' + p1.bytes + ' 字节，可能画空了');
});

const px = await page.evaluate((u) => window.__pixel(u, 2, 2), e1.dataUrl);
t('浅色主题下底色是纯白且不透明', () => {
  if (!px) throw new Error('解不开图');
  if (!(px[0] > 245 && px[1] > 245 && px[2] > 245 && px[3] === 255)) {
    throw new Error('角像素 ' + JSON.stringify(px));
  }
});

/* ---------------- 2. 3D：导出的是当前视角 ---------------- */
await renderOnce([
  "var S = MK.space({box:[40,26,600,380], yaw:-28, pitch:22, range:2.6, title:'立方体'});",
  "document.getElementById('fig').appendChild(S.svg);",
  "S.box([0,0,0],[1,1,1],{color:'blue',opacity:0.1});",
  "S.point([0,0,0],{color:'coral',label:'O'});"
].join('\n'));

const ea = await exportOnce(2);
const a = pngInfo(ea.dataUrl);
save('export-3d-a.png', ea.dataUrl);

await frame.evaluate(() => {
  const svg = document.querySelector('#fig svg');
  const ev = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: 1, bubbles: true, isPrimary: true
  }));
  ev('pointerdown', 300, 200);
  ev('pointermove', 380, 250);
  ev('pointermove', 440, 300);
  ev('pointerup', 440, 300);
});
await new Promise((r) => setTimeout(r, 250));

const eb = await exportOnce(2);
const b = pngInfo(eb.dataUrl);
save('export-3d-b.png', eb.dataUrl);

t('拖动后导出的字节与拖动前不同（= 按当前视角导出）', () => {
  if (a.sha === b.sha) throw new Error('两张完全一样，说明导出的是初始视角');
});

/* ---------------- 3. 深色主题 ---------------- */
await boot('dark');
await renderOnce([
  "var V = MK.frame({box:[40,26,600,300], x:[-6.8,6.8], y:[-1.9,1.9], grid:true, axes:true,",
  "  title:'cos x'});",
  "document.getElementById('fig').appendChild(V.svg);",
  "V.plot(function(x){return Math.cos(x);}, {color:'coral'});",
  "V.legend([{text:'cos x',color:'coral'}]);"
].join('\n'));
const dark = await exportOnce(2);
save('export-dark.png', dark.dataUrl);
const dpx = await page.evaluate((u) => window.__pixel(u, 2, 2), dark.dataUrl);
t('深色主题下底色跟着变深（不是白底）', () => {
  if (!dpx) throw new Error('解不开图');
  if (!(dpx[0] < 80 && dpx[1] < 80 && dpx[2] < 80)) {
    throw new Error('角像素 ' + JSON.stringify(dpx) + '，应接近 #1f1f1e');
  }
});

/* ---------------- 4. 一张卡里两张图 ---------------- */
await boot('light');
const frameA = [
  "var A = MK.frame({box:[40,10,620,200], x:[-3,3], y:[-1.2,1.2], axes:true});",
  "document.getElementById('fig').appendChild(A.svg);",
  "A.plot(function(x){return Math.sin(x);}, {color:'blue'});"
].join('\n');
await renderOnce(frameA);
const one = pngInfo((await exportOnce(2)).dataUrl);

await renderOnce(frameA + '\n' + [
  "var B = MK.frame({box:[40,10,620,200], x:[-3,3], y:[-1.2,1.2], axes:true});",
  "document.getElementById('fig').appendChild(B.svg);",
  "B.plot(function(x){return Math.cos(x);}, {color:'teal'});"
].join('\n'));
const multi = pngInfo((await exportOnce(2)).dataUrl);

t('两张图竖着拼进同一张 PNG（高度≈单图两倍）', () => {
  if (!(multi.h > one.h * 1.6)) {
    throw new Error('单图高 ' + one.h + '，两图高 ' + multi.h);
  }
});

await browser.close();
server.close();
console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
