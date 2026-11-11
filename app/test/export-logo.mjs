/* 从母版 SVG 导出全部尺寸：
   - 扩展图标 16/32/48/128 → src/icons 下 icon16/32/48/128.png
   - Android 普通图标 48/72/96/144/192 → res 下各 mipmap 目录 ic_launcher.png
   - Android 自适应前景 432 → android/app/src/main/res/drawable/ic_launcher_fg.png */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const require2 = createRequire(import.meta.url);
const { chromium } = require2('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';

const master = fs.readFileSync(path.join(ROOT, 'src', 'icons', 'logo.svg'), 'utf8');

/* 小尺寸变体：网格保留，轴与波加粗、点加大，缩到 16/32 仍清晰 */
const small = master
  .replace(/stroke-width="12"/g, 'stroke-width="20"')
  .replace(/stroke-width="24"/g, 'stroke-width="40"')
  .replace(/r="26"/, 'r="34"');

/* 前景变体：去掉底色 rect，图形缩到中心 62%（108dp 安全区 66dp） */
const fg = master
  .replace(/<rect width="512" height="512" rx="112" fill="#2C2C2A"\/>/, '')
  .replace(/<g>/, '<g transform="translate(97,97) scale(0.62)">');

function svgAt(size, body) {
  return body.replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 512 512">');
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();

async function shot(body, size, outPath) {
  const html = '<body style="margin:0;background:transparent">' + svgAt(size, body) + '</body>';
  await page.setContent(html);
  await page.locator('svg').screenshot({ path: outPath });
  console.log('✓ ' + path.relative(ROOT, outPath) + ' (' + size + 'px)');
}

for (const s of [16, 32]) {
  await shot(small, s, path.join(ROOT, 'src', 'icons', 'icon' + s + '.png'));
}
for (const s of [48, 128]) {
  await shot(master, s, path.join(ROOT, 'src', 'icons', 'icon' + s + '.png'));
}

const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const DPI = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
for (const [dir, s] of Object.entries(DPI)) {
  fs.mkdirSync(path.join(RES, dir), { recursive: true });
  await shot(master, s, path.join(RES, dir, 'ic_launcher.png'));
}
fs.mkdirSync(path.join(RES, 'drawable'), { recursive: true });
await shot(fg, 432, path.join(RES, 'drawable', 'ic_launcher_fg.png'));

await browser.close();
console.log('全部导出完成');
