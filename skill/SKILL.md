---
name: math-visualizer
description: >-
  Renders accurate, textbook-quality mathematical figures in HTML/SVG —
  function plots, coordinate systems, vectors and linear algebra, plane and
  solid geometry, graph-theory diagrams, Hasse diagrams, Venn diagrams,
  automata and geometric constructions. Use when the user asks to draw, plot,
  sketch, diagram or visualize anything mathematical or geometric, or when
  explaining a math concept benefits from a precise figure. Do not use for
  flowcharts, product mockups, decorative illustrations, or bitmap images.
agent_created: true
---

# 数学图形

在对话内产出**坐标正确、比例正确、标注正确**的数学图。不落盘，用户要文件时再导出。

核心原则：**不要让模型手算坐标。** 能交给数学表达式的，就不要写死像素点。

## 何时使用

| 用户说 | 动作 |
|---|---|
| 画 / 作图 / 示意 / 函数图像 / 向量 / 平面 / 立体 / 三视图 | 走本 skill |
| 图论 / 有向图 / 最短路径 / 树 / 哈斯图 / 偏序 / 文氏图 / 自动机 / 真值表 | 走本 skill |
| 讲解一个数学概念（导数、张成空间、二面角、等价关系） | 走本 skill —— 配图比文字有效 |
| 流程图 / 架构图 / 界面稿 / 装饰插画 | 不走 —— 用 `inline-visualizer` |
| 位图 / 照片 / 插画 | 不走 —— 用 `ImageGen` |
| 要能下载、能独立打开的 `.html` 文件 | 走本 skill，末尾按「导出」一节落盘 |

## 三条产线

先判断复杂度，再决定怎么写。**选错产线是最常见的时间浪费。**

| 情形 | 产线 | 代价 |
|---|---|---|
| 图元 ≤ 8 个，坐标是整数或简单分数，不需交互 | **手写 SVG** | 零依赖，最快 |
| 函数曲线、参数方程、极坐标、向量场、需要刻度 | **mathkit 2D** | 采样由代码算，不会画错 |
| 立体几何、多面体、截面 | **mathkit 3D** | 投影与隐藏边自动判定 |
| 图论、哈斯图、自动机、关系图 | **mathkit graph** | 布局与边避让由代码算 |
| 文氏图、邻接矩阵 | **mathkit 内置** | 区域位置数学精确 |

判断口诀：**有曲线就走运行时，有第三个维度就走运行时，有"布局"就走运行时；其余手写。**

## 执行步骤

1. **定口径**。这张图要回答什么问题？必须标注哪几个量（点的坐标、长度、角度、权重）？不标注多余的东西。
2. **选产线**。按上表。
3. **取主题**。读 `<user_info>` 的 **IDE Theme**，亮色用浅填充 + 深描边，暗色反过来。调 `widget_guidelines(modules:["diagram","interactive"])` 拿当次规范与调色板，**不要凭记忆写 hex**。
4. **写代码**。用 mathkit 时，先内联脚本再画：
   ```html
   <div id="fig"></div>
   <script>/* mk-core.js 全文 */</script>
   <script>
   var V = MK.frame({box:[40,26,600,330], x:[-4,4], y:[-3,5], equal:true, grid:true, axes:true});
   document.getElementById('fig').appendChild(V.svg);
   V.plot(function(x){ return x*x - 2; }, {color:'blue', w:2});
   </script>
   ```
   脚本用 Read 读取 `assets/` 下的文件后原样内联，**不要改写运行时**。
5. **自检**。扫 `references/checklist.md` 的十条。有条件就跑 `scripts/verify.mjs`。
6. **出图**。`show_widget` 的 `widget_code` 放裸片段（无 `html/head/body`），`title` 用中文且具体。
7. **解释**。结论、推导、注意点写在回复正文，图里只放图。

## 硬约束

1. `viewBox="0 0 680 H"`，`680` 不可改；内容落在 x=40~640。
2. **每个图元显式写 `fill`**。`c-*` 颜色类在部分渲染环境不生效，依赖它会变黑块。
3. 字号 ≥ 11px，字重只用 400 / 500。
4. 无 HTML 注释、无 `/* */`、无 emoji、无 `position: fixed`、外层背景透明。
5. 数学斜体：变量、点、函数名用 `font-style:italic` + serif；数字和单位用正体。
6. 几何图必须等比（`equal:true`），函数图可以不等于。
7. 连接线一律 `fill="none"`，否则箭头/折线变成实心块。
8. 中文按 **1 字 ≈ 1 em** 估宽，英文数字按 0.56 em。标签放不下就换行或缩字号，不要压线。

## 自检

```bash
node scripts/verify.mjs 你的页面.html
```

输出每张图的元素数、虚线数、越界元素。**越界 = 文字被裁或图跑出画布**，必须修。

## 资源

| 文件 | 什么时候读 |
|---|---|
| `references/mathkit-api.md` | 用运行时之前 —— 完整 API 与参数 |
| `references/plot-2d.md` | 画函数、参数方程、极坐标、导数、积分 |
| `references/geometry.md` | 平面几何、三角形、圆、圆锥曲线、角与等长标注 |
| `references/solid-3d.md` | 立体几何、投影、多面体、截面、二面角 |
| `references/discrete.md` | 图论、哈斯图、文氏图、矩阵、自动机、逻辑门 |
| `references/linear-algebra.md` | 向量、线性组合、变换、特征向量、张成空间 |
| `references/checklist.md` | 出图前 —— 十条自检 + 常见错误对照表 |
| `assets/mk-core.js` | 2D 运行时（约 580 行，可读版） |
| `assets/mk-3d.js` | 3D 运行时（依赖 core） |
| `assets/mk-graph.js` | 图论运行时（依赖 core） |

## 导出为文件

用户要文件时，把同样的片段包一层文档骨架，写成 `.html`，再用 `present_files` 打开：

```html
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>标题</title>
<style>body{margin:0;padding:24px;background:#fff;font-family:system-ui,sans-serif}
figure{max-width:680px;margin:0 auto}</style></head>
<body><figure><div id="fig"></div></figure>
<script>/* 同上的脚本 */</script>
</body></html>
```

结论和推导写在 `<figcaption>` 之外的正文字、或独立段落里，图里只留图形。

## 反模式

1. **手算采样点**画抛物线 —— 曲率不均、端点突兀。用 `V.plot`。
2. **忘了 y 轴翻转** —— 数学 y 向上、SVG y 向下，函数图上下颠倒。
3. **tan / 1/x 不断点** —— 渐近线处出现一条竖直假线。`V.plot` 已按像素跳变断点，手写时必须自己断。
4. **3D 用斜二测硬编码** —— 顶点一处改动全图错位。用 `MK.space`。
5. **哈斯图画全传递边** —— 只画覆盖关系（Hasse 图定义），多画一条就是错的。
6. **图论边穿过节点** —— mathkit 会自动绕开；手写时要检查。
7. **箭头忘了 `defs` 里的 marker** —— 箭头消失或变成黑三角。mathkit 手绘三角形，无此问题。
8. **一张图塞进整个证明** —— 拆成 2–3 张，每张只讲一件事。
