/* 调试：把某条用例渲染后的 SVG 拆成可读的结构（圆点坐标、路径点）打出来
   用法: node test/dump.mjs F1 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { CASES } from './testset.mjs';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = path.join(ROOT, 'dist', 'extension', 'viewer.html');
const D = require2(path.join(ROOT, 'src', 'detect.js'));

const id = process.argv[2];
const c = CASES.find((x) => x.id === id);
if (!c) { console.error('没有用例 ' + id); process.exit(2); }

const browser = await chromium.launch({
  executablePath: 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 780, height: 620 } });
await page.goto(pathToFileURL(VIEWER).href);
const out = await page.evaluate(({ code, kind }) => {
  const fig = document.getElementById('fig');
  fig.innerHTML = '';
  try { if (kind === 'svg') fig.innerHTML = code; else (new Function(code))(); }
  catch (e) { return { err: String(e && e.message || e) }; }
  const svg = fig.querySelector('svg');
  if (!svg) return { err: 'no svg' };
  const circles = [...svg.querySelectorAll('circle')].map((el) =>
    'cx=' + (+el.getAttribute('cx')).toFixed(1) + ' cy=' + (+el.getAttribute('cy')).toFixed(1) +
    ' r=' + el.getAttribute('r') + ' fill=' + el.getAttribute('fill'));
  const paths = [...svg.querySelectorAll('path')].map((el) => (el.getAttribute('d') || '').slice(0, 160));
  const lines = [...svg.querySelectorAll('line')].length;
  return { circles, paths, lines, vb: svg.getAttribute('viewBox') };
}, { code: c.code, kind: D.classify(c.code) });
console.log(JSON.stringify(out, null, 1));
await browser.close();
