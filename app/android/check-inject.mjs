/* 检查真机页面注入标志与卡片状态（原生 CDP） */
import { createRequire } from 'module';
const require2 = createRequire(import.meta.url);
const http = require2('http');

const PORT = process.argv[2] || '9333';

function jsonGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const list = await jsonGet('/json/list');
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
function send(method, params) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pend.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const { resolve, reject } = pend.get(m.id);
    pend.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));

const expr = 'JSON.stringify({' +
  'mvPlatform: typeof window.MVPlatform,' +
  'mvExtRoot: !!document.querySelector(".mv-ext-root"),' +
  'mvCards: document.querySelectorAll(".mv-card").length,' +
  'mvMarks: document.querySelectorAll("[class^=mv-]").length,' +
  'title: document.title,' +
  'readyState: document.readyState' +
  '})';

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(r.result.value);
ws.close();
process.exit(0);
