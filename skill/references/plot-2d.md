# 函数与曲线

## 一、坐标系怎么设

```js
var V = MK.frame({ box:[40,26,600,330], x:[-4,4], y:[-3,5], equal:true, grid:true, axes:true });
```

| 图的内容 | `equal` | 理由 |
|---|---|---|
| 圆、抛物线、三角形、向量夹角 | `true` | 比例失真会让"看起来像直角"变成真的不是直角 |
| 指数、对数、振荡、多曲线对比 | `false` | 纵向拉伸才看得出变化 |

值域选择的经验：

- 抛物线 `x²` 在 `[-3,3]` 上最大到 9，若 `y` 只给 `[-3,5]` 会切掉顶部 —— 要么放大 y，要么缩窄 x。
- 留出 **10%~15% 的边距**，曲线不要顶到画布边缘。
- `y` 范围包含 0 时 x 轴才画在中间，否则贴底。

## 二、断点：最容易画错的地方

`tan x`、`1/x`、`sec x` 这类函数在渐近线两侧符号突变。若直接连点，会出现一条横穿画布的**假竖线**。

`V.plot` 已内置断点：相邻采样点的**像素距离**超过阈值就断开。阈值默认 `画布高 × 1.6`。

```js
V.plot(function(x){ return Math.tan(x); }, { from:-1.5, to:4.6, n:900, color:"teal" });
```

手写 SVG 时必须自己做同样的事：

```js
var pts = [];
for (var i = 0; i <= 600; i++) {
  var x = a + (b - a) * i / 600;
  var y = f(x);
  if (!isFinite(y)) { pts.push(null); continue; }
  var p = toPixel(x, y);
  var prev = pts[pts.length - 1];
  if (prev && Math.hypot(p[0]-prev[0], p[1]-prev[1]) > 600) { pts.push(null); }
  pts.push(p);
}
// 遇到 null 就开新子路径（M 而不是 L）
```

**不要靠"函数值超过某个大数就断"**：`tan` 在渐近线附近的值可以是任意大，而 `x²` 在广阔区间也能很大。用像素距离判断才可靠。

## 三、常用函数写法

```js
// 多项式
V.plot(x => 0.5*x*x - 2*x + 1, {color:"blue"});

// 三角：注意 JS 用弧度
V.plot(x => 2*Math.sin(2*x + Math.PI/4), {color:"purple", n:600});

// 指数与对数
V.plot(x => Math.exp(x), {from:-2, to:2, color:"coral"});
V.plot(x => Math.log(x), {from:0.05, to:6, color:"teal"});   // x>0，起点别给 0

// 有理函数（有竖直渐近线）
V.plot(x => 1/(x-1), {from:-4, to:6, n:900, color:"amber"});

// 绝对值 / 取整（折线感强，采样点要密）
V.plot(x => Math.abs(x) - 1, {n:600, color:"green"});
V.plot(x => Math.floor(x), {n:1200, color:"gray", jump:2});  // 阶跃：jump 调小才断开

// 分段
V.plot(x => x <= 0 ? x*x : Math.sqrt(x), {n:700, color:"blue"});
```

阶跃函数（`floor`、`sign`、分段跳跃）要把 `jump` 调小到 2~4，否则竖直跳变会被连成斜线。

## 四、导数、切线、积分

```js
var f  = x => x*x - 2;
var df = x => 2*x;            // 手写导数，别用数值差分
var x0 = 1.5;

V.plot(f, {color:"blue", w:2});
V.plot(x => df(x0)*(x-x0) + f(x0), {color:"coral", w:1.6, dash:true});
V.dot([x0, f(x0)], {label:"P(" + x0 + ", " + f(x0) + ")", color:"coral"});

// 切线斜率三角（dx=1, dy=f'）
V.seg([x0, f(x0)], [x0+1, f(x0)], {dash:true, color:"gray"});
V.seg([x0+1, f(x0)], [x0+1, f(x0)+df(x0)], {dash:true, color:"gray"});
V.label([x0+0.5, f(x0)-0.4], "1", {anchor:"middle", size:11});
V.label([x0+1.08, f(x0)+df(x0)/2], "f′(x₀)", {size:11});
```

积分面积用 `V.area(f, a, b)`，填充色是浅色调，透明度默认 0.5。要在图上写 `∫` 值就直接 `V.label`。

**法线**的斜率是 `-1/f'(x0)`，`f'(x0)=0` 时法线竖直，改用两点写：

```js
V.seg([x0, y0-2], [x0, y0+2], {color:"teal"});
```

## 五、参数方程与极坐标

```js
// 圆 / 椭圆
V.param(t => [2*Math.cos(t), 1.2*Math.sin(t)], {t0:0, t1:2*Math.PI, color:"blue"});

// 摆线
V.param(t => [t - Math.sin(t), 1 - Math.cos(t)], {t0:0, t1:4*Math.PI, color:"purple"});

// 心形线（参数形式，避免尖点误差）
V.param(t => [16*Math.pow(Math.sin(t),3)/10, (13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))/10],
        {t0:0, t1:2*Math.PI, color:"coral"});

// 极坐标玫瑰线 r = cos(3θ)
V.polar(th => Math.cos(3*th), {t0:0, t1:Math.PI*2, color:"teal", n:900});
```

参数方程和极坐标的 `n` 要给足（≥600），否则闭合处会有明显折角。

## 六、多条曲线对比

```js
V.plot(x => Math.sin(x), {color:"blue", w:1.8});
V.plot(x => Math.sin(x) + 0.6, {color:"coral", w:1.4, dash:true});
V.legend([{text:"y = sin x", color:"blue"}, {text:"向上平移 0.6", color:"coral", dash:true}],
         {x: 420, y: 70});
```

三条以上曲线时，**颜色要够区分**：蓝 / 珊瑚 / 青 / 紫 依次用，不要用两种灰。
图例放空白角落，别压曲线；实在没空白就放图外（`y` 设成 box 之外的值，H 会自动包含）。

## 七、常见错误

| 现象 | 原因 | 修法 |
|---|---|---|
| 曲线上下颠倒 | 忘了 y 轴翻转 | 用 `V.plot`，或手写时 `py = h - (y - ymin) * sy` |
| 渐近线处一条竖线 | 没有断点 | 加像素跳变检测，或调小 `jump` |
| 曲线是一段段折线 | 采样太稀 | `n` 提到 600~1200 |
| 曲线在边界处突然截断 | 值域不够 | 放大 `y` 范围或缩小 `from/to` |
| `log` 曲线左端突变 | 从 `x=0` 开始画 | `from` 给 0.05 之类的正数 |
| 图例挡住曲线 | 位置随手放 | 放右上/左上空白区，先看曲线走向再定 |
