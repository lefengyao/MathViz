/* 复现第 10 题（sin + 泰勒近似 + 图例）模型可能的各种写法，找出崩溃点 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = path.join(ROOT, 'dist', 'extension', 'viewer.html');
const CHROME = 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';

const VARIANTS = {
  'V1 标准写法(对象图例)': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true, title:'sin x 与泰勒近似'});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2.2});",
    "V.plot(function(x){return x - x*x*x/6;}, {color:'coral', w:2, dash:true});",
    "V.legend([{text:'sin x',color:'blue'},{text:'三次泰勒',color:'coral',dash:true}]);"
  ].join('\n'),
  'V2 图例传字符串数组': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot(function(x){return Math.sin(x);}, {color:'blue'});",
    "V.plot(function(x){return x - x**3/6;}, {color:'coral', dash:true});",
    "V.legend(['sin x', '泰勒近似']);"
  ].join('\n'),
  'V3 用 ** 幂运算符': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot(x => Math.sin(x), {color:'blue'});",
    "V.plot(x => x - x**3/6 + x**5/120, {color:'coral', dash:true});"
  ].join('\n'),
  'V4 用 ^ 当幂(语义错但不崩)': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot(function(x){return Math.sin(x);}, {color:'blue'});",
    "V.plot(function(x){return x - x^3/6;}, {color:'coral', dash:true});"
  ].join('\n'),
  'V5 plot 带 label': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot(function(x){return Math.sin(x);}, {color:'blue', label:'sin x'});",
    "V.plot(function(x){return x - x**3/6;}, {color:'coral', dash:true, label:'P3(x)'});"
  ].join('\n'),
  'V6 传字符串当函数': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot('Math.sin(x)', {color:'blue'});"
  ].join('\n'),
  'V7 漏 appendChild': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true});",
    "V.plot(function(x){return Math.sin(x);}, {color:'blue'});"
  ].join('\n'),
  'V8 Unicode 负号/上标写进代码': [
    "var V = MK.frame({box:[40,26,600,330], x:[−7,7], y:[-3,3], grid:true, axes:true});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot(function(x){return Math.sin(x);}, {color:'blue'});"
  ].join('\n'),
  'V9 泰勒区间外爆炸(大数值)': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot(function(x){return x - x*x*x/6 + Math.pow(x,5)/120 - Math.pow(x,7)/5040 + Math.pow(x,9)/362880 - Math.pow(x,11)/39916800;}, {color:'coral', dash:true});"
  ].join('\n'),
  'V10 图例中文超长+特殊字符': [
    "var V = MK.frame({box:[40,26,600,330], x:[-7,7], y:[-3,3], grid:true, axes:true});",
    "document.getElementById('fig').appendChild(V.svg);",
    "V.plot(function(x){return Math.sin(x);}, {color:'blue'});",
    "V.legend([{text:'sin x（原函数）',color:'blue'},{text:'x − x³/6（三次泰勒近似多项式）',color:'coral',dash:true}]);"
  ].join('\n')
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(VIEWER).href);

for (const [name, code] of Object.entries(VARIANTS)) {
  const r = await page.evaluate((code) => {
    const fig = document.getElementById('fig');
    const out = { errors: [], svgs: 0, nodes: 0 };
    fig.innerHTML = '';
    const errBox = document.getElementById('mv-err');
    errBox.style.display = 'none'; errBox.textContent = '';
    try { (new Function(code))(); } catch (e) { out.errors.push(e && e.message ? e.message : String(e)); }
    if (errBox.style.display !== 'none' && errBox.textContent) out.errors.push(errBox.textContent);
    out.svgs = fig.querySelectorAll('svg').length;
    out.nodes = fig.querySelectorAll('svg *').length;
    return out;
  }, code);
  const ok = r.errors.length === 0 && r.svgs >= 1 && r.nodes > 0;
  console.log((ok ? '✓' : '✗') + ' ' + name + '  svg=' + r.svgs + ' 图元=' + r.nodes +
    (r.errors.length ? '  错误=' + JSON.stringify(r.errors) : ''));
}
await browser.close();
