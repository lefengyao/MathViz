# 电路原理图（MK.schematic）

## 什么时候用

| 需求 | 用不用 |
|---|---|
| 电路原理图、分压、滤波、放大、驱动、整流、开关电路 | ✅ |
| 单片机 / 模块接线示意（引脚 ↔ 引脚） | ✅ |
| 只画一个元件符号（一个电阻、一个二极管） | ❌ 直接手写 SVG 更快 |
| 方框图 / 系统框图（箭头连大方块，无电气符号） | ❌ 用 `inline-visualizer` 的流程图 |
| PCB 物理布局 | ❌ 用 `MK.pcb` |

## 坐标规则

- 单位是**网格**，`cell` 是一格多少像素（默认 48）。元件放在**整数格点**上：`at:[列,行]`。
- **列向右增大，行向下增大**（和屏幕一致，电源在上所以行的数值小）。
- 元件占据约 2 格宽 × 1 格高（纵向翻转后相反），两个元件之间留 **2~3 格**，导线才有地方走。
- 旋转只用 `rot: 0 / 90 / 180 / 270`，**不要写 45 之类的角度**。

```js
var C = MK.schematic({box:[40,26,600,330], cell:50, title:'RC 低通滤波'});
document.getElementById('fig').appendChild(C.svg);   // 必须挂载
```

`box` 是画布区域 `[x, y, 宽, 高]`，画布总宽固定 680。`title` 画在左上角。

## 元件库

所有元件都是同一个签名：

```js
C.resistor({id:'R1', at:[4,2], rot:0, label:'R1', value:'1 kΩ'});
```

`id` 用来连线（**必须有**），`label` 是位号，`value` 是参数。横放时 label 在上、value 在下；
竖放（`rot:90`）时两者都挪到右侧。

| 元件 | 说明 | 端口 |
|---|---|---|
| `resistor` | 电阻（矩形） | `l` `r` |
| `cap` | 无极性电容 | `l` `r` |
| `capPolar` | 电解电容，`+` 在左 | `l` `r` |
| `ind` | 电感 | `l` `r` |
| `diode` | 二极管，三角尖端朝右（`l`→`r` 是正向） | `l` `r` |
| `led` | 发光二极管，斜箭头表示发光 | `l` `r` |
| `zener` | 稳压二极管 | `l` `r` |
| `npn` / `pnp` | 三极管。发射极箭头朝外 = NPN，朝内 = PNP | `b` `c` `e` |
| `mosfet` | N 沟道 MOS | `g` `d` `s` |
| `opamp` | 运放三角，`n` 是反相（−），`p` 是同相（+） | `n` `p` `out` |
| `battery` | 电池组 | `l` `r` |
| `ac` | 交流源（圆圈 + 正弦） | `l` `r` |
| `ground` | 地，横线朝下 | `t` |
| `vcc` | 电源端子，箭头朝上 | `b` |
| `switch` | 开关 | `l` `r` |
| `fuse` | 保险丝 | `l` `r` |
| `lamp` | 灯泡 | `l` `r` |

方框器件（芯片、模块、变压器）用 `C.ic`，**端口名就是你起的引脚名**：

```js
C.ic({id:'U1', at:[6,4], w:4, h:3, label:'LM358',
  left:['IN+','IN-'], right:['OUT'], top:['VCC'], bottom:['GND']});
C.wire('U1.OUT', 'R3.l');      // 直接用引脚名连
```

## 连线

**只写端口名，不写坐标。**

```js
C.wire('V1.r', 'R1.l');            // 元件的端口
C.wire('R1.r', 'C1.l', {w:1.5});   // 线宽
C.wire('V1.l', 'GND.t', {via:[[0,4.5]]});   // 强制经过某个网格点
C.wires([['R1.r','Q1.c'], ['Q1.e','GND.t']]);  // 批量
```

运行时会做四件事，所以**不要自己拼折线**：

1. 从引脚朝外的方向先伸半格，避免线压在符号上；
2. 两个引脚朝向合适时直角入射，一步到位；
3. 需要拐弯时按引脚朝向决定先横还是先竖；
4. 两个引脚**背对背**时自动走一条 2 格外的边绕行，不会从元件身上穿过去。

导线交叉处会自动判断：只有真正三线交汇（T 型）才打实心结点，十字交叉不打点。

> 中途分出一条支路（比如分压中点引出）可以传坐标：`C.wire([3,4],[6,4])`。
> 这只适合**支路**；主连线仍然要写端口名。

## 自检（必做）

```js
var rep = C.report();
// rep = { ok:true, floating:['Q1.b'], wires:9 }
```

`floating` 是**没接任何线的端口**——图上表现为一根断线头。输出前必须让它变空：

- 悬空的是信号输入：加一个 `C.label(...)` 说明它是外部输入，或者接一个连接器；
- 悬空的是电源/地：补 `C.vcc` / `C.ground`；
- 忘了连线：补 `C.wire`。

## 布局习惯

1. **电源在上、地在下**：`vcc` 放在最上面一行，`ground` 放最下面一行。
2. **信号从左流到右**：输入在左，输出在右。
3. **同一列的元件对齐列号**，同一行的对齐行号——线才会是直线。
4. 元件之间留 2~3 格；两个元件挨太近，走线会绕到元件外圈。
5. 别把 `label` 写在元件正上方又让导线从上面过，会压字。

## 常用模板

### 电阻分压

```js
var C = MK.schematic({box:[40,26,600,460], cell:42, title:'电阻分压'});
document.getElementById('fig').appendChild(C.svg);
C.vcc({id:'P1', at:[3,0.5], label:'+5V'});
C.resistor({id:'R1', at:[3,3], rot:90, label:'R1', value:'10 kΩ'});
C.resistor({id:'R2', at:[3,6], rot:90, label:'R2', value:'10 kΩ'});
C.ground({id:'GND', at:[3,9]});
C.wire('P1.b', 'R1.l');
C.wire('R1.r', 'R2.l');
C.wire('R2.r', 'GND.t');
C.wire([3,4.5], [6,4.5]);                       // 中点引出支路
C.label([6,4.5], 'Vout = 2.5 V', {dx:8, dy:-6, anchor:'start'});
```

`C.wire([3,4.5],[6,4.5])` 是唯一该写坐标的地方——它从一段已有导线中间引出一条支路，
没有端口名可用。落点正好在 R1.r 与 R2.l 之间，运行时会自动在那里补一个结点。

### 三极管驱动 LED（含三端器件）

```js
var C = MK.schematic({box:[40,26,600,500], cell:42, title:'NPN 三极管驱动 LED'});
document.getElementById('fig').appendChild(C.svg);
C.vcc({id:'P1', at:[7,0.5], label:'+5V'});
C.resistor({id:'R1', at:[7,3], rot:90, label:'R1', value:'330 Ω'});
C.led({id:'D1', at:[7,5.4], rot:90, label:'D1', value:'红'});
C.npn({id:'Q1', at:[6,8.4]});
C.resistor({id:'R2', at:[1.6,8.4], label:'R2', value:'10 kΩ'});
C.ground({id:'GND', at:[7,11]});
C.wire('P1.b', 'R1.l');
C.wire('R1.r', 'D1.l');
C.wire('D1.r', 'Q1.c');
C.wire('Q1.e', 'GND.t');
C.wire('R2.r', 'Q1.b');
C.label([0.6,8.4], 'v_in', {anchor:'end', dx:-8});
```

`npn` 的引脚画在斜线上，但接线的落点就是 `b/c/e` 端口，**不用你算斜线端点**。

### RC 低通滤波

```js
var C = MK.schematic({box:[40,26,600,320], cell:52, title:'RC 低通滤波'});
document.getElementById('fig').appendChild(C.svg);
C.ac({id:'V1', at:[1,2], label:'V1', value:'1 kHz'});
C.resistor({id:'R1', at:[4,2], label:'R1', value:'1 kΩ'});
C.cap({id:'C1', at:[7,3], rot:90, label:'C1', value:'100 nF'});
C.ground({id:'GND', at:[7,5.5]});
C.wire('V1.r', 'R1.l');
C.wire('R1.r', 'C1.l');
C.wire('C1.r', 'GND.t');
C.wire('V1.l', 'GND.t', {via:[[0,4.5]]});
C.label([4,0.6], '截止频率 f_c = 1/(2πRC) ≈ 1.6 kHz');
```

注意最后两条：`V1.l` 要回到地，两个引脚朝向相反，`via` 让它贴着左边绕下去，
不至于从 V1 和 R1 中间穿过去。

## 反模式

1. **`C.wire([2,2],[5,2])` 手写坐标** —— 元件一挪位置线就断。写端口名。
2. **用 `V.seg` 一条条画导线** —— 那是 2D 产线的函数，电路块里没有 `V`。
3. **`at:[2.3, 4.7]` 写小数格点** —— 引脚对不上，线会错开半格。
4. **画完不检查 `report()`** —— 图上留着悬空端口自己看不见。
5. **元件全挤在一起** —— 走线没有空间，自动绕行会把图画乱。
6. **地符号接在上方** —— 地的端口是 `t`（顶部），符号本身朝下画，接反了线会从横线底部穿出。
