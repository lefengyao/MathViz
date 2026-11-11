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


`content.js` 只认 `window.MVPlatform`，不直接碰 `chrome.*`（构建时会校验）。
模型代码仍在 `sandbox="allow-scripts"` 的 iframe 里执行，viewer 来自本地虚拟域名，
与 DeepSeek 页面不同源，拿不到 DOM / Cookie / localStorage。

## 目录

```
android/
├── README.md            本文件
├── build.mjs            重建扩展 → 组装 inject.js / viewer.html 到 assets
├── verify.mjs           真机 CDP 端到端验证（含临时 DOM 与截图）
├── platform-android.js  MVPlatform 的 WebView 实现
├── app/                 Gradle 工程（AGP 8.13.2 / Gradle 8.14.3 / JDK 17+）
│   └── src/main/
│       ├── java/com/mathviz/app/MainActivity.java
│       ├── AndroidManifest.xml
│       └── assets/      由 build.mjs 生成：inject.js、viewer.html
└── verify-report.json / screenshot.png   验证产物
```

## 构建与安装

```bash
# 1. 组装 assets（内部会先重建浏览器扩展）
cd deepseek-web/mathviz/android
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
- `addJavascriptInterface` 对页面所有脚本可见，但 Bridge 只有 3 个无害方法
  （返回本地 URL、读写本机模式/开关），不触碰账号数据。
- 工具条在窄屏（≤480px）移到右上角，避免压住底部输入框按钮；面板向下展开。
- 外链交给系统浏览器；文件选择 / 下载 / 通知还没做。
- `WebView.setWebContentsDebuggingEnabled(true)` 目前常开，便于开发诊断；**正式分发前要关掉**。
- 手机端与桌面共用 `src/`，所以 3D 修复、一次注入、错误中文提示这些改动同时生效。
- 真实对话里让模型输出 ` ```mathviz ` 的完整体验仍需登录后再跑一次（验证用的是临时 DOM）。
