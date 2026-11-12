/* MathViz for DeepSeek —— content script
   只做三件事：① 往输入框插入/附加 skill 提示词 ② 认出回复里的 ```mathviz 块
   ③ 把代码交给沙箱页渲染，并把图插回消息里。
   不碰登录态、不发网络请求、不调用 DeepSeek 私有接口。 */
(function () {
  'use strict';

  if (window.__mvLoaded) return;
  window.__mvLoaded = true;

  var P = window.MVPrompt;
  var D = window.MVDetect;
  var Platform = window.MVPlatform;
  var CSS = window.MVCss || '';
  if (!P || !D || !Platform) return;

  var CFG = { mode: 'auto', auto: false };
  var cards = new Map();          // id -> card record
  var mounted = new WeakMap();    // anchor element -> { digest, id }
  var pending = new WeakMap();    // 还没写完的代码块 -> { code, since }
  var seq = 0;
  var theme = 'light';
  var scanTimer = null;
  var toastTimer = null;
  var ui = null;
  var injected = false;           // 本轮对话是否已经给过提示词（同一会话只给一次）
  var injectedMode = null;        // 当时用的模式；换模式才允许更新一次
  var scanning = false;           // 扫描期间抑制自己触发的 MutationObserver 回调

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function themeNow() {
    var s = '';
    try { s = getComputedStyle(document.body).backgroundColor; } catch (e) {}
    if (!s || s === 'rgba(0, 0, 0, 0)' || s === 'transparent') {
      try { s = getComputedStyle(document.documentElement).backgroundColor; } catch (e) {}
    }
    var m = String(s).match(/[\d.]+/g);
    if (m && m.length >= 3) {
      return (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114) < 128 ? 'dark' : 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function visible(n) {
    var r = n.getBoundingClientRect();
    if (r.width < 30 || r.height < 12) return false;
    var s = getComputedStyle(n);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  function composer() {
    var ta = [].slice.call(document.querySelectorAll('textarea')).filter(visible);
    if (ta.length) {
      ta.sort(function (a, b) { return (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight); });
      return ta[0];
    }
    return [].slice.call(document.querySelectorAll('[contenteditable="true"]')).filter(visible)[0] || null;
  }

  function readComposer(n) {
    return (n.tagName === 'TEXTAREA' || n.tagName === 'INPUT') ? (n.value || '') : (n.innerText || n.textContent || '');
  }

  /* React 受控输入框必须用原型上的原生 setter，否则 onChange 收不到 */
  function writeComposer(n, text) {
    if (n.tagName === 'TEXTAREA' || n.tagName === 'INPUT') {
      var proto = n.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, text);
      n.dispatchEvent(new Event('input', { bubbles: true }));
      try { n.setSelectionRange(text.length, text.length); } catch (e) {}
      return true;
    }
    if (n.isContentEditable) {
      n.focus();
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(n);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) {}
      if (!ok) {
        n.insertBefore(document.createTextNode(text), n.firstChild);
        n.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }
    return false;
  }

  function composedText(n) {
    var cur = readComposer(n);
    var q = P.hasPrompt(cur) ? P.questionOf(cur) : cur.trim();
    return P.buildPrompt(CFG.mode, theme) + '\n' + q;
  }

  /* 一次对话只需要给一次协议：模型在上下文里已经知道了，后面直接问就行。
     重复写入受控输入框正是「输入框一直闪烁」的来源，所以已注入时绝不改写 DOM。 */
  function insertPrompt() {
    if (CFG.mode === 'off') { toast('先在面板里选一个模式'); return; }
    var n = composer();
    if (!n) { toast('没找到输入框，先点一下 DeepSeek 的输入区'); return; }
    if (P.hasPrompt(readComposer(n))) {
      /* 只有「换了作图模式」才允许改写一次；其余情况绝不重复写，
         重复写受控输入框正是页面一直闪烁的来源。 */
      if (injectedMode && CFG.mode !== injectedMode) {
        writeComposer(n, composedText(n));
        injectedMode = CFG.mode;
        injected = true;
        syncSess();
        toast('已按新模式更新提示词');
        return;
      }
      injected = true;
      syncSess();
      toast('本轮对话已给过提示词，后面直接问就行');
      return;
    }
    if (injected) { toast('若开了新对话，点「新对话」再重新给一次'); return; }
    writeComposer(n, composedText(n));
    injected = true;
    injectedMode = CFG.mode;
    syncSess();
    toast('提示词已插入，发送一次即可，后续不用再给');
  }

  /* 自动附加同样只在「本轮还没给过」时补一次 */
  function ensurePrefix() {
    if (CFG.mode === 'off' || !CFG.auto || injected) return;
    var n = composer();
    if (!n || P.hasPrompt(readComposer(n))) return;
    writeComposer(n, composedText(n));
    injected = true;
    injectedMode = CFG.mode;
    syncSess();
  }

  function syncSess() {
    if (!ui) return;
    ui.sess.textContent = injected ? '本轮对话：已注入一次（后面直接问）' : '本轮对话：还没给提示词';
    ui.sess.className = 'mv-sess' + (injected ? ' mv-sess-on' : '');
  }

  /* ---------------------------------------------------------------- */
  /* 沙箱卡片                                                          */
  /* ---------------------------------------------------------------- */

  /* 所有卡片共用一张已解析的样式表：每张卡各插一份 <style>，200 张图就是 200 次
     CSS 解析、约 2MB 的重复文本；adoptedStyleSheets 只解析一次，各 shadow 共用。 */
  var cssSheet = null;
  function sharedSheet() {
    if (cssSheet !== null) return cssSheet;
    cssSheet = false;
    try {
      var sh = new CSSStyleSheet();
      sh.replaceSync(CSS);
      cssSheet = sh;
    } catch (e) { cssSheet = false; }
    return cssSheet;
  }
  function styleShadow(sr) {
    var sh = sharedSheet();
    if (sh) { try { sr.adoptedStyleSheets = [sh]; return; } catch (e) {} }
    sr.insertAdjacentHTML('afterbegin', '<style>' + CSS + '</style>');
  }

  function cardMarkup() {
    return '<div class="mv-card" data-mv-ui="1">' +
      '<div class="mv-head">' +
        '<span class="mv-badge">MathViz</span>' +
        '<span class="mv-state" data-a="state">等待渲染…</span>' +
        '<span class="mv-gap"></span>' +
        '<button type="button" data-a="png">存图</button>' +
        '<button type="button" data-a="source">源码</button>' +
        '<button type="button" data-a="copy">复制</button>' +
        '<button type="button" data-a="reload">重渲染</button>' +
        '<button type="button" data-a="fold">折叠</button>' +
      '</div>' +
      '<div class="mv-body"></div>' +
      '<pre class="mv-src" hidden></pre>' +
    '</div>';
  }

  function makeCard(anchor, code, kind, digest) {
    var id = 'mv' + (++seq) + '-' + digest;
    var host = el('div', 'mv-card-host');
    var inline = anchor.tagName === 'PRE';
    /* content-visibility:auto —— 屏幕外的卡片连样式/布局都跳过，长会话滚回顶部时
       不用把几十张卡的 shadow 树重新算一遍；contain-intrinsic-size 的 auto 会记住
       上次的真实高度，滚动条不会跳。旧内核不认这两条，忽略即可。 */
    host.style.cssText = (inline ? 'display:block;margin:0;' : 'display:block;margin:12px 0;')
      + 'content-visibility:auto;contain-intrinsic-size:auto 360px;';
    host.setAttribute('data-mv-ui', '1');
    host.setAttribute('data-theme', theme);
    if (inline) host.setAttribute('data-inline', '1');
    var sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = cardMarkup();
    styleShadow(sr);

    var rec = {
      id: id, host: host, sr: sr, anchor: anchor, code: code, kind: kind,
      inline: inline,
      digest: digest, sent: false, sentCode: '', src: sr.querySelector('.mv-src'),
      /* iframe 是按需创建的：一个沙箱 iframe 就是一份独立 document + JS 上下文，
         40 张图全建出来就多 40 个 frame。只有真要渲染时才插入，暂存时整块移除。 */
      iframe: null, state: sr.querySelector('[data-a="state"]'),
      body: sr.querySelector('.mv-body'),
      /* 渲染生命周期：排队 → 在途 → 完成；离屏/折叠时可被「暂存」释放 iframe */
      queued: false, inflight: false, rendered: false, paused: false, armed: false,
      folded: false, offscreen: false, stuckTimer: 0
    };
    rec.src.textContent = code;

    sr.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-a]') : null;
      if (!btn) return;
      var a = btn.getAttribute('data-a');
      if (a === 'png') {
        if (rec.paused) { resume(rec); toast('图已从暂存恢复，稍等一下再点「存图」'); return; }
        exportCard(rec, btn);
      } else if (a === 'source') {
        var show = rec.src.hasAttribute('hidden');
        if (show) rec.src.removeAttribute('hidden'); else rec.src.setAttribute('hidden', '');
        btn.textContent = show ? '收起源码' : '源码';
      } else if (a === 'copy') {
        copyText(rec.code, btn);
      } else if (a === 'reload') {
        /* 重渲染要读页面上的最新代码，不能用建卡时缓存的快照 */
        var fresh = readCodeFromAnchor(rec.anchor);
        if (fresh) {
          rec.code = fresh;
          rec.kind = D.classify(fresh);
          rec.digest = D.digest(fresh);
          rec.src.textContent = fresh;
          var m = mounted.get(rec.anchor);
          if (m) mounted.set(rec.anchor, { digest: rec.digest, id: m.id });
        }
        rec.paused = false;
        rec.rendered = false;
        rec.sent = false;
        openViewer(rec);
      } else if (a === 'fold') {
        var folded = rec.body.hasAttribute('hidden');
        if (folded) {
          rec.body.removeAttribute('hidden');
          rec.folded = false;
          btn.textContent = '折叠';
          if (rec.paused) {
            rec.paused = false;
            rec.body.classList.remove('mv-paused');
            rec.body.style.height = '';
          }
          if (!rec.rendered) enqueue(rec);
        } else {
          rec.body.setAttribute('hidden', '');
          rec.folded = true;
          btn.textContent = '展开';
          /* 折叠即释放：iframe 现在看不见了，没必要继续占着一个 JS 上下文 */
          pause(rec);
        }
      }
    });

    cards.set(id, rec);
    observe(rec);
    enqueue(rec);
    return rec;
  }

  /* ---------------------------------------------------------------- */
  /* 渲染调度                                                          */
  /*   ① 一次最多让 2 个 iframe 开工 —— 20 张图同时 new Function 会在    */
  /*      手机上造成 300ms 级的单次卡顿；分批后峰值被摊平。              */
  /*   ② 视口近的先画。离屏 2400px 外的卡片不画；已经画过的离开就把     */
  /*      iframe 换成 about:blank 释放掉（一张图约 8MB），滚回来重建。    */
  /*                                                                  */
  /*   卡片的「远/近」一律由 distToViewport() 实测决定，IntersectionObserver */
  /*   只当「视口可能变了」的触发器。早先直接读 isIntersecting 有两个坑： */
  /*   消息列表在内部滚动容器里时它会被祖先裁剪切得忽真忽假，且滚动回来的  */
  /*   那一帧不一定有回调 —— 结果就是图卡在「渲染中…」再也不出来。        */
  /* ---------------------------------------------------------------- */
  var MAX_INFLIGHT = 2;
  var OFFSCREEN = 2400;   /* 超出可视范围这么多，就先不画、已画的释放掉 */
  var queue = [];
  var inflight = 0;
  var pumpTimer = 0;
  var evalTimer = 0;
  var io = null;

  function distToViewport(rec) {
    var r = rec.host.getBoundingClientRect();
    var vh = window.innerHeight || 800;
    if (r.bottom <= 0) return -r.bottom;
    if (r.top >= vh) return r.top - vh;
    return 0;
  }

  function schedulePump() {
    if (pumpTimer) return;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    pumpTimer = raf(function () { pumpTimer = 0; pump(); });
  }


  function pump() {
    if (!queue.length) return;
    queue.sort(function (a, b) { return distToViewport(a) - distToViewport(b); });
    while (inflight < MAX_INFLIGHT && queue.length) {
      var rec = queue.shift();
      rec.queued = false;
      if (!rec.host.isConnected || rec.folded) continue;
      /* 远的直接从队列丢掉（不是挂回去），由 evaluate() 在它靠近时重新入队。
         挂回队列会让这张卡的 queued 一直为真，之后 enqueue 全被挡掉。
         状态要一起退回「等待渲染…」，否则界面上会留一堆假的「排队中」。 */
      if (distToViewport(rec) > OFFSCREEN) {
        rec.state.textContent = '等待渲染…';
        rec.state.className = 'mv-state';
        continue;
      }
      openViewer(rec);
    }
  }

  function enqueue(rec) {
    if (!rec || rec.folded) return;
    if (rec.queued) { schedulePump(); return; }
    if (rec.inflight || rec.rendered || rec.paused) return;
    if (distToViewport(rec) > OFFSCREEN) {
      /* 等 evaluate() 把它带近；状态别停在「排队中…」——它其实没在排队 */
      if (!rec.rendered && rec.state.textContent !== '等待渲染…') {
        rec.state.textContent = '等待渲染…';
        rec.state.className = 'mv-state';
      }
      return;
    }
    rec.queued = true;
    rec.state.textContent = '排队中…';
    rec.state.className = 'mv-state';
    queue.push(rec);
    schedulePump();
  }

  function dequeue(rec) {
    var i = queue.indexOf(rec);
    if (i >= 0) { queue.splice(i, 1); rec.queued = false; }
  }

  function finish(rec) {
    if (!rec.inflight) return;
    rec.inflight = false;
    inflight = Math.max(0, inflight - 1);
    schedulePump();
  }

  /* 释放：把 iframe 的文档清掉，高度锁住，避免下方内容跳动 */
  function pause(rec) {
    if (!rec || rec.paused) return;
    dequeue(rec);
    if (!rec.rendered && !rec.inflight) {
      /* 还没画过：只是退回「等滚动」，别把状态留在「渲染中…」 */
      if (rec.state.textContent !== '等待渲染…') {
        rec.state.textContent = '等待渲染…';
        rec.state.className = 'mv-state';
      }
      return;
    }
    var h = 0;
    try { h = rec.body.getBoundingClientRect().height || 0; } catch (e) {}
    finish(rec);
    if (rec.stuckTimer) { clearTimeout(rec.stuckTimer); rec.stuckTimer = 0; }
    rec.paused = true;
    rec.rendered = false;
    rec.sent = false;
    rec.sentCode = '';
    dropFrame(rec);
    rec.body.classList.add('mv-paused');
    /* 高度锁在释放前，占位图和原来一样高，下方内容不会跳 */
    if (h > 40) rec.body.style.height = Math.round(h) + 'px';
    rec.state.textContent = '已暂存';
    rec.state.className = 'mv-state';
  }

  function resume(rec) {
    rec.offscreen = false;
    if (rec.paused) {
      rec.paused = false;
      rec.body.classList.remove('mv-paused');
      rec.body.style.height = '';
      rec.state.textContent = '排队中…';
      rec.state.className = 'mv-state';
    }
    if (rec.queued) { schedulePump(); return; }
    if (!rec.rendered && !rec.inflight) enqueue(rec);
  }

  /* 所有「视口可能变了」的场合都走这里：重算距离，该画的画、该释放的释放。
     幂等，重复调用没有副作用。 */
  function evaluate() {
    cards.forEach(function (rec) {
      if (!rec.host.isConnected) return;
      if (rec.folded) return;      /* 折叠的已经被 pause 过了，别再动它的状态 */
      var d = distToViewport(rec);
      if (d <= OFFSCREEN) {
        if (rec.offscreen || rec.paused) resume(rec);
        else if (rec.queued) schedulePump();
        else if (!rec.rendered && !rec.inflight) enqueue(rec);
      } else {
        rec.offscreen = true;
        if (rec.rendered || rec.inflight) pause(rec);
        else {
          dequeue(rec);
          if (rec.state.textContent === '排队中…') {
            rec.state.textContent = '等待渲染…';
            rec.state.className = 'mv-state';
          }
        }
      }
    });
    schedulePump();
  }

  function scheduleEval() {
    if (evalTimer) return;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    evalTimer = raf(function () { evalTimer = 0; evaluate(); });
  }

  function observe(rec) {
    if (typeof IntersectionObserver !== 'function') return;   /* 老内核：退化成全部渲染 */
    if (!io) {
      /* 只看「有没有变化」，判定交给 distToViewport —— 见文件头那段注释 */
      io = new IntersectionObserver(function () { scheduleEval(); },
        { rootMargin: '2400px 0px 2400px 0px' });
    }
    rec.host.__mvRec = rec;
    rec.observed = true;
    try { io.observe(rec.host); } catch (e) {}
  }

  function unobserve(rec) {
    if (io && rec.observed) { try { io.unobserve(rec.host); } catch (e) {} }
    rec.observed = false;
    rec.host.__mvRec = null;
  }

  /* 按需创建沙箱 iframe。页面里同时活着的 iframe 数量直接决定内存与切回标签页
     时的恢复成本，所以「建卡」不等于「建 frame」——只有真要画时才插进来。 */
  function ensureFrame(rec) {
    if (rec.iframe) return rec.iframe;
    var f = document.createElement('iframe');
    f.title = 'MathViz 图形';
    f.setAttribute('sandbox', 'allow-scripts');
    f.addEventListener('load', function () { renderInto(rec); });
    rec.body.appendChild(f);
    rec.iframe = f;
    return f;
  }

  /* 移除 = 连 document 一起释放；只换 src 到 about:blank 仍会留一个 frame */
  function dropFrame(rec) {
    if (!rec.iframe) return;
    try { rec.iframe.remove(); } catch (e) {}
    rec.iframe = null;
    rec.armed = false;
  }

  function openViewer(rec) {
    dequeue(rec);
    if (!rec.inflight) { rec.inflight = true; inflight++; }
    rec.paused = false;
    rec.body.classList.remove('mv-paused');
    rec.body.style.height = '';
    rec.host.setAttribute('data-theme', theme);
    rec.state.textContent = '渲染中…';
    rec.state.className = 'mv-state';
    rec.sent = false;
    rec.sentCode = '';
    /* 沙箱页没回话时别把并发名额永久占住，否则后面的图全卡在队列里 */
    if (rec.stuckTimer) clearTimeout(rec.stuckTimer);
    rec.stuckTimer = setTimeout(function () {
      if (rec.inflight) { rec.state.textContent = '渲染超时'; finish(rec); }
    }, 9000);
    var url = Platform.viewerUrl('theme=' + theme + '&id=' + encodeURIComponent(rec.id));
    if (!url) {
      /* 扩展被重载/更新后旧标签页的上下文已失效（运行时通道没了）。
         finish() 会把 inflight 名额还回去，否则后面所有图都永远排队。 */
      rec.state.textContent = '扩展已更新，请刷新页面（F5）';
      rec.state.className = 'mv-state mv-err';
      finish(rec);
      return;
    }
    var f = ensureFrame(rec);
    rec.armed = true;      /* 只有这一次 setAttribute 之后的 load 才是真的沙箱页 */
    f.setAttribute('src', url);
  }

  function renderInto(rec) {
    if (!rec.armed) return;      /* iframe 刚插进 DOM 时加载 about:blank 也会触发 load */
    if (rec.paused || rec.folded) return;
    if (rec.sent && rec.sentCode === rec.code) return;
    rec.sent = true;
    rec.sentCode = rec.code;
    rec.state.textContent = '渲染中…';
    try {
      rec.iframe.contentWindow.postMessage({
        __mv: true, type: 'mv:render', id: rec.id, code: rec.code, kind: rec.kind
      }, '*');
    } catch (e) {
      rec.state.textContent = '沙箱通信失败';
    }
  }

  /* ---------------------------------------------------------------- */
  /* 存图：图在沙箱 iframe 里，父页面拿不到它的 DOM，只能让它自己转 PNG  */
  /* ---------------------------------------------------------------- */

  function stamp() {
    var d = new Date();
    var p = function (v) { return (v < 10 ? '0' : '') + v; };
    return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function exportCard(rec, btn) {
    if (rec.busy) return;
    if (!rec.iframe || !rec.rendered) {
      /* 还没画（离屏卡片可能从来没启动过），先让它画出来。
         不能直接 enqueue()：enqueue 开头会把 rec.paused 的卡静默挡掉，
         表现为「点了存图永远没反应」——必须先 resume 恢复这张卡。 */
      toast('这张图还没渲染，正在开始画，稍等一下再点「存图」');
      resume(rec);
      return;
    }
    rec.busy = true;
    rec.pngBtn = btn;
    rec.pngLabel = btn.textContent;
    btn.textContent = '生成中…';
    try {
      rec.iframe.contentWindow.postMessage({
        __mv: true, type: 'mv:export', id: rec.id, scale: 2
      }, '*');
    } catch (e) {
      finishExport(rec, '沙箱通信失败，先点一下「重渲染」');
      return;
    }
    clearTimeout(rec.pngTimer);
    rec.pngTimer = setTimeout(function () {
      finishExport(rec, '导出超时了，先点「重渲染」再存');
    }, 8000);
  }

  function finishExport(rec, msg) {
    rec.busy = false;
    clearTimeout(rec.pngTimer);
    if (rec.pngBtn) rec.pngBtn.textContent = rec.pngLabel || '存图';
    if (msg) toast(msg);
  }

  function saveImage(dataUrl) {
    var name = 'mathviz-' + stamp() + '.png';
    if (Platform && typeof Platform.saveImage === 'function') {
      return Platform.saveImage(dataUrl, name) || { ok: false, msg: '存图失败' };
    }
    return { ok: false, msg: '当前平台不支持存图' };
  }

  function copyText(text, btn) {
    var done = function (ok) {
      var old = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { btn.textContent = old; }, 1400);
    };
    try {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } catch (e) { done(false); }
  }

  /* ---------------------------------------------------------------- */
  /* 扫描页面里的 mathviz 代码块                                       */
  /* ---------------------------------------------------------------- */

  function skip(n) {
    if (!n || n === document.body || n === document.documentElement) return true;
    if (n.closest && n.closest('[data-mv-ui]')) return true;
    /* 输入框（尤其 contenteditable）里的提示词全文不是模型输出，绝不能拿来渲染 */
    if (n.closest && n.closest('[contenteditable]')) return true;
    var t = n.tagName;
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'INPUT' || t === 'NOSCRIPT') return true;
    var s = n.textContent || '';
    return s.length > 0 && s.indexOf(P.MARK) >= 0;
  }

  /* 用户消息气泡里若出现 language-mathviz 的示例 pre，也不算模型输出。
     只看直接父元素，不看更高层，避免把整页消息容器一起排除掉。 */
  function inUserBubble(pre) {
    var p = pre.parentElement;
    if (!p || p === document.body) return false;
    var s = p.textContent || '';
    return s.length < 12000 && s.indexOf(P.MARK) >= 0;
  }

  function depth(n) {
    var d = 0;
    while (n && n !== document.body) { d++; n = n.parentElement; }
    return d;
  }

  function collect() {
    var found = new Map();   // digest -> candidate（取最内层锚点）

    function add(code, anchor, kind) {
      code = D.normalize(code);
      if (!D.isRenderable(code)) return;
      var dg = D.digest(code);
      var prev = found.get(dg);
      if (prev && prev.depth >= depth(anchor)) return;
      found.set(dg, { code: code, kind: kind, digest: dg, anchor: anchor, depth: depth(anchor) });
    }

    /* ① 已经被 markdown 渲染成 <pre><code> 的块 */
    var pres = document.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (skip(pre) || inUserBubble(pre)) continue;
      var code = pre.querySelector('code') || pre;
      var text = code.textContent || '';
      var meta = {
        text: text,
        className: typeof code.className === 'string' ? code.className : '',
        parentClassName: typeof pre.className === 'string' ? pre.className : '',
        parentLang: pre.getAttribute('data-language') || pre.getAttribute('lang') || '',
        dataLang: code.getAttribute('data-language') || '',
        header: (pre.parentElement ? pre.parentElement.textContent : '').slice(0, 80)
      };
      if (D.isMathvizCode(meta)) {
        var body = D.normalize(text);
        var m = body.match(/^```[ \t]*mathviz[^\n]*\n/);
        if (m) {
          var fenced = D.extractFenced(body);
          for (var k = 0; k < fenced.length; k++) add(fenced[k].code, pre, fenced[k].kind);
        } else {
          add(body, pre, D.classify(body));
        }
      }
    }

    /* ② 流式输出时还没被渲染成 pre 的裸 ```mathviz 文本 */
    var all = document.querySelectorAll('div,p,section,article,li,span,td,blockquote');
    for (var j = 0; j < all.length; j++) {
      var n = all[j];
      if (skip(n)) continue;
      var txt = n.textContent || '';
      if (txt.length > 30000 || txt.indexOf('```mathviz') < 0) continue;
      var blocks = D.extractFenced(txt);
      for (var b = 0; b < blocks.length; b++) add(blocks[b].code, n, blocks[b].kind);
    }

    return found;
  }

  function setStyle(n, prop, val) {
    try { if (n.style.getPropertyValue(prop) !== val) n.style.setProperty(prop, val); } catch (e) {}
  }

  /* 把渲染宿主塞进原来的 <pre> 里 —— 代码块原地变成图，不再另起一张卡片。
     原代码文本保留但不显示，React 流式重渲染后 scan 会再收一次。 */
  function hideCodeInside(pre, host) {
    [].slice.call(pre.childNodes).forEach(function (n) {
      if (n === host) return;
      if (n.nodeType === 1) setStyle(n, 'display', 'none');
      else if (n.nodeType === 3 && n.textContent.trim()) {
        var span = document.createElement('span');
        span.setAttribute('data-mv-hidden', '1');
        span.style.display = 'none';
        span.textContent = n.textContent;
        try { pre.replaceChild(span, n); } catch (e) {}
      }
    });
    setStyle(pre, 'padding', '0px');
    setStyle(pre, 'background', 'transparent');
    setStyle(pre, 'overflow', 'visible');
    setStyle(pre, 'max-height', 'none');
    setStyle(pre, 'white-space', 'normal');
  }

  /* 流式中间态：整段几乎只有 ```mathviz 的元素，把原文收起来 */
  function foldFenceText(n) {
    if (!n || n.tagName === 'PRE' || n.style.display === 'none') return;
    var txt = n.textContent || '';
    var rest = txt.replace(/```[ \t]*mathviz[\s\S]*?```/g, '').trim();
    if (rest.length <= 40) n.style.setProperty('display', 'none');
  }

  function readCodeFromAnchor(a) {
    if (!a) return '';
    if (a.tagName === 'PRE') {
      var code = a.querySelector('code') || a;
      return D.normalize(code.textContent || '');
    }
    var blocks = D.extractFenced(a.textContent || '');
    return blocks.length ? blocks[0].code : '';
  }

  /* pre → 在代码块内部渲染；裸 fence → 紧邻兄弟节点 */
  function mountInto(rec) {
    var a = rec.anchor;
    if (!a || !a.parentNode) return;
    if (rec.inline) {
      if (rec.host.parentElement !== a) a.appendChild(rec.host);
      hideCodeInside(a, rec.host);
    } else {
      if (rec.host.parentElement !== a.parentNode) a.parentNode.insertBefore(rec.host, a.nextSibling);
      foldFenceText(a);
    }
  }

  function prune() {
    cards.forEach(function (rec, id) {
      if (!rec.host.isConnected || !rec.anchor || !rec.anchor.isConnected) {
        try { rec.host.remove(); } catch (e) {}
        unobserve(rec);
        dequeue(rec);
        finish(rec);      /* 渲染中被删掉的卡片不能永久占着一个并发名额 */
        cards.delete(id);
      }
    });
  }

  /* scan 期间我们自己在改 DOM（插 iframe、隐藏 code、改 pre 样式），
     这些变更会喂回 MutationObserver 造成自激循环 —— 输入框看起来就是「一直闪烁」。 */
  function scan() {
    if (scanning) return;
    /* 后台标签不扫描：切回前台时 visibilitychange 会补一次，没必要在后台反复
       读一个正在被站点改写的 DOM（后台的定时器还会被节流，攒到切回时集中爆发）。 */
    if (document.hidden) return;
    scanning = true;
    var t0 = (window.performance || {}).now ? performance.now() : 0;
    try { scanBody(); } finally {
      /* 调试探针：devtools 里读 document.documentElement.dataset.mvScan 就能看到最近几次
         全页扫描花了多久（写在 DOM 上，页面自己的脚本也能读，方便脱离扩展上下文测）。
         长会话变卡时先看这个数 —— 它比「感觉」可靠。 */
      try {
        var ms = Math.round((performance.now() - t0) * 10) / 10;
        var prev = (document.documentElement.getAttribute('data-mv-scan') || '').split(',').filter(Boolean);
        prev.push(String(ms));
        document.documentElement.setAttribute('data-mv-scan', prev.slice(-20).join(','));
      } catch (e) {}
      setTimeout(function () { scanning = false; }, 0);
    }
  }

  function scanBody() {
    var t = themeNow();
    if (t !== theme) {
      theme = t;
      if (ui) ui.host.setAttribute('data-theme', theme);
      /* 只重画正在显示的图；暂存/离屏/排队中的卡片下次启动时自然用新主题。
         走队列而不是直接重载 —— 20 张图同时换 src 会在手机上卡成一片。 */
      cards.forEach(function (rec) {
        if (rec.paused || rec.folded || rec.offscreen) return;
        rec.rendered = false;
        rec.sent = false;
        enqueue(rec);
      });
    }
    prune();

    var found = collect();
    var incomplete = 0;
    found.forEach(function (c) {
      /* 模型输出被截断 / 写了省略号时，代码块是半截的。不要闪出「渲染失败」：
         保留原代码块，等它写完整再自动渲染；计数里如实告知有几段没写完。 */
      if (!D.looksComplete(c.code)) {
        pending.set(c.anchor, { code: c.code, since: Date.now() });
        incomplete++;
        return;
      }
      pending.delete(c.anchor);
      var prev = mounted.get(c.anchor);
      if (prev && prev.digest === c.digest && cards.has(prev.id)) {
        mountInto(cards.get(prev.id));
        return;
      }
      if (prev && cards.has(prev.id)) {
        try { cards.get(prev.id).host.remove(); } catch (e) {}
        cards.delete(prev.id);
      }
      var rec = makeCard(c.anchor, c.code, c.kind, c.digest);
      mountInto(rec);
      mounted.set(c.anchor, { digest: c.digest, id: rec.id });
    });

    if (ui) ui.count.textContent = cards.size + ' 张图'
      + (incomplete ? ' · ' + incomplete + ' 段未写完' : '');
  }

  function schedule() {
    if (scanning) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 280);
  }

  /* ---------------------------------------------------------------- */
  /* 工具条                                                            */
  /* ---------------------------------------------------------------- */

  function buildUI() {
    var host = el('div', 'mv-toolbar-host');
    host.id = 'mv-ext-root';
    host.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:2147483000;';
    host.setAttribute('data-mv-ui', '1');
    host.setAttribute('data-theme', theme);
    var sr = host.attachShadow({ mode: 'open' });

    var opts = P.MODES.map(function (m) {
      return '<option value="' + m.id + '">' + m.label + '</option>';
    }).join('');

    sr.innerHTML = '<div class="mv-bar">' +
        '<button type="button" class="mv-toggle" data-a="toggle">∑ <span>MathViz</span></button>' +
        '<span class="mv-count" data-a="count">0 张图</span>' +
      '</div>' +
      '<div class="mv-panel" hidden>' +
        '<div class="mv-row"><label for="mv-mode">作图模式</label><select id="mv-mode" data-a="mode">' + opts + '</select></div>' +
        '<div class="mv-desc" data-a="desc"></div>' +
        '<div class="mv-sess" data-a="sess">本轮对话：还没给提示词</div>' +
        '<div class="mv-btns">' +
          '<button type="button" class="mv-primary" data-a="insert">插入提示词</button>' +
          '<button type="button" data-a="reset">新对话</button>' +
          '<button type="button" data-a="rescan">重新扫描</button>' +
        '</div>' +
        '<label class="mv-check"><input type="checkbox" data-a="auto"> 新对话的首次发送自动附加（实验性）</label>' +
        '<div class="mv-tip">一整轮对话只需给一次提示词；之后模型会一直按协议输出代码块，'
          + '图直接显示在那个代码块里。Alt+M 开面板</div>' +
      '</div>' +
      '<div class="mv-toast" hidden></div>';
    styleShadow(sr);

    document.body.appendChild(host);

    var q = function (a) { return sr.querySelector('[data-a="' + a + '"]'); };
    var modeSel = q('mode');
    var autoBox = q('auto');
    var desc = q('desc');
    var panel = sr.querySelector('.mv-panel');
    var toastEl = sr.querySelector('.mv-toast');

    function syncForm() {
      modeSel.value = CFG.mode;
      autoBox.checked = !!CFG.auto;
      var m = P.modeById(CFG.mode);
      desc.textContent = m ? m.desc : '';
    }

    function toggle(force) {
      var show = force === undefined ? panel.hasAttribute('hidden') : force;
      if (show) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    }

    sr.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-a]') : null;
      if (!btn) return;
      var a = btn.getAttribute('data-a');
      if (a === 'toggle') { toggle(); return; }
      if (a === 'insert') { insertPrompt(); toggle(false); return; }
      if (a === 'reset') {
        injected = false;
        injectedMode = null;
        syncSess();
        toast('已重置：下一次发送会重新给一次提示词');
        return;
      }
      if (a === 'rescan') { scan(); toast('已重新扫描'); return; }
    });
    modeSel.addEventListener('change', function () {
      CFG.mode = modeSel.value;
      syncForm();
      save();
      toast(CFG.mode === 'off' ? '已关闭提示词' : '模式：' + P.modeById(CFG.mode).label);
    });
    autoBox.addEventListener('change', function () {
      CFG.auto = autoBox.checked;
      save();
      toast(CFG.auto ? '自动附加已开（建议先手动试一次）' : '自动附加已关');
    });

    document.addEventListener('keydown', function (e) {
      if (e.altKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); toggle(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && CFG.auto) ensurePrefix();
    }, true);
    document.addEventListener('click', function (e) {
      if (!CFG.auto) return;
      var t = e.target;
      var btn = t && t.closest ? t.closest('button,[role="button"]') : null;
      if (!btn) return;
      var hint = [btn.getAttribute('aria-label'), btn.title, String(btn.className || ''), btn.textContent]
        .filter(Boolean).join(' ');
      if (/send|submit|发送|提交/i.test(hint) ||
          /ds-button--iconLabelPrimary/.test(String(btn.className || ''))) ensurePrefix();
    }, true);

    ui = { host: host, sr: sr, count: q('count'), toast: toastEl, sess: q('sess'), sync: syncForm };
    syncForm();
    syncSess();
  }

  function toast(msg) {
    if (!ui) return;
    ui.toast.textContent = msg;
    ui.toast.removeAttribute('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.setAttribute('hidden', ''); }, 2600);
  }

  /* 沙箱页回传 */
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__mv !== true || typeof d.type !== 'string') return;
    var rec = cards.get(d.id);
    if (!rec) return;
    if (!rec.iframe || e.source !== rec.iframe.contentWindow) return;
    if (d.type === 'mv:ready' || d.type === 'mv:pong') { renderInto(rec); return; }
    if (d.type === 'mv:exported') {
      finishExport(rec, '');
      var r = saveImage(d.dataUrl);
      toast(r.msg);
      return;
    }
    if (d.type === 'mv:export-error') {
      finishExport(rec, String(d.message || '导出失败'));
      return;
    }
    if (d.type === 'mv:done') {
      if (rec.stuckTimer) { clearTimeout(rec.stuckTimer); rec.stuckTimer = 0; }
      rec.rendered = true;
      rec.paused = false;
      rec.body.classList.remove('mv-paused');
      rec.state.textContent = '已渲染 ' + (d.figures || 1) + ' 张';
      rec.state.className = 'mv-state mv-ok';
      if (rec.iframe) rec.iframe.style.height = Math.max(80, Number(d.height) || 320) + 'px';
      finish(rec);
      return;
    }
    if (d.type === 'mv:error') {
      if (rec.stuckTimer) { clearTimeout(rec.stuckTimer); rec.stuckTimer = 0; }
      rec.rendered = true;
      rec.paused = false;
      rec.body.classList.remove('mv-paused');
      rec.state.textContent = '渲染失败';
      rec.state.className = 'mv-state mv-err';
      if (rec.iframe) rec.iframe.style.height = '0px';
      rec.src.removeAttribute('hidden');
      rec.src.textContent = String(d.message || '') + '\n\n---- 原始代码 ----\n' + rec.code;
      finish(rec);
    }
  });

  function save() {
    Platform.save({ mvMode: CFG.mode, mvAuto: CFG.auto });
  }

  function boot() {
    theme = themeNow();
    var done = function () {
      buildUI();
      scan();
      setTimeout(scan, 900);
      new MutationObserver(schedule).observe(document.body, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['style', 'class']
      });
      /* 主题切换 / SPA 换路由这类只改属性或干脆不触发 MO 的变化，靠低频兜底 */
      setInterval(function () { if (!document.hidden) scan(); }, 3000);

      /* 滚动兜底：站点把消息列表放在自己的滚动容器里，容器的 scroll 不冒泡到
         window，IIntersectionObserver 的回调也可能晚一帧。滚轮/触摸一定会冒泡，
         用它把「视口变了」补上，滚回来就能立刻重建。 */
      var scrollTimer = 0;
      var onScrollish = function () {
        if (scrollTimer) return;
        scrollTimer = setTimeout(function () { scrollTimer = 0; scheduleEval(); }, 120);
      };
      ['wheel', 'touchmove', 'touchstart'].forEach(function (t) {
        window.addEventListener(t, onScrollish, { capture: true, passive: true });
      });
      window.addEventListener('resize', scheduleEval);
      window.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          /* 诊断埋点：记下进后台的时刻，切回时能算出后台了多久 */
          try { document.documentElement.dataset.mvHiddenAt = String(Date.now()); } catch (e) {}
          return;
        }
        /* 诊断埋点（只记录，不改下面的调度）：切回前台时快照卡片状态，
           600ms 后补记一次。两个用途：
           ① t+ 耗时包含主线程被占住的时间 —— 切回瞬间整页卡死的话，
              这个数会直接涨到几百毫秒甚至几秒，一眼定位卡死发生在唤醒后多凶；
           ② 对比前后两次快照，能看出是我们重建（f/r 变化）还是站点自己在闹。
           devtools 里读 document.documentElement.getAttribute('data-mv-wake')。 */
        try {
          var hidAt = +(document.documentElement.dataset.mvHiddenAt || 0);
          var away = hidAt ? Math.round((Date.now() - hidAt) / 1000) : -1;
          var wakeT0 = (window.performance || {}).now ? performance.now() : 0;
          var snap = function () {
            var s = { n: 0, r: 0, p: 0, q: 0, i: 0, f: 0 };
            cards.forEach(function (rec) {
              s.n++;
              if (rec.rendered) s.r++;
              if (rec.paused) s.p++;
              if (rec.queued) s.q++;
              if (rec.inflight) s.i++;
              if (rec.iframe) s.f++;
            });
            return 'n' + s.n + '/r' + s.r + '/p' + s.p + '/q' + s.q + '/i' + s.i + '/f' + s.f;
          };
          setTimeout(function () {
            var spent = wakeT0 ? (Math.round((performance.now() - wakeT0) * 10) / 10 + 'ms') : '?';
            var line = 'away=' + away + 's ' + snap() + ' t+' + spent;
            var prev = (document.documentElement.getAttribute('data-mv-wake') || '').split(',').filter(Boolean);
            prev.push(line);
            document.documentElement.setAttribute('data-mv-wake', prev.slice(-5).join(','));
          }, 600);
        } catch (e) {}
        schedule();        /* 后台期间站点可能追加了内容，先补一次扫描 */
        scheduleEval();    /* 再按当前滚动位置决定画谁、放谁 */
      });

      /* 卡顿探针：最近 30 个长任务（>50ms）的耗时，写在 <html data-mv-long>。
         切回标签页仍觉得卡时读这个数：空的 = 主线程没被大块同步任务占住（是站点或合成器），
         有一串几百毫秒的 = 同步工作在这里，能直接定位是扫描、渲染还是重建。 */
      try {
        if (typeof PerformanceObserver === 'function') {
          var lt = [];
          new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (e) { lt.push(Math.round(e.duration)); });
            if (lt.length > 30) lt = lt.slice(-30);
            document.documentElement.setAttribute('data-mv-long', lt.join(','));
          }).observe({ entryTypes: ['longtask'] });
        }
      } catch (e) {}
    };
    try {
      Platform.load(function (o) {
        CFG.mode = (o && o.mvMode) || 'auto';
        CFG.auto = !!(o && o.mvAuto);
        done();
      });
    } catch (e) { done(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
