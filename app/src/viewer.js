/* MathViz viewer —— 运行在 manifest.sandbox.pages 声明的沙箱页里。
   该页面是 opaque origin：拿不到 DeepSeek 的 DOM / Cookie / localStorage，
   也不允许扩展 API。只通过 postMessage 与 content script 通信。 */
(function () {
  'use strict';

  var q = new URLSearchParams(location.search);
  var cardId = q.get('id') || '';
  var parentWin = window.parent;

  function send(type, extra) {
    var msg = { __mv: true, type: 'mv:' + type, id: cardId };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
    try { parentWin.postMessage(msg, '*'); } catch (e) {}
  }

  /* 模型输出的代码不可信：在沙箱之上再掐掉对外通道 */
  function lockDown() {
    var blocked = function () { throw new Error('MathViz 沙箱禁止网络访问'); };
    try { window.fetch = blocked; } catch (e) {}
    try { window.XMLHttpRequest = function () { throw new Error('MathViz 沙箱禁止网络访问'); }; } catch (e) {}
    try { window.WebSocket = function () { throw new Error('MathViz 沙箱禁止网络访问'); }; } catch (e) {}
    try { if (navigator.sendBeacon) navigator.sendBeacon = blocked; } catch (e) {}
    try { window.Image = function () { throw new Error('MathViz 沙箱禁止外部图片'); }; } catch (e) {}
  }

  var reported = false;

  /* 把模型常犯的错翻成可操作的中文提示，别只丢一句英文异常给用户 */
  function explain(msg) {
    /* 注意顺序：带方法名的特例要放在通用 "is not a function" 之前 */
    if (/\.map is not a function|\.forEach is not a function/.test(msg)) {
      return '参数格式不对。S.face 的第一个参数必须是顶点数组 [[x,y,z],...]；'
        + 'MK.graph 的 edges 必须是 ["A","B",权重] 这样的数组，不要写成对象。';
    }
    if (/is not defined/.test(msg)) {
      return '有变量或函数没定义。常见原因：写了 S.drag(draw) 却没定义 function draw(){}，'
        + '或引用了示例里没给出的变量。删掉 drag 那行通常就能出图。';
    }
    if (/is not a function/.test(msg)) {
      return '调用了不存在的方法，或把参数写成了字符串。3D 用 S.line / S.face / S.point / S.axes；'
        + '2D 才用 V.plot / V.seg；图论用 G.draw() / G.path()。V.plot 等的第一个参数要写 function(x){...}。';
    }
    if (/Unexpected end of input|Unexpected token|Invalid or unexpected token/i.test(msg)) {
      return '代码块不完整或有语法错误。常见原因：回复被截断、还在流式生成中、'
        + '模型写了省略号 ... 或半截字符串、或混入了全角标点（如负号 −、逗号 ，）。等生成完点「重渲染」；若仍是半截，让模型重发一次。';
    }
    return '';
  }

  function fail(err) {
    if (reported) return;
    reported = true;
    var raw = (err && (err.message || err.stack)) ? String(err.message || err.stack) : String(err);
    var tip = explain(raw);
    var msg = (tip ? tip + '\n\n' : '') + '原始错误：' + raw;
    var box = document.getElementById('mv-err');
    box.style.display = 'block';
    box.textContent = msg;
    send('error', { message: msg });
  }

  function measure() {
    var fig = document.getElementById('fig');
    var svgs = fig.querySelectorAll('svg');
    var h = 0;
    for (var i = 0; i < svgs.length; i++) {
      var b = svgs[i].getBoundingClientRect();
      h += b.height || 0;
    }
    if (!h) h = Math.ceil(document.body.getBoundingClientRect().height);
    return Math.max(80, Math.ceil(h + 16));
  }

  /* ---------------------------------------------------------------- */
  /* 导出 PNG                                                          */
  /* ---------------------------------------------------------------- */

  /* SVG 转成 <img> 渲染时读不到页面的 CSS 变量，font-family 里的
     var(--font-sans,system-ui,sans-serif) 会整体失效。导出前把 var() 换成它的 fallback。
     颜色不受影响：mk-* 运行时在画的时候就按深浅色算成 hex 了。 */
  function flattenVars(node) {
    var nodes = node.querySelectorAll('*');
    var all = [node];
    for (var i = 0; i < nodes.length; i++) all.push(nodes[i]);
    var fix = function (v) {
      if (v.indexOf('var(') < 0) return v;
      return v.replace(/var\(\s*--[\w-]+\s*(?:,\s*([^)]*))?\)/g, function (m, fb) {
        return fb ? fb.trim() : 'sans-serif';
      });
    };
    for (var k = 0; k < all.length; k++) {
      var n = all[k];
      ['font-family', 'font'].forEach(function (a) {
        if (n.hasAttribute && n.hasAttribute(a)) n.setAttribute(a, fix(n.getAttribute(a)));
      });
      if (n.hasAttribute && n.hasAttribute('style')) n.setAttribute('style', fix(n.getAttribute('style')));
    }
  }

  /* 导出区域：按实际画出来的内容紧裁，别把运行时预留的空白也带走。
     3D 图尤其明显 —— 立方体只占画布三分之一，整帧导出来像截图，裁完才像插图。
     取不到 bbox（老浏览器 / 空图）就退回 viewBox。 */
  function tightBox(svg) {
    var bb;
    try { bb = svg.getBBox(); } catch (e) { bb = null; }
    if (bb && isFinite(bb.width) && isFinite(bb.height) && bb.width > 1 && bb.height > 1) {
      var m = 10;                       // 描边、文字光晕会略微超出 bbox
      return { x: bb.x - m, y: bb.y - m, w: bb.width + m * 2, h: bb.height + m * 2 };
    }
    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    var r = svg.getBoundingClientRect();
    return { x: 0, y: 0, w: Math.max(1, Math.round(r.width) || 680), h: Math.max(1, Math.round(r.height) || 400) };
  }

  function pageBg() {
    try {
      var v = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-background-primary').trim();
      if (v) return v;
    } catch (e) {}
    return '#ffffff';
  }

  /* 一张卡里可能有多张图（模型偶尔画两条），按顺序竖着拼成一张 */
  function exportPNG(scale, done) {
    var fig = document.getElementById('fig');
    var svgs = [].slice.call(fig.querySelectorAll('svg'));
    if (!svgs.length) { done('这一页还没有可导出的图'); return; }

    var items = svgs.map(function (s) {
      var b = tightBox(s);
      var clone = s.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      /* 改写 viewBox 就是紧裁：坐标系跟着一起平移，画面本身不动 */
      clone.setAttribute('viewBox', b.x + ' ' + b.y + ' ' + b.w + ' ' + b.h);
      clone.setAttribute('width', b.w);
      clone.setAttribute('height', b.h);
      clone.removeAttribute('style');       // 原来的 overflow:visible 会让位图裁不掉
      flattenVars(clone);                   // 克隆体是脱离文档的，改它不影响页面
      return { clone: clone, w: b.w, h: b.h };
    });

    var pad = 16;
    var gap = 18;
    var maxW = 0, sumH = 0;
    items.forEach(function (it) { maxW = Math.max(maxW, it.w); sumH += it.h; });
    var n = items.length;

    /* 手机上别开出太大的画布：超过 1600 万像素就自动降倍率 */
    var s = Math.max(1, Math.min(3, Number(scale) || 2));
    var step = function (k) {
      return {
        w: Math.ceil(maxW * k) + pad * 2,
        h: Math.ceil(sumH * k) + gap * (n - 1) + pad * 2
      };
    };
    var dim = step(s);
    while (dim.w * dim.h > 16e6 && s > 1) { s = Math.max(1, s * 0.85); dim = step(s); }

    var canvas = document.createElement('canvas');
    canvas.width = dim.w;
    canvas.height = dim.h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = pageBg();            // 透明底在深色聊天里会糊成一片，直接用当前主题底色
    ctx.fillRect(0, 0, dim.w, dim.h);

    var y = pad;
    var i = 0;
    var broken = false;

    function next() {
      if (broken) return;
      if (i >= items.length) {
        var url;
        try { url = canvas.toDataURL('image/png'); }
        catch (e) { done('图片生成失败：' + ((e && e.message) || e)); return; }
        done(null, url, dim.w, dim.h);
        return;
      }
      var it = items[i++];
      var img = document.createElement('img');   // 不能用 new Image()：lockDown 把它封了
      img.onload = function () {
        ctx.drawImage(img, pad, y, Math.round(it.w * s), Math.round(it.h * s));
        y += Math.round(it.h * s) + gap;
        next();
      };
      img.onerror = function () {
        broken = true;
        done('这张图转不成位图，可能是 SVG 里有无法序列化的内容');
      };
      try {
        img.src = 'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(new XMLSerializer().serializeToString(it.clone));
      } catch (e) {
        broken = true;
        done('导出失败：' + ((e && e.message) || e));
      }
    }
    next();
  }

  /* ---------------------------------------------------------------- */
  /* 画布手势：滚轮缩放 / 拖动平移 / 双指缩放平移                        */
  /* ---------------------------------------------------------------- */
  /* 只改 svg 的 CSS transform，不动 viewBox：坐标映射、3D 拾取与旋转都不受影响，
     而导出走 getBBox() 并在克隆时清掉 style —— 所以存的永远是整张图，
     不是「放大后看到的那一块」。缩放是看的手段，不该改变图本身。 */

  var MAX_SCALE = 6;
  var navs = [];
  var chip = null;
  var chipTimer = 0;

  function zoomChip() {
    if (!chip) chip = document.getElementById('mv-zoom');
    return chip;
  }

  /* rect 含当前 transform，减去 tx/ty 就是未变换时的屏幕左上角 */
  function baseOf(st) {
    var r = st.svg.getBoundingClientRect();
    return { x: r.left - st.tx, y: r.top - st.ty };
  }

  /* svg 没有 offsetWidth（那是 HTMLElement 才有的），只能用 rect 反推布局尺寸。
     取到的是「当前 s 下」的视觉尺寸，所以要除回 s。 */
  function fitNav(st) {
    var r = st.svg.getBoundingClientRect();
    st.w = (r.width || 0) / st.s;
    st.h = (r.height || 0) / st.s;
  }

  function clampNav(st) {
    var vw = document.documentElement.clientWidth || 0;
    var vh = document.documentElement.clientHeight || 0;
    if (!st.w || !st.h) fitNav(st);
    var ox = Math.max(0, st.w * st.s - vw);
    var oy = Math.max(0, st.h * st.s - vh);
    st.tx = Math.min(0, Math.max(-ox, st.tx));
    st.ty = Math.min(0, Math.max(-oy, st.ty));
  }

  function applyNav(st) {
    if (st.s === 1 && st.tx === 0 && st.ty === 0) {
      st.svg.style.transform = '';
    } else {
      st.svg.style.transformOrigin = '0 0';
      st.svg.style.transform = 'translate(' + st.tx.toFixed(2) + 'px,' + st.ty.toFixed(2) + 'px)'
        + ' scale(' + st.s.toFixed(4) + ')';
    }
    syncChip();
  }

  /* 右上角只放一个百分比小胶囊：大于 1 才出现，点一下复位全部 */
  function syncChip() {
    var c = zoomChip();
    if (!c) return;
    var mx = 1;
    for (var i = 0; i < navs.length; i++) mx = Math.max(mx, navs[i].s);
    if (mx <= 1.001) { c.setAttribute('hidden', ''); return; }
    c.removeAttribute('hidden');
    c.textContent = Math.round(mx * 100) + '%';
    c.className = '';
    clearTimeout(chipTimer);
    chipTimer = setTimeout(function () { c.className = 'dim'; }, 1600);
  }

  /* 以屏幕上某一点为锚缩放：锚点下面那部分图固定不动。
     baseOf 给的是「未变换时的左上角」，图内坐标还要再减掉当前平移量。 */
  function zoomAt(st, mx, my, ns) {
    ns = Math.max(1, Math.min(MAX_SCALE, ns));
    if (Math.abs(ns - st.s) < 0.001) return false;
    var b = baseOf(st);
    var ux = (mx - b.x - st.tx) / st.s;
    var uy = (my - b.y - st.ty) / st.s;
    st.s = ns;
    st.tx = mx - b.x - ux * ns;
    st.ty = my - b.y - uy * ns;
    clampNav(st);
    applyNav(st);
    return true;
  }

  function resetNav(st) {
    if (st.s === 1 && st.tx === 0 && st.ty === 0) return;
    st.s = 1; st.tx = 0; st.ty = 0;
    applyNav(st);
  }

  function resetAllNav() {
    for (var i = 0; i < navs.length; i++) resetNav(navs[i]);
  }

  function attachNav(svg) {
    for (var i = 0; i < navs.length; i++) if (navs[i].svg === svg) return;
    var st = {
      svg: svg, s: 1, tx: 0, ty: 0,
      orbit: svg.getAttribute('data-mv-orbit') === '1'   /* 3D：拖动已被旋转征用 */
    };
    navs.push(st);
    fitNav(st);
    if (!st.orbit) {
      svg.style.cursor = 'grab';
      svg.style.touchAction = 'pan-y';   // 单指仍要能滚页面，只截双指
    }

    /* —— 滚轮：锚在指针上。已回到 1× 还继续缩小，就放行让页面滚 —— */
    svg.addEventListener('wheel', function (e) {
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 100;
      if (!zoomAt(st, e.clientX, e.clientY, st.s * Math.exp(-d * 0.0018))) return;
      e.preventDefault();
    }, { passive: false });

    /* —— 鼠标拖动：普通图左键；3D 图 Alt+左键 / 中键（左键留给旋转）—— */
    var drag = null;
    svg.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      var ok = st.orbit ? (e.button === 1 || (e.button === 0 && e.altKey)) : e.button === 0;
      if (!ok) return;
      drag = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty };
      svg.style.cursor = 'grabbing';
      if (e.button === 1) e.preventDefault();          // 中键别触发浏览器的自动滚动
      if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (er) {} }
    });
    svg.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerType === 'touch') return;
      st.tx = drag.tx + (e.clientX - drag.x);
      st.ty = drag.ty + (e.clientY - drag.y);
      clampNav(st);
      applyNav(st);
    });
    var stop = function () {
      if (!drag) return;
      drag = null;
      if (!st.orbit) svg.style.cursor = 'grab';
    };
    svg.addEventListener('pointerup', stop);
    svg.addEventListener('pointercancel', stop);

    /* —— 双指：缩放 + 跟随中点平移。单指一律不管：留给页面滚动 / 3D 旋转 —— */
    var pinch = null;
    function pair(e) {
      var t = e.touches;
      if (!t || t.length < 2) return null;
      return {
        x: (t[0].clientX + t[1].clientX) / 2,
        y: (t[0].clientY + t[1].clientY) / 2,
        d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1
      };
    }
    svg.addEventListener('touchstart', function (e) {
      var p = pair(e);
      if (!p) return;
      e.preventDefault();                    // 别让浏览器自己 pinch-zoom 或滚页面
      var b = baseOf(st);
      pinch = { x: p.x, y: p.y, d: p.d, s: st.s, bx: b.x, by: b.y, tx: st.tx, ty: st.ty };
      drag = null;
      /* 3D 图的单指已经在旋转：派一个 cancel 让它收手，否则会边转边缩 */
      try { svg.dispatchEvent(new Event('pointercancel')); } catch (er) {}
    }, { passive: false });
    svg.addEventListener('touchmove', function (e) {
      if (!pinch) return;
      var p = pair(e);
      if (!p) return;
      e.preventDefault();
      var ns = Math.max(1, Math.min(MAX_SCALE, pinch.s * p.d / pinch.d));
      var ux = (pinch.x - pinch.bx - pinch.tx) / pinch.s;   // 双指中点对应的图内点
      var uy = (pinch.y - pinch.by - pinch.ty) / pinch.s;
      st.s = ns;
      st.tx = p.x - pinch.bx - ux * ns;
      st.ty = p.y - pinch.by - uy * ns;
      clampNav(st);
      applyNav(st);
    }, { passive: false });
    var unPinch = function (e) { if (!e.touches || e.touches.length < 2) pinch = null; };
    svg.addEventListener('touchend', unPinch);
    svg.addEventListener('touchcancel', unPinch);

    /* —— 双击复位。3D 图自己的双击会复位旋转，两个一起归位正好 —— */
    svg.addEventListener('dblclick', function () { resetNav(st); });
  }

  window.addEventListener('resize', function () {
    for (var i = 0; i < navs.length; i++) {
      fitNav(navs[i]);          // 视口变了，布局尺寸跟着变
      clampNav(navs[i]);
      applyNav(navs[i]);
    }
  });

  (function bindChip() {
    var c = zoomChip();
    if (!c) return;
    c.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      resetAllNav();
    });
  })();

  function render(d) {
    var fig = document.getElementById('fig');
    var box = document.getElementById('mv-err');
    fig.innerHTML = '';
    navs.length = 0;
    box.style.display = 'none';
    box.textContent = '';
    reported = false;

    /* 模型偶尔在代码块末尾留一行省略号占位，安全剥掉再执行 */
    var code = String(d.code || '').replace(/\r?\n\s*(?:\.\.\.|…)\s*$/, '');
    if (!code) { fail('代码块是空的'); return; }

    try {
      if (d.kind === 'svg') {
        fig.innerHTML = code;
      } else {
        (new Function(code))();
      }
      if (!fig.querySelector('svg')) {
        fail('图没有生成：请确认写了 document.getElementById("fig").appendChild(S.svg)'
          + '（V.svg / G.svg 同理），或直接输出一个完整的 <svg> 片段。');
        return;
      }
      var figures = fig.querySelectorAll('svg').length;
      for (var k = 0; k < figures; k++) attachNav(fig.querySelectorAll('svg')[k]);
      send('done', { height: measure(), figures: figures });
      /* svg 刚插进去时布局可能还没稳定，按最终尺寸再校准一次，避免下方留一大块空白。
         运行时（MK.eng）也会在这一帧里按内容重设 viewBox，所以导航缓存的尺寸要跟着刷新，
         否则平移边界还按旧画幅算。 */
      requestAnimationFrame(function () {
        for (var n = 0; n < navs.length; n++) {
          fitNav(navs[n]);
          clampNav(navs[n]);
          applyNav(navs[n]);
        }
        send('done', { height: measure(), figures: figures });
      });
    } catch (err) {
      /* 代码画到一半抛错时，已经画出来的那部分也要能缩放/平移 */
      var drawn = fig.querySelectorAll('svg');
      for (var j = 0; j < drawn.length; j++) attachNav(drawn[j]);
      fail(err);
    }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var d = e.data;
    if (!d || d.__mv !== true || d.id !== cardId) return;
    if (d.type === 'mv:render') render(d);
    if (d.type === 'mv:ping') send('pong');
    /* 导出：3D 图不用特殊处理 —— 拖拽时运行时已经把当前视角画进了 DOM，
       序列化下来的就是此刻屏幕上看到的样子。 */
    if (d.type === 'mv:export') {
      exportPNG(d.scale, function (err, dataUrl, w, h) {
        if (err) { send('export-error', { message: err }); return; }
        send('exported', { dataUrl: dataUrl, width: w, height: h });
      });
    }
  });

  window.addEventListener('error', function (e) {
    fail(e.message || '运行时错误');
  });

  lockDown();
  send('ready');
})();
