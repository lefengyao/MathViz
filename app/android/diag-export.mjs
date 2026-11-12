/* P5 装机验证第二步：真机 App 里点「存图」，验证 PNG 真的落下来。
   用法: node android/diag-export.mjs */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9334;
const APP = 'com.mathviz.app';

function adb(args) {
  return execFileSync('C:/platform-tools/adb.exe', args, { encoding: 'utf8', timeout: 20000 }).trim();
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
          setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 20000);
        });
      },
      close() { ws.close(); }
    });
    ws.onerror = reject;
    setTimeout(() => reject(new Error('WebSocket 连不上')), 8000);
  });
}

const pid = adb(['shell', 'pidof', APP]);
if (!pid) throw new Error('App 没在跑，先启动');
adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const c = await cdp(target.webSocketDebuggerUrl);
await c.send('Runtime.enable');

/* 清掉旧下载记录，点存图 */
const click = await c.send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    var h = document.querySelector('.mv-card-host');
    if (!h) return 'no card';
    var btn = h.shadowRoot.querySelector('.mv-actions button');
    var btns = Array.from(h.shadowRoot.querySelectorAll('button'));
    var save = btns.find(function(b){ return b.textContent.indexOf('存图') >= 0; });
    if (!save) return 'no save btn: ' + btns.map(function(b){return b.textContent;}).join('|');
    save.click();
    return 'clicked';
  })()`
});
console.log('click:', click.result.result.value);
await sleep(3000);

/* toast 文案 */
const toast = await c.send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    var h = document.querySelector('.mv-card-host');
    var t = h && h.shadowRoot.querySelector('.mv-toast');
    return t ? t.textContent : '(无 toast)';
  })()`
});
console.log('toast:', toast.result.result.value);

/* 下载是否落盘（DownloadManager / Download 目录） */
const dl = adb(['shell', 'ls', '-lt', '/sdcard/Download/']).split('\n').slice(0, 5).join('\n');
console.log('Download/ 最新文件:\n' + dl);
const query = adb(['shell', 'dumpsys', 'download']).length;
console.log('(dumpsys download 长度: ' + query + ')');
c.close();
