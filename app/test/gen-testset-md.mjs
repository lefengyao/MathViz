/* 从 testset.mjs 生成 testset.md（人手只用改 testset.mjs，别直接改 md） */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CASES, GROUPS } from './testset.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* 测提示词遵循度时直接向模型提的问题（需先插入对应模式的提示词） */
const QUESTIONS = {
  A1: '画一下 y = sin x 和 y = cos x 的图像，标出一个峰值点',
  A2: '用参数方程画椭圆 x=3cos t, y=2sin t',
  A3: '画极坐标心形线 r = 1 + cos θ',
  A4: '画 sin x 在 [0, π] 下方的定积分面积并标注面积值',
  A5: '画 y = tan x，画出垂直渐近线',
  B1: '画一个单位立方体，可拖拽旋转',
  B2: '画一个球面和水平截面 z = 0.4',
  B3: '画一个底面 2×2、高 2 的四棱锥',
  B4: '画空间向量 a=[1,0,0] 和 b=[0,1,0]，标出夹角',
  B5: '画一个可交互的立方体：每面标注名称，旁边放一个球，点一下能高亮并显示说明',
  C1: '画一个带权无向图并高亮 A 到 F 的最短路径',
  C2: '画一个 AOV 网拓扑排序的分层有向图',
  C3: '画一棵 7 节点的满二叉树',
  C4: '画三集合文氏图：偶数、3 的倍数、大于 5',
  C5: '画关系矩阵 R（自反 + 反对称的 3 阶示例）',
  D1: '—（纯 SVG 主要测扩展识别，不建议让模型手写）',
  E1: '分别画 sin 曲线和画一个矩形示意图（要求输出两个代码块）',
  E2: '先写欧拉公式，再画单位圆上的 e^{iθ}',
  E3: '—（负向用例：故意写错代码，只测扩展的错误提示）'
};
const L = [];
L.push('# MathViz 能力测试集');
L.push('');
L.push('> 以下 ' + CASES.length + ' 条用例已由 `test/verify-testset.mjs` 在真实 Chromium 里逐条跑通（' + CASES.length + '/' + CASES.length + '）。');
L.push('> 数据源是 `test/testset.mjs`，改用例改那里，然后：');
L.push('>');
L.push('> ```bash');
L.push('> node test/verify-testset.mjs   # 先跑通');
L.push('> node test/gen-testset-md.mjs   # 再重新生成本文件');
L.push('> ```');
L.push('');
L.push('## 怎么用');
L.push('');
L.push('每条用例都是**自包含**的：把「测试代码」下面的整段（含 ` ```mathviz ` 围栏）原样复制到输入框，');
L.push('直接发送即可——**用户消息里的 mathviz 代码块同样会被渲染**，不依赖模型。');
L.push('想顺带测提示词遵循度，就先按 `question` 列直接向模型提问（需先插入对应模式的提示词）。');
L.push('');
L.push('判读标准：');
L.push('');
L.push('- ✅ 出图、无失败卡片 → 通过');
L.push('- ⏳ 工具条显示「N 段未写完」→ 代码不完整被扣住，8 秒后仍残缺才兜底渲染（E3 除外，见负向）');
L.push('- ❌ 出现「渲染失败」→ 记下卡片上的中文错误信息，连同用例编号反馈');
L.push('');
L.push('## 自动看模型有没有守规矩');
L.push('');
L.push('把模型针对下表问题的**原始回复**整段存成 txt（含 ` ```mathviz ` 围栏，解释文字不用删），交给检查器：');
L.push('');
L.push('```bash');
L.push('node test/compliance.mjs reply.txt            # 静态判定');
L.push('node test/compliance.mjs reply.txt --render   # 再真跑一遍渲染');
L.push('node test/compliance.mjs --selftest           # 反向验证规则本身');
L.push('```');
L.push('');
L.push('它只干一件事：数模型有没有按协议用运行时。重点抓这四类——');
L.push('');
L.push('| 编号 | 抓什么 | 为什么算错 |');
L.push('|---|---|---|');
L.push('| R4 | 自己 `addEventListener(\'pointermove\')`、跑 `requestAnimationFrame`、写 `S.drag` | 拖拽旋转 / 双击复位已内置，自己实现会与运行时抢事件 |');
L.push('| R6 | 自己声明 `yaw` / `pitch` / `rotate` | 与运行时的视角打架，重放式重绘会跳 |');
L.push('| R7 | 3D 块里 `V.plot`、2D 块里 `S.solid` | 那个模块里没这个函数，必然 TypeError |');
L.push('| R3 | 代码里出现 `...` 或「其余省略」 | 扩展按完整性预判扣住，8 秒后才兜底渲染 |');
L.push('');
L.push('告警（⚠️）不扣通过，但值得记一笔：手算 path、写死 `#1f6feb`、box 宽度偏离 680。');
L.push('');
L.push('`--selftest` 拿这 ' + CASES.length + ' 条正例加 7 条反例反向验证规则：正例一条都不许判违规，反例一条都不许漏。');
L.push('');
L.push('| 编号 | 能力 | 直接向模型提问（测提示词遵循） |');
L.push('|---|---|---|');
for (const c of CASES) {
  L.push('| ' + c.id + ' | ' + c.name + ' | ' + (QUESTIONS[c.id] || '—') + ' |');
}
L.push('');

let lastGroup = '';
for (const c of CASES) {
  if (c.group !== lastGroup) {
    lastGroup = c.group;
    L.push('## ' + c.group);
    L.push('');
  }
  L.push('### ' + c.id + ' ' + c.name + (c.negative ? '（负向用例）' : ''));
  L.push('');
  if (c.prose) {
    L.push('本条含正文混排，粘贴整段（正文 + 代码块）：');
    L.push('');
    L.push(':::: 4 个反引号');
    L.push(c.prose);
    L.push('');
    L.push('```mathviz');
    L.push(c.code);
    L.push('```');
    L.push(':::: 4 个反引号');
  } else if (c.codes) {
    L.push('本条含**两个**代码块，应出**两张图**。粘贴整段：');
    L.push('');
    L.push(':::: 4 个反引号');
    for (const b of c.codes) {
      L.push('```mathviz');
      L.push(b);
      L.push('```');
      L.push('');
    }
    L.push(':::: 4 个反引号');
  } else {
    L.push('粘贴整段：');
    L.push('');
    L.push(':::: 4 个反引号');
    L.push('```mathviz');
    L.push(c.code);
    L.push('```');
    L.push(':::: 4 个反引号');
  }
  if (c.negative) {
    L.push('');
    L.push('**预期**：不渲染失败卡片，而是给出可读的中文错误提示（参数格式不对类）。');
  }
  if (c.interactive) {
    L.push('');
    L.push('**交互验证**：' + c.interactive + '。');
  }
  L.push('');
}

let out = L.join('\n');
out = out.replace(/:::: 4 个反引号/g, '````');
fs.writeFileSync(path.join(ROOT, 'testset.md'), out, 'utf8');
console.log('已生成 testset.md（' + CASES.length + ' 条用例）');
