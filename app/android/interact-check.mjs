/* 真机交互验证（v2）：沙箱 iframe 是 opaque origin 且不暴露独立 CDP target，
   无法从外部驱动。改为把 MK 运行时注入主页面（CDP eval 不受 CSP 限制），
   在真实 WebView 83 里验证拖拽旋转与点面高亮/信息栏——这正是交互层的平台风险点。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PID = (await run('adb shell pidof com.mathviz.app')).trim().replace(/\r/g, '');
if (!PID) { console.log('App 未运行'); process.exit(1); }
await run('adb forward tcp:9223 localabstract:webview_devtools_remote_' + PID);

const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('ws timeout')), 8000); });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const evalJS = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};

function run(cmd) {
  return new Promise((res) => {
    import('child_process').then(({ exec }) => exec(cmd, { timeout: 15000 }, (err, stdout) => res(err ? '' : stdout)));
  });
}

/* 1. 注入运行时（三段 assets） */
const src = ['mk-core.js', 'mk-3d.js', 'mk-graph.js']
  .map((f) => fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'))
  .join('\n;\n');
const boot = await evalJS(src + '\n;typeof MK');
console.log('运行时注入 → MK =', JSON.stringify(boot));

/* 2. 建测试场景：面带 info、球带 info */
await evalJS(`
  document.getElementById('mv-ia-host')?.remove();
  var host = document.querySelector('.ds-markdown') || document.body;
  var wrap = document.createElement('div');
  wrap.id = 'mv-ia-host';
  wrap.innerHTML = '<div id="mv-ia-fig"></div>';
  host.appendChild(wrap);
  (function(){
    var S = MK.space({box:[40,26,600,340], range:2.8, title:'交互测试'});
    document.getElementById('mv-ia-fig').appendChild(S.svg);
    S.box([0,0,0],[1.2,1.2,1.2],{color:'blue', opacity:0.12,
      faceInfo:['底面 z=0','顶面 z=1.2','前面 y=0','后面 y=1.2','左面 x=0','右面 x=1.2']});
    S.sphere([2.2,0,0.6],0.5,{color:'coral', info:'单位球（点我）'});
    window.__S = S;
  })();
  true
`);

/* 3. 拖拽旋转 → path d 应变化、图元数不变 */
const drag = await evalJS(`(() => {
  const svg = document.querySelector('#mv-ia-fig svg');
  const sr = svg.getBoundingClientRect();
  const cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2;
  const d0 = svg.querySelector('path').getAttribute('d');
  const n0 = svg.querySelectorAll('*').length;
  const PE = (t, x, y) => svg.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
  PE('pointerdown', cx, cy); PE('pointermove', cx + 30, cy + 10); PE('pointermove', cx + 60, cy + 20); PE('pointerup', cx + 60, cy + 20);
  const d1 = svg.querySelector('path').getAttribute('d');
  const n1 = svg.querySelectorAll('*').length;
  return { rotated: d0 !== d1, stable: n0 === n1, n0: n0, n1: n1 };
})()`);
console.log('拖拽旋转 →', JSON.stringify(drag));

/* 4. 点面 → 高亮 + 信息栏 + onPick */
const pick = await evalJS(`(() => {
  window.__picked = 'unset';
  window.__S.onPick(function(info){ window.__picked = info; });
  const svg = document.querySelector('#mv-ia-fig svg');
  const face = [].slice.call(svg.querySelectorAll('path')).find((p) => p.__mvPick);
  if (!face) return { err: '无可拾取面' };
  const fr = face.getBoundingClientRect();
  const x = fr.left + fr.width / 2, y = fr.top + fr.height / 2;
  const op0 = face.getAttribute('fill-opacity');
  face.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
  face.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
  const texts = [].slice.call(svg.querySelectorAll('text')).map((t) => t.textContent).join('|');
  const faceAfter = [].slice.call(svg.querySelectorAll('path')).find((p) => p.__mvPick);
  return {
    infoShown: texts.indexOf(String(window.__picked)) >= 0 && window.__picked !== 'unset',
    texts: texts.slice(0, 120),
    opacityChanged: faceAfter.getAttribute('fill-opacity') !== op0,
    onPick: window.__picked
  };
})()`);
console.log('点面 →', JSON.stringify(pick, null, 2));

/* 5. 双击复位 */
const reset = await evalJS(`(() => {
  const svg = document.querySelector('#mv-ia-fig svg');
  svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return { ok: true };
})()`);
console.log('双击复位 →', JSON.stringify(reset));

/* 6. 清理 + 截图 */
await evalJS(`document.getElementById('mv-ia-host').remove(); true`);
await call('Page.enable');
const shot = await call('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(ROOT, 'android', 'screenshot.png'), Buffer.from(shot.result.data, 'base64'));
console.log('截图已存 android/screenshot.png');
ws.close();
