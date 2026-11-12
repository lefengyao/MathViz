/* 从 MuMu 真机 DeepSeek 页面抓取真实设计 token（计算样式） */
import { execFileSync } from 'node:child_process';

const PORT = 9335;
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

const r = await c.send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const pick = (el, props) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const o = {};
      props.forEach(p => o[p] = cs[p]);
      const r = el.getBoundingClientRect();
      o._rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      return o;
    };
    const P = ['backgroundColor','color','borderRadius','fontSize','fontFamily','padding','boxShadow','border','lineHeight','fontWeight'];
    // 找用户消息气泡 / AI 回复 / 代码块 / 输入框 / 侧栏
    const all = Array.from(document.querySelectorAll('div'));
    const userBubble = all.find(d => d.children.length <= 3 && /帮我|帮我画|你好|画一个/.test(d.textContent || '') && d.textContent.length < 200 && getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(d).backgroundColor !== 'rgb(255, 255, 255)');
    const textarea = document.querySelector('textarea');
    const pre = document.querySelector('pre');
    const body = document.body;
    // 主色：取页面上第一个非黑白的强调色
    let accent = null;
    for (const el of document.querySelectorAll('*')) {
      const c = getComputedStyle(el).backgroundColor;
      const m = c && c.match(/rgba?\\((\\d+), (\\d+), (\\d+)/);
      if (m) { const [R,G,B] = [+m[1],+m[2],+m[3]]; if (Math.abs(R-G)>30 || Math.abs(G-B)>30) { accent = c; break; } }
    }
    return JSON.stringify({
      url: location.href.slice(0, 60),
      body: pick(body, ['backgroundColor','fontFamily','color']),
      userBubble: pick(userBubble, P),
      textarea: pick(textarea, P),
      pre: pick(pre, P),
      accent,
      sampleHTML: userBubble ? userBubble.outerHTML.slice(0, 300) : null,
    });
  })()`
});
console.log(r.result.result.value);
c.close();
