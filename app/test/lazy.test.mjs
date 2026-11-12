/* 渲染调度回归：分批渲染 / 离屏暂存 / 折叠释放。
   验证的是「画得多也不卡」那套机制真的在工作，而不是只写了代码。
     node test/lazy.test.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'dist', 'extension');
const CHROME = 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';

const N = 14;

function code(i) {
  return `var V = MK.frame({box:[40,26,600,320], x:[-4,4], y:[-3,5], grid:true, axes:true});
document.getElementById('fig').appendChild(V.svg);
V.plot(function(x){ return x*x-${i}; }, {color:'blue', w:2});`;
}

function pageHtml(n) {
  let blocks = '';
  for (let i = 0; i < n; i++) {
    blocks += `<p>第 ${i + 1} 张图说明文字。</p>
<pre><code class="language-mathviz">${code(i).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>
<div style="height:340px"></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>many</title>
<style>body{margin:0;font:15px/1.7 system-ui}.wrap{max-width:760px;margin:0 auto;padding:16px}
pre{background:#f4f3ee;padding:10px;border-radius:8px;white-space:pre-wrap}</style></head><body>
<div class="wrap">${blocks}</div><textarea id="composer"></textarea>
<button id="send-btn">发送</button></body></html>`;
}

/* 真实站点（DeepSeek / ChatGPT）把消息列表放在自己的滚动容器里，滚动的不是 window。
   这种结构下 IntersectionObserver 只看 viewport、会被祖先裁剪干扰，正是「图渲染不出来」
   的温床 —— 单独立一个场景守着。 */
function innerScrollHtml(n) {
  let blocks = '';
  for (let i = 0; i < n; i++) {
    blocks += `<div class="msg"><p>第 ${i + 1} 条回答。</p>
<pre><code class="language-mathviz">${code(i).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>
<div style="height:320px">补充说明</div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>inner</title>
<style>html,body{height:100%;margin:0;overflow:hidden;font:15px/1.7 system-ui}
#shell{display:flex;flex-direction:column;height:100%}
#list{flex:1;overflow-y:auto;padding:16px}
.msg{max-width:760px;margin:0 auto}
pre{background:#f4f3ee;padding:10px;border-radius:8px;white-space:pre-wrap}</style></head><body>
<div id="shell"><div id="list">${blocks}</div><div style="height:60px;border-top:1px solid #ddd"></div></div>
<script>
  var list = document.getElementById('list');
  window.__toBottom = function () { list.scrollTop = list.scrollHeight; };
  window.__by = function (d) { list.scrollTop = Math.max(0, list.scrollTop + d); };
  /* 真实行为：新回答进来就自动滚到底 */
  setTimeout(window.__toBottom, 400);
</script></body></html>`;
}

let pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { pass++; console.log('  ✓ ' + name); },
    (e) => { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  );
}
function ok(c, m) { if (!c) throw new Error(m || '断言失败'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || '') + ' 期望 ' + b + '，实际 ' + a); }

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-lazy-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROME, headless: true, viewport: { width: 1100, height: 860 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run']
});
await context.route(/^https:\/\/chat\.deepseek\.com\//, (route) =>
  route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml(N) }));

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction((k) => document.querySelectorAll('.mv-card-host').length >= k, N, { timeout: 20000 });

/* 卡片快照：shadow DOM 里读 iframe 的 src / 状态文字 / 占位 class */
const snap = () => page.evaluate(() => [].slice.call(document.querySelectorAll('.mv-card-host')).map((h) => {
  const sr = h.shadowRoot;
  const f = sr.querySelector('iframe');       /* iframe 是按需创建的，暂存时整个移除 */
  const body = sr.querySelector('.mv-body');
  return {
    hasFrame: !!f,
    src: f ? (f.getAttribute('src') || '') : '',
    state: sr.querySelector('[data-a="state"]').textContent,
    paused: body.classList.contains('mv-paused'),
    h: Math.round(f ? f.getBoundingClientRect().height : body.getBoundingClientRect().height),
    top: Math.round(h.getBoundingClientRect().top + window.scrollY)
  };
}));

const isViewer = (s) => /viewer\.html/.test(s);
const isBlank = (s) => s === 'about:blank';

console.log('渲染调度：' + N + ' 张图');

await t('首屏只画视口附近的，远处的不提前启动', async () => {
  await page.waitForTimeout(1800);
  const s = await snap();
  ok(s.filter((x) => x.state.indexOf('已渲染') === 0).length >= 1, '首屏一张都没渲染出来');
  const far = s.filter((x) => x.top > 860 + 3000);
  ok(far.length >= 4, '用例构造有误，远处卡片只有 ' + far.length + ' 张');
  ok(far.every((x) => !isViewer(x.src)), '有 ' + far.filter((x) => isViewer(x.src)).length + ' 张远处卡片被提前渲染了');
  ok(far.every((x) => !x.hasFrame), '远处卡片还插着 iframe（每个 iframe 都是一份 document）');
});

await t('同时活着的 iframe 有上限（不是每张卡一个）', async () => {
  const s = await snap();
  const frames = s.filter((x) => x.hasFrame).length;
  ok(frames <= 8, s.length + ' 张卡却有 ' + frames + ' 个 iframe');
});

await t('滚到底部：底部卡片能渲染出来', async () => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2600);
  const s = await snap();
  const last = s[s.length - 1];
  ok(isViewer(last.src), '最后一张没启动，src=' + last.src);
  ok(last.state.indexOf('已渲染') === 0, '最后一张状态是「' + last.state + '」');
});

await t('滚回顶部：顶部卡片被重建，不是永远空白', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2600);
  const s = await snap();
  ok(s[0].state.indexOf('已渲染') === 0, '第一张状态是「' + s[0].state + '」');
  ok(isViewer(s[0].src), '第一张 iframe 没恢复');
});

await t('离开可视范围的卡片会被暂存（iframe 整个移除）', async () => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2600);
  const s = await snap();
  const paused = s.filter((x) => x.paused);
  ok(paused.length >= 1, '没有任何卡片被暂存');
  ok(paused.every((x) => !x.hasFrame || isBlank(x.src)), '暂存的卡片 iframe 没被清空');
  ok(paused.every((x) => x.h > 40), '暂存后高度被压扁了（会跳版）');
  ok(paused.every((x) => x.state === '已暂存'), '状态文字不对：' + paused.map((x) => x.state).join(','));
});

await t('滚回被暂存的卡片：自动恢复渲染', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(3000);
  const s = await snap();
  ok(!s[0].paused, '第一张还是暂存状态');
  ok(s[0].state.indexOf('已渲染') === 0, '第一张没恢复：' + s[0].state);
});

await t('折叠即释放 iframe', async () => {
  await page.evaluate(() => {
    const h = document.querySelectorAll('.mv-card-host')[0];
    h.shadowRoot.querySelector('button[data-a="fold"]').click();
  });
  await page.waitForTimeout(400);
  const s = await snap();
  const f = await page.evaluate(() => {
    const h = document.querySelectorAll('.mv-card-host')[0];
    const sr = h.shadowRoot;
    const f = sr.querySelector('iframe');
    return {
      src: f ? f.getAttribute('src') : '',
      hasFrame: !!f,
      hidden: sr.querySelector('.mv-body').hasAttribute('hidden'),
      label: sr.querySelector('button[data-a="fold"]').textContent
    };
  });
  ok(f.hidden, '折叠后 body 没隐藏');
  ok(f.label === '展开', '按钮文案没变：' + f.label);
  ok(!f.hasFrame || isBlank(f.src), '折叠后 iframe 没释放，src=' + f.src);
  void s;
});

await t('展开后重新渲染', async () => {
  await page.evaluate(() => {
    const h = document.querySelectorAll('.mv-card-host')[0];
    h.shadowRoot.querySelector('button[data-a="fold"]').click();
  });
  await page.waitForTimeout(2600);
  const s = await snap();
  ok(!s[0].paused, '展开后仍是暂存');
  ok(s[0].state.indexOf('已渲染') === 0, '展开后没渲染：' + s[0].state);
});

await t('内部滚动容器 + 自动滚到底：视口内的图全部画出来', async () => {
  const p2 = await context.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.route(new RegExp('^https://chat[.]deepseek[.]com/inner'), (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: innerScrollHtml(6) }));
  await p2.goto('https://chat.deepseek.com/inner');
  await p2.waitForFunction(() => document.querySelectorAll('.mv-card-host').length >= 6, null, { timeout: 20000 });
  await p2.waitForTimeout(2800);

  const list = () => p2.evaluate(() => [].slice.call(document.querySelectorAll('.mv-card-host')).map((h) => {
    const sr = h.shadowRoot;
    const r = h.getBoundingClientRect();
    return {
      state: sr.querySelector('[data-a="state"]').textContent,
      src: (sr.querySelector('iframe') || { getAttribute: () => '' }).getAttribute('src') || '',
      top: Math.round(r.top), bottom: Math.round(r.bottom)
    };
  }).map((x) => Object.assign(x, { visible: x.bottom > 0 && x.top < window.innerHeight })));

  let s = await list();
  const vis = s.filter((x) => x.visible);
  ok(vis.length >= 1, '用例构造有误：一张可见的卡都没有');
  ok(vis.every((x) => x.state.indexOf('已渲染') === 0),
    '可见的卡片没渲染出来：' + vis.map((x) => x.state).join(','));

  /* 往上滚，让中间的卡进入视口 —— 这是最容易卡在「渲染中…」的地方 */
  await p2.evaluate(() => window.__by(-1100));
  await p2.waitForTimeout(2600);
  s = await list();
  const vis2 = s.filter((x) => x.visible);
  ok(vis2.every((x) => x.state.indexOf('已渲染') === 0),
    '滚动后可见的卡片仍有未渲染：' + vis2.map((x) => x.state).join(','));
  ok(!s.some((x) => x.state === '渲染中…' && x.visible), '有可见卡片永远停在「渲染中…」');
  eq(errs2.length, 0, errs2.join(' | '));
  await p2.close();
});

await t('80 条历史回答批量载入后，前后翻看均能恢复且 iframe 数量受控', async () => {
  const historyPage = await context.newPage();
  const historyErrors = [];
  historyPage.on('pageerror', (e) => historyErrors.push(e.message));
  await historyPage.route(/^https:\/\/chat\.deepseek\.com\/history-stress/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: innerScrollHtml(80) }));
  try {
    await historyPage.goto('https://chat.deepseek.com/history-stress');
    await historyPage.waitForFunction(() => document.querySelectorAll('.mv-card-host').length === 80);
    const waitVisible = () => historyPage.waitForFunction(() => {
      const hosts = [...document.querySelectorAll('.mv-card-host')];
      const visible = hosts.filter((h) => { const r = h.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
      return visible.length && visible.every((h) => h.shadowRoot.querySelector('[data-a="state"]').textContent.startsWith('已渲染'));
    }, null, { timeout: 8000 });
    await historyPage.evaluate(() => window.__toBottom());
    await waitVisible();
    await historyPage.evaluate(() => { document.getElementById('list').scrollTop = 0; });
    await waitVisible();
    await historyPage.evaluate(() => { document.getElementById('list').scrollTop = document.getElementById('list').scrollHeight / 2; });
    await waitVisible();
    await historyPage.evaluate(() => window.__toBottom());
    await waitVisible();
    const state = await historyPage.evaluate(() => {
      const hosts = [...document.querySelectorAll('.mv-card-host')];
      return {
        cards: hosts.length,
        frames: hosts.filter((h) => h.shadowRoot.querySelector('iframe')).length,
        scans: document.documentElement.getAttribute('data-mv-scan')
      };
    });
    eq(state.cards, 80, '重复挂载了历史图卡');
    ok(state.frames <= 12, '离屏卡片未释放：' + state.frames + ' 个 iframe');
    eq(historyErrors.length, 0, historyErrors.join(' | '));
    console.log('      历史压力检查：' + state.cards + ' 张图 / ' + state.frames + ' 个 iframe；扫描 ms：' + state.scans);
  } finally { await historyPage.close(); }
});

await t('全程没有未捕获的 JS 错误', async () => {
  eq(errors.length, 0, errors.join(' | '));
});

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
await context.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
if (fail) process.exitCode = 1;
