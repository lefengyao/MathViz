/* MathViz 平台适配层：Chrome 扩展实现。
   content.js 只认 window.MVPlatform，不直接碰 chrome.*，
   这样同一份业务代码可以同时跑在浏览器扩展和 Android WebView 里。 */
(function (g) {
  'use strict';
  /* 扩展上下文是否还活着。在 edge://extensions 里重载扩展后，旧标签页里残留的
     content script 还在跑，但它的 chrome.runtime 已被销毁（undefined）——
     这时调 getURL 会抛 "Cannot read properties of undefined (reading 'getURL')"，
     且异常发生在渲染启动路径上会把整条调度链打断。所以每个 chrome.* 入口先探活。 */
  function alive() {
    try { return !!(g.chrome && g.chrome.runtime && g.chrome.runtime.id); }
    catch (e) { return false; }
  }
  g.MVPlatform = {
    /* 上下文已失效时返回 null，由调用方给出「请刷新页面」的提示。
       探活和调用之间仍可能失效（扩展更新瞬间），所以 getURL 也要兜 try/catch。 */
    viewerUrl: function (query) {
      if (!alive()) return null;
      try {
        return chrome.runtime.getURL('viewer.html') + '?' + query;
      } catch (e) {
        return null;
      }
    },
    load: function (cb) {
      try {
        if (!alive()) { cb({ mvMode: 'auto', mvAuto: false }); return; }
        chrome.storage.local.get({ mvMode: 'auto', mvAuto: false }, cb);
      } catch (e) {
        cb({ mvMode: 'auto', mvAuto: false });
      }
    },
    save: function (obj) {
      try { if (alive()) chrome.storage.local.set(obj); } catch (e) {}
    },
    /* 存图：扩展里就是一个 data: URL 的 <a download>。
       必须挂在真实 DOM 上再点，Shadow DOM 里的 anchor 某些版本不触发下载。 */
    saveImage: function (dataUrl, name) {
      try {
        var a = document.createElement('a');
        a.href = dataUrl;
        a.download = name;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { try { a.remove(); } catch (e) {} }, 1500);
        return { ok: true, msg: '图片已开始下载' };
      } catch (e) {
        return { ok: false, msg: '下载失败：' + ((e && e.message) || e) };
      }
    }
  };
})(window);
