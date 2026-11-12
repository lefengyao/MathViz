# MathViz for DeepSeek

在 **chat.deepseek.com** 网页上，按需把 MathViz 作图协议交给模型，再把它回复里
` ```mathviz ` 代码块**就地渲染成数学图形**的 MV3 扩展。

一句话：**模型只写数学表达式，坐标交给 MathViz 运行时算，扩展负责把图插回聊天里。**

---

## 和 `browser/` 那套有什么不一样

| | `browser/`（DeepSeek 网页助手） | `mathviz/`（本扩展） |
|---|---|---|
| 目的 | 划词 / 整页翻译、总结、对话 | 让网页版 DeepSeek 会画准确的数学图 |
| 接口 | 调 DeepSeek 私有接口（PoW + SSE） | **完全不调接口** |
| 登录态 | 读 `localStorage.userToken` | **不碰登录态** |
| 权限 | storage + contextMenus + host_permissions | 只有 `storage` |
| 注入范围 | 所有网页 | 只有 `https://chat.deepseek.com/*` |

复用的是工程经验，不是私有接口：**Shadow DOM 隔离 UI、MutationObserver 跟流式 DOM、
构建时内联 + 静态校验、真实 Chromium 加载 unpacked 扩展做 e2e**。
所以 DeepSeek 改 PoW 算法、改接口字段，这套都不受影响；只有它改页面 DOM 结构才需要更新。

---

## 装

1. `edge://extensions/`（Chrome 是 `chrome://extensions/`）→ 开「开发人员模式」
2. 「加载解压缩的扩展」→ 选 **`mathviz/dist/extension/`**
3. 打开 <https://chat.deepseek.com>，左下角出现 `∑ MathViz` 即成功

`dist/extension.zip` 是同一个包的压缩版，用于分发 / 上传商店。

## 用

1. 点左下角 `∑ MathViz`（或按 **`Alt + M`**）打开面板
2. 选一个**作图模式**（见下表）
3. 点「插入提示词」——协议以明文插进输入框（**你能看到、能改**），你的问题保留在末尾
4. 正常发送。**一整轮对话只需要给这一次**：模型在上下文里已经记住协议，后面直接问
   「再画一个离心率 0.8 的椭圆」就行，不用再插。
5. 开了新对话，点面板上的「**新对话**」重置，再重新给一次。

面板会显示「本轮对话：已注入一次 / 还没给提示词」。同一模式重复点「插入提示词」
**不会再改写输入框**（避免受控输入框反复重绘、看起来一直闪烁）；只有换了作图模式才允许更新一次。

「新对话的首次发送自动附加」是实验开关：开启后只在**本轮第一次**发送时补一次协议，
不会每句话都塞一遍。默认关闭，手动插入是可靠路径——React 受控输入框在极端时序下可能吃掉这次改写。

| 模式 | 效果 |
|---|---|
| 通用 · 自动选产线 | 模型自己判断手写 SVG / 2D / 3D / 图论 / 电路 / PCB / 工程图 |
| 函数与 2D | 强制 `MK.frame`，曲线、参数方程、向量 |
| 立体与 3D | 强制 `MK.space`，多面体、截面、空间向量 |
| 图论与离散 | 强制 `MK.graph` / `MK.venn` / `MK.matrix` |
| 电路原理图 | 强制 `MK.schematic`，元件符号 + 端口名连线，自动正交走线 |
| PCB 布局 | 强制 `MK.pcb`，板框 + 封装 + 走线 + 过孔，毫米坐标 |
| 机械工程图 | 强制 `MK.eng`，零件轮廓 + 尺寸 + 剖面线 + 粗糙度 |
| 纯 SVG · 简单图 | 零运行时，只适合图元 ≤ 8 的简单示意图 |
| 关闭 | 不插协议；已有代码块仍会渲染 |

模式与开关记在 `chrome.storage.local`；「本轮已注入」只存在当前标签页内存里，刷新页面会重置为新对话。

---

## 图在哪里

渲染宿主**直接挂在模型输出的那个 `<pre>` 代码块内部**：原代码文本收起（点「源码」能看回来），
代码块原地变成图，右上角只留一行小按钮（存图 / 源码 / 复制 / 重渲染 / 折叠）。
不会在消息旁边另起一张卡片，也不会凭空多出图片。

## 存图（导出 PNG）

每张图右上角的「存图」把当前画面存成 PNG，**3D 图存的就是此刻这个视角** ——
拖拽时运行时已经把视角画进了 DOM，序列化下来的就是屏幕上看到的样子，不需要另存相机参数。

几个不那么显然的决定：

| 决定 | 为什么 |
|---|---|
| 在沙箱 iframe 里转 PNG，只回传 data URL | iframe 是 `sandbox="allow-scripts"`（opaque origin），父页面拿不到它的 DOM |
| 用 `data:image/svg+xml` 喂 `<img>` 再画 canvas | blob URL 在 opaque origin 下有可能被判定跨源弄脏 canvas；data URL 不涉及源，实测 `toDataURL` 不抛错 |
| 导出前把 `var(--font-sans,…)` 换成 fallback | SVG 作为图片渲染时读不到页面 CSS 变量，不换字体就整段失效 |
| 按 `getBBox()` 紧裁，不导整帧 | 运行时给标题预留了空白，3D 图整帧导出会像截图；裁完才像插图 |
| 底色用当前主题背景 | 透明 PNG 贴到深色聊天里会糊成一片 |
| 2 倍图，超过 1600 万像素自动降倍 | 手机上开太大的 canvas 会直接 OOM |
| 一张卡里有多张图时竖着拼成一张 | 模型偶尔一次画两条，分开存反而麻烦 |

浏览器里走 `<a download>`；Android 的 WebView 没有 `DownloadListener`，`<a download>` 什么都不会发生，
所以那边交给原生 `MathVizBridge.saveImage()` 写进 `Pictures/MathViz`（见 `android/README.md`）。

## 3D 与图论的交互（2026-11-11 新增）

- **3D 拖拽旋转开箱即用**：`MK.space` 的画布创建时就挂好了拖拽旋转（触屏 / 鼠标通用）与
  双击复位，模型不再需要写 `draw` 闭包和 `S.drag(draw)`（旧写法仍然兼容）。
  实现是**操作重放**：每个绘制调用入队，`S.redraw()` 清场后按序重放，视图变了图不散。
- **点面高亮 + 信息栏**：`S.face(pt,{info:'说明'})`、`S.solid(v,f,{faceInfo:[...]} )`、
  `S.sphere(c,r,{info})` —— 点击那块会高亮（透明度 / 描边加深），底部信息栏显示说明，
  点空白取消；`S.onPick(fn)` 可接回调。
- **图论节点点选**：`MK.graph` 的节点加 `info:'说明'`，点击节点高亮并显示信息；
  `G.onPick(fn)` / `G.pick(id)`。
- 提示词（skill）已同步：solid3d / discrete 产线明确告诉模型这些交互自带、鼓励给块加 `info`。
- 交互测试 `test/interact.test.mjs` 15 项 + 真机 CDP 实测
  （`android/interact-check.mjs`：旋转视图变化、重放图元数稳定、点面高亮 / 信息栏 / 回调）。

## 画布缩放与平移（2026-11-12 新增）

图太小看不清细节时，可以直接在卡片里放大看。

| 手势 | 普通图（2D / 图论 / 电路 / PCB / 工程图） | 3D 图 |
|---|---|---|
| 鼠标滚轮 | 以指针为锚缩放 1×–6× | 同左 |
| 鼠标左键拖动 | 平移 | **旋转**（原有行为不变） |
| Alt+左键 / 中键拖动 | 平移 | 平移（左键被旋转占用） |
| 双指张开 / 捏合 | 缩放 + 跟随双指中点平移 | 同左 |
| 单指拖动 | 交还给页面滚动 | 旋转 |
| 双击 | 复位 | 复位缩放 + 复位视角 |

右上角会出现一个半透明的百分比胶囊，点它也能一键复位；回到 100% 后自动消失。

几个关键决定：

- **只改 CSS `transform`，不动 `viewBox`**。坐标映射不变，3D 的拾取与旋转、
  点面高亮都不受影响；导出的 PNG 也因此永远是整张图，而不是「放大后看到的那一块」——
  缩放是看的手段，不该改变图是什么。
- **1× 时滚轮向下滚会放行**（不 `preventDefault`），浏览器把滚动交给聊天页，
  不会出现「图把页面卡住，只能把鼠标挪到图外面才能滚」。
- **单指不拦截**（`touch-action: pan-y` + 只有双指才 `preventDefault`），
  手机上手指落在图上照样能上下滑聊天；双指才接管，顺带避免浏览器自己缩放整页。
- **平移有边界**：图放大后最多拖到边缘对齐，不会拖出一片空白。
- 3D 的 svg 带 `data-mv-orbit="1"` 标记，查看器据此把「拖动」让给旋转；
  `S.drag()` 之类的旧写法仍然兼容。

验证：`test/nav.test.mjs` 24 项，全部走真实事件（Playwright 鼠标 / CDP 触摸 / 合成 TouchEvent），
覆盖锚点不漂移、平移边界、双指位移不放大、3D 手势分工、放大后导出仍是整图；
MuMu（Android 12 / WebView）上实测双指捏合 2.07×、平移跟手、双击复位。

### 图多了会不会卡（v1.6）

先量再改。`test/perf.mjs` 直接内嵌 `viewer.html` 压测，测的是「图本身」的成本：

| 图数 | SVG 节点 | 渲染总耗时 | 整页光栅 | 滚动 CPU/帧 | 增量内存 |
|---|---|---|---|---|---|
| 1 | 66 | 76ms | 12ms | 0.08ms | — |
| 10 | 362 | 90ms | 15ms | 1.22ms | ~110MB |
| 20 | 660 | 121ms | 18ms | 1.28ms | ~150MB |

（手机视口 393×852 + CPU 降速 5 倍：20 张 349ms、CPU 3.39ms/帧 —— 仍在一帧 16.7ms 的预算内。）

绘图侧轻是因为：一条 300 点的曲线在 DOM 里就一个 `<path>`；3D 没有常驻 `rAF`，只在拖动时重绘；
缩放只改 CSS `transform`，不触发重排。**成本在 iframe 数量上**——每张图一个沙箱 iframe，
各自一份 document + JS 上下文，约 8MB/张。所以优化全在「少开、早关」：

- **分批渲染**：最多 2 个 iframe 同时开工，队列按到视口的距离排序。20 张图同时
  `new Function` 在手机上是一次 300ms 级的卡顿，分批后峰值被摊平。
- **iframe 按需创建**：建卡不等于建 frame。40 张图全建出来就是 40 个 frame，
  每个都是一份 document；现在只有真要画时才插入，暂存时**整个移除**（不是换成
  `about:blank`——那样仍然留着一个 frame）。实测 120 张卡同时只有 5 个 iframe。
- **离屏暂存**：离可视范围 2400px 以外的图先不画；画过的离开就移除 iframe，
  高度用占位锁住（不跳版），滚回来重建一次 6~17ms。
- **共用一张样式表**：卡片的 CSS 用 `adoptedStyleSheets` 共享，只解析一次；
  以前每张卡都插一份 `<style>`，200 张图就是 200 次解析、约 2MB 重复文本。
- **屏幕外不排版**：卡片宿主加 `content-visibility:auto`，屏幕外的 shadow 树连
  样式与布局都跳过，长会话滚回顶部不用把几十张卡重算一遍。
- **后台不扫描**：`document.hidden` 期间不扫 DOM，切回前台由 `visibilitychange`
  只补后台期间记录的变更 + 一次视口重算，不重读整份历史。
- **历史消息增量识别**：只检查新增或改动的消息分支；侧栏样式、hover 和自己的图卡
  不触发全页源码扫描。每 3 秒的兜底只检查主题和卸载清理，完整扫描限于启动和手动操作。
  裸围栏用文本遍历定位，避免逐层拼接同一段历史文本。
- **换源码立即释放任务**：历史消息被替换或卸载时，同步清理 iframe、观察器、超时和
  并发名额，避免新图等到旧任务的 9 秒超时才启动。
- **折叠即释放**：点「折叠」不再只是 `display:none`，iframe 一并清掉。
- **主题切换走队列**：以前是 20 张图同时换 `src`，现在排队重画。

「远/近」**只信 `getBoundingClientRect()` 量出来的距离**，`IntersectionObserver` 仅用来
「通知视口可能变了」。v1.6 曾经直接读 `isIntersecting` 决定画还是释放，结果在
「消息列表装在自己的滚动容器里」的站点（DeepSeek 就是）上会翻车：祖先裁剪让判定忽真忽假，
滚回来的那一帧又不一定有回调，卡片就永久停在「渲染中…」。现在任何一次 IO 回调、
滚轮 / 触摸 / 缩放 / 切回标签页都会触发一次 `evaluate()` 重算，可见的一定画、远的一定释放。

切回标签页仍觉得卡时，先读三个探针（DevTools 控制台）：

```js
document.documentElement.dataset.mvScan            // 最近 20 次扫描的耗时（ms，含增量/轻量兜底）
document.documentElement.dataset.mvLong            // 最近 30 个长任务（>50ms）的耗时
document.documentElement.getAttribute('data-mv-wake')  // 最近 5 次切回前台：后台多久 + 卡片快照 + 唤醒耗时
```

`mvLong` 为空 = 主线程没有大块同步任务，卡在站点自身或合成器；有一串几百毫秒的，
说明同步工作确实在这里，把数字发回来就能定位是扫描、渲染还是重建。

`mvWake` 每条格式：`away=Ns n总数/r已渲染/p暂存/q排队/i进行中/f活frame t+耗时`。
`t+` 是切回前台到记录点（600ms 后）的墙上耗时——**它包含主线程被占住的时间**：
整页卡死时这个数会直接涨到几百毫秒甚至几秒，一眼看出卡死发生在唤醒后、有多凶；
对比前后的 `n/r/p/q/i/f` 快照，能看出是我们重建 frame（f 变化）还是站点自己在闹。

另外扩展被重载/更新后，未刷新的旧标签页会优雅降级：卡片状态显示「扩展已更新，请刷新页面（F5）」，
不再抛 `chrome.runtime` 相关异常（`platform-chrome.js` 里的 `alive()` 探活负责这个）。

想复现或看自己的机器：`node test/perf.mjs --mobile`；机制本身由 `test/lazy.test.mjs` 11 项守着
（首屏不提前画远处图 / 滚动到底能画 / 滚回重建 / 离屏移除 iframe 且高度不塌 / 折叠释放 /
内部滚动容器 / 80 条历史回答前后翻看 / 无 JS 错误）。增量扫描与换源码调度由
`test/history.test.mjs` 覆盖：静置和侧栏不重读旧代码、追加只检查新块、在途任务替换、
跨 span 的裸围栏更新、未完成块计数与卸载清理。
工程图自适应的边界（320px 窄容器 / 超长标题 / 空图 / 单点 / PCB）由 `test/eng-boundary.test.mjs` 守着。

排查现场卡顿时，控制台执行 `document.documentElement.dataset.mvScan` 可看到最近 20 次扫描耗时；
初次完整识别与后续增量检查的工作量不同，需结合滚动位置和长任务记录判断。

早期版本会「输入框一直闪烁 + 莫名其妙多出图」，根因是三个叠在一起的问题，现在都已修掉：

| 现象 | 根因 | 修法 |
|---|---|---|
| 多出一张图 | 提示词自带的「最小可运行示例」是一整段闭合的 ` ```mathviz ... ``` `，插进输入框 / 显示在用户消息里后，被扩展自己的扫描器当成模型输出渲染了 | 提示词里的示例只给**代码块内容**、不带首尾 fence；全文只出现一次 ` ```mathviz ` 字面量，凑不出闭合块 |
| 用户消息里的示例也变图 | 扫描器把 `language-mathviz` 的示例 `pre`、以及协议正文里的 "mathviz" 字样都当成了目标 | 跳过输入框（含 `contenteditable`）、协议正文、用户消息气泡里的示例；语言标记判断收紧，代码块头部必须以 `mathviz` 开头 |
| 输入框一直闪烁 | 误渲染的卡片插在输入框附近，加上扫描器写 DOM 又喂回自己的 MutationObserver，形成自激循环 | 过滤自身 UI 和无关样式变更，合并增量扫描；样式写入前先比对，不重复写；同一模式重复点插入不再改写输入框 |

回归测试里专门留了两条断言：把完整协议塞进 `contenteditable`、以及用户消息气泡里放一个
`language-mathviz` 示例，都不许再多出任何一张图。

---

## 代码块协议

模型被要求输出**一个或若干个**这样的块：

````
```mathviz
var V = MK.frame({box:[40,26,600,330], x:[-4,4], y:[-3,5], grid:true, axes:true, title:'抛物线'});
document.getElementById('fig').appendChild(V.svg);
V.plot(function(x){ return x*x-2; }, {color:'blue', w:2.2});
V.dot([0,-2], {color:'coral'});
```
````

也可以直接给一个手写 `<svg viewBox="0 0 680 H">`（纯 SVG 模式）。
协议里写死了这些硬约束：画布宽 680、内容落在 x=40~640、不要内联运行时、
不要 `<script>` 标签 / `html/head/body` / `import`、不要手算采样点、
图元显式写颜色、字号 ≥ 11px、连接线 `fill="none"`、代码块内不访问网络和存储。

`MK.frame` / `MK.space` / `MK.graph` / `MK.venn` / `MK.matrix` 的完整 API 摘要也随协议一起给模型，
它不需要看 MathViz 的 `references/` 就能写对。

**模型不遵守协议怎么办**：卡片会显示「渲染失败」并自动展开源码与错误信息，
点「源码」能拿到原始代码，改完贴回去或让它重答即可。不会破坏页面其它内容。

---

## 它是怎么工作的

```
content script（隔离世界，页面 DOM 可见）
  ├─ prompt.js   九种模式的提示词模板
  ├─ detect.js   ```mathviz 块识别 / 归一化 / 分类 / 摘要去重
  ├─ 工具条      Shadow DOM，左下角（避开 browser/ 那套的右下悬浮球）
  ├─ 插入        原生 value setter + input 事件；本轮只写一次，换模式才允许更新
  └─ 观察器      MutationObserver（100ms 合并变更分支 + 过滤自身 UI），认 <pre><code> 和流式裸 fence
                   渲染宿主 append 进原 <pre>、原 code 收起 → 代码块就地变图
                       │ postMessage（只传代码字符串，不传任何凭据）
                       ▼
viewer.html（manifest.sandbox.pages，opaque origin）
  ├─ 内联 mk-core.js + mk-3d.js + mk-graph.js + mk-eng.js（约 2900 行，本地打包）
  ├─ new Function(code)() 执行模型代码 → 生成 <svg>
  └─ 回传高度 / 错误 → 父页面撑开 iframe
```

三个关键决策：

1. **必须用 sandbox iframe，不能在 content script 里 `eval`。**
   content script 虽然跑在隔离世界，但**和页面同源**，能读到 `localStorage.userToken`。
   模型输出的代码属于不可信输入，绝不能放在那里执行。
   `sandbox.pages` 给 viewer 一个 opaque origin：拿不到父页面 DOM、Cookie、localStorage，
   也用不了扩展 API；iframe 上再叠一层 `sandbox="allow-scripts"`（不含 `allow-same-origin`）。

2. **不用 `srcdoc`。** srcdoc 会继承父页面的 CSP，内联脚本容易被挡。
   改成 `chrome.runtime.getURL('viewer.html')`，它是扩展自己的页面，CSP 由我们写。
   实测 DeepSeek 首页的 CSP 只有 `frame-ancestors 'none'`（禁止自己被嵌），
   没有 `frame-src` 限制，因此页面可以嵌扩展 iframe —— 这条依据来自 `_recon/headers.txt`，
   **若官方以后加了 `frame-src`，需要重新评估**。

3. **运行时随包内联，不远端下载。** 沙箱页的 meta CSP 关掉 `connect-src` / `font-src`，
   viewer 里再覆写 `fetch / XHR / WebSocket / sendBeacon / Image`。模型代码即使想外带数据也发不出去。

主题：扩展读页面背景亮度判断深浅，通过 URL query 传给 viewer；
viewer **在加载运行时之前**设置 `--color-background-primary` / `--color-text-primary`，
因为 `mk-core.js` 的 `isDark()` 只在脚本执行那一刻读一次。

---

## 目录

```
mathviz/
├── README.md              本文件
├── package.json           scripts
├── build.mjs              一键构建 + 静态校验 + 打 zip + 画图标（零 npm 依赖）
├── src/
│   ├── manifest.json      MV3 / content_scripts / sandbox.pages / WAR
│   ├── platform-chrome.js 平台适配层（扩展侧 3 处 chrome.*）
│   ├── prompt.js          提示词模板（纯逻辑，可单测）
│   ├── detect.js          代码块识别（纯逻辑，可单测）
│   ├── content.js         工具条 / 插入 / 观察器 / 卡片（只认 MVPlatform）
│   ├── viewer.html        沙箱页模板（占位符由构建替换）
│   ├── viewer.js          沙箱内执行、回传、画布手势（缩放/平移/导出）
│   └── ui.css             工具条 + 卡片样式（注入 Shadow DOM）
├── assets/                MathViz 四个运行时的**本地快照**
│   └── mk-core.js / mk-3d.js / mk-graph.js / mk-eng.js
├── android/               【Android 正式 App】WebView 套壳 + platform 适配层
├── android-probe/         真机 DOM 探针（最小 WebView + CDP）
├── test/
│   ├── core.test.mjs      67 项纯逻辑
│   ├── e2e.mjs            35 项真实 Chromium 端到端（含存图真下载）
│   ├── interact.test.mjs  15 项交互（旋转/点选/信息栏，真实 Chromium）
│   ├── eng.test.mjs       44 项工程运行时渲染断言（真实 Chromium）
│   ├── export.test.mjs     9 项导出 PNG 断言（沙箱 iframe + canvas 不污染）
│   ├── nav.test.mjs       24 项画布手势（滚轮/拖动/双指/复位/导出不受影响）
│   ├── lazy.test.mjs      11 项渲染调度（含 80 条历史回答在内部容器前后翻看）
│   ├── history.test.mjs   历史消息增量扫描 / 在途任务替换 / 流式围栏更新
│   ├── perf.mjs           渲染压力基准（N 张图的耗时/内存/CPU，--mobile 模拟手机）
│   ├── docsnip.mjs        把 skill/references 的代码块全跑一遍
│   ├── shot.mjs           按 id 渲染用例并截图，供人眼校对排版
│   ├── testset.mjs        能力测试集数据源（25 条）
│   ├── verify-testset.mjs 测试集逐条验证
│   ├── compliance.mjs     模型回复合规检查（产线/自造交互/截断，可 --render）
│   ├── gen-testset-md.mjs 生成 testset.md
│   └── screenshots/       验证截图
└── dist/                  产物，可删可重建，不要手改
    ├── extension/         加载解压缩扩展时选这个
    └── extension.zip
```

`assets/` 是从 `../skill/assets/` 复制的快照（2026-11-11），
所以本目录**不依赖 MathViz 项目也能独立构建**。上游运行时升级后，重新复制并跑一次构建即可。

---

## 开发与验证

```bash
cd app
node build.mjs              # 产出 dist/extension/ + dist/extension.zip
node test/core.test.mjs     # 67 项：提示词、代码块提取/归一化/分类、协议不自造闭合 fence
node test/export.test.mjs   # 9 项：导出 PNG（尺寸/底色/3D 当前视角/多图拼合）
node test/e2e.mjs           # 35 项：真实 Chromium 加载 unpacked 扩展（含点存图真下载）
node test/lazy.test.mjs     # 11 项：渲染调度 + 80 条历史回答前后翻看（真实 unpacked 扩展）
node test/history.test.mjs  # 历史消息增量扫描、任务替换、流式围栏、未完成计数
node test/perf.mjs --mobile # 压力基准：手机视口 + CPU×5 降速下 N 张图的耗时与内存
node test/interact.test.mjs # 15 项：拖拽旋转、点面高亮、信息栏、图论节点点选
node test/compliance.mjs --selftest   # 规则自检：25 条正例零误判 / 12 条反例零漏检
```

e2e 用本地 mock 的 `chat.deepseek.com` 页面（Playwright `route` 拦截，不联网、不需要登录），
验证的是纯逻辑测不到的部分：

- sandbox 页能被页面 iframe 加载，`new Function` 真的能执行
- 内联后的 `mk-core/3d/graph` 真的画出带网格、坐标轴、曲线的 `<svg>`（截图亲眼核过）
- **图直接挂在原 `<pre>` 内部**、原代码被收起，不是旁边另起一张卡片
- **提示词不会自造图片**：完整协议塞进输入框 / 用户消息气泡都不许多出一张图
- **不闪烁**：插入后输入框值 1 秒内稳定、静置 1 秒卡片数不变；同一模式重复插入不重写 DOM
- **一轮只注入一次**：换模式才更新、点「新对话」才重置、自动附加只补首次
- 流式追加代码块、坏代码报错、深浅主题切换、卡片交互
- **沙箱内访问父页面 DOM 被浏览器拒绝**（登录态隔离）
- **3D / 图论**：提示词里的 `solid3d`、`discrete` 示例真的渲染出立体图与图论图；
  围栏被写成 `javascript` 也能靠 `MK.space(...)` 特征救回来；
  漏 `appendChild`、`S.drag(draw)` 未定义等常见错误给出中文可操作提示
- **移动版 DOM 兼容**：`.md-code-block + pre>span`（无 `<code>`、语言名在 banner）能识别并渲染；
  无文本的 `div[role="button"].ds-button--iconLabelPrimary` 也能触发自动附加
- 全程无未捕获 JS 错误

构建时的静态校验：manifest 引用的文件是否齐全、占位符是否替换完、
三段运行时是否真的内联、sandbox 页与 WAR 是否声明。

### 能力测试集（给人手测真机/真页面用）

`testset.md` 是 25 条自包含用例（2D 五种 / 3D 五种（含交互）/ 图论五种 / 纯 SVG / 综合边界 /
电路与工程六种），每条都是完整的 ` ```mathviz ` 代码块，**原样粘进输入框发送即可渲染**（用户消息同样被扫描），
用来在不依赖模型的情况下逐项验证渲染链路；表格里还附了「直接问模型的问题」测提示词遵循度。

```bash
node test/verify-testset.mjs   # 真实 Chromium 里逐条跑（当前 25/25）
node test/gen-testset-md.mjs   # 改过 test/testset.mjs 后重新生成 testset.md
```

**提问测试集**：`questions.md` 是另一份文件，只有问题、没有代码和判读说明——
105 条按九条产线分组（自动选产线 / 2D / 3D / 图论 / 原理图 / PCB / 工程图 / 综合边界），
配合顶部「插入作图提示词」逐条发给模型，看它是否按协议出代码块。
用法：选中一条 → 粘到「我的问题」后面 → 发送；出图即通过。
第 95–97 条是故意让它自己写动画 / 拖拽的陷阱题，第 94 条是「用 canvas 画」的跑偏题，
第 98–99 条测多轮上下文改写，第 100 条测「一图混排」是否会被拆成两个代码块。

**测模型遵循度**：把模型对表中问题的原始回复存成 txt，交给检查器打分——

```bash
node test/compliance.mjs reply.txt --render
```

静态判定产线是否用对（没自造交互轮子、没跨模块乱调 API、代码没截断），`--render` 再把每块真跑一遍。
分三级：❌ 违规 / ⚠️ 告警 / ✅ 合规，有违规时退出码 1，可直接进回归。规则编号 R1–R13 见 `test/compliance.mjs` 顶部注释。

---

## 3D 曾经"渲染失败"，查下来不是运行时的锅

浏览器探针里 `MK.space` / `MK.graph` / `MK.mk` 都在，提示词示例和官方立方体片段都能出 svg。
真实失败集中在**模型输出侧**，四条：

| 现象 | 原因 | 现在 |
|---|---|---|
| 什么都没发生 | 模型把围栏写成 javascript，`isMathvizCode` 不认 | 内容含 `MK.space(...)` 或 `getElementById('fig')` 也认 |
| 「渲染失败」 | 漏了 `appendChild(S.svg)` | 提示词硬约束明写；错误信息指名挂载动作 |
| `draw is not defined` | 照抄 `S.drag(draw)` 却没定义 `draw` | 提示词禁止；错误信息给中文解释 |
| `S.plot is not a function` / `pts.map is not a function` | 3D 混用 2D 方法、`S.face` 传了对象 | 提示词补参数格式与禁令；错误信息分类翻译 |

`solid3d` / `discrete` 的 API 摘要现在带参数格式、挂载动作和常见禁用法，
两段示例本身也在 e2e 里真跑过。若仍遇到失败，点卡片「源码」把错误文字发出来即可定位。

---

## 已知边界 / 风险

- **真实账号下的端到端没验证**：mock 页面不等于 DeepSeek 的真实 DOM。输入框定位用的是
  「最大可见 textarea → contenteditable」的启发式，发送按钮靠 `aria-label/title/class/文本` 猜。
  官方改版后若失效，改 `content.js` 里的 `composer()` 与发送按钮匹配即可。
- **一轮对话只注入一次**：模型靠上下文记住协议，后续直接提问即可。换作图模式会更新一次，
  开新对话要点「新对话」重置（状态只存当前标签页内存，刷新页面即视为新对话）。
- **自动附加是实验功能**：默认关、且只补本轮首次。手动「插入提示词」是可靠路径。
- **裸 ` ```mathviz ` 文本**：只有当那个元素去掉 fence 后剩余文字 ≤ 40 字时才会收起原文；
  夹在大段正文中间时原文会保留（避免误删正文）。这类流式中间态用轻量兄弟节点渲染，
  等页面把它渲染成 `<pre>` 后会自动切换成代码块内渲染。
- **一个代码块 = 一处渲染**，块内多个 `<svg>` 会纵向排在同一处。
- **页面 SPA 重渲染**会换掉 DOM 节点，观察器会重新挂载；已有图不会自动迁移。
- **不可信代码始终在沙箱里**，但仍建议只对你自己发起的对话启用；
  别把别人给的代码块当成可信输入去改协议。
- 只处理 top frame，`iframe` 内的内容不注入。
- 与 `browser/` 那套可同时装：工具条一个在左下、一个在右下，快捷键 `Alt+M` / `Alt+D` 不冲突。

---

## 手机端

`android/` 是原生 Android WebView 套壳，加载 `chat.deepseek.com` 后注入**同一份** `src/` 业务 JS；
`android-probe/` 是用来抓真机 DOM 的一次性探针。两者各有 README。

三条扩展能力通过 `MVPlatform` 适配层替换：`chrome.runtime.getURL` → 本地虚拟域名
`https://mathviz.local/viewer.html`（`shouldInterceptRequest` 由 assets 提供）、
`chrome.storage.local` → Java Bridge + SharedPreferences、
`content_scripts` 声明注入 → `onPageFinished` + `evaluateJavascript(assets/inject.js)`。
`content.js` 里不允许再出现 `chrome.*`（构建时校验）。

真机（vivo V1914A / Android 10 / WebView 83）已跑通 9 项端到端验证：
注入、平台层、提示词插入、代码块内渲染、沙箱 iframe 走本地虚拟域名并成功出图。
详见 [`android/README.md`](android/README.md)。

手机端 WebView 的数据目录独立，**第一次要单独登录 DeepSeek**；
`WebView.setWebContentsDebuggingEnabled(true)` 目前常开，正式分发前要关掉。
