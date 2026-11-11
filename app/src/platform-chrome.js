/* MathViz 平台适配层：Chrome 扩展实现。
   content.js 只认 window.MVPlatform，不直接碰 chrome.*，
   这样同一份业务代码可以同时跑在浏览器扩展和 Android WebView 里。 */
(function (g) {
  'use strict';
  g.MVPlatform = {
    viewerUrl: function (query) {
      return chrome.runtime.getURL('viewer.html') + '?' + query;
    },
    load: function (cb) {
      try {
        chrome.storage.local.get({ mvMode: 'auto', mvAuto: false }, cb);
      } catch (e) {
        cb({ mvMode: 'auto', mvAuto: false });
      }
    },
    save: function (obj) {
      try { chrome.storage.local.set(obj); } catch (e) {}
    }
  };
})(window);
