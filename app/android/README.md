# MathViz Android（手机端）

一个原生 Android WebView 套壳：加载 `chat.deepseek.com`，页面就绪后注入
**与浏览器扩展同一份业务 JS**，于是手机上也能在对话里就地渲染 MathViz 图形。

不复制业务代码 —— `build.mjs` 从 `../dist/extension/` 组装 assets，源码只有 `mathviz/src/` 一份。

## 平台替换

| 浏览器扩展 | Android | 实现位置 |
|---|---|---|
| `chrome.runtime.getURL('viewer.html')` | `Bridge.viewerUrl()` → `https://mathviz.local/viewer.html` | `platform-android.js` / `MainActivity.Bridge` |
| `chrome.storage.local` | `Bridge.load/save()` → SharedPreferences | 同上 |
| `manifest.content_scripts` 声明注入 | `onPageFinished` → `evaluateJavascript(assets/inject.js)` | `MainActivity.HostClient` |
| `sandbox.pages` + WAR 提供 viewer | `shouldInterceptRequest` 把虚拟域名映射到 `assets/viewer.html` | 同上 |
| 浏览器原生 `<input type=file>` | `onShowFileChooser` → 相册 / 文件选择器 | `MainActivity.HostChrome` |

### 附件上传（v1.1）

网页版早有附件按钮，套壳一开始点了**完全没反应**——WebView 默认不实现
`onShowFileChooser`，`<input type="file">` 被点击时没有任何宿主处理。

DeepSeek 只用一个隐藏的 `input[type=file]`，`accept` 是上千个扩展名（图片 + 文档 + 代码），
`multiple=true`。现在的分流：

- `accept` 全是图片 → 直接开相册（`ACTION_GET_CONTENT image/*`）
- 其它（DeepSeek 就属于这种）→ 先弹「上传附件」菜单，再选「从相册选图片」或「选择文件」
- 单选走 `GET_CONTENT`（有相册入口），多选走 `ACTION_OPEN_DOCUMENT`（官方多选路径）
- **每条路径都必须给 `onReceiveValue` 回一次**（用户取消就回 `null`），否则 WebView 认为这次
  选择没结束，之后再点附件按钮永远不弹。代码里 `cancelUpload()` 专门守这条。

不需要存储权限：SAF / GET_CONTENT 给的是一次性读授权，WebView 直接读 `content://` 即可。

### 多选为什么自己解析 Uri

多选曾经「选了两张，回到聊天一个都没有」，日志是：

```
附件选择返回 resultCode=-1 uri=null | data=action=null data=null clip=2
```

`resultCode` 是 OK、`clipData` 有两项，但 `data` 为 null。MuMu / AOSP 12 的 DocumentsUI
在多选时只塞 `clipData`、不设 `Intent.data`，而
`WebChromeClient.FileChooserParams.parseResult` 内部要求 `intent.getData()` 非空，
于是直接返回 null —— 单选不受影响，只有多选中招。

所以 `urisFromResult()` 自己取：先读 `clipData`（多选），再退回 `data`，最后才交给
`parseResult` 兜底。顺便解决另一个隐患：某些选择器只返回单选 data，这样两种都能拿到。

### 端到端验证记录（v1.1，MuMu 12 / Android 12）

只看「输入框出现缩略图」不算通，必须让**服务端真的收到并解析**。实测发了两条消息：

| 操作 | 发出去的内容 | 模型回复 |
|---|---|---|
| 相册选 1 张图 | 一张 DeepSeek 界面截图 | 准确描述了截图内容（问候语、输入框、附件与发送按钮）✓ |
| 选择文件 | `mv-note.txt`（内含「暗号：蓝鲸-42」） | 答出「蓝鲸-42」，说明文件正文被完整读取 ✓ |
| 多选 2 张 | 两张图 | 两张同时入框 ✓ |
| 取消后再点 | — | 菜单正常再弹 ✓ |

图片能被描述、文件正文能被读出，等于同时验证了四段链路：SAF 授权 → WebView 读
`content://` → 页面构造 `FormData` 上传 → 服务端解析。任何一段断掉都不会有这个结果。

日志里对应的成功返回形如：

```
附件选择返回 resultCode=-1 uri=1 个 | data=content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2Fmv-note.txt
```


### 存图：把图存进相册（v1.3）

网页版点「存图」是 `<a download>`，在 WebView 里**一点反应都没有** —— 没有 `DownloadListener`
的 WebView 会静默丢弃这类下载，用户只会以为按钮坏了。所以 Android 侧改走原生：

```
沙箱 iframe 里把 SVG 画成 PNG → postMessage 给 content.js
  → Platform.saveImage() → MathVizBridge.saveImage(dataUrl, name)
  → base64 解码 → MediaStore 插入 Pictures/MathViz → 解除 IS_PENDING
```

- API 29+ 用 `MediaStore.Images` + `RELATIVE_PATH`，**不需要任何存储权限**；
  低于 29 落到 `getExternalFilesDir(Pictures)/MathViz`（应用私有，不需要权限）。
- 桥方法返回**空串表示成功、非空表示失败原因**，JS 直接把原因显示成 toast，
  不用去翻 logcat 才知道为什么没存上。
- 这个桥方法跑在 JavaBridge 线程而不是 UI 线程，所以磁盘 IO 可以直接做；
  Toast 才需要 `runOnUiThread`。

实测（MuMu 12 / Android 12）：点「存图」约 1 秒后出现在相册，

```
I MathVizMobile: 存图成功 mathviz-20261112-090250.png（55385 字节）
shell@ $ ls -l /sdcard/Pictures/MathViz
-rwxrwxrwx 1 root root 55385 2026-11-12 09:02 mathviz-20261112-090250.png
```

3D 图存的是**当前视角**：拖拽时运行时已经把视角画进 SVG，导出的就是屏幕上那一眼，
不需要另存相机参数，也不需要特殊分支。

### 双指缩放 / 拖动（v1.4）

图里的手势全部由 `viewer.js` 自己处理，WebView 必须**让路**，否则同一组手指会
一边缩放网页、一边缩放画布：

```java
s.setSupportZoom(false);
s.setBuiltInZoomControls(false);
s.setDisplayZoomControls(false);
```

不关掉的话，WebView 的原生捏合会在 `touchstart` 之前就接管，页面里的
`preventDefault()` 拦不住，表现为「图放大了、网页也跟着放大」。

手势分工（Android 上没有 Alt / 中键，所以 3D 的平移只走双指）：

| 手指 | 普通图 | 3D 图 |
|---|---|---|
| 单指上下滑 | 滚聊天页（不拦） | 旋转 |
| 双指张开 / 捏合 | 缩放 + 跟随中点平移 | 同左 |
| 双击 | 复位 | 复位缩放 + 视角 |

实测（MuMu 12 / Android 12 / WebView 130，dpr 3，视口 360×220）：

```
初始           scale 1，transform 空
双指张开       translate(-192, -106.67) scale(2.0667)，胶囊显示 207%
双指右下拖 84  translate(-108, -70.67)  ← 位移与手指一致，没有回跳
双击           transform 清空
```

同样这套手势在浏览器端由 `test/nav.test.mjs` 24 项守着（含「1× 时滚轮要放行页面滚动」
和「放大后导出的仍是整张图」）。



### 长会话里图多了发涩（v1.6）

**症状**：一条回答里图一多、或者会话滚长了，整个页面滚动发涩，手机尤其明显。

**先量**：`node test/perf.mjs --mobile`（手机视口 393×852 + CPU 降速 5 倍）。结论是绘图侧很轻 ——
20 张图渲染总耗时 349ms、滚动 CPU 3.39ms/帧（一帧预算 16.7ms）、每条 300 点的曲线在 DOM 里只占
一个 `<path>`、3D 没有常驻 `rAF`。**成本在 iframe 数量**：每张图一个沙箱 iframe，各自一份
document + JS 上下文，实测增量内存约 8MB/张。

**改法**（`src/content.js`，App 与扩展共用同一份）：

1. 分批渲染：最多 2 个 iframe 同时开工，队列按到视口的距离排序 —— 20 张图一起 `new Function`
   在手机上是一次 300ms 级卡顿，分批后峰值摊平；
2. 离屏暂存：离可视范围 2400px 以外先不画；画过的离开就 `src=about:blank` 释放，
   高度用占位锁住不跳版，滚回来重建一次 6~17ms；
3. 折叠即释放：以前只 `display:none`，iframe 还活着；
4. 主题切换走队列，不再 20 张同时换 `src`。

**验证**：`test/lazy.test.mjs` 10 项（首屏不提前画远处图 / 滚到底能画 / 滚回重建 /
离屏换 `about:blank` 且高度不塌 / 折叠释放 / 内部滚动容器下仍能画 / 无 JS 错误）。
版本 1.7 / versionCode 8。

### 装完新版后图一张都不出来（v1.7）

**症状**：升级到 1.6 之后，所有图卡在「渲染中…」或干脆空白，滚到哪都一样。

**根因**：v1.6 的调度拿 `IntersectionObserver.isIntersecting` 直接当「画还是释放」的判决。
消息列表装在自己的滚动容器里时（DeepSeek 就是这样），祖先裁剪会让这个判定忽真忽假；
滚回来的那一帧又不一定有回调，卡片就被永久挂起。而且 pump 把远处的卡「挂回队列」后
`queued` 一直是 true，后续 `enqueue()` 全被挡掉，队列再也推进不了。

**改法**：远近只信 `getBoundingClientRect()` 实测的距离，`IntersectionObserver` 降级成
「通知视口可能变了」的触发器；任何一次 IO 回调、滚轮 / 触摸 / 缩放 / 切回标签页都走一次
幂等的 `evaluate()`。远卡从队列里直接丢掉（不挂回去），靠近时重新入队。另外 iframe 插入 DOM
时加载 `about:blank` 也会触发 `load`，用一个 `armed` 标记把这类假事件挡掉，状态不再跳到
「渲染中…」。



### 工程图缩在左下角 / 被边界吞掉（v1.5）

**症状**（真机 Android 15 实测）：机械工程图整张缩成左下角一小块，周围一大片空白；
另一些图则被卡片边缘裁掉一截。和手机宽度、深色模式、手势都无关。

**根因不在排版，在 `MK.eng` 的 `ext`**。`ext` 是模型手填的「这张图要画多大范围」（毫米），
运行时按 `s = min((box宽-24)/ext宽, (box高-24)/ext高)` 死算比例、原点固定在左下：

- `ext` 估大 → 内容只占一小块，贴在左下角（图上下留白）；
- `ext` 估小 → 内容溢出 `viewBox`，超出部分直接被裁。

这不是手机特有的问题，只是窄屏把「缩成一小块」放大了。实测 `ext:[280,192]` 画 100×56 的板，
内容只落在 `x 90–281 / y 259–366`（画布 680×442），正是一小坨贴在左下。

**改法**：`ext` 降级为**比例提示**。脚本跑完后的下一帧（`requestAnimationFrame`），
运行时用 `.mv-fit` 包裹层量出真实内容 bbox，重设 `viewBox` 并把标题挪到新左上角：

- 写大：缩放到内容填满（实测填充率 0.94~0.97），不再缩在角落；
- 写小：画幅外扩把溢出部分兜进来，不再被裁；
- 显式传 `scale` 的图跳过（那是想要固定出图比例），需要手动重排可调 `E.fit()`；
- 原理图另有一套**只扩不缩**的兜底 `growToContent()`：`cell` 是模型选定的尺寸不该改，
  但行数写多了会顶出画布，只把画幅往外扩。

**验证**：`test/eng.test.mjs` 新增 6 项（ext 写大 / 写小 / 显式 scale / 无 title / 原理图 12 行），
真机侧用设备内几何探针直接量 iframe 与 svg：

```bash
node android/diag-card.mjs        # 起 App → 注入一个 mathviz 代码块 → 量 iframe/svg/viewBox
```

```
改前（ext 写大一倍）：viewBox 0 0 680 442，内容挤在左下
改后：               viewBox 35 231 256 185，iframe 360×277，图铺满卡片
```

### 全屏适配：顶部被通知栏压住 / 底部被手势条压住（v1.2）

**症状**（Android 15 实测）：页面顶到屏幕最上沿，DeepSeek 的 logo 被状态栏压掉一半；
打开侧边栏，最底下的「账号 / 设置」那一行被手势条挡住点不到。

**根因不是 CSS**。`targetSdk 35` 起，Android 15 对所有应用**强制 edge-to-edge**：
窗口默认铺满整块屏幕，状态栏和导航栏变成浮在内容上的透明层。以前系统会自动把窗口
缩进安全区（`fitsSystemWindows` 的默认效果），现在不会了 —— 不接 insets 的应用一律被压。

**改法**（`MainActivity` + `styles.xml`）：

1. `Theme.AppTheme` 里把 `statusBarColor` / `navigationBarColor` 设透明，声明式地进入全屏；
2. `WebView` 外面套一层 `FrameLayout`（`root`），在它上面挂 `setOnApplyWindowInsetsListener`，
   把 `systemBars() | displayCutout()` 的四个值变成这层的 **padding**，底部再和 `ime()` 取大者
   （键盘弹出时不会和 `adjustResize` 叠成两份空白）；
3. 为什么是 padding 不是 margin：只有容器真的变小，WebView 的**视口**才会变小，
   页面里 `position: fixed` 的东西（侧边栏抽屉、底部输入框）才会跟着收进来 —— 只做视觉位移会
   出现「内容挪下去了但抽屉还是超出屏幕」；
4. 空白区域得涂色，否则白底应用会多出黑边。注入脚本在锚点 `elementFromPoint(视口顶部中点)`
   沿 DOM 往上找第一个不透明 `background-color`，通过 `MathVizBridge.chromeColor()` 报给原生；
   原生刷 `root` 背景，并按亮度切换状态栏 / 导航栏图标的黑白（`setSystemBarsAppearance`）。

**为什么不用 `windowOptOutEdgeToEdgeEnforcement`**：那是 Android 15 的一次性逃生舱，
Google 明确说 Android 16 起失效（targetSdk 36 又强制回来）。既然要改，就按官方推荐的方向改。

**验证**（MuMu 的虚拟屏没有状态栏，截图看不出效果，所以用数值对账）：

```bash
# 用 debug 包伪造系统栏高度，再从页面里读 window.innerHeight 对账
node insets-check.mjs --top 72 --bottom 96
```

```
物理屏高      1920 px
密度          480 dpi (dpr 3)
期望视口高    584 css px
实测 innerHeight 584 css px     ✓
实测 document 高 584 css px     ✓
✓ 视口高度 = 屏高 - 系统栏（误差 ≤ 2px）
✓ document 高度跟着视口一起缩（不是只做了视觉位移）
✓ 页面能调 MathVizBridge.chromeColor
✓ 能取到页面底色（原生据此涂系统栏区域）
```

`1920 − 72 − 96 = 1752`，除 dpr 3 正是 584 —— 说明内边距真的作用到了视口上。
伪造高度的入口只在 debug 包生效（`FLAG_DEBUGGABLE`），release 包忽略这两个 extra。

## 安全边界

`content.js` 只认 `window.MVPlatform`，不直接碰 `chrome.*`（构建时会校验）。

模型代码仍在 `sandbox="allow-scripts"` 的 iframe 里执行，viewer 来自本地虚拟域名，
与 DeepSeek 页面不同源，拿不到 DOM / Cookie / localStorage。

## 目录

```
android/
├── README.md            本文件
├── build.mjs            重建扩展 → 组装 inject.js / viewer.html 到 assets
├── verify.mjs           真机 CDP 端到端验证（含临时 DOM 与截图）
├── insets-check.mjs     全屏适配对账：视口高度 == 屏高 − 系统栏
├── platform-android.js  MVPlatform 的 WebView 实现（底色上报 / 存图 / 设置）
├── app/                 Gradle 工程（AGP 8.13.2 / Gradle 8.14.3 / JDK 17+）
│   └── src/main/
│       ├── java/com/mathviz/app/MainActivity.java
│       ├── AndroidManifest.xml
│       ├── res/values/styles.xml   AppTheme（系统栏透明，全屏）
│       └── assets/      由 build.mjs 生成：inject.js、viewer.html
└── verify-report.json / screenshot.png   验证产物
```

## 构建与安装

```bash
# 1. 组装 assets（内部会先重建浏览器扩展）
cd app/android
node build.mjs

# 2. 构建 APK
ANDROID_HOME="C:/Users/15610/AppData/Local/Android/Sdk" bash ./gradlew assembleDebug --offline

# 3. 装到真机（Git Bash 必须关路径转换；vivo 需要在手机上确认一次安装）
export MSYS_NO_PATHCONV=1
cp app/build/outputs/apk/debug/app-debug.apk "$TEMP/mathviz-mobile.apk"
adb push "C:/Users/15610/AppData/Local/Temp/mathviz-mobile.apk" /data/local/tmp/mvm.apk
adb shell "pm install -r /data/local/tmp/mvm.apk"
adb shell "am force-stop com.mathviz.app"
adb shell "am start -n com.mathviz.app/.MainActivity"

# 4. 验证
node verify.mjs
```

工程在中文路径下，`gradle.properties` 里已加 AGP 官方的 `android.overridePathCheck=true`。

## 真机验证（vivo V1914A / Android 10 / WebView 83）

`verify.mjs` 通过 `webview_devtools_remote_<pid>` + CDP 只读验证，9 项全绿：

```
✓ content.js 已注入                 ✓ 代码块内生成渲染宿主
✓ platform 层 + Java bridge 就位    ✓ 沙箱渲染完成（已渲染 1 张）
✓ 业务模块齐全                     ✓ viewer 走本地虚拟域名
✓ 工具条已创建                     ✓ iframe sandbox = allow-scripts
✓ 提示词插入成功（保留原问题）
```

最关键的一环是 `https://mathviz.local/viewer.html` 经 `shouldInterceptRequest`
由本地 assets 提供后，仍能 `postMessage` 通信、`new Function` 执行、生成 SVG。
验证只往页面临时插 DOM（插进 `.ds-markdown` 里），跑完即删，不发消息、不写服务端数据。

## 已知边界 / 风险

- **登录态独立**：Android 每个应用有自己的 WebView 数据目录，与手机浏览器 / 官方 App /
  探针 App 都不共享，第一次要单独登录一次。
- **安装确认**：vivo 对新包会弹 `PackageInstallerActivity`，`pm install` 在没确认时
  返回 `INSTALL_FAILED_ABORTED: User rejected permissions` 或静默失败；重试前先在手机上点允许。
- `addJavascriptInterface` 对页面所有脚本可见，但 Bridge 只有 5 个无害方法
  （返回本地 URL、读写本机模式/开关、上报页面底色、存图），不触碰账号数据。
- 工具条在窄屏（≤480px）移到右上角，避免压住底部输入框按钮；面板向下展开。
- 外链交给系统浏览器；文件选择 / 下载 / 通知还没做。
- `WebView.setWebContentsDebuggingEnabled(true)` 目前常开，便于开发诊断；**正式分发前要关掉**。
- 手机端与桌面共用 `src/`，所以 3D 修复、一次注入、错误中文提示这些改动同时生效。
- 真实对话里让模型输出 ` ```mathviz ` 的完整体验仍需登录后再跑一次（验证用的是临时 DOM）。
