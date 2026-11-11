/* 真机渲染失败诊断：把页面里的卡片状态、错误文字、代码块原始结构一次性捞出来。
   只读，不改页面。 node diagnose.mjs */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = 'com.mathviz.app';
const PORT = 9224;
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

const EXPR = `(() => {
  const cards = [...document.querySelectorAll('.mv-card-host')].map((h) => {
    const sh = h.shadowRoot;
    const q = (s) => sh.querySelector(s);
    return {
      inline: h.hasAttribute('data-inline'),
      state: q('.mv-state') ? q('.mv-state').textContent : '',
      srcShown: q('.mv-src') ? !q('.mv-src').hasAttribute('hidden') : false,
      srcText: q('.mv-src') ? q('.mv-src').textContent.slice(0, 1200) : '',
      iframeSrc: q('iframe') ? q('iframe').getAttribute('src') : '',
      iframeHeight: q('iframe') ? q('iframe').style.height : ''
    };
  });
  const pres = [...document.querySelectorAll('pre')].map((p) => ({
    cls: String(p.className || ''),
    parentCls: String((p.parentElement && p.parentElement.className) || '').slice(0, 150),
    parentText: String((p.parentElement && p.parentElement.textContent) || '').slice(0, 100),
    len: (p.textContent || '').length,
    head: (p.textContent || '').slice(0, 320),
    tail: (p.textContent || '').slice(-260),
    full: p.textContent || '',
    hasCard: !!p.querySelector('.mv-card-host'),
    childTags: [...p.children].map((c) => c.tagName + '.' + String(c.className || '').slice(0, 40)).slice(0, 4)
  }));
  const fences = [...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && (e.textContent || '').indexOf('\\u0060\\u0060\\u0060mathviz') >= 0)
    .slice(0, 5)
    .map((e) => ({ tag: e.tagName, text: (e.textContent || '').slice(0, 220) }));
  return {
    url: location.href, title: document.title, ready: document.readyState,
    injected: !!window.__mvLoaded, platform: typeof window.MVPlatform,
    bridge: typeof window.MathVizBridge,
    toolbar: !!document.querySelector('#mv-ext-root'),
    hostClass: (document.querySelector('#mv-ext-root') || {}).className || '',
    width: innerWidth,
    cards, pres, fences,
    bodyHead: (document.body.innerText || '').slice(0, 260)
  };
})()`;

let pid = adb(['shell', 'pidof', APP]);
if (!pid) {
  adb(['shell', 'am', 'start', '-n', APP + '/.MainActivity']);
  await sleep(5000);
  pid = adb(['shell', 'pidof', APP]);
}
if (!pid) throw new Error('App 没在运行');
adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有 page target');
const c = await cdp(page.webSocketDebuggerUrl);
const r = await c.send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
c.close();
if (!r.result || !r.result.result || !r.result.result.value) throw new Error('evaluate 失败');
const d = r.result.result.value;

const meta = {
  app: APP, pid,
  lastUpdate: adb(['shell', 'dumpsys package ' + APP + ' | grep lastUpdateTime']).trim(),
  at: new Date().toISOString()
};
fs.writeFileSync(path.join(ROOT, 'diagnose-report.json'), JSON.stringify({ meta, ...d }, null, 2) + '\n');

console.log('App       :', APP, 'pid', pid);
console.log('lastUpdate:', meta.lastUpdate);
console.log('URL       :', d.url);
console.log('注入      :', d.injected, '| platform', d.platform, '| bridge', d.bridge,
  '| 工具条', d.toolbar, '| host class', JSON.stringify(d.hostClass), '| 视口', d.width);
console.log('正文开头  :', JSON.stringify(d.bodyHead.slice(0, 160)));
console.log('\n=== 卡片 (' + d.cards.length + ') ===');
d.cards.forEach((c, i) => {
  console.log('[' + i + ']', c.state, '| inline', c.inline, '| 高度', c.iframeHeight, '| src', c.iframeSrc.slice(0, 90));
  if (c.state.indexOf('失败') >= 0 || c.srcShown) console.log('    源码/错误:', JSON.stringify(c.srcText.slice(0, 700)));
});
console.log('\n=== pre (' + d.pres.length + ') ===');
d.pres.forEach((p, i) => console.log('[' + i + ']', 'len=' + p.len, 'cls=' + JSON.stringify(p.cls),
  'parent=' + JSON.stringify(p.parentCls), 'hasCard=' + p.hasCard,
  '\n     头:', JSON.stringify(p.head.slice(0, 150)),
  '\n     尾:', JSON.stringify(p.tail.slice(-160))));
console.log('\n=== 失败卡片：当时代码 vs 当前 pre ===');
d.cards.forEach((c, i) => {
  if (c.state.indexOf('失败') < 0) return;
  const now = d.pres[i] ? d.pres[i].tail : '(无对应 pre)';
  const then = c.srcText.split('---- 原始代码 ----')[1] || '';
  console.log('[' + i + ']', c.state);
  console.log('   当时末尾:', JSON.stringify(then.trim().slice(-150)));
  console.log('   当前末尾:', JSON.stringify(now.slice(-150)));
  console.log('   是否一致:', then.trim() === (d.pres[i] ? d.pres[i].full.trim() : ''));
});
console.log('\n=== 裸 fence 文本 (' + d.fences.length + ') ===');
d.fences.forEach((f, i) => console.log('[' + i + ']', f.tag, JSON.stringify(f.text.slice(0, 160))));
console.log('\n报告：diagnose-report.json');
