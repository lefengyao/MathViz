/* Enter 发送真实消息，抓用户气泡 + AI 回复 + 代码块真实样式 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PORT = 9337;
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
    ws.onerror = reject; setTimeout(() => reject(new Error('ws')), 8000);
  });
}

let pid = adb(['shell', 'pidof', APP]);
if (!pid) { adb(['shell', 'am', 'start', '-n', APP + '/.MainActivity']); await sleep(6000); pid = adb(['shell', 'pidof', APP]); }
adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const c = await cdp(target.webSocketDebuggerUrl);
await c.send('Runtime.enable'); await c.send('Page.enable');

// 输入 + Enter
await c.send('Runtime.evaluate', {
  expression: `(() => {
    var ta = document.querySelector('textarea');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '用一句话介绍你自己');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`
});
await sleep(500);
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(10000);

const r = await c.send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const pick = (el, props) => {
      if (!el) return null;
      const cs = getComputedStyle(el); const o = {}; props.forEach(p => o[p] = cs[p]);
      const r = el.getBoundingClientRect(); o._rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',');
      o._cls = (el.className || '').toString().slice(0, 60);
      return o;
    };
    const P = ['backgroundColor','color','borderRadius','fontSize','padding','boxShadow','maxWidth','lineHeight','fontFamily'];
    var userText = Array.from(document.querySelectorAll('div,p,span')).find(e => /用一句话介绍你自己/.test(e.textContent || '') && e.children.length === 0);
    var bubble = null;
    for (var up = userText; up && up !== document.body; up = up.parentElement) {
      var bg = getComputedStyle(up).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)') { bubble = up; break; }
    }
    var md = document.querySelector('[class*="markdown"]');
    var aiText = md ? pick(md.querySelector('p') || md, P) : null;
    return JSON.stringify({ userText: pick(userText, P), userBubble: pick(bubble, P), aiText, md: pick(md, P) });
  })()`
});
console.log(r.result.result.value);
const shot = await c.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('real-deepseek2.png', Buffer.from(shot.result.data, 'base64'));
console.log('shot ok');
c.close();
