/* MathViz for DeepSeek —— 一键构建
   node build.mjs
   产出 dist/extension/（可直接「加载解压缩的扩展」）与 dist/extension.zip。
   沿用 deepseek-web/browser/build.mjs 的做法：源码在 src/，产物全部重建，
   构建时做静态校验（manifest 引用、占位符、运行时完整性），不依赖任何 npm 包。 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(ROOT, 'assets');
const DIST = path.join(ROOT, 'dist');
const EXT = path.join(DIST, 'extension');

const read = (p) => fs.readFileSync(p, 'utf8');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(path.join(EXT, 'icons'), { recursive: true });

function write(rel, data) {
  const out = path.join(EXT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, typeof data === 'string' ? data : Buffer.from(data));
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. 图标：纯标准库画 PNG（圆角蓝底 + 坐标轴 + 抛物线），3x3 超采样     */
/* ------------------------------------------------------------------ */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(size, sample) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const off = y * stride;
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const c = sample((x + (sx + 0.5) / 3) / size, (y + (sy + 0.5) / 3) / size);
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const p = off + 1 + x * 4;
      raw[p] = r / 9; raw[p + 1] = g / 9; raw[p + 2] = b / 9; raw[p + 3] = a / 9;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}
function iconSample(u, v) {
  const R = 0.22;
  const x = Math.min(u, 1 - u), y = Math.min(v, 1 - v);
  if (x < R && y < R && (x - R) ** 2 + (y - R) ** 2 > R * R) return [0, 0, 0, 0];
  let px = [77 + Math.round(v * 18), 107 + Math.round(v * 20), 254 - Math.round(v * 14), 255];
  const white = [255, 255, 255, 255];
  const axisX = v > 0.775 && v < 0.795 && u > 0.12 && u < 0.9;
  const axisY = u > 0.165 && u < 0.185 && v > 0.1 && v < 0.82;
  const t = (u - 0.5) / 0.34;
  const curveV = 0.72 - t * t * 0.52;
  const curve = u > 0.19 && u < 0.81 && Math.abs(v - curveV) < 0.022;
  const dotU = 0.7, dotV = 0.72 - ((dotU - 0.5) / 0.34) ** 2 * 0.52;
  const dot = (u - dotU) ** 2 + (v - dotV) ** 2 < 0.045 ** 2;
  return (axisX || axisY || curve || dot) ? white : px;
}
for (const s of [16, 32, 48, 128]) write('icons/icon' + s + '.png', png(s, iconSample));

/* ------------------------------------------------------------------ */
/* 2. content script：源码直出 + 把 CSS 变成可注入的 JS 常量            */
/* ------------------------------------------------------------------ */
for (const f of ['platform-chrome.js', 'prompt.js', 'detect.js', 'content.js']) write(f, read(path.join(SRC, f)));
write('ui-css.js', 'window.MVCss = ' + JSON.stringify(read(path.join(SRC, 'ui.css'))) + ';\n');

/* ------------------------------------------------------------------ */
/* 3. viewer.html：把三个运行时 + viewer.js 内联进沙箱页                */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s).replace(/<\/script>/gi, '<\\/script>');
let html = read(path.join(SRC, 'viewer.html'));
const parts = {
  '/* __MK_CORE__ */': read(path.join(ASSETS, 'mk-core.js')),
  '/* __MK_3D__ */': read(path.join(ASSETS, 'mk-3d.js')),
  '/* __MK_GRAPH__ */': read(path.join(ASSETS, 'mk-graph.js')),
  '/* __VIEWER_JS__ */': read(path.join(SRC, 'viewer.js'))
};
for (const [token, code] of Object.entries(parts)) {
  if (!html.includes(token)) throw new Error('viewer.html 缺少占位符 ' + token);
  html = html.replace(token, esc(code));
}
write('viewer.html', html);

/* ------------------------------------------------------------------ */
/* 4. manifest：同步版本号                                             */
/* ------------------------------------------------------------------ */
const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
const manifest = JSON.parse(read(path.join(SRC, 'manifest.json')));
manifest.version = pkg.version;
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

/* ------------------------------------------------------------------ */
/* 5. 静态校验                                                         */
/* ------------------------------------------------------------------ */
const problems = [];
const need = (rel) => { if (!fs.existsSync(path.join(EXT, rel))) problems.push('缺文件: ' + rel); };
for (const js of manifest.content_scripts.flatMap((c) => c.js)) need(js);
(manifest.sandbox.pages || []).forEach(need);
for (const w of manifest.web_accessible_resources || []) {
  for (const r of w.resources) if (!r.includes('*')) need(r);
}
for (const k of ['16', '32', '48', '128']) {
  need(manifest.icons[k]);
  need(manifest.action.default_icon[k]);
}
if (/__MK_|__VIEWER_JS__/.test(html)) problems.push('viewer.html 有未替换的占位符');
for (const [label, sig] of [['mk-core', 'g.MK = {'], ['mk-3d', 'MK.space = space'], ['mk-graph', 'MK.graph = graph']]) {
  if (!html.includes(sig)) problems.push('运行时没内联: ' + label);
}
if (!html.includes('mv:render')) problems.push('viewer.js 没内联');
if (/chrome\./.test(read(path.join(SRC, 'content.js')))) {
  problems.push('content.js 仍直接引用 chrome.*，必须走 MVPlatform 才能复用到 WebView');
}
if (!manifest.sandbox || !(manifest.sandbox.pages || []).length) problems.push('manifest 缺 sandbox 声明');
if (!(manifest.web_accessible_resources || []).some((w) => (w.resources || []).includes('viewer.html'))) {
  problems.push('viewer.html 没在 web_accessible_resources 里声明');
}
if (problems.length) {
  console.error('\n构建校验失败：\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 6. 打 zip（自己写，不依赖外部命令）                                  */
/* ------------------------------------------------------------------ */
function zipDirectory(dir) {
  const files = [];
  (function walk(d, prefix) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      const name = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, name);
      else files.push({ name, data: fs.readFileSync(full) });
    }
  })(dir, '');

  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const deflated = zlib.deflateRawSync(f.data, { level: 9 });
    const useDeflate = deflated.length < f.data.length;
    const payload = useDeflate ? deflated : f.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return { buffer: Buffer.concat([...chunks, cdBuf, eocd]), count: files.length };
}

const zip = zipDirectory(EXT);
fs.writeFileSync(path.join(DIST, 'extension.zip'), zip.buffer);

/* ------------------------------------------------------------------ */
console.log('\nMathViz for DeepSeek v' + manifest.version + ' 构建完成\n');
for (const f of ['manifest.json', 'platform-chrome.js', 'prompt.js', 'detect.js', 'ui-css.js', 'content.js', 'viewer.html']) {
  console.log('  ' + f.padEnd(22) + kb(fs.statSync(path.join(EXT, f)).size));
}
console.log('  icons/            4 个 PNG');
console.log('  上传包            ' + kb(zip.buffer.length) + '（' + zip.count + ' 个文件，manifest.json 在根）');
console.log('\n校验通过：manifest 引用完整、占位符已替换、三段运行时已内联、sandbox 页已声明。');
