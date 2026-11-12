/* 同步检查：app（扩展 + Android）与 skill（WorkBuddy 技能包）共用同一份运行时。
   两处各有一份 mk-*.js，本脚本校验一致性；--copy 用 app 侧覆盖 skill 侧。
   用法：node sync-runtime.mjs [check|copy]  （默认 check） */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app', 'assets');
const SKILL = path.join(ROOT, 'skill', 'assets');
const FILES = ['mk-core.js', 'mk-3d.js', 'mk-graph.js', 'mk-eng.js'];
const mode = process.argv[2] || 'check';

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
let drift = 0;

for (const f of FILES) {
  const a = path.join(APP, f), s = path.join(SKILL, f);
  if (!fs.existsSync(a)) { console.error('✗ app 侧缺失 ' + f); drift = 1; continue; }
  if (!fs.existsSync(s)) {
    if (mode === 'copy') {
      fs.copyFileSync(a, s);
      console.log('+ ' + f + '  skill 侧新建 (' + sha(a) + ')');
      continue;
    }
    console.error('✗ skill 侧缺失 ' + f);
    drift = 1;
    continue;
  }
  const ha = sha(a), hs = sha(s);
  if (ha === hs) { console.log('✓ ' + f + '  ' + ha); continue; }
  if (mode === 'copy') {
    fs.copyFileSync(a, s);
    console.log('↻ ' + f + '  已用 app 侧 (' + ha + ') 覆盖 skill 侧 (' + hs + ')');
  } else {
    console.log('✗ ' + f + '  两份不一致  app=' + ha + '  skill=' + hs);
    drift = 1;
  }
}

if (mode !== 'copy') {
  console.log(drift ? '\n有漂移。运行 node sync-runtime.mjs copy 以 app 侧为准同步。' : '\n两处运行时一致。');
} else {
  console.log('\n同步完成。skill 与 app 现在共用同一份运行时。');
}
process.exit(mode === 'copy' ? 0 : drift);
