# MathViz

> MathViz — teach the model to draw math, then render it live: plots, 3D solids, and graphs, right inside the chat.

中文 · [English](README.en.md)

**MathViz 做两件事：**

1. **教会大模型画数学图。** 模型手写 SVG 画函数、立体、图论，错误高度集中——忘翻 y 轴、手算采样点、硬编码投影、边穿过节点。MathViz 把一套「作图协议 + 运行时」交给模型：模型只写数学表达式（`x => x*x - 2`、`edges:[["A","B",4]]`），采样、投影、布局、断点、隐藏边判定全部交给代码算。**这不只是给模型一个工具，而是一套可迭代的训练方法**：每一次模型画错，都变成运行时的一层容错或测试集的一条用例——今天修掉的「图例传字符串数组」「点了已释放的节点」，明天就是协议里的明确禁令。
2. **让 DeepSeek 网页端获得绘图能力。** DeepSeek 网页版没有 Artifacts、没有代码沙箱、没有公式之外的任何图形输出。MathViz 以 MV3 浏览器扩展 + Android WebView 套壳落地：按需把作图协议插进输入框（**一整轮对话只需一次**），再把模型回复里的 ` ```mathviz ` 代码块**就地渲染成图**——不调任何私有接口、不碰登录态，2D 曲线、可拖拽旋转的 3D 立体、可点击高亮的图论，直接长在聊天气泡里。

**一句话：模型只写数学，坐标交给运行时，扩展负责把图插回聊天。**

---

## 它解决什么

模型手写 SVG 画数学图，错误高度集中在五类：

| 错误 | 后果 |
|---|---|
| 忘了翻转 y 轴 | 函数图上下颠倒 |
| 手算采样点 | 曲率不均、端点突兀、渐近线处连出一条假竖线 |
| 用「等距投影」硬编码 3D 坐标 | 顶点改一处，全图错位；隐藏边全画成实线 |
| 图论边直接连圆心 | 边穿过节点，读者看不出拓扑 |
| 按英文字宽估中文 | 标签压线或被裁 |

MathViz 的解法是把坐标计算交给代码，并**用真实浏览器持续验证**：模型输出的典型写法被收进复现脚本（如 `test/q10-repro.mjs` 的 10 种图例写法），崩了就给运行时补容错，回归全绿才发版。

## 三条产线

不是所有图都值得引入运行时。选错产线是最常见的时间浪费。

| 情形 | 产线 | 代价 |
|---|---|---|
| 图元 ≤ 8、坐标简单、无交互 | 手写 SVG | 零依赖 |
| 函数 / 参数方程 / 极坐标 / 需要刻度 | `mk-core.js` | 采样与断点由代码算 |
| 立体几何 | `mk-3d.js` | 正交投影 + 隐藏边自动判定 |
| 图论 / 哈斯图 / 自动机 | `mk-graph.js` | 布局 + 边避让 |
| 文氏图 / 邻接矩阵 | `mk-graph.js` 内置 | 区域位置数学精确 |

## 两种形态，一套运行时

| | `app/` 应用版 | `skill/` 技能版 |
|---|---|---|
| 载体 | MV3 浏览器扩展（DeepSeek 网页）+ Android WebView 套壳 | WorkBuddy 技能包（对话内画图） |
| 协议下发 | 面板一键插入输入框，每轮对话一次 | SKILL.md 直接进入系统上下文 |
| 渲染 | 扩展在代码块原地把 ` ```mathviz ` 渲染成图 | 运行时内联，`show_widget` / HTML 呈现 |
| 交互 | 3D 拖拽旋转、双击复位、点面/点节点高亮 + 信息栏 | 同左（同一份运行时） |

`app/assets/` 与 `skill/assets/` 是同一份运行时快照，`sync-runtime.mjs` 做 sha256 校验防漂移。

## 目录

```
MathViz/
├── app/                       【应用版】浏览器扩展 + Android 套壳
│   ├── src/                   扩展源码（prompt.js 内含作图协议提示词）
│   ├── assets/                运行时快照（与 skill/assets 同一份，改后跑 node ../sync-runtime.mjs copy）
│   ├── android/               手机端：WebView 套壳 + 真机 CDP 验证脚本
│   ├── test/                  单元 61 / 交互 15 / 能力测试集 19 条
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

**DeepSeek 网页扩展**（详见 [`app/README.md`](app/README.md)）：

1. `edge://extensions/`（Chrome 是 `chrome://extensions/`）→ 开「开发人员模式」
2. 「加载解压缩的扩展」→ 选 `app/dist/extension/`
3. 打开 <https://chat.deepseek.com>，左下角出现 `∑ MathViz` 即成功

**Android**：构建 `app/android/` 得到 APK 安装；套壳内置同一套运行时，手机浏览器装不了扩展时的替代方案。

**WorkBuddy 技能**：

```bash
cp -r skill ~/.workbuddy/skills/math-visualizer
```

目录名必须与 `SKILL.md` 里的 `name: math-visualizer` 一致，否则技能不会被加载。

## 用起来（扩展）

1. 点左下角 `∑ MathViz`（或按 **`Alt + M`**）打开面板
2. 选一个**作图模式**（通用自动选产线 / 函数与2D / 立体与3D / 图论与离散 / 纯SVG）
3. 点「插入提示词」——协议以明文插进输入框（**你能看到、能改**），你的问题保留在末尾
4. 正常发送。**一整轮对话只需要给这一次**，后面直接问「再画一个离心率 0.8 的椭圆」就行
5. 开了新对话，点面板上的「**新对话**」重置，再重新给一次

图渲染在模型输出的那个代码块内部：原代码收起（点「源码」能看回来），右上角留源码 / 复制 / 重渲染 / 折叠四个小按钮。

**3D 与图论交互**：画布自带拖拽旋转与双击复位；`S.face(pt,{info:'说明'})`、`S.solid(v,f,{faceInfo:[...]})`、图论节点 `info` —— 点击高亮并在底部信息栏显示说明。

**技能版用法**：直接说「画一下 y = x³ − 3x 在 x=1.5 处的切线」，技能会自动选产线、内联运行时出图；要独立文件就说「导出成 HTML」。

## 测试

```bash
cd app
npm test                        # 单元 61 项
node test/interact.test.mjs     # 交互 15 项（真实 Chromium，合成 pointer 事件）
node test/verify-testset.mjs    # 能力测试集 19 条
node test/compliance.mjs reply.txt --render   # 模型回复遵循度打分（静态 + 真渲染）
```

另有真机验证链：`app/android/{verify,interact-check,diagnose,grab-q28}.mjs` 通过 CDP 连真机 WebView，覆盖注入、渲染、交互三类检查。

## 验证过的内容

三个运行时不是「写完就算」，每个能力都用无头浏览器渲染后肉眼核过：

- 2D：`tan` 在渐近线处无假竖线；抛物线比例正确；刻度与轴标签不重叠；文字有描边可读。
- 3D：立方体正好 3 条隐藏边、四棱锥 5 条，与法线推导一致；正六边形截面在 `yaw 26 / pitch 36` 下清晰可辨。
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

## License

[MIT](LICENSE)
