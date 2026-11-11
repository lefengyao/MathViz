/* 端到端验证：真实 Chromium 加载 unpacked 扩展，用本地 mock 的 chat.deepseek.com 页面。
   验证的是纯逻辑测不到的东西：
     - MV3 sandbox.pages 能否在页面里被 iframe 加载并执行 new Function
     - 运行时（mk-core/3d/graph）内联后是否真的画出 svg
     - content script 的 DOM 观察、提示词插入、主题传递、沙箱隔离
   node test/e2e.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = require(path.join(ROOT, 'src', 'prompt.js'));
const EXT = path.join(ROOT, 'dist', 'extension');
const CHROME = 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';
const SHOTS = path.join(ROOT, 'test', 'screenshots');

fs.mkdirSync(SHOTS, { recursive: true });

/* 代码块里的 <svg> 用实体转义，保证 textContent 里拿到的是源码文本 */
const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DeepSeek mock</title>
<style>
  body { margin:0; background:#ffffff; color:#1a1a19; font:15px/1.7 system-ui,sans-serif; }
  .wrap { max-width:760px; margin:24px auto; padding:0 16px 140px; }
  pre { background:#f4f3ee; padding:12px; border-radius:8px; white-space:pre-wrap; }
  code { font:12px/1.6 ui-monospace,Menlo,monospace; }
  #composer { position:fixed; left:50%; bottom:16px; transform:translateX(-50%);
              width:600px; height:64px; padding:10px; font:14px system-ui; }
  button { padding:8px 14px; }
</style></head><body>
<div class="wrap">
  <h1>数学作图会话（mock）</h1>
  <div id="user-msg">画一下 y = x² − 2</div>
  <div class="assistant">
    <p>下面是函数图像：</p>
    <pre><code class="language-mathviz">var V = MK.frame({box:[40,26,600,320], x:[-4,4], y:[-3,5], grid:true, axes:true, title:'抛物线'});
document.getElementById('fig').appendChild(V.svg);
V.plot(function(x){ return x*x-2; }, {color:'blue', w:2.2});
V.dot([0,-2], {color:'coral'});</code></pre>
  </div>
  <div id="raw-msg">&#96;&#96;&#96;mathviz
&lt;svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 120"&gt;&lt;circle cx="340" cy="60" r="30" fill="#D85A30"/&gt;&lt;/svg&gt;
&#96;&#96;&#96;</div>
  <div id="later"></div>
  <div id="probe"></div>
  <div id="ce-box" contenteditable="true" style="min-height:36px;border:1px dashed #999;margin:8px 0"></div>
  <div id="user-bubble"></div>
  <button id="theme-btn">切换深色</button>
</div>
<textarea id="composer" placeholder="给 DeepSeek 发消息"></textarea>
<button id="send-btn" aria-label="发送消息" style="position:fixed;right:12px;bottom:16px">发送</button>
<script>
  document.getElementById('theme-btn').addEventListener('click', function () {
    var dark = document.body.style.background !== 'rgb(31, 31, 30)';
    document.body.style.background = dark ? '#1f1f1e' : '#ffffff';
    document.body.style.color = dark ? '#f1efe8' : '#1a1a19';
  });
</script>
</body></html>`;

let pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { pass++; console.log('  ✓ ' + name); },
    (e) => { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  );
}
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-ext-check-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--disable-features=Translate'
  ]
});

const errors = [];
await context.route(/^https:\/\/chat\.deepseek\.com\//, (route) => {
  route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
});

const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

const sr = (sel) => `document.querySelector('#mv-ext-root').shadowRoot.querySelector('${sel}')`;
const cardsCount = () => page.evaluate(() => document.querySelectorAll('.mv-card-host').length);
const cardStates = () => page.evaluate(() => [].slice.call(document.querySelectorAll('.mv-card-host'))
  .map((h) => h.shadowRoot.querySelector('.mv-state').textContent));

/* 直接取提示词里给模型的示例，测的就是模型会照抄的那段代码 */
function example(mode) {
  const s = P.buildPrompt(mode);
  return s.slice(s.indexOf('## 最小可运行示例'), s.indexOf(P.QUESTION)).replace(/^[^\n]*\n/, '').trim();
}
function setProbe(cls, code) {
  return page.evaluate(([c, s]) => {
    document.getElementById('probe').innerHTML = '<pre><code class="' + c + '"></code></pre>';
    document.querySelector('#probe code').textContent = s;
  }, [cls, code]);
}
function probeState() {
  return page.evaluate(() => {
    const pre = document.querySelector('#probe pre');
    const host = pre && pre.querySelector('.mv-card-host[data-inline]');
    return host ? host.shadowRoot.querySelector('.mv-state').textContent : '(无卡片)';
  });
}
function waitProbe(kw) {
  return page.waitForFunction((k) => {
    const pre = document.querySelector('#probe pre');
    const host = pre && pre.querySelector('.mv-card-host[data-inline]');
    return !!host && host.shadowRoot.querySelector('.mv-state').textContent.indexOf(k) >= 0;
  }, kw, { timeout: 15000 });
}

console.log('\n[扩展加载与渲染]');
await t('content script 注入，工具条出现', async () => {
  assert.equal(await page.evaluate(`!!${sr('.mv-toggle')}`), true);
});
await t('两条 mathviz 块都被识别成卡片（pre + 裸 fence）', async () => {
  await page.waitForFunction(() => document.querySelectorAll('.mv-card-host').length >= 2, null, { timeout: 12000 });
  assert.ok(await cardsCount() >= 2);
});
await t('沙箱页成功执行 new Function，卡片显示「已渲染」', async () => {
  await page.waitForFunction(() => [].slice.call(document.querySelectorAll('.mv-card-host'))
    .some((h) => h.shadowRoot.querySelector('.mv-state').textContent.indexOf('已渲染') >= 0),
    null, { timeout: 15000 });
  const states = await cardStates();
  assert.ok(states.some((s) => s.indexOf('已渲染') >= 0), JSON.stringify(states));
});
await t('iframe 里真的生成了 svg 元素', async () => {
  let total = 0;
  for (const f of page.frames()) {
    try { total += await f.evaluate(() => document.querySelectorAll('#fig svg').length); } catch (e) {}
  }
  assert.ok(total >= 1, 'iframe 里没有 svg，总帧数 ' + page.frames().length);
});
await t('运行时画出了图元（不只是空 svg）', async () => {
  let nodes = 0;
  for (const f of page.frames()) {
    try { nodes += await f.evaluate(() => document.querySelectorAll('#fig svg *').length); } catch (e) {}
  }
  assert.ok(nodes > 10, '图元数 ' + nodes);
});
await t('渲染成功后 iframe 高度被撑开', async () => {
  const h = await page.evaluate(() => {
    const f = document.querySelector('.mv-card-host').shadowRoot.querySelector('iframe');
    return parseInt(f.style.height, 10) || 0;
  });
  assert.ok(h >= 80, 'height=' + h);
});
await t('裸 fence 原文被收起，页面上只留渲染卡片', async () => {
  await page.waitForFunction(() => document.getElementById('raw-msg').style.display === 'none', null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => document.getElementById('raw-msg').style.display), 'none');
});
await t('图直接渲染在原代码块内部，不再另起卡片', async () => {
  const info = await page.evaluate(() => {
    const pre = document.querySelector('pre');
    const host = pre.querySelector('.mv-card-host[data-inline]');
    const code = pre.querySelector('code');
    return {
      preHidden: pre.style.display === 'none',
      inline: !!host,
      codeHidden: !code || code.style.display === 'none'
    };
  });
  assert.equal(info.preHidden, false, 'pre 不该被隐藏，它现在是图的容器');
  assert.equal(info.inline, true, '渲染宿主必须挂在 pre 内部');
  assert.equal(info.codeHidden, true, '原代码文本应收起');
});
await t('iframe 是 sandbox，且没有 allow-same-origin', async () => {
  const s = await page.evaluate(() => document.querySelector('.mv-card-host').shadowRoot.querySelector('iframe').getAttribute('sandbox'));
  assert.equal(s, 'allow-scripts');
});
await t('沙箱内拿不到父页面 DOM（登录态隔离）', async () => {
  let blocked = false;
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate(() => {
        try { return window.parent.document.getElementById('composer') ? 'OPEN' : 'NO-DOM'; }
        catch (e) { return 'BLOCKED'; }
      });
      if (r === 'BLOCKED') blocked = true;
    } catch (e) {}
  }
  assert.equal(blocked, true);
});
await t('保存初始渲染截图（滚动到顶部）', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, 'e2e-render.png') });
  assert.ok(fs.existsSync(path.join(SHOTS, 'e2e-render.png')));
});
await t('静置 1 秒卡片数稳定，没有自激循环', async () => {
  const before = await cardsCount();
  await page.waitForTimeout(1100);
  assert.equal(await cardsCount(), before);
});

console.log('\n[回归：提示词本身不能被当成模型输出]');
await t('输入框里出现完整协议时，不额外生成图片', async () => {
  const before = await cardsCount();
  await page.evaluate((text) => { document.getElementById('ce-box').textContent = text; }, P.buildPrompt('auto'));
  await page.waitForTimeout(1200);
  const after = await cardsCount();
  await page.evaluate(() => { document.getElementById('ce-box').textContent = ''; });
  assert.equal(after, before, '协议里的示例 fence 被误渲染，多出 ' + (after - before) + ' 张图');
});
await t('用户消息气泡里带 mathviz 示例时，不额外生成图片', async () => {
  const before = await cardsCount();
  await page.evaluate(() => {
    document.getElementById('user-bubble').innerHTML =
      '<div>【MathViz 作图模式】请输出 mathviz 代码块</div>' +
      '<pre><code class="language-mathviz">var V = MK.frame({x:[-2,2]});</code></pre>';
  });
  await page.waitForTimeout(1200);
  const after = await cardsCount();
  await page.evaluate(() => { document.getElementById('user-bubble').innerHTML = ''; });
  assert.equal(after, before, '用户消息里的示例被误渲染，多出 ' + (after - before) + ' 张图');
});

console.log('\n[提示词插入]');
await t('打开面板，选 plot2d，插入提示词', async () => {
  await page.fill('#composer', '画 y=x² 的图');
  await page.evaluate(`${sr('[data-a="toggle"]')}.click()`);
  await page.evaluate(() => {
    const s = document.querySelector('#mv-ext-root').shadowRoot.querySelector('[data-a="mode"]');
    s.value = 'plot2d';
    s.dispatchEvent(new Event('change'));
  });
  await page.evaluate(`${sr('[data-a="insert"]')}.click()`);
  const v = await page.inputValue('#composer');
  assert.ok(v.includes('【MathViz 作图模式】'));
  assert.ok(v.includes('使用 `MK.frame`'));
  assert.ok(v.includes('画 y=x² 的图'));
});
await t('插入后输入框值稳定，不再反复改写（不闪烁）', async () => {
  const v1 = await page.inputValue('#composer');
  await page.waitForTimeout(900);
  assert.equal(await page.inputValue('#composer'), v1);
});
await t('换模式重插不叠加协议，只保留一份', async () => {
  await page.evaluate(() => {
    const s = document.querySelector('#mv-ext-root').shadowRoot.querySelector('[data-a="mode"]');
    s.value = 'solid3d';
    s.dispatchEvent(new Event('change'));
  });
  await page.evaluate(`${sr('[data-a="insert"]')}.click()`);
  const v = await page.inputValue('#composer');
  assert.equal((v.match(/【MathViz 作图模式】/g) || []).length, 1);
  assert.ok(v.includes('使用 `MK.space`'));
  assert.ok(!v.includes('使用 `MK.frame` 画二维坐标系'));
  assert.ok(v.endsWith('画 y=x² 的图'));
});
await t('同一模式重复点插入不会重写输入框，面板显示已注入', async () => {
  const v1 = await page.inputValue('#composer');
  await page.evaluate(`${sr('[data-a="insert"]')}.click()`);
  assert.equal(await page.inputValue('#composer'), v1);
  const sess = await page.evaluate(`${sr('[data-a="sess"]')}.textContent`);
  assert.ok(sess.includes('已注入'), sess);
});
await t('off 模式不插入，也不自动附加', async () => {
  await page.fill('#composer', '普通问题');
  await page.evaluate(() => {
    const s = document.querySelector('#mv-ext-root').shadowRoot.querySelector('[data-a="mode"]');
    s.value = 'off';
    s.dispatchEvent(new Event('change'));
  });
  await page.evaluate(`${sr('[data-a="insert"]')}.click()`);
  assert.equal(await page.inputValue('#composer'), '普通问题');
});
await t('点「新对话」重置后，自动附加能重新补一次协议', async () => {
  await page.evaluate(`${sr('[data-a="reset"]')}.click()`);
  const sess = await page.evaluate(`${sr('[data-a="sess"]')}.textContent`);
  assert.ok(sess.includes('还没给'), sess);
  await page.evaluate(() => {
    const s = document.querySelector('#mv-ext-root').shadowRoot.querySelector('[data-a="mode"]');
    s.value = 'svg'; s.dispatchEvent(new Event('change'));
    const c = document.querySelector('#mv-ext-root').shadowRoot.querySelector('[data-a="auto"]');
    c.checked = true; c.dispatchEvent(new Event('change'));
  });
  await page.fill('#composer', '画一个圆');
  await page.click('#send-btn');
  const v = await page.inputValue('#composer');
  assert.ok(v.includes('【MathViz 作图模式】'));
  assert.ok(v.includes('画一个圆'));
  await page.evaluate(() => {
    const c = document.querySelector('#mv-ext-root').shadowRoot.querySelector('[data-a="auto"]');
    c.checked = false; c.dispatchEvent(new Event('change'));
    const s = document.querySelector('#mv-ext-root').shadowRoot.querySelector('[data-a="mode"]');
    s.value = 'auto'; s.dispatchEvent(new Event('change'));
  });
});

console.log('\n[动态内容 / 错误 / 主题]');
await t('流式追加新代码块会被观察到并渲染', async () => {
  const before = await cardsCount();
  await page.evaluate(() => {
    const d = document.getElementById('later');
    d.innerHTML = '<pre><code class="language-mathviz">var V = MK.frame({x:[-2,2],y:[-2,2],title:\'新图\'});\n'
      + 'document.getElementById("fig").appendChild(V.svg);\nV.dot([0,0],{color:"teal"});</code></pre>';
  });
  await page.waitForFunction((n) => document.querySelectorAll('.mv-card-host').length > n, before, { timeout: 12000 });
  assert.ok(await cardsCount() > before);
});
await t('坏代码显示「渲染失败」并自动展开源码', async () => {
  await page.evaluate(() => {
    const d = document.getElementById('later');
    d.innerHTML = '<pre><code class="language-mathviz">throw new Error("boom-expected");</code></pre>';
  });
  await page.waitForFunction(() => [].slice.call(document.querySelectorAll('.mv-card-host'))
    .some((h) => h.shadowRoot.querySelector('.mv-state').textContent.indexOf('渲染失败') >= 0),
    null, { timeout: 12000 });
  const info = await page.evaluate(() => {
    const hs = [].slice.call(document.querySelectorAll('.mv-card-host'));
    const h = hs.find((x) => x.shadowRoot.querySelector('.mv-state').textContent.indexOf('渲染失败') >= 0);
    return { src: h.shadowRoot.querySelector('.mv-src').textContent, hidden: h.shadowRoot.querySelector('.mv-src').hasAttribute('hidden') };
  });
  assert.ok(info.src.includes('boom-expected'));
  assert.equal(info.hidden, false);
});
await t('「源码」按钮可切换', async () => {
  const before = await page.evaluate(() => document.querySelector('.mv-card-host').shadowRoot.querySelector('.mv-src').hasAttribute('hidden'));
  await page.evaluate(() => document.querySelector('.mv-card-host').shadowRoot.querySelector('[data-a="source"]').click());
  const after = await page.evaluate(() => document.querySelector('.mv-card-host').shadowRoot.querySelector('.mv-src').hasAttribute('hidden'));
  assert.notEqual(before, after);
});
await t('页面切深色后，卡片与沙箱都跟着换主题', async () => {
  await page.click('#theme-btn');
  await page.waitForFunction(() => [].slice.call(document.querySelectorAll('.mv-card-host'))
    .some((h) => h.getAttribute('data-theme') === 'dark'), null, { timeout: 12000 });
  const src = await page.evaluate(() => document.querySelector('.mv-card-host').shadowRoot.querySelector('iframe').getAttribute('src'));
  assert.ok(src.includes('theme=dark'));
});
console.log('\n[3D / 图论 / 错误诊断]');
await t('提示词里的 3D 示例能渲染出立体图', async () => {
  await setProbe('language-mathviz', example('solid3d'));
  await waitProbe('已渲染');
  const url = await page.evaluate(() =>
    document.querySelector('#probe .mv-card-host').shadowRoot.querySelector('iframe').getAttribute('src'));
  const id = decodeURIComponent(url.split('id=')[1] || '');
  let nodes = 0;
  for (const f of page.frames()) {
    if (id && f.url().indexOf('id=' + id) >= 0) {
      try { nodes = await f.evaluate(() => document.querySelectorAll('#fig svg *').length); } catch (e) {}
    }
  }
  assert.ok(nodes > 10, '3D 沙箱里的图元数 ' + nodes);
});
await t('提示词里的图论示例能渲染', async () => {
  await setProbe('language-mathviz', example('discrete'));
  await waitProbe('已渲染');
});
await t('模型把围栏写成 javascript 时仍能识别并渲染 3D', async () => {
  await setProbe('language-javascript', example('solid3d'));
  await waitProbe('已渲染');
  assert.ok((await probeState()).includes('已渲染'));
});
await t('S.drag(draw) 未定义时给出中文可操作提示', async () => {
  await setProbe('language-mathviz',
    'var S = MK.space({range:2});\ndocument.getElementById("fig").appendChild(S.svg);\nS.drag(draw);');
  await waitProbe('渲染失败');
  const src = await page.evaluate(() => document.querySelector('#probe .mv-card-host').shadowRoot.querySelector('.mv-src').textContent);
  assert.ok(src.includes('有变量或函数没定义'), src.slice(0, 120));
  assert.ok(src.includes('draw is not defined'));
});
await t('漏掉 appendChild 时提示挂载动作', async () => {
  await setProbe('language-mathviz',
    'var S = MK.space({range:2});\nS.line([0,0,0],[1,1,1],{color:"blue"});');
  await waitProbe('渲染失败');
  const src = await page.evaluate(() => document.querySelector('#probe .mv-card-host').shadowRoot.querySelector('.mv-src').textContent);
  assert.ok(src.includes('appendChild(S.svg)'), src.slice(0, 140));
});
await t('流式半截代码不渲染，补全后自动出图', async () => {
  const half = "var V = MK.frame({x:[-2,2],y:[-2,2]});\nV.label([0,0],'x',{color:'blue', size:13";
  const full = "var V = MK.frame({x:[-2,2],y:[-2,2]});\n"
    + "document.getElementById('fig').appendChild(V.svg);\n"
    + "V.plot(function(x){ return x*x; }, {color:'blue'});";
  await setProbe('language-mathviz', half);
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => !!document.querySelector('#probe .mv-card-host')), false,
    '半截代码不该立刻建卡片');
  await page.evaluate((s) => { document.querySelector('#probe code').textContent = s; }, full);
  await waitProbe('已渲染');
});
await t('语法错误给出中文可操作提示', async () => {
  await setProbe('language-mathviz', 'var alpha = ;\nvar beta = 1;');
  await waitProbe('渲染失败');
  const src = await page.evaluate(() => document.querySelector('#probe .mv-card-host').shadowRoot.querySelector('.mv-src').textContent);
  assert.ok(src.includes('代码块不完整或有语法错误'), src.slice(0, 160));
});

console.log('\n[移动版 DOM 兼容]');
await t('移动版代码块（.md-code-block + pre>span，无 code 元素）也能渲染', async () => {
  await page.evaluate(() => {
    const code = 'var V = MK.frame({x:[-2,2],y:[-2,2],grid:true,axes:true});\n'
      + 'document.getElementById("fig").appendChild(V.svg);';
    document.getElementById('probe').innerHTML =
      '<div class="md-code-block md-code-block-light">'
      + '<div class="md-code-block-banner-wrap"><span>mathviz 复制 下载</span></div>'
      + '<pre><span class="token"></span></pre></div>';
    document.querySelector('#probe .token').textContent = code;
  });
  await waitProbe('已渲染');
  assert.equal(await page.evaluate(() =>
    !!document.querySelector('#probe pre .mv-card-host[data-inline]')), true);
});
await t('移动版发送按钮（无文本的 div[role=button]）也能触发自动附加', async () => {
  await page.evaluate(`${sr('[data-a="reset"]')}.click()`);
  await page.evaluate(() => {
    const sh = document.querySelector('#mv-ext-root').shadowRoot;
    const s = sh.querySelector('[data-a="mode"]');
    s.value = 'auto'; s.dispatchEvent(new Event('change'));
    const c = sh.querySelector('[data-a="auto"]');
    c.checked = true; c.dispatchEvent(new Event('change'));
    const b = document.createElement('div');
    b.id = 'mv-send-mobile';
    b.setAttribute('role', 'button');
    b.className = 'ds-button ds-button--iconLabelPrimary _4f3769f';
    document.body.appendChild(b);
  });
  await page.fill('#composer', '移动端测试');
  await page.evaluate(() => document.getElementById('mv-send-mobile').click());
  assert.ok((await page.inputValue('#composer')).includes('【MathViz 作图模式】'));
  await page.evaluate(() => {
    document.getElementById('mv-send-mobile').remove();
    const c = document.querySelector('#mv-ext-root').shadowRoot.querySelector('[data-a="auto"]');
    c.checked = false; c.dispatchEvent(new Event('change'));
  });
});
await page.evaluate(() => { document.getElementById('probe').innerHTML = ''; });

await t('全程没有未捕获的 JS 错误', async () => {
  assert.deepEqual(errors, []);
});

await page.screenshot({ path: path.join(SHOTS, 'e2e-final.png'), fullPage: false });
console.log('\n截图：test/screenshots/e2e-final.png');
console.log('-'.repeat(40));
console.log('通过 ' + pass + ' / ' + (pass + fail));

await context.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
if (fail) process.exit(1);
