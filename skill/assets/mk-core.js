(function (g) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  var R = {
    blue: ["#E6F1FB", "#B5D4F4", "#85B7EB", "#378ADD", "#185FA5", "#0C447C"],
    coral: ["#FAECE7", "#F5C4B3", "#F0997B", "#D85A30", "#993C1D", "#712B13"],
    teal: ["#E1F5EE", "#9FE1CB", "#5DCAA5", "#1D9E75", "#0F6E56", "#085041"],
    amber: ["#FAEEDA", "#FAC775", "#EF9F27", "#BA7517", "#854F0B", "#633806"],
    purple: ["#EEEDFE", "#CECBF6", "#AFA9EC", "#7F77DD", "#534AB7", "#3C3489"],
    red: ["#FCEBEB", "#F7C1C1", "#F09595", "#E24B4A", "#A32D2D", "#791F1F"],
    green: ["#EAF3DE", "#C0DD97", "#97C459", "#639922", "#3B6D11", "#27500A"],
    pink: ["#FBEAF0", "#F4C0D1", "#ED93B1", "#D4537E", "#993556", "#72243E"],
    gray: ["#F1EFE8", "#D3D1C7", "#B4B2A9", "#888780", "#5F5E5A", "#444441"]
  };

  function isDark() {
    try {
      var s = getComputedStyle(document.documentElement);
      var bg = s.getPropertyValue("--color-background-primary").trim();
      if (bg && bg.indexOf("oklch") < 0 && bg.indexOf("lab") < 0) {
        var m = bg.match(/[\d.]+/g);
        if (m && m.length >= 3) {
          return (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114) < 140;
        }
      }
      var mc = s.getPropertyValue("--color-text-primary").trim();
      if (mc && mc.indexOf("oklch") < 0) {
        var n = mc.match(/[\d.]+/g);
        if (n && n.length >= 3) {
          return (+n[0] * 0.299 + +n[1] * 0.587 + +n[2] * 0.114) > 150;
        }
      }
    } catch (e) {}
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  var D = isDark();

  function ink() { return D ? "#B4B2A9" : "#5F5E5A"; }
  function faint() { return D ? "#55534E" : "#D3D1C7"; }
  function bgFill() {
    try {
      var v = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-background-primary").trim();
      if (v) return v;
    } catch (e) {}
    return D ? "#1a1a19" : "#ffffff";
  }
  function accent(name) { var r = R[name] || R.blue; return D ? r[2] : r[4]; }
  function tint(name) { var r = R[name] || R.blue; return D ? r[5] : r[0]; }
  function strong(name) { var r = R[name] || R.blue; return D ? r[1] : r[5]; }

  function mk(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  function txt(parent, x, y, s, o) {
    o = o || {};
    var t = mk("text", {
      x: x, y: y,
      fill: o.fill || ink(),
      "font-size": o.size || 12,
      "font-family": o.mono ? "ui-monospace,SFMono-Regular,Menlo,monospace" : "var(--font-sans,system-ui,sans-serif)",
      "font-weight": o.weight || 400,
      "font-style": o.italic ? "italic" : null,
      "text-anchor": o.anchor || "start",
      "dominant-baseline": o.baseline || "auto"
    }, parent);
    if (o.serif) t.setAttribute("font-family", "var(--font-serif,Georgia,serif)");
    if (o.halo !== false) {
      t.setAttribute("paint-order", "stroke");
      t.setAttribute("stroke", o.haloColor || (D ? "#141413" : "#ffffff"));
      t.setAttribute("stroke-width", o.haloW || 3);
      t.setAttribute("stroke-linejoin", "round");
    }
    t.textContent = s;
    return t;
  }

  function tw(s, fs) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? fs : fs * 0.56;
    return w;
  }

  function niceStep(span, target) {
    var raw = Math.abs(span) / (target || 8);
    if (!isFinite(raw) || raw <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  function fmt(v, step) {
    if (Math.abs(v) < 1e-9) return "0";
    var dec = step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0;
    var s = Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3 ? v.toExponential(1) : v.toFixed(dec);
    return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k]; }
  function len(a) { return Math.hypot(a[0], a[1]); }
  function unit(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l]; }
  function perp(a) { return [-a[1], a[0]]; }

  function Frame(o) {
    o = o || {};
    var box = o.box || [40, 30, 600, 340];
    var bx = box[0], by = box[1], bw = box[2], bh = box[3];
    var xr = o.x || [-5, 5];
    var yr = o.y || [-3, 3];
    var sx = bw / (xr[1] - xr[0]);
    var sy = bh / (yr[1] - yr[0]);
    if (o.equal !== false) { var s0 = Math.min(sx, sy); sx = sy = s0; }
    var dw = (xr[1] - xr[0]) * sx;
    var dh = (yr[1] - yr[0]) * sy;
    var ox = bx + (bw - dw) / 2;
    var oy = by + (bh - dh) / 2;

    var W = o.w || 680;
    var H = o.h || Math.ceil(by + bh + 28);

    var svg = mk("svg", {
      viewBox: "0 0 " + W + " " + H,
      width: "100%",
      role: "img",
      xmlns: NS
    });
    svg.style.display = "block";
    svg.style.overflow = "visible";

    var title = mk("title", null, svg);
    title.textContent = o.title || "数学图形";
    var desc = mk("desc", null, svg);
    desc.textContent = o.desc || "";

    var defs = mk("defs", null, svg);
    var cid = "clip" + Math.random().toString(36).slice(2, 8);
    var cp = mk("clipPath", { id: cid }, defs);
    mk("rect", { x: ox, y: oy, width: dw, height: dh }, cp);

    var stage = mk("g", { "clip-path": "url(#" + cid + ")" }, svg);
    var top = mk("g", null, svg);

    function px(p) {
      return [ox + (p[0] - xr[0]) * sx, oy + dh - (p[1] - yr[0]) * sy];
    }
    function up(p) {
      return [xr[0] + (p[0] - ox) / sx, yr[0] + (dh - (p[1] - oy)) / sy];
    }

    var V = {
      svg: svg, g: stage, over: top, dark: D,
      xr: xr, yr: yr, px: px, up: up, sx: sx, sy: sy,
      box: { x: ox, y: oy, w: dw, h: dh },
      W: W, H: H,
      color: accent, tint: tint, strong: strong, ink: ink,
      _mk: mk, _txt: txt
    };

    V.grid = function (opt) {
      opt = opt || {};
      var c = opt.color || faint();
      var op = opt.opacity || (D ? 0.55 : 0.9);
      var stx = niceStep(xr[1] - xr[0], opt.nx || 10);
      var sty = niceStep(yr[1] - yr[0], opt.ny || 8);
      var gg = mk("g", { stroke: c, "stroke-width": 0.5, opacity: op }, stage);
      var i, x, y;
      for (x = Math.ceil(xr[0] / stx) * stx; x <= xr[1] + 1e-9; x += stx) {
        var p1 = px([x, yr[0]]), p2 = px([x, yr[1]]);
        mk("line", { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }, gg);
      }
      for (y = Math.ceil(yr[0] / sty) * sty; y <= yr[1] + 1e-9; y += sty) {
        var q1 = px([xr[0], y]), q2 = px([xr[1], y]);
        mk("line", { x1: q1[0], y1: q1[1], x2: q2[0], y2: q2[1] }, gg);
      }
      return V;
    };

    V.axes = function (opt) {
      opt = opt || {};
      var c = opt.color || ink();
      var g0 = mk("g", { stroke: c, "stroke-width": 1.2, fill: "none" }, top);
      var x0 = Math.min(Math.max(0, xr[0]), xr[1]);
      var y0 = Math.min(Math.max(0, yr[0]), yr[1]);
      var ax = px([xr[0], y0]), bx2 = px([xr[1], y0]);
      var ay = px([x0, yr[0]]), by2 = px([x0, yr[1]]);
      mk("line", { x1: ax[0], y1: ax[1], x2: bx2[0] - 6, y2: bx2[1] }, g0);
      mk("line", { x1: ay[0], y1: ay[1] + 6, x2: by2[0], y2: by2[1] }, g0);
      mk("path", {
        d: "M" + bx2[0] + " " + bx2[1] + "l-7 -3.2v6.4z",
        fill: c, stroke: "none"
      }, g0);
      mk("path", {
        d: "M" + by2[0] + " " + by2[1] + "l-3.2 7h6.4z",
        fill: c, stroke: "none"
      }, g0);

      var stx = niceStep(xr[1] - xr[0], opt.nx || 10);
      var sty = niceStep(yr[1] - yr[0], opt.ny || 8);
      var lab = mk("g", null, top);
      var x, y;
      var xEnd = xr[1], yEnd = yr[1];
      for (x = Math.ceil(xr[0] / stx) * stx; x <= xr[1] + 1e-9; x += stx) {
        if (Math.abs(x) < 1e-9) continue;
        if (Math.abs(x - xEnd) < Math.abs(stx) * 0.45) continue;
        var t1 = px([x, y0]);
        mk("line", { x1: t1[0], y1: t1[1] - 4, x2: t1[0], y2: t1[1] + 4, stroke: c, "stroke-width": 1.2 }, top);
        txt(lab, t1[0], t1[1] + 17, fmt(x, stx), { size: 11, fill: ink(), anchor: "middle" });
      }
      for (y = Math.ceil(yr[0] / sty) * sty; y <= yr[1] + 1e-9; y += sty) {
        if (Math.abs(y) < 1e-9) continue;
        if (Math.abs(y - yEnd) < Math.abs(sty) * 0.45) continue;
        var t2 = px([x0, y]);
        mk("line", { x1: t2[0] - 4, y1: t2[1], x2: t2[0] + 4, y2: t2[1], stroke: c, "stroke-width": 1.2 }, top);
        txt(lab, t2[0] - 8, t2[1] + 4, fmt(y, sty), { size: 11, fill: ink(), anchor: "end" });
      }
      if (xr[0] <= 0 && xr[1] >= 0 && yr[0] <= 0 && yr[1] >= 0) {
        var o0 = px([0, 0]);
        txt(lab, o0[0] - 7, o0[1] + 15, "O", { size: 12, fill: ink(), anchor: "end" });
      }
      var xl = px([xr[1], y0]);
      txt(lab, xl[0] + 2, xl[1] + 19, opt.xlabel || "x", { size: 13, fill: ink(), italic: true, anchor: "end", serif: true });
      var yl = px([x0, yr[1]]);
      txt(lab, yl[0] + 7, yl[1] - 8, opt.ylabel || "y", { size: 13, fill: ink(), italic: true, serif: true });
      return V;
    };

    V.sample = function (f, a, b, n, jump) {
      n = n || 420;
      var out = [], prev = null;
      var lim = jump || Math.min(dh * 1.6, dh);
      for (var i = 0; i <= n; i++) {
        var x = a + (b - a) * i / n;
        var y = f(x);
        if (typeof y !== "number" || !isFinite(y)) { prev = null; out.push(null); continue; }
        var cy = Math.max(yr[0] - (yr[1] - yr[0]), Math.min(yr[1] + (yr[1] - yr[0]), y));
        var p = px([x, cy]);
        if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > lim) { prev = null; out.push(null); continue; }
        out.push(p);
        prev = p;
      }
      return out;
    };

    function pathOf(pts) {
      var d = "", pen = false;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (!p) { pen = false; continue; }
        d += (pen ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2);
        pen = true;
      }
      return d;
    }

    /* 模型常把函数参数写成字符串（如 V.plot('sin(x)')），提前拦下给可读提示 */
    function needFn(f, name) {
      if (typeof f !== "function") {
        throw new Error(name + " 的第一个参数必须是函数，例如 function(x){ return Math.sin(x); }，"
          + "不能直接写表达式字符串");
      }
      return f;
    }

    V.plot = function (f, opt) {
      opt = opt || {};
      needFn(f, "V.plot");
      var a = opt.from !== undefined ? opt.from : xr[0];
      var b = opt.to !== undefined ? opt.to : xr[1];
      var pts = V.sample(f, a, b, opt.n || 420, opt.jump);
      var c = opt.color ? accent(opt.color) : accent("blue");
      var p = mk("path", {
        d: pathOf(pts), fill: "none", stroke: c,
        "stroke-width": opt.w || 1.8,
        "stroke-linecap": "round", "stroke-linejoin": "round",
        "stroke-dasharray": opt.dash ? (opt.dash === true ? "5 4" : opt.dash) : null,
        opacity: opt.opacity || 1
      }, stage);
      if (opt.label) {
        var last = null;
        for (var k = pts.length - 1; k >= 0; k--) if (pts[k]) { last = pts[k]; break; }
        if (last) V.tag(last, opt.label, { color: opt.color, dx: opt.dx, dy: opt.dy });
      }
      return p;
    };

    V.curve = function (pts, opt) {
      opt = opt || {};
      var c = opt.color ? accent(opt.color) : accent("blue");
      return mk("path", {
        d: pathOf(pts), fill: opt.fill ? (opt.fillColor || tint(opt.color || "blue")) : "none",
        stroke: c, "stroke-width": opt.w || 1.8,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": opt.dash ? "5 4" : null
      }, stage);
    };

    V.param = function (fn, opt) {
      opt = opt || {};
      needFn(fn, "V.param");
      var t0 = opt.t0 || 0, t1 = opt.t1 === undefined ? Math.PI * 2 : opt.t1;
      var n = opt.n || 480, pts = [];
      for (var i = 0; i <= n; i++) {
        var t = t0 + (t1 - t0) * i / n;
        var v = fn(t);
        if (!v) { pts.push(null); continue; }
        var x = v[0] !== undefined ? v[0] : v.x;
        var y = v[1] !== undefined ? v[1] : v.y;
        if (!isFinite(x) || !isFinite(y)) { pts.push(null); continue; }
        pts.push(px([x, y]));
      }
      var c = opt.color ? accent(opt.color) : accent("blue");
      return mk("path", {
        d: pathOf(pts), fill: "none", stroke: c,
        "stroke-width": opt.w || 1.8, "stroke-linecap": "round",
        "stroke-dasharray": opt.dash ? "5 4" : null
      }, stage);
    };

    V.polar = function (r, opt) {
      opt = opt || {};
      needFn(r, "V.polar");
      return V.param(function (t) {
        var rr = r(t);
        return [rr * Math.cos(t), rr * Math.sin(t)];
      }, opt);
    };

    V.seg = function (a, b, opt) {
      opt = opt || {};
      var p1 = px(a), p2 = px(b);
      return mk("line", {
        x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
        stroke: opt.color ? accent(opt.color) : ink(),
        "stroke-width": opt.w || 1.5,
        "stroke-dasharray": opt.dash ? (opt.dash === true ? "5 4" : opt.dash) : null,
        "stroke-linecap": "round", opacity: opt.opacity || 1
      }, stage);
    };

    V.arrow = function (a, b, opt) {
      opt = opt || {};
      var c = opt.color ? accent(opt.color) : accent("blue");
      var p1 = px(a), p2 = px(b);
      var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      var L = Math.hypot(dx, dy) || 1;
      var ux = dx / L, uy = dy / L;
      var hs = opt.head || 9;
      var ex = p2[0] - ux * (hs - 1), ey = p2[1] - uy * (hs - 1);
      mk("line", {
        x1: p1[0], y1: p1[1], x2: ex, y2: ey, stroke: c,
        "stroke-width": opt.w || 1.8, "stroke-linecap": "round",
        "stroke-dasharray": opt.dash ? "5 4" : null
      }, stage);
      var nx = -uy, ny = ux;
      mk("path", {
        d: "M" + p2[0] + " " + p2[1] +
          "L" + (p2[0] - ux * hs + nx * hs * 0.42) + " " + (p2[1] - uy * hs + ny * hs * 0.42) +
          "L" + (p2[0] - ux * hs - nx * hs * 0.42) + " " + (p2[1] - uy * hs - ny * hs * 0.42) + "Z",
        fill: c, stroke: "none"
      }, stage);
      if (opt.label) {
        var mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
        var ox2 = opt.lx !== undefined ? opt.lx : nx * 12;
        var oy2 = opt.ly !== undefined ? opt.ly : ny * 12;
        txt(top, mx + ox2, my + oy2 + 4, opt.label, {
          size: opt.size || 13, fill: c, anchor: "middle", italic: true, serif: true
        });
      }
      return p2;
    };

    V.dot = function (p, opt) {
      opt = opt || {};
      var q = px(p);
      var c = opt.color ? accent(opt.color) : accent("blue");
      mk("circle", { cx: q[0], cy: q[1], r: opt.r || 4, fill: c, stroke: tint("gray"), "stroke-width": 1.5 }, top);
      if (opt.label) {
        txt(top, q[0] + (opt.dx === undefined ? 8 : opt.dx), q[1] + (opt.dy === undefined ? -8 : opt.dy),
          opt.label, {
            size: opt.size || 13, fill: strong(opt.color || "blue"),
            anchor: opt.anchor || "start", italic: opt.italic !== false, serif: true
          });
      }
      return q;
    };

    V.label = function (p, s, opt) {
      opt = opt || {};
      var q = px(p);
      return txt(top, q[0] + (opt.dx || 0), q[1] + (opt.dy || 0), s, {
        size: opt.size || 12, fill: opt.color ? strong(opt.color) : ink(),
        anchor: opt.anchor || "start", italic: opt.italic, mono: opt.mono
      });
    };

    V.tag = function (q, s, opt) {
      opt = opt || {};
      var c = opt.color ? accent(opt.color) : accent("blue");
      return txt(top, q[0] + (opt.dx === undefined ? 6 : opt.dx), q[1] + (opt.dy === undefined ? -8 : opt.dy), s, {
        size: opt.size || 12, fill: c, anchor: opt.anchor || "start"
      });
    };

    V.poly = function (pts, opt) {
      opt = opt || {};
      var q = pts.map(px);
      var c = opt.color ? accent(opt.color) : accent("blue");
      var e = mk("path", {
        d: "M" + q.map(function (p) { return p[0].toFixed(2) + " " + p[1].toFixed(2); }).join("L") + "Z",
        fill: opt.fill === false ? "none" : (opt.fillColor || tint(opt.color || "blue")),
        opacity: opt.opacity === undefined ? (opt.fill === false ? 1 : 0.55) : opt.opacity,
        stroke: c, "stroke-width": opt.w || 1.5,
        "stroke-linejoin": "round",
        "stroke-dasharray": opt.dash ? "5 4" : null
      }, stage);
      return e;
    };

    V.circle = function (c0, r, opt) {
      opt = opt || {};
      var q = px(c0);
      return mk("circle", {
        cx: q[0], cy: q[1], r: r * sx,
        fill: opt.fill ? (opt.fillColor || tint(opt.color || "blue")) : "none",
        "fill-opacity": opt.fill ? 0.4 : 0,
        stroke: opt.color ? accent(opt.color) : ink(),
        "stroke-width": opt.w || 1.5,
        "stroke-dasharray": opt.dash ? "5 4" : null
      }, stage);
    };

    V.arc = function (c0, r, a1, a2, opt) {
      opt = opt || {};
      var n = 60, pts = [];
      var dd = a2 - a1;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      for (var i = 0; i <= n; i++) {
        var t = a1 + dd * i / n;
        pts.push([c0[0] + r * Math.cos(t), c0[1] + r * Math.sin(t)]);
      }
      return V.curve(pts, opt);
    };

    V.angle = function (v, p1, p2, opt) {
      opt = opt || {};
      var r = (opt.r || 26) / sx;
      var A = sub(p1, v), B = sub(p2, v);
      var a1 = Math.atan2(A[1], A[0]), a2 = Math.atan2(B[1], B[0]);
      var dd = a2 - a1;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      var n = Math.max(8, Math.round(Math.abs(dd) / 0.08)), pts = [];
      for (var i = 0; i <= n; i++) {
        var t = a1 + dd * i / n;
        pts.push([v[0] + r * Math.cos(t), v[1] + r * Math.sin(t)]);
      }
      var c = opt.color ? accent(opt.color) : accent("teal");
      V.curve(pts, { color: opt.color || "teal", w: opt.w || 1.2 });
      if (opt.label !== false) {
        var am = a1 + dd / 2;
        var lr = r + (opt.lr || 16) / sx;
        var lp = px([v[0] + lr * Math.cos(am), v[1] + lr * Math.sin(am)]);
        txt(top, lp[0], lp[1] + 4, opt.label || (Math.abs(dd) * 180 / Math.PI).toFixed(0) + "°", {
          size: opt.size || 11, fill: c, anchor: "middle"
        });
      }
      return V;
    };

    V.rightAngle = function (v, p1, p2, opt) {
      opt = opt || {};
      var s = (opt.size || 11) / sx;
      var A = mul(unit(sub(p1, v)), s), B = mul(unit(sub(p2, v)), s);
      var q1 = px(add(v, A)), q2 = px(add(add(v, A), B)), q3 = px(add(v, B));
      mk("path", {
        d: "M" + q1[0] + " " + q1[1] + "L" + q2[0] + " " + q2[1] + "L" + q3[0] + " " + q3[1],
        fill: "none", stroke: opt.color ? accent(opt.color) : accent("coral"),
        "stroke-width": 1.2
      }, stage);
      return V;
    };

    V.mark = function (a, b, n, opt) {
      opt = opt || {};
      n = n || 1;
      var A = px(a), B = px(b);
      var d = sub(B, A), L = len(d) || 1, u = unit(d), p = perp(u);
      var s = opt.size || 5;
      for (var i = 0; i < n; i++) {
        var t = 0.5 + (i - (n - 1) / 2) * 0.055;
        var m = [A[0] + d[0] * t, A[1] + d[1] * t];
        mk("line", {
          x1: m[0] - p[0] * s - u[0] * 2, y1: m[1] - p[1] * s - u[1] * 2,
          x2: m[0] + p[0] * s + u[0] * 2, y2: m[1] + p[1] * s + u[1] * 2,
          stroke: opt.color ? accent(opt.color) : accent("coral"), "stroke-width": 1.4
        }, stage);
      }
      return V;
    };

    V.area = function (f, a, b, opt) {
      opt = opt || {};
      needFn(f, "V.area");
      var pts = V.sample(f, a, b, opt.n || 300);
      var base = px([0, 0])[1];
      var d = "", pen = false, first = null, last = null;
      for (var i = 0; i < pts.length; i++) {
        if (!pts[i]) continue;
        if (!pen) { d += "M" + pts[i][0].toFixed(1) + " " + base.toFixed(1); first = pts[i]; pen = true; }
        d += "L" + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1);
        last = pts[i];
      }
      if (last) d += "L" + last[0].toFixed(1) + " " + base.toFixed(1) + "Z";
      return mk("path", {
        d: d, fill: opt.fillColor || tint(opt.color || "blue"),
        opacity: opt.opacity || 0.5, stroke: "none"
      }, stage);
    };

    V.rect = function (p, w, h, opt) {
      opt = opt || {};
      var q = px(p);
      return mk("rect", {
        x: q[0], y: q[1] - h * sy, width: w * sx, height: h * sy,
        fill: opt.fill === false ? "none" : (opt.fillColor || tint(opt.color || "teal")),
        opacity: opt.opacity === undefined ? 0.5 : opt.opacity,
        stroke: opt.color ? accent(opt.color) : accent("teal"),
        "stroke-width": 1.2, "stroke-dasharray": opt.dash ? "5 4" : null
      }, stage);
    };

    V.legend = function (items, opt) {
      opt = opt || {};
      var x = opt.x || (ox + 8), y = opt.y || (oy + 14);
      var gap = 17;
      /* 容错：模型可能传字符串数组 ['sin x','泰勒']、用 label 代替 text、或混入缺文字的项，别崩 */
      var norm = [];
      if (items && typeof items.length === "number") {
        for (var j = 0; j < items.length; j++) {
          var raw = items[j];
          if (typeof raw === "string") raw = { text: raw };
          var t = raw && raw.text !== undefined ? raw.text : (raw && raw.label);
          if (t !== undefined) norm.push({ text: t, color: raw.color, dash: raw.dash });
        }
      }
      if (!norm.length) norm.push({ text: "", color: "" });
      var maxw = 0;
      for (var j2 = 0; j2 < norm.length; j2++) maxw = Math.max(maxw, tw(String(norm[j2].text), 11));
      var lg = mk("g", null, top);
      if (opt.bg !== false) {
        mk("rect", {
          x: x - 8, y: y - 14, width: maxw + 54, height: norm.length * gap + 8,
          rx: 5, fill: opt.bgColor || bgFill(), opacity: 0.9,
          stroke: faint(), "stroke-width": 0.5
        }, lg);
      }
      for (var i = 0; i < norm.length; i++) {
        var it = norm[i];
        var yy = y + i * gap;
        mk("line", {
          x1: x, y1: yy - 4, x2: x + 18, y2: yy - 4,
          stroke: it.color ? accent(it.color) : ink(), "stroke-width": 2,
          "stroke-dasharray": it.dash ? "5 4" : null
        }, lg);
        txt(lg, x + 24, yy, String(it.text), { size: 11, fill: ink(), halo: false });
      }
      return V;
    };

    if (o.grid) V.grid(o.gridOpt);
    if (o.axes) V.axes(o.axesOpt);

    return V;
  }

  g.MK = {
    frame: Frame,
    mk: mk,
    txt: txt,
    textWidth: tw,
    niceStep: niceStep,
    fmt: fmt,
    accent: accent,
    tint: tint,
    strong: strong,
    ink: ink,
    dark: D,
    v: { sub: sub, add: add, mul: mul, len: len, unit: unit, perp: perp },
    palette: R
  };
})(window);
