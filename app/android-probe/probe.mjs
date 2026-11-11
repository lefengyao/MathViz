/* 真机 DOM 探针
   用已装到手机的 com.mathviz.probe（一个只加载网页 + 开 CDP 调试的 WebView 空壳），
   通过 adb forward + Chrome DevTools Protocol 只读地观察页面结构。

   不注入脚本、不写 Cookie / localStorage、不修改页面；Page.navigate 只在传了 url 时用。
   报告只存结构信息，不存对话正文。

     node probe.mjs                       # 抓当前页面
     node probe.mjs https://chat.deepseek.com   # 先导航再抓
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9222;
const APP = 'com.mathviz.probe';
const TARGET = process.argv[2] || '';

function adb(args) {
  return execFileSync('adb', args, { encoding: 'utf8', timeout: 20000 }).trim();
}
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
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, id: el.id || '',
      cls: String(typeof el.className === 'string' ? el.className : '').slice(0, 140),
      ph: el.getAttribute('placeholder') || '',
      ce: el.getAttribute('contenteditable') || '',
      size: [Math.round(r.width), Math.round(r.height)] };
  };
  const codes = [...document.querySelectorAll('code')].slice(0, 10).map((el) => ({
    cls: String(el.className || '').slice(0, 140),
    parentTag: el.parentElement ? el.parentElement.tagName : '',
    len: (el.textContent || '').length,
    head: (el.textContent || '').slice(0, 70)
  }));
  const pres = [...document.querySelectorAll('pre')].slice(0, 10).map((el) => ({
    cls: String(el.className || '').slice(0, 140),
    lang: el.getAttribute('data-language') || '',
    len: (el.textContent || '').length,
    head: (el.textContent || '').slice(0, 70)
  }));
  const boxes = [...document.querySelectorAll('div,section,main')]
    .filter((el) => /chat|message|conversation|dialog|bubble|content/i.test(String(el.className || '')))
    .slice(0, 14)
    .map((el) => ({ tag: el.tagName, cls: String(el.className || '').slice(0, 140),
      kids: el.children.length, text: (el.textContent || '').slice(0, 60) }));
  const sendCandidates = [...document.querySelectorAll('div,button,span,[role="button"]')]
    .filter((el) => {
      const s = (String(el.className || '') + ' ' + (el.getAttribute('aria-label') || '') + ' '
        + (el.title || '') + ' ' + (el.textContent || '')).toLowerCase();
      return /send|发送|submit|提交|ds-button/.test(s) && el.children.length < 6;
    })
    .slice(0, 16)
    .map((el) => ({ tag: el.tagName, role: el.getAttribute('role') || '',
      aria: el.getAttribute('aria-label') || '', title: el.title || '',
      cls: String(el.className || '').slice(0, 150),
      text: (el.textContent || '').trim().slice(0, 40),
      html: el.outerHTML.slice(0, 220) }));
  const chain = [];
  let p = document.querySelector('textarea');
  for (let i = 0; p && i < 5; i++, p = p.parentElement) {
    chain.push({ tag: p.tagName, cls: String(p.className || '').slice(0, 150), kids: p.children.length });
  }
  const cs = getComputedStyle(document.body);
  let block = null;
  const pre0 = document.querySelector('pre');
  if (pre0) {
    const blChain = [];
    let bp = pre0;
    for (let i = 0; bp && i < 4; i++, bp = bp.parentElement) {
      blChain.push({ tag: bp.tagName, cls: String(bp.className || '').slice(0, 160),
        kids: bp.children.length, text: (bp.textContent || '').slice(0, 90),
        html: bp.outerHTML.slice(0, 320) });
    }
    block = {
      ownHTML: pre0.outerHTML.slice(0, 700),
      innerTags: [...pre0.children].map((e) => e.tagName + '.' + String(e.className || '').slice(0, 60)),
      childNodes: [...pre0.childNodes].map((n) => n.nodeType === 3 ? 'TEXT:' + (n.textContent || '').slice(0, 30) : n.tagName),
      chain: blChain
    };
  }
  return {
    url: location.href,
    title: document.title,
    ready: document.readyState,
    ua: navigator.userAgent,
    viewport: [innerWidth, innerHeight, devicePixelRatio],
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    textareas: [...document.querySelectorAll('textarea')].map(pick),
    editables: [...document.querySelectorAll('[contenteditable]')].map(pick),
    inputs: [...document.querySelectorAll('input')].slice(0, 12).map(pick),
    buttons: [...document.querySelectorAll('button')].slice(0, 14)
      .map((el) => ({ cls: String(el.className || '').slice(0, 100),
        aria: el.getAttribute('aria-label') || '', title: el.title || '',
        text: (el.textContent || '').trim().slice(0, 40) })),
    pres, codes, boxes, sendCandidates, textareaChain: chain, codeBlock: block,
    iframeCount: document.querySelectorAll('iframe').length,
    shadowHosts: [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length,
    bodyBg: cs.backgroundColor, bodyColor: cs.color,
    bodyLen: (document.body ? (document.body.innerText || '').length : 0),
    bodyHead: (document.body ? (document.body.innerText || '') : '').slice(0, 260)
  };
})()`;

/* ------------------------------------------------------------------ */
let pid = adb(['shell', 'pidof', APP]);
if (!pid) {
  adb(['shell', 'am', 'start', '-n', APP + '/.MainActivity']);
  await sleep(4000);
  pid = adb(['shell', 'pidof', APP]);
}
if (!pid) throw new Error('探针 App 没在运行：' + APP);
const socket = 'webview_devtools_remote_' + pid;
adb(['forward', 'tcp:' + PORT, 'localabstract:' + socket]);

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有 page target；WebView 可能还没加载页面。targets=' + JSON.stringify(list));

const c = await cdp(page.webSocketDebuggerUrl);
if (TARGET) {
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: TARGET });
  await sleep(5000);
}
const r = await c.send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
c.close();
if (!r.result || !r.result.result || !r.result.result.value) {
  throw new Error('Runtime.evaluate 失败: ' + JSON.stringify(r).slice(0, 400));
}
const d = r.result.result.value;

const report = {
  device: { model: adb(['shell', 'getprop', 'ro.product.model']), android: adb(['shell', 'getprop', 'ro.build.version.release']) },
  browser: ver.Browser, socket, pid,
  capturedAt: new Date().toISOString(),
  url: d.url, title: d.title, ready: d.ready, ua: d.ua,
  viewport: d.viewport, dark: d.dark, bodyLen: d.bodyLen,
  textareas: d.textareas, editables: d.editables, inputs: d.inputs,
  buttons: d.buttons, pres: d.pres, codes: d.codes, boxes: d.boxes,
  sendCandidates: d.sendCandidates, textareaChain: d.textareaChain,
  iframeCount: d.iframeCount, shadowHosts: d.shadowHosts,
  bodyBg: d.bodyBg, bodyColor: d.bodyColor
};
fs.writeFileSync(path.join(ROOT, 'report.json'), JSON.stringify(report, null, 2) + '\n');

console.log('设备     :', report.device.model, 'Android', report.device.android);
console.log('WebView  :', ver.Browser, '(pid ' + pid + ')');
console.log('URL      :', d.url);
console.log('标题     :', d.title, '| ready:', d.ready);
console.log('视口     :', d.viewport.join(' x '), '| 深色:', d.dark);
console.log('UA       :', d.ua);
console.log('正文字数 :', d.bodyLen);
console.log('正文开头 :', JSON.stringify(d.bodyHead.slice(0, 180)));
console.log('\ntextarea :', JSON.stringify(d.textareas));
console.log('可编辑   :', JSON.stringify(d.editables));
console.log('input    :', JSON.stringify(d.inputs.slice(0, 6)));
console.log('\npre      :', JSON.stringify(d.pres));
console.log('code     :', JSON.stringify(d.codes));
console.log('\n按钮     :', JSON.stringify(d.buttons.slice(0, 8)));
console.log('\n容器候选 :', JSON.stringify(d.boxes.slice(0, 8)));
console.log('\n发送按钮候选 :');
d.sendCandidates.forEach((c) => console.log('  ', JSON.stringify(c)));
console.log('\ntextarea 祖先链 :', JSON.stringify(d.textareaChain));
console.log('iframe/shadow :', d.iframeCount, '/', d.shadowHosts, '| body 配色', d.bodyBg, d.bodyColor);
if (d.codeBlock) {
  console.log('\n=== 第一个 pre 的细节 ===');
  console.log('ownHTML  :', d.codeBlock.ownHTML);
  console.log('子节点   :', JSON.stringify(d.codeBlock.childNodes));
  d.codeBlock.chain.forEach((c, i) => console.log('父链[' + i + '] :', JSON.stringify(c)));
}
console.log('\n结构报告已存 report.json（不含对话正文）');
