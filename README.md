# MathViz

让大模型画数学图时**不用手算坐标**，从而更快、更准。

方向：函数图像、向量与线性代数、平面几何、立体几何、离散数学（图论 / 哈斯图 / 文氏图 / 自动机）。

## 它解决什么

模型手写 SVG 画数学图，错误高度集中在五类：

| 错误 | 后果 |
|---|---|
| 忘了翻转 y 轴 | 函数图上下颠倒 |
| 手算采样点 | 曲率不均、端点突兀、渐近线处连出一条假竖线 |
| 用「等距投影」硬编码 3D 坐标 | 顶点改一处，全图错位；隐藏边全画成实线 |
| 图论边直接连圆心 | 边穿过节点，读者看不出拓扑 |
| 按英文字宽估中文 | 标签压线或被裁 |

MathViz 的做法是**把坐标计算交给代码**：模型只写数学表达式（`x => x*x - 2`、`[0,0,0]→[2,2,2]`、`edges:[["A","B",4]]`），投影、采样、布局、断点、隐藏边判定全由运行时完成。

## 三条产线

不是所有图都值得引入运行时。选错产线是最常见的时间浪费。

| 情形 | 产线 | 代价 |
|---|---|---|
| 图元 ≤ 8、坐标简单、无交互 | 手写 SVG | 零依赖 |
| 函数 / 参数方程 / 极坐标 / 需要刻度 | `mk-core.js` | 采样与断点由代码算 |
| 立体几何 | `mk-3d.js` | 正交投影 + 隐藏边自动判定 |
| 图论 / 哈斯图 / 自动机 | `mk-graph.js` | 布局 + 边避让 |
| 文氏图 / 邻接矩阵 | `mk-graph.js` 内置 | 区域位置数学精确 |

## 目录

```
MathViz/
├── app/                       【应用版】浏览器扩展 + Android 套壳（原 deepseek-web/mathviz）
│   ├── src/                   扩展源码（prompt.js 内含作图协议提示词）
│   ├── assets/                运行时快照（与 skill/assets 同一份，改后跑 node ../sync-runtime.mjs copy）
│   ├── android/               手机端：WebView 套壳 + 真机验证脚本
│   ├── test/                  单元 / 交互 / 能力测试集（19 条）
│   ├── testset.md             测试集文档；testset-paste.md 直接粘贴版
│   └── dist/                  构建产物（extension/ + extension.zip）
├── skill/                     可安装的技能包（对话内画图；运行时与 app 共用）
│   ├── SKILL.md               触发判定 / 产线选择 / 执行流程
│   ├── references/            七份按主题的作图知识
│   │   ├── mathkit-api.md     运行时完整 API
│   │   ├── plot-2d.md         函数、参数方程、极坐标、导数、积分
│   │   ├── geometry.md        平面几何、三角形、圆、圆锥曲线
│   │   ├── solid-3d.md        投影、多面体、截面、二面角、三视图
│   │   ├── discrete.md        图论、哈斯图、文氏图、矩阵、自动机、逻辑门
│   │   ├── linear-algebra.md  向量、投影、张成、变换、特征向量
│   │   └── checklist.md       十条自检 + 现象对照 + 符号表
│   ├── assets/                三个运行时（可读源码，约 1600 行）
│   │   ├── mk-core.js
│   │   ├── mk-3d.js
│   │   └── mk-graph.js
│   └── scripts/
│       ├── verify.mjs         用无头浏览器跑 getBBox，查越界与字号
│       └── build-standalone.mjs  把外链脚本内联成单文件
├── examples/                  六个可双击打开的示例
│   ├── 01-function-tangent.html
│   ├── 02-vector-projection.html
│   ├── 03-triangle-incenter.html
│   ├── 04-cube-hexagon.html
│   ├── 05-graph-shortest-path.html
│   ├── 06-dfa.html
│   └── dist/                  内联后的独立单文件版
└── docs/design.md             设计决策与取舍记录
```

## 安装

把 `skill/` 复制到用户级技能目录：

```bash
cp -r skill ~/.workbuddy/skills/math-visualizer
```

目录名必须与 `SKILL.md` 里的 `name: math-visualizer` 一致，否则技能不会被加载。

## 用起来

**对话内出图**：直接说「画一下 y = x³ − 3x 在 x=1.5 处的切线」，技能会自动选产线、内联运行时、调 `show_widget`。

**要独立文件**：说「导出成 HTML」，会落盘并用 `present_files` 打开。

**验证一张图有没有问题**：

```bash
node skill/scripts/verify.mjs examples/04-cube-hexagon.html
```

输出每张图的元素数、虚线数、越界元素、字号过小的文字。有越界就退出码 1。

**打包成单文件**（发给别人、脱离项目目录也能打开）：

```bash
node skill/scripts/build-standalone.mjs examples/04-cube-hexagon.html
```

## 验证过的内容

三个运行时不是「写完就算」，每个能力都用无头 Edge 渲染后肉眼核过：

- 2D：`tan` 在渐近线处无假竖线；抛物线比例正确；刻度与轴标签不重叠；文字有描边可读。
- 3D：立方体正好 3 条隐藏边、四棱锥 5 条，与法线推导一致；正六边形截面在 `yaw 26 / pitch 36` 下清晰可辨（另试了三组视角，`45/35.3` 正对截面但立方体失去立体感）。
- 图论：箭头方向、边避让（高亮路径绕过中间节点）、哈斯图重心排序减交叉、文氏图七个区域标签逐个验算落在正确区域。
- 全部示例通过 `verify.mjs`。

## 已知限制

- **画布宽度固定 680**。这是承载环境的硬约束，改为自适应会破坏所有坐标假设。
- **内联运行时占 token**。`mk-core.js` 约 500 行，复杂图要再加 3D / 图论模块。简单图请走手写 SVG 产线。这是有意的权衡：一次性多花 1 万 token，换掉几十次坐标算错的重画。
- **3D 只有正交投影**，没有透视。教学图足够，写实渲染不适合。
- **`force` 布局每次结果不同**，节点多时会乱。要稳定输出用 `circle` 或手动给坐标。
- **圆锥曲线只给参数化画法**，不给隐式方程求根。`x²+y²=1` 这类要自己转成 `t => [cos t, sin t]`。
- **中文字宽按 1em 估算**，极窄的西文混排仍可能差 1–2px，靠 `verify.mjs` 兜底。
- 字体依赖系统 `--font-sans` / `--font-serif`，数学斜体用 serif，某些环境会回落到默认衬线体。
