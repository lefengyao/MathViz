/* 原生 CDP（不走 playwright）：Runtime.evaluate 扫描 mathviz 卡片，抓第 28 题题面与错误 */
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
if (!page) { console.error('没有 page target'); process.exit(1); }
console.log('页面: ' + page.title + '  ' + page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};

await new Promise((r) => (ws.onopen = r));

const expr = `(function(){
  var NOTO = function(el){ return el ? (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,500) : ''; };
  var out = { cards: [], q28: [], mathvizBlocks: [] };
  var cards = document.querySelectorAll('.mv-card');
  out.totalCards = cards.length;
  cards.forEach(function(c, i){
    var err = c.querySelector('.mv-err');
    var ok = c.querySelector('.mv-ok, .mv-count');
    out.cards.push({ i:i, err: err && err.style.display!=='none' ? NOTO(err) : '', status: NOTO(ok), text: NOTO(c).slice(0,300) });
  });
  /* 抓用户消息里含 28 的文本（题面） */
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var n, hits = 0;
  while ((n = walker.nextNode()) && hits < 8) {
    var t = (n.textContent||'').trim();
    if (t.length > 4 && t.length < 300 && /(^|[^0-9])第?\\s*28\\s*(号|题|、|\\.)/.test(t)) { out.q28.push(t.slice(0,300)); hits++; }
  }
  /* 抓所有模型输出的 mathviz 代码块内容（渲染失败的那块要看代码） */
  document.querySelectorAll('pre code, pre').forEach(function(el){
    var t = el.textContent || '';
    if (t.indexOf('MK.') >= 0 || t.indexOf('getElementById') >= 0) out.mathvizBlocks.push(t.slice(0, 1500));
  });
  return JSON.stringify(out);
})()`;

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
const data = JSON.parse(r.result.value);
console.log('卡片总数: ' + data.totalCards);
data.cards.forEach((c) => {
  console.log('--- 卡片#' + c.i + ' 状态=' + c.status);
  if (c.err) console.log('    错误: ' + c.err);
});
console.log('含28的题面: ' + JSON.stringify(data.q28, null, 2));
console.log('mathviz代码块数: ' + data.mathvizBlocks.length);
data.mathvizBlocks.forEach((b, i) => console.log('--- 代码块#' + i + ' ---\n' + b + '\n'));

ws.close();
process.exit(0);
