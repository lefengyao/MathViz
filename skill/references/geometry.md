# 平面几何

平面几何图的成败在于**标注**：图形本身好画，规范难在角怎么标、等长怎么标、直角怎么标。
标注错了，图形越精确越误导。

## 一、标注惯例

| 要表达 | 画法 | mathkit 调用 |
|---|---|---|
| 角 | 以顶点为圆心的弧 + 度数或希腊字母 | `V.angle(v, p1, p2, {r:26, label:"α"})` |
| 直角 | 顶点处的小方块（不是弧） | `V.rightAngle(v, p1, p2)` |
| 等长 | 线段中点处的短斜线，相同条数表示相等 | `V.mark(a, b, 1)` / `V.mark(a, b, 2)` |
| 平行 | 线段上的单箭头 `▸`，同数表示平行 | `V.label` 放 `∥` 或画小箭头 |
| 中点 | 点上加点或两侧等长标记 | 两者取一，不要同时用 |

**角弧半径统一**：同一张图里所有角弧用同一个 `r`，否则看起来像不同量级的角。
**不要给所有角都标数字**：只标题目要求的、或参与推理的那几个。

直角标记尺寸 `size:11` 左右；太小看不见，太大会盖住图形。

## 二、三角形

```js
var A = [0,0], B = [4,0], C = [1.2,3];
var V = MK.frame({ box:[40,26,600,330], x:[-0.8,5.2], y:[-1.0,4.0], equal:true, grid:false, axes:false });
document.getElementById("fig").appendChild(V.svg);

V.poly([A,B,C], { color:"blue", fill:true, opacity:0.16 });
V.seg(A,B,{w:1.8}); V.seg(B,C,{w:1.8}); V.seg(C,A,{w:1.8});
V.dot(A,{label:"A",dx:-14,dy:14}); V.dot(B,{label:"B",dx:8,dy:14}); V.dot(C,{label:"C",dx:0,dy:-10});
```

顶点标签放在**图形外侧**：底边两点往下、顶点往上。`dx/dy` 手动调，别让标签压在边上。

### 四心

```js
// 重心：三顶点平均
var Gm = [(A[0]+B[0]+C[0])/3, (A[1]+B[1]+C[1])/3];

// 内心：按边长加权
function incenter(P,Q,R){
  var a = dist(Q,R), b = dist(R,P), c = dist(P,Q), s = a+b+c;
  return [(a*P[0]+b*Q[0]+c*R[0])/s, (a*P[1]+b*Q[1]+c*R[1])/s];
}

// 外心：两条中垂线交点（数值解即可）
```

画中线：顶点到对边中点，用虚线；三条中线交于重心，重心用 `V.dot` 实心点标出。

**只画题目问的那一个心**，四个心画在一张图里没人看得清。

### 相似与全等

相似用「对应角相等 + 对应边成比例」，图上标 `∽`；全等标 `≌`。
两组等长边用 1 条 / 2 条标记区分，不要用颜色区分（颜色另有含义）。

## 三、圆

```js
V.circle([0,0], 2, { color:"blue" });
V.dot([0,0], { label:"O", dx:-12, dy:12, color:"gray" });

// 圆的切线：切点处半径垂直切线
var t = Math.PI/3, P = [2*Math.cos(t), 2*Math.sin(t)];
V.dot(P, { label:"P", color:"coral" });
V.seg([0,0], P, { dash:true, color:"gray" });     // 半径
V.seg(P, [P[0]-2*Math.sin(t), P[1]+2*Math.cos(t)], { color:"coral", w:1.8 }); // 切线
V.rightAngle(P, [0,0], [P[0]-Math.sin(t), P[1]+Math.cos(t)]);
```

- **圆心角 / 圆周角**：同弧所对的圆周角是圆心角的一半。标角时把两条弧都画出来，数值写在弧旁。
- **弦与弦心距**：弦的垂直平分线过圆心，这条虚线能解释一大半圆的性质题。
- **两圆位置关系**：外离 / 外切 / 相交 / 内切 / 内含，用 `d`（圆心距）与 `r₁+r₂`、`|r₁-r₂|` 的关系标注。

## 四、圆锥曲线

统一用 `equal:true`，否则焦点位置和曲线形状对不上。

```js
// 椭圆 x²/a² + y²/b² = 1，焦点 (±c, 0)，c² = a² − b²
var a = 3, b = 2, c = Math.sqrt(a*a - b*b);   // c ≈ 2.236
V.param(t => [a*Math.cos(t), b*Math.sin(t)], {t0:0, t1:2*Math.PI, color:"blue"});
V.dot([c,0], { label:"F₂", color:"coral" });
V.dot([-c,0], { label:"F₁", color:"coral" });

// 双曲线 x²/a² − y²/b² = 1，渐近线 y = ±(b/a)x
V.param(t => [a/Math.cos(t), b*Math.tan(t)], {t0:-1.35, t1:1.35, color:"teal"});
V.param(t => [-a/Math.cos(t), b*Math.tan(t)], {t0:-1.35, t1:1.35, color:"teal"});
V.seg([-4,-4*b/a], [4,4*b/a], { dash:true, color:"gray" });
V.seg([-4, 4*b/a], [4,-4*b/a], { dash:true, color:"gray" });

// 抛物线 y² = 2px，焦点 (p/2, 0)，准线 x = −p/2
var p = 2;
V.param(t => [t*t/(2*p), t], {t0:-4, t1:4, color:"green"});
V.dot([p/2,0], { label:"F", color:"coral" });
V.seg([-p/2,-3], [-p/2,3], { dash:true, color:"gray" });
V.label([-p/2, -3.3], "准线", { anchor:"middle", size:11 });
```

双曲线的参数范围别给到 `±π/2`（`cos t → 0`，坐标爆炸），`±1.3` 左右正好。

## 五、常见错误

| 现象 | 原因 | 修法 |
|---|---|---|
| 直角看起来不直 | `equal:false` 或缺省 | 平面几何一律 `equal:true` |
| 角弧跑到角外面 | 顶点/边点顺序反了 | 弧取的是 `p1` 到 `p2` 的**小弧**，确认三点位置 |
| 等长标记压住顶点 | 标记画在端点 | `V.mark` 已放在线段中点，手写时取 0.5 处 |
| 圆变成椭圆 | `equal:false` | 改 `equal:true` |
| 焦点画在曲线外 | `c` 算错 | 椭圆 `c²=a²−b²`；双曲线 `c²=a²+b²` |
| 顶点标签互相重叠 | `dx/dy` 没按方向调 | 按「远离图形中心」的方向偏移 |
