# MathViz 真机 DOM 探针

手机套壳方案的第一步：**只读地**观察真机 WebView 里 DeepSeek 网页的真实 DOM，
用来确定 `content.js` 的 `composer()`、代码块扫描器在移动端要怎么改。

不是正式 App，只有一个 WebView，不注入任何脚本、不碰 Cookie / localStorage。

## 环境

- 真机：vivo V1914A，Android 10，系统 WebView `Chrome/83.0.4103.106`
- 本机：adb 1.0.41（`C:\platform-tools`）、JDK 21、Android SDK、Gradle 8.14.3 / AGP 8.13.2
- 工程从 `DshViewer` 借了 gradle 骨架和 `android.overridePathCheck=true`（中文路径必需）

## 构建 / 安装 / 抓取

```bash
# 1. 构建（本机已缓存 gradle 与 AGP，可 --offline）
ANDROID_HOME="C:/Users/15610/AppData/Local/Android/Sdk" bash ./gradlew assembleDebug --offline

# 2. 安装：Git Bash 会做 MSYS 路径转换，必须先关掉
export MSYS_NO_PATHCONV=1
cp app/build/outputs/apk/debug/app-debug.apk "$TEMP/mathviz-probe.apk"
adb push "C:/Users/15610/AppData/Local/Temp/mathviz-probe.apk" /data/local/tmp/mvp.apk
adb shell "pm install -r /data/local/tmp/mvp.apk"

# 3. 启动并抓取（脚本自己找 PID、建 forward、连 CDP）
adb shell am start -n com.mathviz.probe/.MainActivity
node probe.mjs                                   # 抓当前页
node probe.mjs https://chat.deepseek.com         # 先导航再抓
```

`probe.mjs` 用 Node 22 内置的 `WebSocket` 直连 CDP，不依赖 npm 包。
报告写到 `report.json`，**只存结构信息、不存对话正文**。

> 注意：沙箱每次 Bash 调用结束会回收 adb server，所以 `adb forward` 和 CDP 通信
> 必须在同一个进程 / 同一条命令里完成 —— 这也是 `probe.mjs` 自己调 adb 的原因。

## 首次实测结果（2026-11-11 21:15）

| 项 | 结果 | 含义 |
|---|---|---|
| URL | `https://chat.deepseek.com/sign_in` | **未登录**，被导向登录页 |
| 标题 | DeepSeek - 探索未至之境 | 页面完整加载，`readyState=complete` |
| WebView | Chrome/83.0.4103.106 | 老内核但**没有白屏**，网页正常渲染 |
| UA | `... (wv) ... Chrome/83 ... Mobile Safari` | 带 WebView 标识，服务端**没有拦截**，风控这一层过关 |
| 视口 | 360 × 710，dpr 3 | 移动版布局生效；MathViz 680 画布需要缩放适配 |
| body 文本 | 登录表单（手机号 / 验证码 / 密码登录） | 对话页结构要登录后才能抓 |
| 元素 | `.ds-input__input` 两个 input；无 textarea、无 contenteditable、无 pre/code | 登录页；DeepSeek 的 class 前缀是 `ds-` |

**初步结论**：
1. 手机 WebView 直连 DeepSeek 网页可行，不需要伪装桌面 UA，风控没有拦在加载/登录页这一步。
2. 系统 WebView 83 支持 Shadow DOM、`iframe sandbox`、`postMessage`、ES2020 语法，
   扩展的业务 JS 大概率能直接跑；**唯一必须替换的是 3 处 `chrome.*` API**。
3. 移动版 URL 会跳 `/sign_in`，WebView 的 Cookie 与手机浏览器 / 官方 App **不共享**，要单独登录一次。

## 登录后实测（2026-11-11 21:20）

| 项 | 结果 | 对扩展的影响 |
|---|---|---|
| URL | `https://chat.deepseek.com/` | 登录后停在根路径，没有跳移动子域 |
| 输入框 | **一个 `textarea`**，`placeholder="给 DeepSeek 发送消息 "`，294×42 | ✅ `composer()` 的 textarea 分支直接可用；原生 setter + `input` 事件照旧 |
| contenteditable | 无 | ✅ 不用适配第二套写法 |
| 发送按钮 | `<div role="button" class="ds-button ds-button--iconLabelPrimary ...">`，**无 aria/title/文本** | ⚠️ 当前 `content.js` 靠 `send/发送` 文本匹配会失效；但 `closest('[role="button"]')` 能命中，改用 `ds-button--iconLabelPrimary` 类即可 |
| 按钮体系 | 全是 `div.ds-button`（不是 `<button>`），带 CSS Module 哈希类名 `_4f3769f` 等 | 别依赖哈希类名，用稳定的 `ds-` 前缀 |
| textarea 祖先链 | 全是哈希类名 `_24fad49 / _020ab5b / ...` | 不要按容器 class 找消息区，靠 `pre/code` 和角色判断 |
| 主题 | `body` 背景 `rgb(255,255,255)` → light；`prefers-color-scheme` 未开深色 | ✅ `themeNow()` 读 body 背景可用 |
| iframe / shadow | 页面自身 `0 / 0` | ✅ 我们插入的沙箱 iframe 不会和页面冲突 |
| 视口 | 360×710 dpr3 | 工具条面板 296px 宽勉强够；软键盘弹出需 `adjustResize`（工程已设） |

## 含代码块的回复实测（2026-11-11 21:25）

发了一条「用 python 打印 hello world，把代码放进代码块里」，页面跳到
`/a/chat/s/<uuid>`，回复里有 10 个代码块。真实结构：

```
.ds-markdown.ds-assistant-message-main-content     ← 助手消息正文（36 个子元素）
└─ .md-code-block.md-code-block-light             ← 代码块容器，主题写在 class 上
   ├─ .md-code-block-banner-wrap
   │  └─ .md-code-block-banner → <span>python</span>   ← 语言名在 banner 文本里
   │     （复制 / 下载按钮也是 div[role=button]）
   └─ <pre>                                       ← 代码本体：没有 class、没有 data-language
      └─ <span><span class="token keyword">…</span>…</span>  ← Prism 高亮，没有 <code>
```

其它消息层级：用户消息 `.d29f3d7d.ds-message`、助手消息 `.ds-message`、
思考链 `.ds-think-content`、正文 `.ds-markdown.ds-assistant-message-main-content`。
`<code>` 元素数量为 **0**，`<pre>` 有 10 个、class 全空。

## 移动端适配结论（探针目的达成）

| 能力 | 结论 | 工作量 |
|---|---|---|
| 找输入框 | `textarea` 唯一且可见，`composer()` / 原生 setter 直接可用 | **零改动** |
| 读取代码 | `pre.textContent` 会正确拼回高亮 span 里的原始代码；`code = pre.querySelector('code') \|\| pre` 已兼容 | **零改动** |
| 认出 mathviz 块 | banner 语言名出现在 `pre.parentElement.textContent` 开头，`/^mathviz\b/` 命中；内容兜底 `MK.frame(...)` 也命中 | **零改动** |
| 代码块内渲染 | `hideCodeInside` 隐藏 pre 的 span 子节点、host append 进 pre，banner 保留在上方 | **零改动** |
| 主题 | body 白底 → light；移动版另有 `md-code-block-light/dark` 可辅助判断 | **零改动** |
| 自动附加发送按钮 | 移动版是无文本的 `div[role="button"].ds-button--iconLabelPrimary`，旧代码按「send/发送」文本匹配会失效 | **已修**（加 class 兜底） |
| `chrome.*` 三处 | `getURL('viewer.html')`、`storage.local.get/set` 在 WebView 里不存在 | **正式 App 的 platform 层要做**，这是手机端剩下的主要工作 |

**结论：手机端最大的不确定性已经排除。** 真机 WebView 能加载、能登录、能对话，
页面 DOM 与扩展现有假设基本兼容；剩下的是纯工程活 —— 把 3 处扩展 API 换成
WebView bridge，并把 `viewer.html` 用 `WebViewAssetLoader` 映射成本地沙箱页。

已在扩展里补了移动版回归用例并跑通：core **54/54**、e2e **32/32**
（含 `.md-code-block + pre>span` 渲染、无文本 div 发送按钮触发自动附加）。

> 探针坚持只读：不代发消息、不往真实会话写测试数据，测试消息由本人发送。

## 边界

- 探针 App 包名 `com.mathviz.probe`，与真机上已有的 `com.dshviewer.app` 完全独立，不动它的数据。
- `Page.navigate` 只改 WebView 当前显示的页面；没有清 Cookie、没有写存储、没有发消息。
- 正式套壳 App 不在这个目录：等 DOM 结构定下来后另建，共用 `mathviz/src/` 的业务层。
