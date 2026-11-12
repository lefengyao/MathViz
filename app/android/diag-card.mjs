/* 临时诊断：在真实 App 的 WebView 里注入一个 mathviz 代码块，
   量出卡片 → iframe → svg 的实际几何，判断「图被挤到左下角」出在哪一层。
   用法: node android/diag-card.mjs [截图输出路径] */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9333;
const APP = 'com.mathviz.app';
const SHOT = process.argv[2] || path.join(ROOT, 'diag.png');

function adb(args) {
  return execFileSync('adb', args, { encoding: 'utf8', timeout: 20000 }).trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, res);
          ws.send(JSON.stringify({ id, method, params: params || {} }));
          setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 20000);
        });
      },
      events,
      close() { ws.close(); }
    });
    ws.onerror = reject;
    setTimeout(() => reject(new Error('WebSocket 连不上')), 8000);
  });
}

const CODE = [
  "var E = MK.eng({box:[40,26,600,390], ext:[280,192], title:'法兰盘主视图'});",
  "document.getElementById('fig').appendChild(E.svg);",
  "var out = [[20,20],[120,20],[120,76],[20,76]];",
  "E.poly(out, {close:true});",
  "E.circle([70,48], 14);",
  "[[32,32],[108,32],[32,64],[108,64]].forEach(function(c){ E.circle(c,5); E.centerMark(c,{r:8}); });",
  "E.circle([70,48], 20.5);",
  "E.dimX([20,20],[120,20], {offset:10});",
  "E.dimY([20,20],[20,76], {offset:14});",
  "E.viewLabel(70, 2, '主视图');"
].join('\n');

adb(['shell', 'am', 'force-stop', APP]);
adb(['shell', 'am', 'start', '-n', APP + '/.MainActivity']);
await sleep(6000);
const pid = adb(['shell', 'pidof', APP]);
if (!pid) throw new Error('App 没起来');
adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
if (!target) throw new Error('没有 page target');
const c = await cdp(target.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');

const pageInfo = await c.send('Runtime.evaluate', {
  expression: `JSON.stringify({url: location.href, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
    hasRoot: !!document.querySelector('#mv-ext-root'), pre: document.querySelectorAll('pre').length})`,
  returnByValue: true
});
console.log('page:', pageInfo.result.result.value);

/* 注入一个代 code 块，让内容脚本自己去渲染 */
const inject = await c.send('Runtime.evaluate', {
  expression: `(() => {
    var pre = document.createElement('pre');
    var code = document.createElement('code');
    code.className = 'language-mathviz';
    code.textContent = ${JSON.stringify(CODE)};
    pre.appendChild(code);
    document.body.appendChild(pre);
    return 'ok';
  })()`,
  returnByValue: true
});
console.log('inject:', inject.result.result.value);
await sleep(4000);

const measure = await c.send('Runtime.evaluate', {
  expression: `(() => {
    var h = document.querySelector('.mv-card-host');
    if (!h) return JSON.stringify({err: 'no card'});
    var sr = h.shadowRoot;
    var ifr = sr.querySelector('.mv-body iframe');
    var r = ifr ? ifr.getBoundingClientRect() : null;
    return JSON.stringify({
      vw: innerWidth, dpr: devicePixelRatio,
      hostW: Math.round(h.getBoundingClientRect().width),
      iframe: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
      iframeStyleH: ifr && ifr.style.height,
      state: sr.querySelector('.mv-state') && sr.querySelector('.mv-state').textContent
    });
  })()`,
  returnByValue: true
});
console.log('card:', measure.result.result.value);

const tree = await c.send('Page.getFrameTree');
const frames = [];
(function walk(n) { frames.push(n.frame); (n.childFrames || []).forEach(walk); })(tree.result.frameTree);
console.log('frames:', frames.map((f) => f.url.slice(0, 70)).join(' | '));

for (const f of frames) {
  if (!/viewer\.html/.test(f.url)) continue;
  const w = await c.send('Page.createIsolatedWorld', { frameId: f.id, worldName: 'diag' });
  const ctx = w.result.executionContextId;
  const m = await c.send('Runtime.evaluate', {
    contextId: ctx,
    returnByValue: true,
    expression: `(() => {
      var svg = document.querySelector('#fig svg');
      if (!svg) return 'no svg';
      var r = svg.getBoundingClientRect();
      var cs = getComputedStyle(svg);
      return JSON.stringify({
        innerW: innerWidth, innerH: innerHeight,
        bodyH: Math.round(document.body.getBoundingClientRect().height),
        svg: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        vb: svg.getAttribute('viewBox'), wAttr: svg.getAttribute('width'), hAttr: svg.getAttribute('height'),
        cssW: cs.width, cssH: cs.height, transform: cs.transform, origin: cs.transformOrigin,
        zoomStyle: document.documentElement.style.zoom || '(none)'
      });
    })()`
  });
  console.log('frame#', f.id.slice(0, 8), m.result.result.value);
}

const shot = await c.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
console.log('screenshot ->', SHOT);
c.close();
