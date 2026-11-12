/* MathViz 平台适配层：Android WebView 实现。
   content.js 只认 window.MVPlatform；这里把三处扩展能力接到 Java 的 MathVizBridge。 */
(function (g) {
  'use strict';
  var B = g.MathVizBridge;
  var FALLBACK = 'https://mathviz.local/viewer.html?';

  g.MVPlatform = {
    viewerUrl: function (query) {
      return B ? B.viewerUrl(query) : FALLBACK + query;
    },
    load: function (cb) {
      if (!B) { cb({ mvMode: 'auto', mvAuto: false }); return; }
      try { cb(JSON.parse(B.load())); }
      catch (e) { cb({ mvMode: 'auto', mvAuto: false }); }
    },
    save: function (obj) {
      if (!B) return;
      try { B.save(JSON.stringify(obj)); } catch (e) {}
    },
    /* 存图：WebView 里 <a download> 不会触发任何东西（没装 DownloadListener），
       必须交给原生写相册。返回 {ok, msg}，失败原因直接显示给用户。 */
    saveImage: function (dataUrl, name) {
      if (!B || typeof B.saveImage !== 'function') {
        return { ok: false, msg: '这个版本还不支持存图，请更新 APK' };
      }
      try {
        var err = String(B.saveImage(dataUrl, name) || '');
        if (err) return { ok: false, msg: '保存失败：' + err };
        return { ok: true, msg: '已存到相册 Pictures/MathViz' };
      } catch (e) {
        return { ok: false, msg: '保存失败：' + ((e && e.message) || e) };
      }
    }
  };
})(window);

/* ------------------------------------------------------------------
   页面底色上报

   Android 15 起系统强制全屏（edge-to-edge），状态栏和手势条的区域改由原生涂抹。
   涂什么色不能写死 —— 得问页面当前是什么底色，否则会多出两条白边／黑边。

   取色方法：在视口顶部中间那一点做命中测试，再沿 DOM 往上找第一个真正不透明的
   background-color。这样拿到的就是「状态栏下面实际画的是什么色」。
   深浅色切换、进聊天页、打开抽屉都会改底色，所以定时对一次，变了才发。
------------------------------------------------------------------ */
(function (g) {
  'use strict';
  var B = g.MathVizBridge;
  if (!B || typeof B.chromeColor !== 'function') return;

  var last = '';

  function alphaOf(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return 0;
    var p = m[1].split(',');
    return p.length >= 4 ? parseFloat(p[3]) : 1;
  }

  function toHex(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return '';
    var p = m[1].split(',');
    if (p.length < 3) return '';
    var out = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.max(0, Math.min(255, Math.round(parseFloat(p[i]) || 0))).toString(16);
      out += v.length < 2 ? '0' + v : v;
    }
    return out;
  }

  function paintedBackground(el) {
    while (el && el.nodeType === 1) {
      var c = getComputedStyle(el).backgroundColor;
      if (alphaOf(c) > 0.5) return toHex(c);
      el = el.parentElement;
    }
    return '';
  }

  function report() {
    var c = '';
    try {
      var probe = document.elementFromPoint(Math.round(window.innerWidth / 2), 1);
      c = paintedBackground(probe)
        || paintedBackground(document.body)
        || paintedBackground(document.documentElement);
    } catch (e) { /* 页面还没就绪，下一轮再说 */ }
    if (!c) {
      c = g.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches
        ? '#1a1a1a' : '#ffffff';
    }
    if (c === last) return;
    last = c;
    try { B.chromeColor(c); } catch (e) {}
  }

  report();
  setInterval(report, 1500);
  document.addEventListener('visibilitychange', report);
  g.addEventListener('resize', report);
})(window);
