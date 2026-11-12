/* 渲染压力基准（手动跑，不进 CI）：一页放 N 张图时，到底重不重。
     node test/perf.mjs            # 桌面视口
     node test/perf.mjs --mobile   # 手机视口 393×852 + CPU 降速 5 倍（近似中端手机）
     node test/perf.mjs --n=40     # 指定最大数量

   直接内嵌 dist 里的 viewer.html，跳过扩展与 DeepSeek 页面：
   测的就是「图本身」的成本，不受站点自身 DOM 干扰。
   输出里三个数最值得看：
     渲染ms      每张图的 new Function + 建 SVG 的耗时（首屏卡不卡看它）
     整页光栅ms  合成一帧（含所有可见图）的耗时（滚不滚得动看它）
     CPU/帧ms    滚动 120 帧时主线程平均耗时（超过 ~8ms 就会掉帧） */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'extension');
const CHROME = 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';

const argv = process.argv.slice(2);
const MOBILE = argv.includes('--mobile');
const MAXN = Number((argv.find((a) => a.startsWith('--n=')) || '').split('=')[1]) || 20;

/* viewer.html 是 chrome-extension:// 里跑的，用本地 http 起同形环境（file:// 下 sandbox 不可靠） */
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const VIEWER = 'http://127.0.0.1:' + server.address().port + '/viewer.html?';

const TWO_D = `var V = MK.frame({box:[40,26,600,320], x:[-4,4], y:[-3,5], grid:true, axes:true, title:'TITLE'});
document.getElementById('fig').appendChild(V.svg);
V.plot(function(x){ return x*x-2; }, {color:'blue', w:2.2});
V.plot(function(x){ return Math.sin(x)*2; }, {color:'coral', w:2});
V.dot([0,-2], {color:'coral'});`;

const THREE_D = `var S = MK.space({box:[40,26,600,340], yaw:30, pitch:20, range:3, title:'TITLE'});
document.getElementById('fig').appendChild(S.svg);
S.box([0,0,0], [2,2,2], {color:'blue', alpha:0.15});
S.axes(2);`;

const GRAPH = `var G = MK.graph({box:[40,26,600,320], nodes:[{id:'A',x:0,y:0},{id:'B',x:1,y:1},{id:'C',x:2,y:0},{id:'D',x:1,y:-1}], edges:[['A','B'],['B','C'],['C','D'],['D','A']], title:'TITLE'});
document.getElementById('fig').appendChild(G.svg);
G.draw();`;

const ENG = `var E = MK.eng({box:[40,26,600,380], ext:[140,96], title:'TITLE'});
document.getElementById('fig').appendChild(E.svg);
E.rect([20,20], 100, 56, {});
E.circle([70,48], 18, {});`;

const KINDS = [TWO_D, THREE_D, GRAPH, ENG];

function pageHtml(n) {
  let cards = '';
  for (let i = 0; i < n; i++) {
    cards += `<div class="card"><div class="head">图 ${i + 1}</div>
<iframe sandbox="allow-scripts" src="${VIEWER}theme=light&id=mv${i}"
 style="width:100%;height:360px;border:0;display:block"></iframe></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;background:#fff;font:15px system-ui}
 .wrap{max-width:760px;margin:0 auto;padding:0 16px 120px}
 .card{border:1px solid #e6e4de;border-radius:12px;margin:16px 0;overflow:hidden}
 .head{padding:8px 12px;font:12px ui-monospace;color:#666;border-bottom:1px solid #eee}
</style></head><body><div class="wrap">${cards}</div></body></html>`;
}

const CODES = (n) => Array.from({ length: n }, (_, i) => KINDS[i % 4].replace('TITLE', '#' + (i + 1)));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-perf-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROME, headless: true,
  viewport: MOBILE ? { width: 393, height: 852, deviceScaleFactor: 2.5 } : { width: 1280, height: 900 },
  args: ['--no-first-run', '--disable-features=Translate']
});

async function measure(n) {
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  if (MOBILE) await client.send('Emulation.setCPUThrottlingRate', { rate: 5 });
  await page.setContent(pageHtml(n), { waitUntil: 'load' });

  /* 逐帧喂渲染指令 —— 和 content script 的做法一致 */
  const t0 = Date.now();
  const results = await page.evaluate((codes) => {
    const frames = [].slice.call(document.querySelectorAll('iframe'));
    return Promise.all(frames.map((f, i) => new Promise((res) => {
      const id = 'mv' + i;
      function on(e) {
        if (!e.data || e.data.id !== id) return;
        if (e.data.type === 'mv:done') { window.removeEventListener('message', on); res(1); }
        if (e.data.type === 'mv:error') { window.removeEventListener('message', on); window.__mvErr = (window.__mvErr || []).concat(id + ':' + e.data.message); res(2); }
      }
      window.addEventListener('message', on);
      setTimeout(() => f.contentWindow.postMessage({ __mv: true, type: 'mv:render', id, code: codes[i], kind: 'auto' }, '*'), 60);
      setTimeout(() => { window.removeEventListener('message', on); res(0); }, 20000);
    })));
  }, CODES(n));
  const renderMs = Date.now() - t0;
  const ok = results.filter((x) => x === 1).length;
  await page.waitForTimeout(600);

  let nodes = 0, svgNodes = 0;
  for (const f of page.frames().filter((x) => /viewer\.html/.test(x.url()))) {
    try {
      const r = await f.evaluate(() => {
        let inner = 0;
        document.querySelectorAll('svg').forEach((s) => { inner += s.querySelectorAll('*').length; });
        return { all: document.querySelectorAll('*').length, svg: inner };
      });
      nodes += r.all; svgNodes += r.svg;
    } catch (e) {}
  }

  /* captureScreenshot 必须把整页光栅化，能反映绘制成本 */
  const shots = [];
  for (let i = 0; i < 3; i++) {
    const t1 = Date.now();
    await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    shots.push(Date.now() - t1);
  }
  const shotMs = Math.round(shots.reduce((a, b) => a + b, 0) / 3);

  const m = await client.send('Performance.getMetrics');
  const get = (k) => (m.metrics.find((x) => x.name === k) || {}).value;
  const heap = Math.round(get('JSHeapUsedSize') / 1048576 * 10) / 10;
  const task0 = get('TaskDuration');

  await page.evaluate(() => new Promise((res) => {
    let i = 0;
    function step() { window.scrollBy(0, 26); if (++i < 120) requestAnimationFrame(step); else res(); }
    requestAnimationFrame(step);
  }));
  const m2 = await client.send('Performance.getMetrics');
  const get2 = (k) => (m2.metrics.find((x) => x.name === k) || {}).value;
  const cpuPerFrame = Math.round((get2('TaskDuration') - task0) / 120 * 1000 * 100) / 100;

  await page.close();
  return {
    n, ok, nodes, svgNodes, heap, renderMs,
    perFigure: Math.round(renderMs / Math.max(1, n)), shotMs, cpuPerFrame, rss: chromeRss()
  };
}

function chromeRss() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH', { encoding: 'utf8' });
    let kb = 0;
    out.split(/\r?\n/).forEach((l) => {
      const c = l.split('","');
      if (c.length > 4) kb += parseInt(c[4].replace(/[^\d]/g, ''), 10) || 0;
    });
    return Math.round(kb / 1024) + 'MB';
  } catch (e) { return '?'; }
}

console.log((MOBILE ? '手机视口 393×852 / CPU×5 降速' : '桌面视口 1280×900') + '\n');
console.log('图数\t成功\tSVG节点\t内存MB\t渲染总ms\t每张ms\t整页光栅ms\tCPU/帧ms\tchromeRSS');
for (let i = 1; i <= MAXN; i = i < 5 ? i + 1 : i * 2) {
  const r = await measure(i);
  console.log([r.n, r.ok, r.svgNodes, r.heap, r.renderMs, r.perFigure, r.shotMs, r.cpuPerFrame, r.rss].join('\t'));
  if (i >= MAXN) break;
}
await context.close();
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
