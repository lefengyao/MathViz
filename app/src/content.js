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

  function cardMarkup() {
    return '<div class="mv-card" data-mv-ui="1">' +
      '<div class="mv-head">' +
        '<span class="mv-badge">MathViz</span>' +
        '<span class="mv-state" data-a="state">等待渲染…</span>' +
        '<span class="mv-gap"></span>' +
        '<button type="button" data-a="source">源码</button>' +
        '<button type="button" data-a="copy">复制</button>' +
        '<button type="button" data-a="reload">重渲染</button>' +
        '<button type="button" data-a="fold">折叠</button>' +
      '</div>' +
      '<div class="mv-body"><iframe title="MathViz 图形" sandbox="allow-scripts"></iframe></div>' +
      '<pre class="mv-src" hidden></pre>' +
    '</div>';
  }

  function makeCard(anchor, code, kind, digest) {
    var id = 'mv' + (++seq) + '-' + digest;
    var host = el('div', 'mv-card-host');
    var inline = anchor.tagName === 'PRE';
    host.style.cssText = inline ? 'display:block;margin:0;' : 'display:block;margin:12px 0;';
    host.setAttribute('data-mv-ui', '1');
    host.setAttribute('data-theme', theme);
    if (inline) host.setAttribute('data-inline', '1');
    var sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>' + CSS + '</style>' + cardMarkup();

    var rec = {
      id: id, host: host, sr: sr, anchor: anchor, code: code, kind: kind,
      inline: inline,
      digest: digest, sent: false, sentCode: '', src: sr.querySelector('.mv-src'),
      iframe: sr.querySelector('iframe'), state: sr.querySelector('[data-a="state"]'),
      body: sr.querySelector('.mv-body')
    };
    rec.src.textContent = code;
    rec.iframe.addEventListener('load', function () { renderInto(rec); });

    sr.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-a]') : null;
      if (!btn) return;
      var a = btn.getAttribute('data-a');
      if (a === 'source') {
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
        rec.sent = false;
        openViewer(rec);
      } else if (a === 'fold') {
        var folded = rec.body.hasAttribute('hidden');
        if (folded) rec.body.removeAttribute('hidden'); else rec.body.setAttribute('hidden', '');
        btn.textContent = folded ? '折叠' : '展开';
      }
    });

    cards.set(id, rec);
    openViewer(rec);
    return rec;
  }

  function openViewer(rec) {
    rec.host.setAttribute('data-theme', theme);
    rec.state.textContent = '等待渲染…';
    rec.state.className = 'mv-state';
    rec.sent = false;
    rec.sentCode = '';
    var url = Platform.viewerUrl('theme=' + theme + '&id=' + encodeURIComponent(rec.id));
    rec.iframe.setAttribute('src', url);
  }

  function renderInto(rec) {
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
        cards.delete(id);
      }
    });
  }

  /* scan 期间我们自己在改 DOM（插 iframe、隐藏 code、改 pre 样式），
     这些变更会喂回 MutationObserver 造成自激循环 —— 输入框看起来就是「一直闪烁」。 */
  function scan() {
    if (scanning) return;
    scanning = true;
    try { scanBody(); } finally {
      setTimeout(function () { scanning = false; }, 0);
    }
  }

  function scanBody() {
    var t = themeNow();
    if (t !== theme) {
      theme = t;
      if (ui) ui.host.setAttribute('data-theme', theme);
      cards.forEach(function (rec) { openViewer(rec); });
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

    sr.innerHTML = '<style>' + CSS + '</style>' +
      '<div class="mv-bar">' +
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
    if (e.source !== rec.iframe.contentWindow) return;
    if (d.type === 'mv:ready' || d.type === 'mv:pong') { renderInto(rec); return; }
    if (d.type === 'mv:done') {
      rec.state.textContent = '已渲染 ' + (d.figures || 1) + ' 张';
      rec.state.className = 'mv-state mv-ok';
      rec.iframe.style.height = Math.max(80, Number(d.height) || 320) + 'px';
      return;
    }
    if (d.type === 'mv:error') {
      rec.state.textContent = '渲染失败';
      rec.state.className = 'mv-state mv-err';
      rec.iframe.style.height = '0px';
      rec.src.removeAttribute('hidden');
      rec.src.textContent = String(d.message || '') + '\n\n---- 原始代码 ----\n' + rec.code;
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
