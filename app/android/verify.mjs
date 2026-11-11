/* 真机端到端验证：确认注入、平台层、提示词插入、沙箱渲染整条链路。
   只在页面里临时插 DOM 做测试，不发送消息、不写服务端数据，跑完把临时节点删掉。

     node verify.mjs
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = 'com.mathviz.app';
const PORT = 9223;
const adb = (a) => execFileSync('adb', a, { encoding: 'utf8', timeout: 20000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

let pid = adb(['shell', 'pidof', APP]);
if (!pid) {
  adb(['shell', 'am', 'start', '-n', APP + '/.MainActivity']);
  await sleep(5000);
  pid = adb(['shell', 'pidof', APP]);
}
if (!pid) throw new Error('App 没在运行：' + APP);
adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有 page target；确认 App 已加载页面');
const c = await cdp(page.webSocketDebuggerUrl);

async function evalJS(expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (!r.result || r.result.exceptionDetails) {
    throw new Error('页面脚本异常: ' + JSON.stringify(r.result && r.result.exceptionDetails).slice(0, 400));
  }
  return r.result.result.value;
}

const out = { app: APP, pid, at: new Date().toISOString(), checks: {} };

out.checks.runtime = await evalJS(`({
  url: location.href,
  ready: document.readyState,
  injected: !!window.__mvLoaded,
  platform: typeof window.MVPlatform,
  bridge: typeof window.MathVizBridge,
  prompt: typeof window.MVPrompt,
  detect: typeof window.MVDetect,
  css: typeof window.MVCss,
  toolbar: !!document.querySelector('#mv-ext-root'),
  width: innerWidth,
  narrow: matchMedia('(max-width: 480px)').matches,
  hostClass: (document.querySelector('#mv-ext-root') || {}).className || '',
  hostPos: (() => { const h = document.querySelector('#mv-ext-root');
    return h ? { top: getComputedStyle(h).top, left: getComputedStyle(h).left,
      bottom: getComputedStyle(h).bottom, right: getComputedStyle(h).right } : null; })(),
  chromeCalls: (typeof window.MVPlatform.viewerUrl === 'function')
})`);

/* 临时输入框：验证「插入提示词」确实写进了 textarea（React 受控 setter 路径） */
await evalJS(`(() => {
  const old = document.getElementById('mv-test-input');
  if (old) old.remove();
  const t = document.createElement('textarea');
  t.id = 'mv-test-input';
  t.style.cssText = 'position:fixed;left:10px;top:10px;width:320px;height:70px;z-index:99999';
  t.value = '画一条抛物线';
  document.body.appendChild(t);
  return true;
})()`);
out.checks.prompt = await evalJS(`(() => {
  const sh = document.querySelector('#mv-ext-root').shadowRoot;
  sh.querySelector('[data-a="reset"]').click();
  sh.querySelector('[data-a="insert"]').click();
  const v = document.getElementById('mv-test-input').value;
  return { hasMark: v.indexOf('\\u3010MathViz \\u4f5c\\u56fe\\u6a21\\u5f0f\\u3011') >= 0,
    keepsQuestion: v.indexOf('画一条抛物线') >= 0, length: v.length };
})()`);

/* 临时代码块：走完识别 → platform.viewerUrl → shouldInterceptRequest → 沙箱渲染 */
await evalJS(`(() => {
  const old = document.getElementById('mv-test-block');
  if (old) old.remove();
  const d = document.createElement('div');
  d.id = 'mv-test-block';
  d.className = 'md-code-block md-code-block-light';
  d.innerHTML = '<pre><code class="language-mathviz"></code></pre>';
  d.querySelector('code').textContent =
    'var V = MK.frame({x:[-2,2],y:[-2,2],grid:true,axes:true});\\n'
    + 'document.getElementById("fig").appendChild(V.svg);';
  const mount = document.querySelector('.ds-markdown') || document.body;
  mount.appendChild(d);
  return mount.className || 'BODY';
})()`);
await sleep(3500);
out.checks.render = await evalJS(`(() => {
  const pre = document.querySelector('#mv-test-block pre');
  const host = pre && pre.querySelector('.mv-card-host[data-inline]');
  const sh = host && host.shadowRoot;
  const iframe = sh && sh.querySelector('iframe');
  return {
    inlineHost: !!host,
    state: sh ? sh.querySelector('.mv-state').textContent : '',
    src: iframe ? iframe.getAttribute('src') : '',
    sandbox: iframe ? iframe.getAttribute('sandbox') : ''
  };
})()`);

/* 留一张真机截图，肉眼确认工具条与图都在 */
await c.send('Page.enable');
const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (shot.result && shot.result.data) {
  fs.writeFileSync(path.join(ROOT, 'screenshot.png'), Buffer.from(shot.result.data, 'base64'));
}

/* 清理临时节点，页面本身恢复原样 */
await evalJS(`(() => {
  ['mv-test-input','mv-test-block'].forEach((id) => {
    const e = document.getElementById(id); if (e) e.remove();
  });
  return true;
})()`);
c.close();

fs.writeFileSync(path.join(ROOT, 'verify-report.json'), JSON.stringify(out, null, 2) + '\n');
const r = out.checks.runtime, p = out.checks.prompt, v = out.checks.render;
const ok = (b) => b ? '✓' : '✗';
console.log('App      :', APP, 'pid', pid, '|', r.url);
console.log(ok(r.injected), 'content.js 已注入');
console.log(ok(r.platform === 'object' && r.bridge === 'object'), 'platform 层 + Java bridge 就位');
console.log(ok(r.prompt === 'object' && r.detect === 'object' && r.css === 'string'), '业务模块齐全');
console.log(ok(r.toolbar), '工具条已创建');
console.log('   视口 ' + r.width + 'px | 窄屏媒体查询 ' + r.narrow + ' | host class ' + JSON.stringify(r.hostClass)
  + ' | 位置 ' + JSON.stringify(r.hostPos));
console.log(ok(p.hasMark && p.keepsQuestion), '提示词插入成功（保留原问题，' + p.length + ' 字）');
console.log(ok(v.inlineHost), '代码块内生成渲染宿主');
console.log(ok(v.state.indexOf('已渲染') >= 0), '沙箱渲染完成，状态：' + v.state);
console.log(ok(v.src.indexOf('https://mathviz.local/viewer.html') === 0), 'viewer 走本地虚拟域名：' + v.src.slice(0, 70));
console.log(ok(v.sandbox === 'allow-scripts'), 'iframe sandbox：' + v.sandbox);
console.log('\n报告：verify-report.json（临时 DOM 已清理）');

const failed = !r.injected || !r.toolbar || !p.hasMark || !v.inlineHost ||
  v.state.indexOf('已渲染') < 0 || v.src.indexOf('https://mathviz.local/viewer.html') !== 0;
if (failed) process.exit(1);
