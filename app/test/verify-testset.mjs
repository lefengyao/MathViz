/* 在真实 Chromium 里逐条跑测试集，确认每段代码都能渲染出 SVG。
   用法：node test/verify-testset.mjs        （跑全部）
         node test/verify-testset.mjs A1 B2  （只跑指定用例） */
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
const CHROME = 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';
const D = require2(path.join(ROOT, 'src', 'detect.js'));

const only = process.argv.slice(2);
const list = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(VIEWER).href);

let pass = 0, fail = 0;
for (const c of list) {
  const blocks = c.codes || [c.code];
  const kinds = blocks.map((b) => D.classify(b));
  /* 每个代码块在真实链路里是独立的 viewer iframe；这里逐块清空逐块验证 */
  const r = await page.evaluate(({ blocks, kinds }) => {
    const fig = document.getElementById('fig');
    const out = { errors: [], svgs: [], nodes: [] };
    for (let i = 0; i < blocks.length; i++) {
      fig.innerHTML = '';
      const errBox = document.getElementById('mv-err');
      errBox.style.display = 'none'; errBox.textContent = '';
      try {
        if (kinds[i] === 'svg') fig.innerHTML = blocks[i];
        else (new Function(blocks[i]))();
      } catch (e) { out.errors.push(e && e.message ? e.message : String(e)); }
      if (errBox.style.display !== 'none' && errBox.textContent) out.errors.push(errBox.textContent);
      out.svgs.push(fig.querySelectorAll('svg').length);
      out.nodes.push(fig.querySelectorAll('svg *').length);
    }
    return out;
  }, { blocks, kinds });

  let ok;
  if (c.negative) {
    ok = r.errors.length > 0;   // 负向用例：要求报错且信息非空
  } else {
    ok = r.errors.length === 0 && r.svgs.every((n) => n >= 1) && r.nodes.every((n) => n > 0);
  }
  const tag = c.id + ' ' + c.name;
  if (ok) { pass++; console.log('✓ ' + tag + '  (svg=' + r.svgs.join('+') + ' 图元=' + r.nodes.join('+') + ')'); }
  else { fail++; console.log('✗ ' + tag + '  svg=' + r.svgs.join('+') + ' nodes=' + r.nodes.join('+') + ' 错误=' + JSON.stringify(r.errors)); }
}
await browser.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + list.length);
process.exit(fail ? 1 : 0);
