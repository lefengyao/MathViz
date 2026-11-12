/* 长历史记录回归：真实 Chromium DOM + content.js，沙箱协议使用可延迟的测试页。
   不连接真实会话、不读取登录信息；实际 MV3 沙箱另由 lazy.test.mjs / e2e.mjs 验证。
   node test/history.test.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.MATHVIZ_CHROME || 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';
const server = http.createServer((req, res) => {
  const delay = new URL(req.url, 'http://localhost').searchParams.get('delay') || 0;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><script>
    const id=new URLSearchParams(location.search).get('id');
    parent.postMessage({__mv:true,type:'mv:ready',id},'*');
    addEventListener('message',e=>{
      if(e.data?.type==='mv:render') setTimeout(()=>parent.postMessage(
        {__mv:true,type:'mv:done',id,figures:1,height:180},'*'),${Number(delay)});
    });
  </script>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0, fail = 0;

const source = (i) => `var V = MK.frame({x:[-4,4], y:[-3,5]});
document.getElementById('fig').appendChild(V.svg);
V.plot(function(x){return x*x-${i};});`;
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const block = (i) => `<article><p>历史回答 ${i}</p><pre><code id="history-${i}" class="language-mathviz">${escape(source(i))}</code></pre></article>`;

async function boot(n = 80, delay = 0, extra = '') {
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(`<style>body{margin:0}article{margin:10px 100px}pre{white-space:pre-wrap}</style>
    <aside id="status"></aside><main id="history">${Array.from({ length: n }, (_, i) => block(i)).join('')}${extra}</main><textarea></textarea>`);
  await page.evaluate(({ origin, delay }) => {
    window.__historyReads = 0;
    const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    document.querySelectorAll('code').forEach((code) => Object.defineProperty(code, 'textContent', {
      get() { window.__historyReads++; return text.get.call(this); },
      set(value) { text.set.call(this, value); },
    }));
    window.MVPlatform = {
      viewerUrl: (query) => origin + '/viewer.html?' + query + '&delay=' + delay,
      load: (cb) => cb({ mvMode: 'auto', mvAuto: false }),
      save() {},
    };
  }, { origin, delay });
  for (const name of ['prompt.js', 'detect.js']) await page.addScriptTag({ path: path.join(ROOT, 'src', name) });
  await page.evaluate((css) => { window.MVCss = css; }, fs.readFileSync(path.join(ROOT, 'src/ui.css'), 'utf8'));
  await page.addScriptTag({ path: path.join(ROOT, 'src/content.js') });
  await page.waitForFunction((n) => document.querySelectorAll('.mv-card-host').length === n, n);
  return { page, errors };
}

async function test(name, fn) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

try {
  await test('浏览未变化的长历史时，定时检查不重读全部旧代码', async () => {
    const { page, errors } = await boot();
    try {
      await page.waitForTimeout(1400);
      await page.evaluate(() => { window.__historyReads = 0; });
      await page.waitForTimeout(3100);
      const reads = await page.evaluate(() => window.__historyReads);
      assert.equal(reads, 0, '旧代码被重复读取 ' + reads + ' 次');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await test('侧栏样式变化不触发历史消息重扫', async () => {
    const { page } = await boot();
    try {
      await page.waitForTimeout(1400);
      await page.evaluate(() => {
        window.__historyReads = 0;
        document.getElementById('status').className = 'sidebar-active';
      });
      await page.waitForTimeout(450);
      assert.equal(await page.evaluate(() => window.__historyReads), 0);
    } finally { await page.close(); }
  });

  await test('追加历史消息只识别新块，已有图卡保持原位', async () => {
    const { page } = await boot();
    try {
      await page.waitForTimeout(1400);
      await page.evaluate((html) => {
        window.__firstCard = document.querySelector('.mv-card-host');
        window.__historyReads = 0;
        document.getElementById('history').insertAdjacentHTML('beforeend', html);
      }, block(80));
      await page.waitForFunction(() => document.querySelectorAll('.mv-card-host').length === 81);
      assert.equal(await page.evaluate(() => window.__historyReads), 0, '追加一条消息却重读了旧会话');
      assert.equal(await page.evaluate(() => window.__firstCard === document.querySelector('.mv-card-host')), true);
    } finally { await page.close(); }
  });

  await test('渲染途中连续替换代码块，会归还旧任务名额', async () => {
    const { page, errors } = await boot(2, 900);
    try {
      await page.waitForFunction(() => [...document.querySelectorAll('.mv-card-host')].every(
        (h) => h.shadowRoot.querySelector('[data-a="state"]').textContent === '渲染中…'));
      await page.evaluate((codes) => {
        document.querySelectorAll('code').forEach((code, i) => { code.textContent = codes[i]; });
        document.querySelector('.mv-toolbar-host').shadowRoot.querySelector('[data-a="rescan"]').click();
      }, [source(101), source(102)]);
      await page.waitForFunction(() => [...document.querySelectorAll('.mv-card-host')].every(
        (h) => h.shadowRoot.querySelector('[data-a="state"]').textContent.startsWith('已渲染')),
      null, { timeout: 2500 });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await test('流式裸围栏跨多个 span 闭合后仍能出图，改内部文本也会更新', async () => {
    const { page, errors } = await boot(0);
    try {
      await page.waitForTimeout(1400); // 首次启动兜底扫描结束，不能靠它掩盖增量漏检
      await page.evaluate((code) => {
        const raw = document.createElement('div');
        raw.id = 'raw-stream';
        raw.innerHTML = '<span>```mathviz\n</span><span id="raw-code"></span>';
        raw.querySelector('#raw-code').textContent = code;
        document.getElementById('history').appendChild(raw);
      }, source(201));
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.mv-card-host').count(), 0, '围栏未闭合就渲染');
      await page.evaluate(() => {
        document.getElementById('raw-stream').insertAdjacentHTML('beforeend', '<span>\n```</span>');
      });
      await page.waitForFunction(() => document.querySelectorAll('.mv-card-host').length === 1);
      await page.evaluate((code) => {
        document.getElementById('raw-code').firstChild.nodeValue = code;
      }, source(202));
      await page.waitForFunction(() => document.querySelector('.mv-card-host').shadowRoot.querySelector('.mv-src').textContent.includes('x*x-202'), null, { timeout: 1500 });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await test('一条新消息的增量扫描不会丢掉其他未完成块的计数', async () => {
    const { page } = await boot(0);
    try {
      await page.evaluate(() => {
        document.getElementById('history').innerHTML = '<pre><code class="language-mathviz">var V = MK.frame({</code></pre>';
      });
      await page.waitForFunction(() => document.querySelector('.mv-toolbar-host').shadowRoot.textContent.includes('1 段未写完'));
      await page.evaluate((html) => document.getElementById('history').insertAdjacentHTML('beforeend', html), block(90));
      await page.waitForFunction(() => document.querySelectorAll('.mv-card-host').length === 1);
      assert.equal(await page.evaluate(() => document.querySelector('.mv-toolbar-host').shadowRoot.textContent.includes('1 段未写完')), true);
      await page.evaluate(() => document.querySelector('pre').remove());
      await page.waitForFunction(() => !document.querySelector('.mv-toolbar-host').shadowRoot.textContent.includes('段未写完'));
    } finally { await page.close(); }
  });

  await test('站点只卸载图卡而保留源码时，会自动恢复图形', async () => {
    const { page } = await boot(1);
    try {
      await page.waitForTimeout(1400);
      await page.evaluate(() => document.querySelector('.mv-card-host').remove());
      await page.waitForFunction(() => document.querySelector('.mv-card-host')?.shadowRoot.querySelector('[data-a="state"]').textContent.startsWith('已渲染'), null, { timeout: 1500 });
    } finally { await page.close(); }
  });

  await test('裸围栏只删除一条绘图语句时，现有图也会更新', async () => {
    const { page } = await boot(0);
    try {
      await page.waitForTimeout(1400);
      await page.evaluate((code) => {
        const raw = document.createElement('div');
        raw.id = 'raw-remove';
        raw.append(document.createTextNode('```mathviz\n' + code + '\n'));
        const extra = document.createElement('span');
        extra.id = 'removed-line';
        extra.textContent = 'V.dot([1,1]);\n';
        raw.append(extra, document.createTextNode('```'));
        document.getElementById('history').append(raw);
      }, source(301));
      await page.waitForFunction(() => document.querySelector('.mv-card-host')?.shadowRoot.querySelector('.mv-src').textContent.includes('V.dot'));
      await page.evaluate(() => document.getElementById('removed-line').remove());
      await page.waitForFunction(() => !document.querySelector('.mv-card-host').shadowRoot.querySelector('.mv-src').textContent.includes('V.dot'), null, { timeout: 1500 });
    } finally { await page.close(); }
  });

  await test('围栏反引号被拆到相邻文本节点时仍能识别', async () => {
    const { page } = await boot(0);
    try {
      await page.waitForTimeout(1400);
      await page.evaluate((code) => {
        const raw = document.createElement('div');
        for (const text of ['``', '`mathviz\n', code, '\n``', '`']) raw.append(document.createTextNode(text));
        document.getElementById('history').append(raw);
      }, source(401));
      await page.waitForFunction(() => document.querySelectorAll('.mv-card-host').length === 1, null, { timeout: 1500 });
      await page.evaluate((code) => {
        const raw = document.createElement('div');
        raw.id = 'split-stream';
        raw.innerHTML = '<span>``</span><span>`mathviz\n</span><span id="split-code"></span><span>\n``</span>';
        raw.querySelector('#split-code').textContent = code;
        document.getElementById('history').append(raw);
      }, source(402));
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.mv-card-host').count(), 1);
      await page.evaluate(() => document.getElementById('split-stream').insertAdjacentHTML('beforeend', '<span>`</span>'));
      await page.waitForFunction(() => document.querySelectorAll('.mv-card-host').length === 2, null, { timeout: 1500 });
    } finally { await page.close(); }
  });

  await test('站点复用未完成块为普通文本后，会清掉未完成计数', async () => {
    const { page } = await boot(0);
    try {
      await page.waitForTimeout(1400);
      await page.evaluate(() => {
        document.getElementById('history').innerHTML = '<pre><code class="language-mathviz">var V = MK.frame({</code></pre>';
      });
      await page.waitForFunction(() => document.querySelector('.mv-toolbar-host').shadowRoot.textContent.includes('1 段未写完'));
      await page.evaluate(() => {
        const code = document.querySelector('code');
        code.className = '';
        code.textContent = '普通文字';
      });
      await page.waitForFunction(() => !document.querySelector('.mv-toolbar-host').shadowRoot.textContent.includes('段未写完'), null, { timeout: 1500 });
    } finally { await page.close(); }
  });

  await test('流式围栏的结束符单独追加为段落时，仍能识别完整代码', async () => {
    const { page } = await boot(0);
    try {
      await page.waitForTimeout(1400);
      await page.evaluate((code) => {
        const raw = document.createElement('div');
        raw.id = 'paragraph-fence';
        const p = document.createElement('p');
        p.textContent = '```mathviz\n' + code;
        raw.append(p);
        document.getElementById('history').append(raw);
      }, source(501));
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.mv-card-host').count(), 0);
      await page.evaluate(() => {
        const p = document.createElement('p');
        p.textContent = '\n```';
        document.getElementById('paragraph-fence').append(p);
      });
      await page.waitForFunction(() => document.querySelectorAll('.mv-card-host').length === 1, null, { timeout: 1500 });
    } finally { await page.close(); }
  });
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
