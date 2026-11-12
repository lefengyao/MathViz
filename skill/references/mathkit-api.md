# mathkit API 速查

四个运行时文件，按需内联。`mk-3d.js` / `mk-graph.js` / `mk-eng.js` 都依赖 `mk-core.js`，必须先加载。

```html
<script>/* mk-core.js 全文 */</script>
<script>/* 需要时才加 mk-3d.js / mk-graph.js / mk-eng.js */</script>
```

所有坐标参数都写**数学坐标**，不是像素。运行时负责翻转 y 轴。
例外是 `MK.schematic`（网格坐标）和 `MK.pcb`（毫米、y 向下），见各自的 reference。

---

## 2D：`MK.frame(opts)`

```js
var V = MK.frame({
  box: [40, 26, 600, 330],   // [x, y, 宽, 高] 像素。默认 [40,30,600,340]
  x: [-4, 4],                // x 轴范围（数学）
  y: [-3, 5],                // y 轴范围（数学）
  equal: true,               // 等比缩放。几何图必须 true，函数图可 false
  grid: true,                // 画网格
  axes: true,                // 画坐标轴 + 刻度 + 箭头
  w: 680,                    // viewBox 宽，不要改
  h: null,                   // viewBox 高，默认自动
  title: "抛物线",            // 无障碍标题
  desc: "y = x² − 2 与其切线"
});
document.getElementById("fig").appendChild(V.svg);
```

返回对象 `V` 兼作绘制入口，所有方法返回 `V`，可链式。

### 坐标与几何信息

| 成员 | 作用 |
|---|---|
| `V.px([x,y])` | 数学坐标 → 像素坐标 |
| `V.up([px,py])` | 像素 → 数学坐标 |
| `V.sx` / `V.sy` | 每单位多少像素（等比时相等） |
| `V.box` | `{x, y, w, h}` 实际绘图区（等比时可能小于 box） |
| `V.svg` / `V.g` / `V.over` | SVG 根 / 裁剪层 / 顶层（文字箭头不受裁剪） |
| `V.color(name)` / `V.tint(name)` / `V.strong(name)` | 曲线色 / 填充色 / 文字色 |

### 网格与坐标轴

```js
V.grid({ nx: 10, ny: 8 });            // 刻度密度，自动取 1/2/5×10ⁿ
V.axes({ xlabel: "x", ylabel: "y" }); // 带箭头的坐标轴 + 数字刻度 + 原点 O
```

轴位置自动判断：0 在范围内就画在 0，否则贴边。末端刻度会被自动跳过，避免和轴标签 `x` 撞车。

### 绘图方法

| 方法 | 说明 |
|---|---|
| `V.plot(f, opt)` | 函数曲线。`f: x => y` |
| `V.param(fn, opt)` | 参数方程。`fn: t => [x, y]` |
| `V.polar(r, opt)` | 极坐标。`r: θ => ρ` |
| `V.curve(pts, opt)` | 已知点列折线/曲线 |
| `V.seg(a, b, opt)` | 线段 |
| `V.arrow(a, b, opt)` | 向量箭头（带实心三角头） |
| `V.dot(p, opt)` | 实心点，可带标签 |
| `V.label(p, text, opt)` | 文字标签 |
| `V.poly(pts, opt)` | 多边形（可填充） |
| `V.circle(c, r, opt)` | 圆（数学半径） |
| `V.arc(c, r, a1, a2, opt)` | 圆弧（弧度） |
| `V.angle(v, p1, p2, opt)` | 角弧 + 度数标注 |
| `V.rightAngle(v, p1, p2, opt)` | 直角小方块 |
| `V.mark(a, b, n, opt)` | 等长标记（n 条短斜线） |
| `V.area(f, a, b, opt)` | 曲线与 x 轴之间的填充 |
| `V.rect(p, w, h, opt)` | 矩形（数学坐标） |
| `V.legend(items, opt)` | 图例，自带背景框 |
| `V.tag(pxPt, text)` | 在像素点附近放标签（`plot` 内部用） |

### 通用选项

```js
{ color: "blue" | "coral" | "teal" | "amber" | "purple" | "red" | "green" | "pink" | "gray",
  w: 1.8,            // 线宽
  dash: true,        // 虚线；也可传 "5 4"
  opacity: 0.6,
  label: "y = x²",   // 曲线末端标签
  fill: true }       // poly / circle 填充
```

`plot` 额外参数：

```js
{ from: -3, to: 3,   // 绘制区间，默认整个 x 范围
  n: 420,            // 采样点数
  jump: 40 }         // 断点阈值（像素）。相邻点像素距离超过它就断开
```

---

## 3D：`MK.space(opts)`

```js
var S = MK.space({
  box: [40, 26, 600, 320],
  yaw: -30,      // 绕 z 轴旋转。默认 -30 → x 轴指向右下，y 轴指向右上
  pitch: 20,     // 俯视角。默认 20 → z 轴竖直向上。-90 俯视，0 平视
  range: 3,      // 视野半径，越大图形越小
  zoom: 1,       // 缩放微调
  h: null        // viewBox 高，默认自动
});
document.getElementById("fig").appendChild(S.svg);
```

| 方法 | 说明 |
|---|---|
| `S.p([x,y,z])` | 三维点 → 像素坐标 |
| `S.d([x,y,z])` | 深度值（越大越靠近相机） |
| `S.line(a, b, opt)` | 三维线段 |
| `S.arrow(a, b, opt)` | 三维向量箭头 |
| `S.axes({len, labels:["x","y","z"]})` | 三维坐标轴 |
| `S.point(p, opt)` | 三维点 + 标签 |
| `S.label(p, text, opt)` | 三维位置上的文字 |
| `S.face(pts, opt)` | 单张面（平行四边形 / 三角形） |
| `S.polyline(pts, opt)` | 三维折线 |
| `S.solid(verts, faces, opt)` | **通用多面体**，自动判定隐藏边 |
| `S.box(mn, mx, opt)` | 长方体 |
| `S.prism(basePts, h, opt)` | 棱柱（底面点列 + 高） |
| `S.pyramid(basePts, apex, opt)` | 棱锥 |
| `S.plane(origin, u, v, opt)` | 平行四边形平面（起点 + 两个方向向量） |
| `S.sphere(c, r, opt)` | 球（外轮廓 + 赤道 + 经线） |
| `S.cylinder(c, r, h, opt)` | 圆柱 |
| `S.angle(v, a, b, opt)` | 三维角弧 + 标注 |
| `S.clear()` | 清空重绘 |
| `S.onPick(fn)` | 点击面/球时的回调，`fn(infoText)` |

### 交互（已内置，不要自己实现）

画布**自带拖拽旋转与双击复位**：拖拽改变 yaw/pitch，双击回到初始视角。`S.drag` 只是为旧图保留的空兼容桩，**不要再调用**。

给可点击的元素加说明文字，点击即高亮并在底部信息栏显示：

```js
S.sphere([2,0,0], 0.5, { color: "coral", info: "单位球（点击高亮）" });
S.box([0,0,0], [1,1,1], { color: "blue",
  faceInfo: ["底面 z=0", "顶面 z=1", "前面 y=0", "后面 y=1", "左面 x=0", "右面 x=1"] });
S.onPick(function (info) { /* 收到被点击元素的 info，可省略 */ });
```

`info` 用于球/面整体说明；`solid`/`box` 另支持 `faceInfo:[每面一条]`。点空白处取消高亮。

### `solid` 的顶点绕向

`faces` 里每个面按**从外部看逆时针**的顺序列顶点索引。绕向反了会导致隐藏边判定错误（该虚线的画成实线）。

```js
S.solid(
  [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],
  [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[0,4,7,3],[1,2,6,5]],
  { color: "blue" }
);
```

隐藏边自动画成灰色虚线，可见边实线。不想自动判定就传 `autoHide:false`（全部实线）。

### 可拖拽的立体图

拖拽与双击复位**已内置**，直接画即可，无需任何绑定：

```js
S.box([0,0,0], [2,2,2], { color: "blue", faceInfo: ["底面","顶面","前面","后面","左面","右面"] });
```

在扩展 / 手机端的沙箱渲染里拖拽旋转、双击复位、点击高亮都直接可用；
导出成静态图时交互自然消失，不影响画面。

---

## 图论：`MK.graph(opts)`

```js
var G = MK.graph({
  box: [40, 24, 600, 350],
  directed: true,          // false 则无箭头
  layout: "circle",        // circle | tree | layered | force | grid
  root: "A",               // tree 布局的根
  nodes: ["A", "B", "C"],  // 或 [{id:"A", label:"v₁", color:"blue", accept:true}]
  edges: [["A","B",4], ["B","C"]],  // 或 [{s,t,label,w,color,dash}]
  title: "带权有向图"
});
document.getElementById("fig").appendChild(G.svg);
G.layout("circle").draw();
```

| 方法 | 说明 |
|---|---|
| `G.layout(kind, opt)` | 重新布局 |
| `G.draw(opt)` | 绘制。`{edgeColor, nodeColor, curve:"all"}` |
| `G.path(["A","B","C"], opt)` | 高亮一条路径（加粗 + 换色） |
| `G.mark("A", opt)` | 给节点加一圈高亮环 |
| `G.radius(node)` | 节点半径（按文字长度自适应） |

节点对象字段：`{id, label, color, r, x, y, fixed, accept, sub}`。`accept:true` 画双圈（自动机接受态），`sub` 在节点下方加小字。

**边自动避让**：如果一条边的直线会穿过其他节点，运行时自动改成绕行曲线。多边（同一对节点之间多条）自动分开。

### 布局怎么选

| 图的形状 | 布局 |
|---|---|
| 无环、无明确层次、节点 ≤ 12 | `circle`（最稳，边最少交叉） |
| 有根、树结构 | `tree` |
| DAG、偏序、分层流程 | `layered`（含重心排序，减少交叉） |
| 一般无向图、社交网络 | `force`（结果不稳定，节点多时会乱） |
| 邻接关系演示 | `grid` |

---

## 矩阵：`MK.matrix(opts)`

```js
document.getElementById("fig").appendChild(MK.matrix({
  x: 90, y: 60, cell: 36,
  rows: ["a","b","c"], cols: ["a","b","c"],
  data: [[0,1,1],[1,0,1],[1,1,0]],
  label: "关系 R 的邻接矩阵"
}));
```

`data` 里非零格子自动浅色高亮。返回 SVG 元素，不是对象。

---

## 文氏图：`MK.venn(opts)`

```js
document.getElementById("fig").appendChild(MK.venn({
  box: [40, 20, 600, 300],
  sets: [{label:"A",color:"blue"}, {label:"B",color:"coral"}, {label:"C",color:"teal"}],
  labels: { a:"1", b:"2", c:"3", ab:"4", ac:"5", bc:"6", abc:"7" }
}));
```

`labels` 的键固定为 `a/b/c/ab/ac/bc/abc`，位置由圆几何精确算出，不用自己调偏移。两集合时只有 `a/b/ab`。

要放自定义文字（比如具体元素名）用 `regions`：

```js
regions: [{ set: 0, at: [120, 40], text: "2, 4, 6" }]   // at 是相对画布中心的像素偏移
```

---

## 工程类：`MK.schematic` / `MK.pcb` / `MK.eng`

三个运行时都在 `mk-eng.js` 里，细讲见 `schematic.md`、`pcb.md`、`engineering.md`。这里只列签名。

### `MK.schematic({box, cell, title, desc})` → C（网格坐标）

```js
C.resistor({id, at:[列,行], rot, label, value})   // 18 个符号同理
C.ic({id, at, w, h, left:[], right:[], top:[], bottom:[], label})
C.wire('R1.r', 'Q1.c', {color, w, via:[[列,行]]})
C.wires([['R1.r','Q1.c'], ...])
C.label([列,行], 'v_in', {dx, dy, anchor})
C.dot([列,行], {r})
C.report()      // {ok, floating:[...], wires}
C.floating()    // 悬空端口数组
```

符号：`resistor cap capPolar ind diode led zener npn pnp mosfet opamp battery ac ground vcc switch fuse lamp`
端口：两端件 `l`/`r`；`npn/pnp` `b/c/e`；`mosfet` `g/d/s`；`opamp` `n/p/out`；`ground.t`；`vcc.b`。

### `MK.pcb({box, board:[宽,高], title})` → P（毫米，原点左上，y 向下）

```js
P.outline({r, text})
P.grid({step})
P.footprint('0805|0603|1206|1210|sot23|soic8|dip8|header', {at, ref, value, rot, n, pins, layer})
P.trace([[x,y], ...], {w, layer:'top'|'bottom'})
P.route(a, b, {w, layer})          // 自动 45°
P.pad([x,y], {w, h, shape:'rect'|'circle'|'oval', drill})
P.via([x,y], {pad, drill})
P.silk('文字', [x,y])  /  P.silk(a, b, {dash})
P.dim(a, b, {offset, side, text})  P.dimX  P.dimY
P.legend([{color:'top'|'bottom'|'pad'|'silk', text}])
```

### `MK.eng({box, ext:[宽,高], scale, title})` → E（毫米，原点左下，y 向上）

`ext` 只是比例提示，不是硬边界：脚本执行完运行时会按实际内容 bbox 重设 viewBox，
写大不会缩成左下角一小块、写小也不会被裁掉。传了 `scale` 则尊重固定比例、不自动适配。
需要手动重排时调 `E.fit()`。

```js
E.line(a, b, {style, w})        E.poly(pts, {close, style, w, fill})
E.rect(p, w, h, opt)            E.circle(c, r, opt)
E.arc(c, r, a1, a2, opt)        // 角度制，逆时针为正
E.hatch(poly, {angle, gap})     E.centerMark(c, {r})
E.dimX / E.dimY (a, b, {offset, side, text})
E.dimDia(c, p, {dx, dy, text})  E.dimRad(c, p, {dx, dy, text})
E.dimAngle(v, p1, p2, {r, text})
E.leader(p, to, '文字')          E.roughness(p, 'Ra 3.2')
E.datum(p, 'A', {down})          E.sectionCut(a, b, {label:'A'})
E.balloon(1, p, {to})            E.viewLabel(x, y, '主视图')
E.text(p, '文字', {dx, dy, anchor})
```

`style`：`solid` 粗实线 / `thin` 细实线 / `dash` 虚线 / `center` 中心线 / `phantom` 双点划线。
