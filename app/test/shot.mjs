/* 把测试集用例在真实 Chromium 里渲染并截图，供人眼校对排版（不是自动断言）。
   用法：
     node test/shot.mjs F          # 跑 id 以 F 开头的全部
     node test/shot.mjs F1 F3      # 只跑指定几条
   图存到 test/screenshots/shot-<id>.png */
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { CASES } from './testset.mjs';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = path.join(ROOT, 'dist', 'extension', 'viewer.html');
const OUT = path.join(ROOT, 'test', 'screenshots');
const D = require2(path.join(ROOT, 'src', 'detect.js'));

const args = process.argv.slice(2);
if (!args.length) { console.error('用法: node test/shot.mjs <id前缀|id...>'); process.exit(2); }
const list = CASES.filter((c) => args.some((a) => c.id === a || c.id.startsWith(a)));
if (!list.length) { console.error('没有匹配的用例'); process.exit(2); }

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 780, height: 620 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(VIEWER).href);

for (const c of list) {
  const blocks = c.codes || [c.code];
  const kinds = blocks.map((b) => D.classify(b));
  const err = await page.evaluate(({ blocks, kinds }) => {
    const fig = document.getElementById('fig');
    fig.innerHTML = '';
    const box = document.getElementById('mv-err');
    box.style.display = 'none'; box.textContent = '';
    const errs = [];
    for (let i = 0; i < blocks.length; i++) {
      try {
        if (kinds[i] === 'svg') fig.innerHTML = blocks[i];
        else (new Function(blocks[i]))();
      } catch (e) { errs.push(e && e.message ? e.message : String(e)); }
    }
    if (box.style.display !== 'none' && box.textContent) errs.push(box.textContent);
    return { errs, nodes: fig.querySelectorAll('svg *').length };
  }, { blocks, kinds });

  const file = path.join(OUT, 'shot-' + c.id + '.png');
  await page.screenshot({ path: file, fullPage: true });
  console.log((err.errs.length ? '✗ ' : '✓ ') + c.id + ' ' + c.name + '  图元=' + err.nodes
    + (err.errs.length ? '  错误=' + JSON.stringify(err.errs) : '') + '  -> ' + path.basename(file));
}

await browser.close();
