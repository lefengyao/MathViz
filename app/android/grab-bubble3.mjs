/* 抓用户气泡样式（第4次，脚本落盘避免引号地狱） */
import { execFileSync } from 'node:child_process';

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  return new Promise((resolve) => { ws.onopen = () => resolve({ send(method, params) { return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); }); } }); });
}

const pid = execFileSync('C:/platform-tools/adb.exe', ['shell', 'pidof', 'com.mathviz.app']).toString().trim();
execFileSync('C:/platform-tools/adb.exe', ['forward', 'tcp:9341', 'localabstract:webview_devtools_remote_' + pid]);
const list = await (await fetch('http://127.0.0.1:9341/json/list')).json();
const c = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await c.send('Runtime.enable');

const JS = `(() => {
  var els = Array.from(document.querySelectorAll('div,p,span')).filter(function(e) {
    return (e.textContent || '').indexOf('用一句话介绍') >= 0 && e.textContent.length < 60;
  });
  var out = [];
  els.forEach(function(e) {
    for (var up = e; up && up !== document.body; up = up.parentElement) {
      var cs = getComputedStyle(up);
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'rgb(255, 255, 255)') {
        var r2 = up.getBoundingClientRect();
        out.push({ bg: cs.backgroundColor, radius: cs.borderRadius, color: cs.color, fs: cs.fontSize, pad: cs.padding, w: Math.round(r2.width), rightGap: Math.round(innerWidth - r2.right), cls: (up.className||'').toString().slice(0,40) });
        break;
      }
    }
  });
  return JSON.stringify(out.slice(0, 4));
})()`;

const r = await c.send('Runtime.evaluate', { returnByValue: true, expression: JS });
console.log(r.result.result.value);
