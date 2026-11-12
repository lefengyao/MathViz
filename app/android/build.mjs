/* Android assets 组装
   1. 先重建浏览器扩展（保证 dist/extension 是最新的）
   2. 把 platform-android.js + 扩展的 4 个 JS 拼成 inject.js
   3. 复制 viewer.html
   业务代码只有 src/ 一份来源，不复制、不手改 assets。

     node build.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(ROOT, '..', 'dist', 'extension');
const ASSETS = path.join(ROOT, 'app', 'src', 'main', 'assets');
const read = (p) => fs.readFileSync(p, 'utf8');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

console.log('重建扩展…');
execFileSync(process.execPath, [path.resolve(ROOT, '..', 'build.mjs')], { stdio: 'ignore' });

fs.mkdirSync(ASSETS, { recursive: true });

const parts = [
  ['platform-android.js', read(path.join(ROOT, 'platform-android.js'))],
  ['prompt.js', read(path.join(EXT, 'prompt.js'))],
  ['detect.js', read(path.join(EXT, 'detect.js'))],
  ['ui-css.js', read(path.join(EXT, 'ui-css.js'))],
  ['content.js', read(path.join(EXT, 'content.js'))]
];
const inject = parts.map(([name, code]) => '/* ---- ' + name + ' ---- */\n' + code).join('\n');
fs.writeFileSync(path.join(ASSETS, 'inject.js'), inject);

const viewer = read(path.join(EXT, 'viewer.html'));
fs.writeFileSync(path.join(ASSETS, 'viewer.html'), viewer);

const problems = [];
if (/chrome\./.test(inject)) problems.push('inject.js 里还有 chrome.* 调用（平台层没抽干净）');
for (const sig of ['MVPlatform', 'MVPrompt', 'MVDetect', 'MVCss', '__mvLoaded']) {
  if (!inject.includes(sig)) problems.push('inject.js 缺少 ' + sig);
}
for (const sig of ['g.MK = {', 'MK.space = space', 'MK.graph = graph', 'MK.schematic = schematic', 'mv:render']) {
  if (!viewer.includes(sig)) problems.push('viewer.html 缺少 ' + sig);
}
if (problems.length) {
  console.error('\n组装校验失败：\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

console.log('\nAndroid assets 组装完成');
console.log('  inject.js   ' + kb(Buffer.byteLength(inject)));
console.log('  viewer.html ' + kb(Buffer.byteLength(viewer)));
console.log('\n校验通过：平台层齐全、无 chrome.* 残留、四段运行时已内联。');
