/* 全屏（edge-to-edge）适配验证：确认 WebView 的**视口**真的被系统栏让出了空间。

   为什么不能只看截图：MuMu 这类模拟器的虚拟屏没有状态栏，截图上永远看不出被压住。
   所以用 adb 的 wm size / wm density 算出「扣掉系统栏之后应该剩多少 CSS 像素」，
   再从页面里读 window.innerHeight 对账。debug 包支持用 Intent 参数伪造系统栏高度。

     node insets-check.mjs                # 用真实 insets（模拟器上一般是 0）
     node insets-check.mjs --top 72 --bottom 96
*/
import { execFileSync } from 'node:child_process';

const APP = 'com.mathviz.app';
const PORT = 9224;

/* 机器上同时挂着 127.0.0.1:16384 与 emulator-5554 时，adb 不带 -s 会报
   "more than one device"，所以自己挑一个（可用 ANDROID_SERIAL 指定）。 */
if (process.env.ADB_CONNECT) {
  try { execFileSync('adb', ['connect', process.env.ADB_CONNECT], { encoding: 'utf8' }); } catch (e) {}
}
const serials = execFileSync('adb', ['devices'], { encoding: 'utf8' })
  .split('\n').slice(1)
  .map((l) => l.trim().split(/\s+/))
  .filter((p) => p[1] === 'device')
  .map((p) => p[0]);
const SERIAL = process.env.ANDROID_SERIAL || serials[0];
if (!SERIAL) throw new Error('没有已连接的设备');
const adb = (a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', timeout: 20000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('设备: ' + SERIAL);

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
};
const TOP = arg('top', 0);
const BOTTOM = arg('bottom', 0);

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, res);
          ws.send(JSON.stringify({ id, method, params: params || {} }));
          setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 15000);
        });
      },
      close() { ws.close(); }
    });
    ws.onerror = reject;
    setTimeout(() => reject(new Error('WebSocket 连不上')), 8000);
  });
}

/* ---- 屏幕物理尺寸与密度 ---- */
const size = /(\d+)x(\d+)/.exec(adb(['shell', 'wm', 'size']));
const density = Number(/(\d+)/.exec(adb(['shell', 'wm', 'density']))[1]);
const dpr = density / 160;
const physH = Number(size[2]);

const expectCss = Math.round((physH - TOP - BOTTOM) / dpr);

/* ---- 带参数重启，让 debug 包用伪造的系统栏高度 ---- */
adb(['shell', 'am', 'force-stop', APP]);
const extras = [];
if (TOP) extras.push('--ei', 'mvInsetTop', String(TOP));
if (BOTTOM) extras.push('--ei', 'mvInsetBottom', String(BOTTOM));
adb(['shell', 'am', 'start', '-n', APP + '/.MainActivity', ...extras]);
await sleep(6000);

const pid = adb(['shell', 'pidof', APP]);
if (!pid) throw new Error('App 没起来');
adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有 page target');

const c = await cdp(page.webSocketDebuggerUrl);
const evalJS = async (expression) => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (!r.result || r.result.exceptionDetails) throw new Error('页面脚本异常');
  return r.result.result.value;
};

const m = await evalJS(`(() => {
  function painted(el) {
    while (el && el.nodeType === 1) {
      const c = getComputedStyle(el).backgroundColor;
      const mm = /rgba?\\(([^)]+)\\)/.exec(c || '');
      if (mm) {
        const p = mm[1].split(',');
        const a = p.length >= 4 ? parseFloat(p[3]) : 1;
        if (a > 0.5) return c;
      }
      el = el.parentElement;
    }
    return '';
  }
  return {
    innerHeight, innerWidth,
    docClientH: document.documentElement.clientHeight,
    screenH: screen.height,
    screenW: screen.width,
    dpr: devicePixelRatio,
    bg: painted(document.elementFromPoint(Math.round(innerWidth / 2), 1))
        || painted(document.body),
    bridge: typeof (window.MathVizBridge && window.MathVizBridge.chromeColor)
  };
})()`);
c.close();

/* ---- 对账 ---- */
const rows = [
  ['物理屏高', physH + ' px', ''],
  ['密度', density + ' dpi (dpr ' + dpr + ')', ''],
  ['伪造的系统栏', '上 ' + TOP + ' / 下 ' + BOTTOM + ' px', ''],
  ['期望视口高', expectCss + ' css px', ''],
  ['实测 innerHeight', m.innerHeight + ' css px', ''],
  ['实测 document 高', m.docClientH + ' css px', ''],
  ['页面底色', m.bg || '(空)', ''],
  ['chromeColor 桥', m.bridge, '']
];

let fail = 0;
const check = (ok, msg) => {
  rows.push([(ok ? '✓ ' : '✗ ') + msg, '', '']);
  if (!ok) fail++;
};

check(Math.abs(m.innerHeight - expectCss) <= 2,
  '视口高度 = 屏高 - 系统栏（误差 ≤ 2px）');
check(Math.abs(m.docClientH - m.innerHeight) <= 2,
  'document 高度跟着视口一起缩（不是只做了视觉位移）');
check(m.bridge === 'function', '页面能调 MathVizBridge.chromeColor');
check(!!m.bg, '能取到页面底色（原生据此涂系统栏区域）');

const w = Math.max(...rows.map((r) => [...r[0]].length)) + 2;
for (const r of rows) console.log(r[0].padEnd(w) + r[1] + (r[2] || ''));
console.log('\n' + (fail ? fail + ' 项不通过' : '全部通过'));
process.exit(fail ? 1 : 0);
