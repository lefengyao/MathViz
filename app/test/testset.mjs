/* MathViz 能力测试集：每条用例都是一段可直接粘贴进 DeepSeek 输入框的
   ```mathviz 代码块（用户消息里的代码块同样会被渲染），用于逐项验证渲染能力。
   数据源单一：verify-testset.mjs 用它在真实 Chromium 里逐条跑通后再生成 testset.md。 */

export const CASES = [
  {
    id: 'A1', group: '2D 函数', name: '双曲线 + 标注 + 图例',
    code: [
      "var V = MK.frame({box:[40,26,600,330], x:[-6.8,6.8], y:[-1.9,1.9], grid:true, axes:true,",
      "  title:'y = sin x 与 y = cos x', desc:'周期 2π，值域 [-1,1]'});",
      "document.getElementById('fig').appendChild(V.svg);",
      "V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2.2});",
      "V.plot(function(x){return Math.cos(x);}, {color:'coral', w:2.2, dash:true});",
      "V.dot([Math.PI/2,1],{color:'coral',r:3.5});",
      "V.label([Math.PI/2,1],'峰值 (π/2, 1)',{dx:6,dy:-14,color:'coral'});",
      "V.legend([{text:'sin x',color:'blue'},{text:'cos x',color:'coral',dash:true}]);"
    ].join('\n')
  },
  {
    id: 'A2', group: '2D 函数', name: '参数方程（椭圆）',
    code: [
      "var V = MK.frame({box:[40,26,600,360], x:[-3.4,3.4], y:[-2.4,2.4], grid:true, axes:true,",
      "  title:'参数方程：椭圆', desc:'x = 3cos t，y = 2sin t'});",
      "document.getElementById('fig').appendChild(V.svg);",
      "V.param(function(t){return [3*Math.cos(t), 2*Math.sin(t)];}, {color:'blue', w:2.2});",
      "V.dot([3,0],{color:'coral'});",
      "V.label([3,0],'t = 0',{dx:8,dy:-10,color:'coral'});"
    ].join('\n')
  },
  {
    id: 'A3', group: '2D 函数', name: '极坐标（心形线）',
    code: [
      "var V = MK.frame({box:[40,26,600,400], x:[-3.2,3.2], y:[-3.2,3.2], grid:true, axes:true,",
      "  title:'极坐标：心形线', desc:'r = 1 + cos θ'});",
      "document.getElementById('fig').appendChild(V.svg);",
      "V.polar(function(t){return 1+Math.cos(t);}, {color:'coral', w:2.2});",
      "V.dot([2,0],{color:'blue'});",
      "V.label([2,0],'θ = 0, r = 2',{dx:8,dy:-10,color:'blue'});"
    ].join('\n')
  },
  {
    id: 'A4', group: '2D 函数', name: '定积分面积填充',
    code: [
      "var V = MK.frame({box:[40,26,600,340], x:[-0.5,4.2], y:[-0.6,3.2], grid:true, axes:true,",
      "  title:'定积分：sin x 在 [0, π] 下方的面积', desc:'∫₀^π sin x dx = 2'});",
      "document.getElementById('fig').appendChild(V.svg);",
      "V.area(function(x){return Math.sin(x);}, 0, Math.PI, {color:'blue', opacity:0.35});",
      "V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2.2});",
      "V.dot([Math.PI/2,1],{color:'coral'});",
      "V.label([Math.PI/2,0.5],'面积 = 2',{dx:10,color:'blue'});"
    ].join('\n')
  },
  {
    id: 'A5', group: '2D 函数', name: '多分支曲线 + 渐近线（tan）',
    code: [
      "var V = MK.frame({box:[40,26,600,360], x:[-4.8,4.8], y:[-4,4], grid:true, axes:true,",
      "  title:'y = tan x', desc:'周期 π，x = π/2 + kπ 处有垂直渐近线'});",
      "document.getElementById('fig').appendChild(V.svg);",
      "function branch(a,b){V.param(function(t){return [t,Math.tan(t)];},{t0:a,t1:b,color:'blue',w:2});}",
      "branch(-Math.PI/2+0.06, Math.PI/2-0.06);",
      "branch(Math.PI/2+0.06, 3*Math.PI/2-0.06);",
      "[ -Math.PI/2, Math.PI/2, 3*Math.PI/2 ].forEach(function(k){",
      "  V.seg([k,-4],[k,4],{dash:true,color:'gray',w:1});",
      "});",
      "V.label([Math.PI/2+0.12,3.3],'x = π/2',{dx:4,color:'gray'});"
    ].join('\n')
  },
  {
    id: 'B1', group: '3D 立体', name: '单位立方体（拖拽旋转 / 双击复位）',
    code: [
      "var S = MK.space({box:[40,26,600,380], yaw:-28, pitch:22, range:2.6,",
      "  title:'单位立方体', desc:'拖动旋转 · 双击复位'});",
      "document.getElementById('fig').appendChild(S.svg);",
      "S.box([0,0,0],[1,1,1],{color:'blue',opacity:0.1});",
      "S.line([0,0,0],[1.5,0,0],{color:'gray'});",
      "S.line([0,0,0],[0,1.5,0],{color:'gray'});",
      "S.line([0,0,0],[0,0,1.5],{color:'gray'});",
      "S.point([0,0,0],{color:'coral',label:'O'});",
      "S.label([0.5,0.5,1],'(0.5,0.5,1)',{color:'blue'});"
    ].join('\n')
  },
  {
    id: 'B2', group: '3D 立体', name: '球与平面截面',
    code: [
      "var S = MK.space({box:[40,26,600,380], yaw:-24, pitch:18, range:3.2,",
      "  title:'球面与水平截面', desc:'平面 z = 0.4 截单位球 · 点击球高亮'});",
      "document.getElementById('fig').appendChild(S.svg);",
      "S.sphere([0,0,0],1.4,{color:'blue',opacity:0.12, info:'单位球 x²+y²+z²=1.96'});",
      "S.plane([-1.4,-1.4,0.4],[2.8,0,0],[0,2.8,0],{color:'teal',opacity:0.3});",
      "S.point([0,0,0.4],{color:'coral',label:'z = 0.4'});"
    ].join('\n')
  },
  {
    id: 'B3', group: '3D 立体', name: '四棱锥',
    code: [
      "var S = MK.space({box:[40,26,600,380], yaw:-30, pitch:20, range:3.0,",
      "  title:'四棱锥', desc:'底面 2×2，高 2'});",
      "document.getElementById('fig').appendChild(S.svg);",
      "S.pyramid([[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],[0,0,2],{color:'coral',opacity:0.15});",
      "S.point([0,0,2],{color:'blue',label:'顶点'});"
    ].join('\n')
  },
  {
    id: 'B5', group: '3D 立体', name: '交互：拖拽旋转 + 点面高亮/信息',
    code: [
      "var S = MK.space({box:[40,26,600,380], yaw:-28, pitch:22, range:2.8,",
      "  title:'可交互立方体', desc:'拖动旋转 · 双击复位 · 点击面看信息'});",
      "document.getElementById('fig').appendChild(S.svg);",
      'S.box([0,0,0],[1.4,1.4,1.4],{color:"blue", opacity:0.12,',
      '  faceInfo:["底面 z=0","顶面 z=1.4","前面 y=0","后面 y=1.4","左面 x=0","右面 x=1.4"]});',
      'S.sphere([2.4,0,0.7],0.55,{color:"coral", opacity:0.25, info:"一个单位球（点击高亮）"});',
      'S.onPick(function(info){ });'
    ].join('\n'),
    interactive: '拖动 = 旋转；双击 = 复位；点面/球 = 高亮并显示信息，点空白取消'
  },
  {
    id: 'B4', group: '3D 立体', name: '空间向量与夹角',
    code: [
      "var S = MK.space({box:[40,26,600,380], yaw:-35, pitch:24, range:2.6,",
      "  title:'空间向量 a 与 b', desc:'a = [1,0,0]，b = [0,1,0]，夹角 90°'});",
      "document.getElementById('fig').appendChild(S.svg);",
      "S.arrow([0,0,0],[1.6,0,0],{color:'blue'});",
      "S.arrow([0,0,0],[0,1.6,0],{color:'coral'});",
      "S.angle([0,0,0],[1.2,0,0],[0,1.2,0],{color:'teal'});",
      "S.label([1.8,0,0],'a',{color:'blue'});",
      "S.label([0,1.8,0],'b',{color:'coral'});"
    ].join('\n')
  },
  {
    id: 'C1', group: '图论离散', name: '无向图 + 最短路径高亮',
    code: [
      "var G = MK.graph({box:[40,24,600,380], directed:false,",
      "  title:'最短路径：A → F', nodes:['A','B','C','D','E','F'],",
      "  edges:[['A','B',4],['A','C',2],['B','C',1],['B','D',5],['C','D',8],['C','E',10],['D','E',2],['D','F',6],['E','F',3]]});",
      "document.getElementById('fig').appendChild(G.svg);",
      "G.layout('force');",
      "G.draw();",
      "G.path(['A','C','B','D','E','F'],{color:'coral',w:3});",
      "G.mark('F',{color:'coral'});"
    ].join('\n')
  },
  {
    id: 'C2', group: '图论离散', name: '有向分层图（拓扑结构）',
    code: [
      "var G = MK.graph({box:[40,24,600,400], directed:true,",
      "  title:'AOV 网拓扑排序', nodes:['S','A','B','C','D','T'],",
      "  edges:[['S','A',1],['S','B',1],['A','C',1],['B','C',1],['B','D',1],['C','T',1],['D','T',1]]});",
      "document.getElementById('fig').appendChild(G.svg);",
      "G.layout('layered');",
      "G.draw();"
    ].join('\n')
  },
  {
    id: 'C3', group: '图论离散', name: '二叉树',
    code: [
      "var G = MK.graph({box:[40,24,600,380], directed:true,",
      "  title:'满二叉树（层序编号）', nodes:['1','2','3','4','5','6','7'],",
      "  edges:[['1','2',1],['1','3',1],['2','4',1],['2','5',1],['3','6',1],['3','7',1]]});",
      "document.getElementById('fig').appendChild(G.svg);",
      "G.layoutTree('1');",
      "G.draw();"
    ].join('\n')
  },
  {
    id: 'C4', group: '图论离散', name: '三集合文氏图',
    code: [
      "var svg = MK.venn({box:[40,24,600,340], title:'三集合关系',",
      "  sets:[{label:'A：偶数',color:'blue'},{label:'B：3 的倍数',color:'coral'},{label:'C：大于 5',color:'teal'}],",
      "  regions:[{set:0,dx:-78,dy:-46,text:'2'},{set:0,dx:0,dy:34,text:'6'},{set:0,dx:0,dy:-2,text:'8'},{set:1,dx:78,dy:-46,text:'3'},{set:2,dx:0,dy:52,text:'10'}]});",
      "document.getElementById('fig').appendChild(svg);"
    ].join('\n')
  },
  {
    id: 'C5', group: '图论离散', name: '关系矩阵',
    code: [
      "var svg = MK.matrix({x:150,y:70,cell:52,label:'关系矩阵 R（自反 + 反对称示例）',",
      "  rows:['1','2','3'], cols:['1','2','3'], data:[[1,1,0],[0,1,1],[0,0,1]]});",
      "document.getElementById('fig').appendChild(svg);"
    ].join('\n')
  },
  {
    id: 'D1', group: '纯 SVG', name: '手写几何示意图',
    code: [
      '<svg viewBox="0 0 680 240" xmlns="http://www.w3.org/2000/svg">',
      '  <rect x="1" y="1" width="678" height="238" rx="12" fill="#FBFAF7" stroke="#D3D1C7"/>',
      '  <circle cx="170" cy="120" r="70" fill="#E8F0FE" stroke="#4A7DBF" stroke-width="2"/>',
      '  <rect x="330" y="50" width="140" height="140" rx="8" fill="#FDEBE7" stroke="#C4694F" stroke-width="2"/>',
      '  <polygon points="560,190 620,70 680,190" fill="#E6F4EE" stroke="#3F8F6B" stroke-width="2"/>',
      '  <line x1="100" y1="120" x2="600" y2="120" stroke="#8A877E" stroke-width="1" stroke-dasharray="5 4"/>',
      '  <text x="170" y="126" text-anchor="middle" font-size="14" fill="#2B2A26">圆</text>',
      '  <text x="400" y="126" text-anchor="middle" font-size="14" fill="#2B2A26">矩形</text>',
      '  <text x="622" y="152" text-anchor="middle" font-size="14" fill="#2B2A26">三角形</text>',
      '</svg>'
    ].join('\n')
  },
  {
    id: 'E1', group: '综合边界', name: '一条消息两个代码块（出两张图）',
    codes: [
      [
        "var V = MK.frame({box:[40,26,600,300], x:[-3.5,3.5], y:[-1.6,1.6], grid:true, axes:true, title:'图一：sin'});",
        "document.getElementById('fig').appendChild(V.svg);",
        "V.plot(function(x){return Math.sin(x);}, {color:'blue', w:2});"
      ].join('\n'),
      [
        '<svg viewBox="0 0 680 160" xmlns="http://www.w3.org/2000/svg">',
        '  <rect x="240" y="30" width="200" height="100" rx="10" fill="#E6F4EE" stroke="#3F8F6B" stroke-width="2"/>',
        '  <text x="340" y="86" text-anchor="middle" font-size="16" fill="#2B2A26">图二：纯 SVG</text>',
        '</svg>'
      ].join('\n')
    ],
    code: ''
  },
  {
    id: 'E2', group: '综合边界', name: '公式正文 + 代码块混排',
    prose: '下面是欧拉恒等式的几何直观：\n\n$$e^{i\\theta} = \\cos\\theta + i\\sin\\theta$$\n\n单位圆上转一圈回到 1：',
    code: [
      "var V = MK.frame({box:[40,26,600,360], x:[-1.6,1.6], y:[-1.4,1.4], grid:true, axes:true,",
      "  title:'单位圆上的 e^{iθ}', desc:'θ 从 0 转到 2π'});",
      "document.getElementById('fig').appendChild(V.svg);",
      "V.param(function(t){return [Math.cos(t), Math.sin(t)];}, {color:'blue', w:2.2});",
      "V.dot([1,0],{color:'coral'});",
      "V.label([1,0],'θ = 0',{dx:8,dy:-10,color:'coral'});",
      "V.dot([-1,0],{color:'teal'});",
      "V.label([-1,0],'θ = π',{dx:-8,dy:-10,color:'teal'});"
    ].join('\n')
  },
  {
    id: 'E3', group: '综合边界', name: '负向：运行时错误要有可读提示',
    negative: true,
    code: [
      "var V = MK.frame({x:[-2,2], y:[-2,2]});",
      "document.getElementById('fig').appendChild(V.svg);",
      "V.plot('这不是函数', {color:'blue'});"
    ].join('\n')
  }
];

/* 供 verify-testset 与生成 testset.md 共用 */
export const GROUPS = ['2D 函数', '3D 立体', '图论离散', '纯 SVG', '综合边界'];
