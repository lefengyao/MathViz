/* 在真实 DeepSeek 页面发一条消息，抓取用户气泡 / AI 回复 / 代码块的真实样式 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PORT = 9336;
const APP = 'com.mathviz.app';
function adb(args) { return execFileSync('C:/platform-tools/adb.exe', args, { encoding: 'utf8', timeout: 20000 }).trim(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
      }, close() { ws.close(); }
    });
    ws.onerror = reject; setTimeout(() => reject(new Error('ws 连不上')), 8000);
  });
}

let pid = adb(['shell', 'pidof', APP]);
if (!pid) { adb(['shell', 'am', 'start', '-n', APP + '/.MainActivity']); await sleep(6000); pid = adb(['shell', 'pidof', APP]); }
adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const c = await cdp(target.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');

// 1. 输入消息（React 受控组件用原生 setter）
await c.send('Runtime.evaluate', {
  expression: `(() => {
    var ta = document.querySelector('textarea');
    if (!ta) return 'no textarea';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '用一句话介绍你自己');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`,
  returnByValue: true
});
await sleep(800);

// 2. 点发送（找发送按钮：textarea 容器里最后一个可点击 div/button）
const sendR = await c.send('Runtime.evaluate', {
  expression: `(() => {
    var ta = document.querySelector('textarea');
    var root = ta.closest('div[class]');
    for (var up = ta; up && up !== document.body; up = up.parentElement) {
      var btns = up.querySelectorAll('div[role="button"], button');
      for (var b of btns) { if (b.offsetWidth > 0) { b.click(); return 'clicked ' + b.tagName; } }
    }
    return 'no btn';
  })()`,
  returnByValue: true
});
console.log('send:', sendR.result.result.value);
await sleep(9000); // 等回复开始

// 3. 抓真实样式
const r = await c.send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const pick = (el, props) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const o = {}; props.forEach(p => o[p] = cs[p]);
      const r = el.getBoundingClientRect();
      o._rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      o._cls = (el.className || '').toString().slice(0, 80);
      return o;
    };
    const P = ['backgroundColor','color','borderRadius','fontSize','padding','boxShadow','maxWidth','lineHeight'];
    // 用户气泡：包含刚才文本的元素及其带背景色的祖先
    var userText = Array.from(document.querySelectorAll('div,p,span')).find(e => /用一句话介绍你自己/.test(e.textContent) && e.children.length === 0);
    var bubble = null;
    for (var up = userText; up && up !== document.body; up = up.parentElement) {
      var bg = getComputedStyle(up).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)') { bubble = up; break; }
    }
    // markdown 容器 / 代码块
    var md = document.querySelector('.ds-markdown');
    var codeBlock = document.querySelector('.ds-markdown pre, .ds-markdown code');
    var sidebar = Array.from(document.querySelectorAll('div')).find(d => d.offsetWidth > 0 && d.getBoundingClientRect().left === 0 && d.getBoundingClientRect().height > 300 && getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)');
    return JSON.stringify({
      userText: pick(userText, P),
      userBubble: pick(bubble, P),
      md: pick(md, P),
      code: pick(codeBlock, P),
      sidebar: pick(sidebar, ['backgroundColor']),
    });
  })()`
});
console.log(r.result.result.value);

// 4. 全页截图（真实布局参考）
const shot = await c.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('real-deepseek.png', Buffer.from(shot.result.data, 'base64'));
console.log('screenshot -> real-deepseek.png');
c.close();
