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
    }
  };
})(window);
