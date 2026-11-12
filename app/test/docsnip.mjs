/* 文档代码块体检：把 skill/references 里带 MK.schematic / MK.pcb / MK.eng 的
   ```js 代码块全部真跑一遍，出错就报，并截图供人眼校对。
   用法：node test/docsnip.mjs [schematic|pcb|engineering] */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = path.resolve(ROOT, '..', 'skill', 'references');
const VIEWER = path.join(ROOT, 'dist', 'extension', 'viewer.html');
const OUT = path.join(ROOT, 'test', 'screenshots');
const D = require2(path.join(ROOT, 'src', 'detect.js'));

const want = process.argv.slice(2);
const docs = ['schematic', 'pcb', 'engineering'].filter((n) => !want.length || want.includes(n));

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 780, height: 620 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(VIEWER).href);

let total = 0, bad = 0;

for (const name of docs) {
  const file = path.join(REF, name + '.md');
  if (!fs.existsSync(file)) { console.log('跳过（不存在）' + file); continue; }
  const md = fs.readFileSync(file, 'utf8');
  const blocks = [];
  const re = /```js\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) {
    const code = m[1];
    if (!/MK\.(?:schematic|pcb|eng)\s*\(/.test(code)) continue;
    blocks.push({ code, line: md.slice(0, m.index).split('\n').length });
  }
  console.log('\n[' + name + '.md] ' + blocks.length + ' 个代码块');

  let i = 0;
  for (const b of blocks) {
    i++; total++;
    const kind = D.classify(b.code);
    const r = await page.evaluate(({ code, kind }) => {
      const fig = document.getElementById('fig');
      fig.innerHTML = '';
      const box = document.getElementById('mv-err');
      box.style.display = 'none'; box.textContent = '';
      try {
        if (kind === 'svg') fig.innerHTML = code; else (new Function(code))();
        if (box.style.display !== 'none' && box.textContent) return { ok: false, err: box.textContent };
        return { ok: true, nodes: fig.querySelectorAll('svg *').length };
      } catch (e) { return { ok: false, err: e && e.message ? e.message : String(e) }; }
    }, { code: b.code, kind: kind === 'svg' ? 'js' : kind });

    const shot = path.join(OUT, 'doc-' + name + '-' + i + '.png');
    await page.screenshot({ path: shot, fullPage: true });
    if (r.ok) console.log('  ✓ #' + i + '（第 ' + b.line + ' 行）图元 ' + r.nodes + ' -> ' + path.basename(shot));
    else { bad++; console.log('  ✗ #' + i + '（第 ' + b.line + ' 行）' + r.err); }
  }
}

await browser.close();
console.log('\n' + '-'.repeat(40));
console.log('代码块 ' + total + ' 个，失败 ' + bad + ' 个');
if (bad) process.exit(1);
