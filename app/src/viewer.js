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

  function render(d) {
    var fig = document.getElementById('fig');
    var box = document.getElementById('mv-err');
    fig.innerHTML = '';
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
      send('done', { height: measure(), figures: figures });
      /* svg 刚插进去时布局可能还没稳定，按最终尺寸再校准一次，避免下方留一大块空白 */
      requestAnimationFrame(function () { send('done', { height: measure(), figures: figures }); });
    } catch (err) {
      fail(err);
    }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var d = e.data;
    if (!d || d.__mv !== true || d.id !== cardId) return;
    if (d.type === 'mv:render') render(d);
    if (d.type === 'mv:ping') send('pong');
  });

  window.addEventListener('error', function (e) {
    fail(e.message || '运行时错误');
  });

  lockDown();
  send('ready');
})();
