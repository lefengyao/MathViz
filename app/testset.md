# MathViz 能力测试集

> 以下 25 条用例已由 `test/verify-testset.mjs` 在真实 Chromium 里逐条跑通（25/25）。
> 数据源是 `test/testset.mjs`，改用例改那里，然后：
>
> ```bash
> node test/verify-testset.mjs   # 先跑通
> node test/gen-testset-md.mjs   # 再重新生成本文件
> ```

## 怎么用

每条用例都是**自包含**的：把「测试代码」下面的整段（含 ` ```mathviz ` 围栏）原样复制到输入框，
直接发送即可——**用户消息里的 mathviz 代码块同样会被渲染**，不依赖模型。
想顺带测提示词遵循度，就先按 `question` 列直接向模型提问（需先插入对应模式的提示词）。

判读标准：

- ✅ 出图、无失败卡片 → 通过
- ⏳ 工具条显示「N 段未写完」→ 代码不完整被扣住，8 秒后仍残缺才兜底渲染（E3 除外，见负向）
- ❌ 出现「渲染失败」→ 记下卡片上的中文错误信息，连同用例编号反馈

## 自动看模型有没有守规矩

把模型针对下表问题的**原始回复**整段存成 txt（含 ` ```mathviz ` 围栏，解释文字不用删），交给检查器：

```bash
node test/compliance.mjs reply.txt            # 静态判定
node test/compliance.mjs reply.txt --render   # 再真跑一遍渲染
node test/compliance.mjs --selftest           # 反向验证规则本身
```

它只干一件事：数模型有没有按协议用运行时。重点抓这四类——

| 编号 | 抓什么 | 为什么算错 |
|---|---|---|
| R4 | 自己 `addEventListener('pointermove')`、跑 `requestAnimationFrame`、写 `S.drag` | 拖拽旋转 / 双击复位已内置，自己实现会与运行时抢事件 |
| R6 | 自己声明 `yaw` / `pitch` / `rotate` | 与运行时的视角打架，重放式重绘会跳 |
| R7 | 3D 块里 `V.plot`、2D 块里 `S.solid` | 那个模块里没这个函数，必然 TypeError |
| R3 | 代码里出现 `...` 或「其余省略」 | 扩展按完整性预判扣住，8 秒后才兜底渲染 |

告警（⚠️）不扣通过，但值得记一笔：手算 path、写死 `#1f6feb`、box 宽度偏离 680。

`--selftest` 拿这 25 条正例加 7 条反例反向验证规则：正例一条都不许判违规，反例一条都不许漏。

| 编号 | 能力 | 直接向模型提问（测提示词遵循） |
|---|---|---|
| A1 | 双曲线 + 标注 + 图例 | 画一下 y = sin x 和 y = cos x 的图像，标出一个峰值点 |
| A2 | 参数方程（椭圆） | 用参数方程画椭圆 x=3cos t, y=2sin t |
| A3 | 极坐标（心形线） | 画极坐标心形线 r = 1 + cos θ |
| A4 | 定积分面积填充 | 画 sin x 在 [0, π] 下方的定积分面积并标注面积值 |
| A5 | 多分支曲线 + 渐近线（tan） | 画 y = tan x，画出垂直渐近线 |
| B1 | 单位立方体（拖拽旋转 / 双击复位） | 画一个单位立方体，可拖拽旋转 |
| B2 | 球与平面截面 | 画一个球面和水平截面 z = 0.4 |
| B3 | 四棱锥 | 画一个底面 2×2、高 2 的四棱锥 |
| B5 | 交互：拖拽旋转 + 点面高亮/信息 | 画一个可交互的立方体：每面标注名称，旁边放一个球，点一下能高亮并显示说明 |
| B4 | 空间向量与夹角 | 画空间向量 a=[1,0,0] 和 b=[0,1,0]，标出夹角 |
| C1 | 无向图 + 最短路径高亮 | 画一个带权无向图并高亮 A 到 F 的最短路径 |
| C2 | 有向分层图（拓扑结构） | 画一个 AOV 网拓扑排序的分层有向图 |
| C3 | 二叉树 | 画一棵 7 节点的满二叉树 |
| C4 | 三集合文氏图 | 画三集合文氏图：偶数、3 的倍数、大于 5 |
| C5 | 关系矩阵 | 画关系矩阵 R（自反 + 反对称的 3 阶示例） |
| D1 | 手写几何示意图 | —（纯 SVG 主要测扩展识别，不建议让模型手写） |
| E1 | 一条消息两个代码块（出两张图） | 分别画 sin 曲线和画一个矩形示意图（要求输出两个代码块） |
| E2 | 公式正文 + 代码块混排 | 先写欧拉公式，再画单位圆上的 e^{iθ} |
| E3 | 负向：运行时错误要有可读提示 | —（负向用例：故意写错代码，只测扩展的错误提示） |
| F1 | RC 低通滤波（原理图） | — |
| F2 | 三极管开关 + LED（三端器件） | — |
| F3 | PCB 布局（封装 + 走线 + 过孔 + 尺寸） | — |
| F4 | 工程图：法兰盘（轮廓 + 孔 + 尺寸 + 粗糙度） | — |
| F5 | 工程图：阶梯轴剖视（剖面线 + 尺寸链） | — |
| F6 | 负向：端口名写错要给中文提示 | — |

## 2D 函数

### A1 双曲线 + 标注 + 图例

粘贴整段：

````
```mathviz
var V = MK.frame({box:[40,26,600,330], x:[-6.8,6.8], y:[-1.9,1.9], grid:true, axes:true,
  title:'y = sin x 与 y = cos x', desc:'周期 2π，值域 [-1,1]'});
document.getElementById('fig').appendChild(V.svg);
V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2.2});
V.plot(function(x){return Math.cos(x);}, {color:'coral', w:2.2, dash:true});
V.dot([Math.PI/2,1],{color:'coral',r:3.5});
V.label([Math.PI/2,1],'峰值 (π/2, 1)',{dx:6,dy:-14,color:'coral'});
V.legend([{text:'sin x',color:'blue'},{text:'cos x',color:'coral',dash:true}]);
```
````

### A2 参数方程（椭圆）

粘贴整段：

````
```mathviz
var V = MK.frame({box:[40,26,600,360], x:[-3.4,3.4], y:[-2.4,2.4], grid:true, axes:true,
  title:'参数方程：椭圆', desc:'x = 3cos t，y = 2sin t'});
document.getElementById('fig').appendChild(V.svg);
V.param(function(t){return [3*Math.cos(t), 2*Math.sin(t)];}, {color:'blue', w:2.2});
V.dot([3,0],{color:'coral'});
V.label([3,0],'t = 0',{dx:8,dy:-10,color:'coral'});
```
````

### A3 极坐标（心形线）

粘贴整段：

````
```mathviz
var V = MK.frame({box:[40,26,600,400], x:[-3.2,3.2], y:[-3.2,3.2], grid:true, axes:true,
  title:'极坐标：心形线', desc:'r = 1 + cos θ'});
document.getElementById('fig').appendChild(V.svg);
V.polar(function(t){return 1+Math.cos(t);}, {color:'coral', w:2.2});
V.dot([2,0],{color:'blue'});
V.label([2,0],'θ = 0, r = 2',{dx:8,dy:-10,color:'blue'});
```
````

### A4 定积分面积填充

粘贴整段：

````
```mathviz
var V = MK.frame({box:[40,26,600,340], x:[-0.5,4.2], y:[-0.6,3.2], grid:true, axes:true,
  title:'定积分：sin x 在 [0, π] 下方的面积', desc:'∫₀^π sin x dx = 2'});
document.getElementById('fig').appendChild(V.svg);
V.area(function(x){return Math.sin(x);}, 0, Math.PI, {color:'blue', opacity:0.35});
V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2.2});
V.dot([Math.PI/2,1],{color:'coral'});
V.label([Math.PI/2,0.5],'面积 = 2',{dx:10,color:'blue'});
```
````

### A5 多分支曲线 + 渐近线（tan）

粘贴整段：

````
```mathviz
var V = MK.frame({box:[40,26,600,360], x:[-4.8,4.8], y:[-4,4], grid:true, axes:true,
  title:'y = tan x', desc:'周期 π，x = π/2 + kπ 处有垂直渐近线'});
document.getElementById('fig').appendChild(V.svg);
function branch(a,b){V.param(function(t){return [t,Math.tan(t)];},{t0:a,t1:b,color:'blue',w:2});}
branch(-Math.PI/2+0.06, Math.PI/2-0.06);
branch(Math.PI/2+0.06, 3*Math.PI/2-0.06);
[ -Math.PI/2, Math.PI/2, 3*Math.PI/2 ].forEach(function(k){
  V.seg([k,-4],[k,4],{dash:true,color:'gray',w:1});
});
V.label([Math.PI/2+0.12,3.3],'x = π/2',{dx:4,color:'gray'});
```
````

## 3D 立体

### B1 单位立方体（拖拽旋转 / 双击复位）

粘贴整段：

````
```mathviz
var S = MK.space({box:[40,26,600,380], yaw:-28, pitch:22, range:2.6,
  title:'单位立方体', desc:'拖动旋转 · 双击复位'});
document.getElementById('fig').appendChild(S.svg);
S.box([0,0,0],[1,1,1],{color:'blue',opacity:0.1});
S.line([0,0,0],[1.5,0,0],{color:'gray'});
S.line([0,0,0],[0,1.5,0],{color:'gray'});
S.line([0,0,0],[0,0,1.5],{color:'gray'});
S.point([0,0,0],{color:'coral',label:'O'});
S.label([0.5,0.5,1],'(0.5,0.5,1)',{color:'blue'});
```
````

### B2 球与平面截面

粘贴整段：

````
```mathviz
var S = MK.space({box:[40,26,600,380], yaw:-24, pitch:18, range:3.2,
  title:'球面与水平截面', desc:'平面 z = 0.4 截单位球 · 点击球高亮'});
document.getElementById('fig').appendChild(S.svg);
S.sphere([0,0,0],1.4,{color:'blue',opacity:0.12, info:'单位球 x²+y²+z²=1.96'});
S.plane([-1.4,-1.4,0.4],[2.8,0,0],[0,2.8,0],{color:'teal',opacity:0.3});
S.point([0,0,0.4],{color:'coral',label:'z = 0.4'});
```
````

### B3 四棱锥

粘贴整段：

````
```mathviz
var S = MK.space({box:[40,26,600,380], yaw:-30, pitch:20, range:3.0,
  title:'四棱锥', desc:'底面 2×2，高 2'});
document.getElementById('fig').appendChild(S.svg);
S.pyramid([[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],[0,0,2],{color:'coral',opacity:0.15});
S.point([0,0,2],{color:'blue',label:'顶点'});
```
````

### B5 交互：拖拽旋转 + 点面高亮/信息

粘贴整段：

````
```mathviz
var S = MK.space({box:[40,26,600,380], yaw:-28, pitch:22, range:2.8,
  title:'可交互立方体', desc:'拖动旋转 · 双击复位 · 点击面看信息'});
document.getElementById('fig').appendChild(S.svg);
S.box([0,0,0],[1.4,1.4,1.4],{color:"blue", opacity:0.12,
  faceInfo:["底面 z=0","顶面 z=1.4","前面 y=0","后面 y=1.4","左面 x=0","右面 x=1.4"]});
S.sphere([2.4,0,0.7],0.55,{color:"coral", opacity:0.25, info:"一个单位球（点击高亮）"});
S.onPick(function(info){ });
```
````

**交互验证**：拖动 = 旋转；双击 = 复位；点面/球 = 高亮并显示信息，点空白取消。

### B4 空间向量与夹角

粘贴整段：

````
```mathviz
var S = MK.space({box:[40,26,600,380], yaw:-35, pitch:24, range:2.6,
  title:'空间向量 a 与 b', desc:'a = [1,0,0]，b = [0,1,0]，夹角 90°'});
document.getElementById('fig').appendChild(S.svg);
S.arrow([0,0,0],[1.6,0,0],{color:'blue'});
S.arrow([0,0,0],[0,1.6,0],{color:'coral'});
S.angle([0,0,0],[1.2,0,0],[0,1.2,0],{color:'teal'});
S.label([1.8,0,0],'a',{color:'blue'});
S.label([0,1.8,0],'b',{color:'coral'});
```
````

## 图论离散

### C1 无向图 + 最短路径高亮

粘贴整段：

````
```mathviz
var G = MK.graph({box:[40,24,600,380], directed:false,
  title:'最短路径：A → F', nodes:['A','B','C','D','E','F'],
  edges:[['A','B',4],['A','C',2],['B','C',1],['B','D',5],['C','D',8],['C','E',10],['D','E',2],['D','F',6],['E','F',3]]});
document.getElementById('fig').appendChild(G.svg);
G.layout('force');
G.draw();
G.path(['A','C','B','D','E','F'],{color:'coral',w:3});
G.mark('F',{color:'coral'});
```
````

### C2 有向分层图（拓扑结构）

粘贴整段：

````
```mathviz
var G = MK.graph({box:[40,24,600,400], directed:true,
  title:'AOV 网拓扑排序', nodes:['S','A','B','C','D','T'],
  edges:[['S','A',1],['S','B',1],['A','C',1],['B','C',1],['B','D',1],['C','T',1],['D','T',1]]});
document.getElementById('fig').appendChild(G.svg);
G.layout('layered');
G.draw();
```
````

### C3 二叉树

粘贴整段：

````
```mathviz
var G = MK.graph({box:[40,24,600,380], directed:true,
  title:'满二叉树（层序编号）', nodes:['1','2','3','4','5','6','7'],
  edges:[['1','2',1],['1','3',1],['2','4',1],['2','5',1],['3','6',1],['3','7',1]]});
document.getElementById('fig').appendChild(G.svg);
G.layoutTree('1');
G.draw();
```
````

### C4 三集合文氏图

粘贴整段：

````
```mathviz
var svg = MK.venn({box:[40,24,600,340], title:'三集合关系',
  sets:[{label:'A：偶数',color:'blue'},{label:'B：3 的倍数',color:'coral'},{label:'C：大于 5',color:'teal'}],
  regions:[{set:0,dx:-78,dy:-46,text:'2'},{set:0,dx:0,dy:34,text:'6'},{set:0,dx:0,dy:-2,text:'8'},{set:1,dx:78,dy:-46,text:'3'},{set:2,dx:0,dy:52,text:'10'}]});
document.getElementById('fig').appendChild(svg);
```
````

### C5 关系矩阵

粘贴整段：

````
```mathviz
var svg = MK.matrix({x:150,y:70,cell:52,label:'关系矩阵 R（自反 + 反对称示例）',
  rows:['1','2','3'], cols:['1','2','3'], data:[[1,1,0],[0,1,1],[0,0,1]]});
document.getElementById('fig').appendChild(svg);
```
````

## 纯 SVG

### D1 手写几何示意图

粘贴整段：

````
```mathviz
<svg viewBox="0 0 680 240" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="678" height="238" rx="12" fill="#FBFAF7" stroke="#D3D1C7"/>
  <circle cx="170" cy="120" r="70" fill="#E8F0FE" stroke="#4A7DBF" stroke-width="2"/>
  <rect x="330" y="50" width="140" height="140" rx="8" fill="#FDEBE7" stroke="#C4694F" stroke-width="2"/>
  <polygon points="560,190 620,70 680,190" fill="#E6F4EE" stroke="#3F8F6B" stroke-width="2"/>
  <line x1="100" y1="120" x2="600" y2="120" stroke="#8A877E" stroke-width="1" stroke-dasharray="5 4"/>
  <text x="170" y="126" text-anchor="middle" font-size="14" fill="#2B2A26">圆</text>
  <text x="400" y="126" text-anchor="middle" font-size="14" fill="#2B2A26">矩形</text>
  <text x="622" y="152" text-anchor="middle" font-size="14" fill="#2B2A26">三角形</text>
</svg>
```
````

## 综合边界

### E1 一条消息两个代码块（出两张图）

本条含**两个**代码块，应出**两张图**。粘贴整段：

````
```mathviz
var V = MK.frame({box:[40,26,600,300], x:[-3.5,3.5], y:[-1.6,1.6], grid:true, axes:true, title:'图一：sin'});
document.getElementById('fig').appendChild(V.svg);
V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2});
```

```mathviz
<svg viewBox="0 0 680 160" xmlns="http://www.w3.org/2000/svg">
  <rect x="240" y="30" width="200" height="100" rx="10" fill="#E6F4EE" stroke="#3F8F6B" stroke-width="2"/>
  <text x="340" y="86" text-anchor="middle" font-size="16" fill="#2B2A26">图二：纯 SVG</text>
</svg>
```

````

### E2 公式正文 + 代码块混排

本条含正文混排，粘贴整段（正文 + 代码块）：

````
下面是欧拉恒等式的几何直观：

$$e^{i\theta} = \cos\theta + i\sin\theta$$

单位圆上转一圈回到 1：

```mathviz
var V = MK.frame({box:[40,26,600,360], x:[-1.6,1.6], y:[-1.4,1.4], grid:true, axes:true,
  title:'单位圆上的 e^{iθ}', desc:'θ 从 0 转到 2π'});
document.getElementById('fig').appendChild(V.svg);
V.param(function(t){return [Math.cos(t), Math.sin(t)];}, {color:'blue', w:2.2});
V.dot([1,0],{color:'coral'});
V.label([1,0],'θ = 0',{dx:8,dy:-10,color:'coral'});
V.dot([-1,0],{color:'teal'});
V.label([-1,0],'θ = π',{dx:-8,dy:-10,color:'teal'});
```
````

### E3 负向：运行时错误要有可读提示（负向用例）

粘贴整段：

````
```mathviz
var V = MK.frame({x:[-2,2], y:[-2,2]});
document.getElementById('fig').appendChild(V.svg);
V.plot('这不是函数', {color:'blue'});
```
````

**预期**：不渲染失败卡片，而是给出可读的中文错误提示（参数格式不对类）。

## 电路与工程

### F1 RC 低通滤波（原理图）

粘贴整段：

````
```mathviz
var C = MK.schematic({box:[40,26,600,330], cell:52, title:'RC 低通滤波'});
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
````

### F2 三极管开关 + LED（三端器件）

粘贴整段：

````
```mathviz
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
````

### F3 PCB 布局（封装 + 走线 + 过孔 + 尺寸）

粘贴整段：

````
```mathviz
var P = MK.pcb({box:[40,24,600,390], board:[50,32], title:'降压模块 PCB（顶层视角）'});
document.getElementById('fig').appendChild(P.svg);
P.outline({r:2});
P.grid({step:5});
P.footprint('0805', {at:[12,9], ref:'R1', value:'10k'});
P.footprint('0805', {at:[12,17], ref:'R2', value:'1k'});
P.footprint('sot23', {at:[24,10], ref:'Q1', value:'AO3400'});
P.footprint('soic8', {at:[36,16], ref:'U1', value:'LM358'});
P.footprint('header', {at:[8,25], n:3, ref:'J1', value:'IN'});
P.trace([[12,9.95],[18,9.95],[18,10],[22.8,10]], {w:0.5});
P.route([25,10],[36,14], {w:0.6});
P.trace([[12,16.05],[20,16.05],[20,18],[36,18]], {w:0.5, layer:'bottom'});
P.via([20,20], {pad:0.9, drill:0.4});
P.pad([44,26], {w:3.2, h:3.2, shape:'circle', drill:1.4});
P.silk('GND', [40.5,29.5]);
P.dim([0,0],[50,0], {offset:-9});
P.dim([50,0],[50,32], {offset:9});
P.legend();
```
````

### F4 工程图：法兰盘（轮廓 + 孔 + 尺寸 + 粗糙度）

粘贴整段：

````
```mathviz
var E = MK.eng({box:[40,26,600,390], ext:[140,96], title:'法兰盘主视图'});
document.getElementById('fig').appendChild(E.svg);
var out = [[20,20],[120,20],[120,76],[20,76]];
E.poly(out, {close:true});
E.circle([70,48], 14);
[[32,32],[108,32],[32,64],[108,64]].forEach(function(c){ E.circle(c,5); E.centerMark(c,{r:8}); });
E.circle([70,48], 20.5);
E.line([6,48],[134,48], {style:'center'});
E.line([70,10],[70,86], {style:'center'});
E.dimX([20,20],[120,20], {offset:10});
E.dimY([20,20],[20,76], {offset:14});
E.dimX([32,32],[108,32], {offset:-17, text:'76'});
E.dimDia([70,48],[70,34], {dx:-8, dy:2, anchor:'end'});
E.dimRad([70,48],[84,48], {dx:18, dy:-14});
E.roughness([92,76], 'Ra 3.2');
E.leader([108,64], [126,86], '4×φ10 均布');
E.viewLabel(70, 2, '主视图');
```
````

### F5 工程图：阶梯轴剖视（剖面线 + 尺寸链）

粘贴整段：

````
```mathviz
var E = MK.eng({box:[40,26,600,390], ext:[170,100], title:'阶梯轴（A—A 剖视）'});
document.getElementById('fig').appendChild(E.svg);
var half = [[20,34],[20,52],[60,52],[60,62],[115,62],[115,52],[155,52],[155,34]];
E.poly(half, {close:true});
E.hatch(half, {angle:45, gap:4});
E.line([8,43],[166,43], {style:'center'});
E.dimX([20,34],[60,34], {offset:12, text:'40'});
E.dimX([60,34],[115,34], {offset:12, text:'55'});
E.dimX([115,34],[155,34], {offset:12, text:'40'});
E.dimY([20,34],[20,52], {offset:14});
E.dimY([60,52],[60,62], {offset:20});
E.sectionCut([163,80],[14,80], {label:'A'});
E.viewLabel(85, 92, 'A—A');
E.roughness([155,52], 'Ra 1.6');
```
````

### F6 负向：端口名写错要给中文提示（负向用例）

粘贴整段：

````
```mathviz
var C = MK.schematic({box:[40,26,600,300], cell:50});
document.getElementById('fig').appendChild(C.svg);
C.resistor({id:'R1', at:[2,2], label:'R1'});
C.resistor({id:'R2', at:[5,2], label:'R2'});
C.wire('R1.左边', 'R2.l');
```
````

**预期**：不渲染失败卡片，而是给出可读的中文错误提示（参数格式不对类）。
