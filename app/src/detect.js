/* MathViz for DeepSeek —— 代码块识别与归一化（纯逻辑，无 DOM 依赖，可单测） */
(function (g) {
  'use strict';

  var FENCE = /```[ \t]*mathviz[^\r\n]*\r?\n([\s\S]*?)```/gi;
  var FENCE_HEAD = /```[ \t]*mathviz[^\r\n]*\r?\n/i;
  var LANG_LINE = /^\s*(?:mathviz|javascript|js|svg)\s*(?:\r?\n|$)/i;

  /* 从任意文本里抽出所有闭合的 ```mathviz 块 */
  function extractFenced(text) {
    var out = [];
    var src = String(text || '').replace(/\r\n/g, '\n');
    FENCE.lastIndex = 0;
    var m;
    while ((m = FENCE.exec(src)) !== null) {
      var code = normalize(m[1]);
      if (code) out.push({ code: code, kind: classify(code), digest: digest(code) });
    }
    return out;
  }

  /* 流式输出时代码块还没闭合：有头无尾 */
  function hasOpenFence(text) {
    var src = String(text || '');
    FENCE_HEAD.lastIndex = 0;
    var head = FENCE_HEAD.test(src);
    if (!head) return false;
    var i = src.search(FENCE_HEAD);
    var tail = src.slice(i + src.slice(i).indexOf('\n') + 1);
    return tail.indexOf('```') < 0;
  }

  /* 归一化模型输出：去包裹、去语言行、统一换行 */
  function normalize(code) {
    var s = String(code || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    s = s.replace(/^\s*<script[^>]*>\s*/i, '').replace(/\s*<\/script>\s*$/i, '');
    s = s.replace(/^\s*```[^\n]*\n/, '').replace(/\n```\s*$/, '');
    if (LANG_LINE.test(s)) s = s.replace(LANG_LINE, '');
    return s.replace(/^\n+/, '').replace(/\s+$/, '');
  }

  /* 判断一段代码是纯 SVG 片段还是需要执行的 JS */
  function classify(code) {
    var s = String(code || '').trim();
    if (!s) return 'unknown';
    if (/^<svg[\s>]/i.test(s) && /<\/svg>/i.test(s)) return 'svg';
    if (/^\s*<(?:!doctype|html|head|body)\b/i.test(s)) return 'unknown';
    return 'js';
  }

  /* 判断 <code> 元素是不是 mathviz 块。
     className / data-lang 这类字段是短的语言标记，含 mathviz 即可命中；
     header 是自由文本，必须「以 mathviz 开头」才算，否则协议正文里出现
     「输出一个 mathviz 代码块」会把普通代码块误判成图。
     最后一层兜底：模型常把围栏写成 javascript / js，但内容一看就是 MathViz
     运行时调用（MK.space(...) 或 getElementById('fig')），这种也要认，
     否则用户看到的是「什么都没发生」，比渲染失败更难查。 */
  function isMathvizCode(meta) {
    meta = meta || {};
    var lang = [meta.className, meta.parentClassName, meta.parentLang, meta.dataLang]
      .filter(Boolean).join(' ').toLowerCase();
    if (/mathviz/.test(lang)) return true;
    var header = String(meta.header || '').trim().toLowerCase();
    if (/^mathviz\b/.test(header)) return true;
    var text = String(meta.text || '');
    var first = text.split(/\r?\n/, 1)[0].trim().toLowerCase();
    if (/^```?\s*mathviz\b/.test(first)) return true;
    if (/^mathviz\s*$/.test(first)) return true;
    return /\bMK\.(?:frame|space|graph|venn|matrix|schematic|pcb|eng)\s*\(/.test(text) ||
      /getElementById\(\s*['"]fig['"]\s*\)/.test(text);
  }

  /* FNV-1a 32 位，用于「内容变没变」的判断，不用于安全 */
  function digest(str) {
    var h = 0x811c9dc5;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /* 一个块是否值得渲染（避免把流式半截代码画出来） */
  function isRenderable(code) {
    var k = classify(code);
    if (k === 'unknown') return false;
    if (k === 'svg') return true;
    return String(code).length >= 12 && !/^\s*(?:var|let|const)?\s*$/.test(code);
  }

  /* 流式输出时代码块常被截断在半截（缺括号、字符串没闭合、末尾省略号）。
     粗略但足够挡住这类残缺：括号/引号必须平衡，且末尾要是收尾字符。
     宁可晚几秒渲染，也不要闪出一张「渲染失败」。 */
  function looksComplete(code) {
    var s = String(code || '').trim();
    if (!s) return false;
    if (classify(s) === 'svg') return /<\/svg>\s*$/i.test(s);
    var brace = 0, paren = 0, bracket = 0, quote = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), prev = i ? s.charAt(i - 1) : '';
      if (quote) {
        if (ch === quote && prev !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') brace++;
      else if (ch === '}') brace--;
      else if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '[') bracket++;
      else if (ch === ']') bracket--;
    }
    if (quote || brace > 0 || paren > 0 || bracket > 0) return false;
    return /[;}\])>]\s*$/.test(s);
  }

  var api = {
    extractFenced: extractFenced,
    hasOpenFence: hasOpenFence,
    normalize: normalize,
    classify: classify,
    isMathvizCode: isMathvizCode,
    isRenderable: isRenderable,
    looksComplete: looksComplete,
    digest: digest
  };

  g.MVDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
