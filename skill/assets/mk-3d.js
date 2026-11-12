(function (g) {
  "use strict";

  var MK = g.MK;
  if (!MK) throw new Error("mk-core.js must load before mk-3d.js");
  var mk = MK.mk;

  function space(o) {
    o = o || {};
    var box = o.box || [40, 26, 600, 320];
    var bx = box[0], by = box[1], bw = box[2], bh = box[3];
    var yaw = (o.yaw === undefined ? -30 : o.yaw) * Math.PI / 180;
    var pitch = (o.pitch === undefined ? 20 : o.pitch) * Math.PI / 180;
    var range = o.range || 3;
    var zoom = o.zoom || 1;
    var scale = Math.min(bw, bh) / (range * 2.05) * zoom;
    var cx = bx + bw / 2;
    var cy = by + bh / 2;
    var H = o.h || Math.ceil(by + bh + 26);
    var cen = o.center || [0, 0, 0];

    var svg = mk("svg", {
      viewBox: "0 0 " + (o.w || 680) + " " + H,
      width: "100%", role: "img", xmlns: "http://www.w3.org/2000/svg"
    });
    svg.style.display = "block";
    /* 告诉查看器：这张图的「拖动」已经用于旋转，平移请走 Alt+拖动 / 中键 */
    svg.setAttribute("data-mv-orbit", "1");
    var ti = mk("title", null, svg);
    ti.textContent = o.title || "立体图形";
    mk("desc", null, svg).textContent = o.desc || "";

    var stage = mk("g", null, svg);
    var overlay = mk("g", null, svg);
    var infoG = mk("g", null, svg);

    var S = {
      svg: svg, g: stage, over: overlay, W: o.w || 680, H: H,
      color: MK.accent, tint: MK.tint, strong: MK.strong, ink: MK.ink,
      dark: MK.dark
    };

    /* —— 交互状态：重放式重绘。拖拽旋转与点选高亮都不需要模型提供 redraw —— */
    var ops = [];            // 绘制操作队列，redraw 时按序重放
    var replaying = false;   // 重放期间不再入队（solid 内部会调 line）
    var pickSeq = 0;         // 可拾取图元 id（调用时分配，重放保持稳定）
    var highlight = null;    // 当前选中的拾取 id
    var infoText = "";       // 底部信息栏文字
    var pickCb = null;       // S.onPick 注册的回调
    var userRedraw = null;   // 兼容旧式 S.drag(draw)
    var initYaw = yaw, initPitch = pitch;

    function rec(fn) {
      if (replaying) { fn(); return; }
      ops.push(fn); fn();
    }

    function drawInfo() {
      while (infoG.firstChild) infoG.removeChild(infoG.firstChild);
      if (!infoText) return;
      var W = o.w || 680;
      var tw = Math.min(MK.textWidth(infoText, 12) + 20, W - 24);
      mk("rect", {
        x: 10, y: H - 30, width: tw, height: 22, rx: 6,
        fill: MK.dark ? "#45423A" : "#33312B", "fill-opacity": 0.9, stroke: "none"
      }, infoG);
      MK.txt(infoG, 20, H - 15, infoText, { size: 12, fill: "#F5F3EC" });
    }

    S.redraw = function () {
      replaying = true;
      try {
        while (stage.firstChild) stage.removeChild(stage.firstChild);
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
        for (var i = 0; i < ops.length; i++) ops[i]();
      } finally { replaying = false; }
      drawInfo();
      return S;
    };

    function rot(p) {
      var q0 = p[0] - cen[0], q1 = p[1] - cen[1], q2 = p[2] - cen[2];
      var cyw = Math.cos(yaw), syw = Math.sin(yaw);
      var X = q0 * cyw - q1 * syw;
      var Y = q0 * syw + q1 * cyw;
      return [X, Y, q2];
    }

    function proj(p) {
      var r = rot(p);
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      return [cx + r[0] * scale, cy + (-r[1] * sp - r[2] * cp) * scale];
    }

    function depth(p) {
      var r = rot(p);
      return r[1] * Math.cos(pitch) + r[2] * Math.sin(pitch);
    }

    function camDir() {
      return [
        Math.sin(yaw) * Math.cos(pitch),
        Math.cos(yaw) * Math.cos(pitch),
        Math.sin(pitch)
      ];
    }

    S.p = proj;
    S.d = depth;
    S.scale = scale;
    S.yaw = function () { return yaw; };
    S.pitch = function () { return pitch; };

    S.clear = function () {
      ops = [];
      highlight = null; infoText = "";
      while (stage.firstChild) stage.removeChild(stage.firstChild);
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
      while (infoG.firstChild) infoG.removeChild(infoG.firstChild);
      return S;
    };

    /* 原始画线：S.line 的 rec 包装与 solid 内部共用，避免重放时边被画两遍 */
    function lineRaw(a, b, opt) {
      opt = opt || {};
      var p1 = proj(a), p2 = proj(b);
      mk("line", {
        x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
        stroke: opt.color ? MK.accent(opt.color) : MK.ink(),
        "stroke-width": opt.w || 1.4,
        "stroke-dasharray": opt.dash ? (opt.dash === true ? "5 4" : opt.dash) : null,
        "stroke-linecap": "round", opacity: opt.opacity || 1
      }, stage);
    }

    S.line = function (a, b, opt) {
      rec(function () { lineRaw(a, b, opt); });
      return S;
    };

    S.arrow = function (a, b, opt) {
      opt = opt || {};
      rec(function () {
        var c = opt.color ? MK.accent(opt.color) : MK.ink();
        var p1 = proj(a), p2 = proj(b);
        var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        var L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        var hs = opt.head || 9;
        mk("line", {
          x1: p1[0], y1: p1[1], x2: p2[0] - ux * (hs - 1), y2: p2[1] - uy * (hs - 1),
          stroke: c, "stroke-width": opt.w || 1.7, "stroke-linecap": "round"
        }, stage);
        var nx = -uy, ny = ux;
        mk("path", {
          d: "M" + p2[0] + " " + p2[1] +
            "L" + (p2[0] - ux * hs + nx * hs * 0.4) + " " + (p2[1] - uy * hs + ny * hs * 0.4) +
            "L" + (p2[0] - ux * hs - nx * hs * 0.4) + " " + (p2[1] - uy * hs - ny * hs * 0.4) + "Z",
          fill: c, stroke: "none"
        }, stage);
        if (opt.label) {
          var m = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
          MK.txt(overlay, m[0] + nx * 13, m[1] + ny * 13 + 4, opt.label, {
            size: 13, fill: c, anchor: "middle", italic: true, serif: true
          });
        }
      });
      return S;
    };

    S.axes = function (opt) {
      opt = opt || {};
      rec(function () {
        var L = opt.len || 1.0;
        var c = MK.ink();
        var o = [0, 0, 0];
        var dirs = [[L, 0, 0], [0, L, 0], [0, 0, L]];
        var names = opt.labels || ["x", "y", "z"];
        var cols = opt.colors || ["gray", "gray", "gray"];
        for (var i = 0; i < 3; i++) {
          var e = dirs[i];
          var p1 = proj(o), p2 = proj(e);
          var cc = opt.muted ? c : MK.accent(cols[i]);
          mk("line", {
            x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
            stroke: cc, "stroke-width": 1.2
          }, stage);
          var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
          var Lp = Math.hypot(dx, dy) || 1, ux = dx / Lp, uy = dy / Lp;
          var hs = 8;
          mk("path", {
            d: "M" + (p2[0] + ux * 3) + " " + (p2[1] + uy * 3) +
              "L" + (p2[0] - ux * hs + uy * hs * 0.4) + " " + (p2[1] - uy * hs - ux * hs * 0.4) +
              "L" + (p2[0] - ux * hs - uy * hs * 0.4) + " " + (p2[1] - uy * hs + ux * hs * 0.4) + "Z",
            fill: cc, stroke: "none"
          }, stage);
          MK.txt(overlay, p2[0] + ux * 13 + 4, p2[1] + uy * 13 + 4, names[i], {
            size: 13, fill: cc, italic: true, serif: true, anchor: "middle"
          });
        }
      });
      return S;
    };

    S.point = function (p, opt) {
      opt = opt || {};
      var q0 = null;
      rec(function () {
        var q = proj(p);
        q0 = q;
        var c = opt.color ? MK.accent(opt.color) : MK.accent("blue");
        mk("circle", { cx: q[0], cy: q[1], r: opt.r || 3.6, fill: c, stroke: MK.tint("gray"), "stroke-width": 1.4 }, overlay);
        if (opt.label) {
          MK.txt(overlay, q[0] + (opt.dx === undefined ? 8 : opt.dx), q[1] + (opt.dy === undefined ? -7 : opt.dy),
            opt.label, {
              size: opt.size || 13, fill: MK.strong(opt.color || "blue"),
              italic: opt.italic !== false, serif: true, anchor: opt.anchor || "start"
            });
        }
      });
      return q0 || proj(p);
    };

    S.label = function (p, s, opt) {
      opt = opt || {};
      rec(function () {
        var q = proj(p);
        MK.txt(overlay, q[0] + (opt.dx || 0), q[1] + (opt.dy || 0), s, {
          size: opt.size || 12, fill: opt.color ? MK.strong(opt.color) : MK.ink(),
          anchor: opt.anchor || "start", italic: opt.italic, serif: opt.serif
        });
      });
      return S;
    };

    function polyPath(pts, close) {
      var q = pts.map(proj);
      return (close ? "M" : "M") + q.map(function (p) {
        return p[0].toFixed(2) + " " + p[1].toFixed(2);
      }).join("L") + (close ? "Z" : "");
    }

    S.face = function (pts, opt) {
      opt = opt || {};
      /* 带 info 的面可点击：高亮 + 底部信息栏（调用时分配 id，重放保持稳定） */
      var pid = opt.info ? "f" + (++pickSeq) : null;
      rec(function () {
        var hl = pid !== null && highlight === pid;
        var c = opt.color ? MK.accent(opt.color) : MK.accent("blue");
        var el = mk("path", {
          d: polyPath(pts, true),
          fill: opt.fillColor || MK.tint(opt.color || "blue"),
          "fill-opacity": hl ? Math.min(0.85, (opt.opacity === undefined ? 0.42 : opt.opacity) + 0.32) : (opt.opacity === undefined ? 0.42 : opt.opacity),
          stroke: hl ? MK.strong(opt.color || "blue") : (opt.stroke === false ? "none" : c),
          "stroke-width": hl ? 2.6 : (opt.w || 1.2),
          "stroke-dasharray": opt.dash ? "5 4" : null,
          "stroke-linejoin": "round"
        }, stage);
        if (pid !== null) {
          el.style.cursor = "pointer";
          el.__mvPick = { id: pid, info: opt.info };
        }
      });
      return S;
    };

    /* 原始画折线：S.polyline 的 rec 包装与 angle 内部共用 */
    function polyRaw(pts, opt) {
      opt = opt || {};
      var c = opt.color ? MK.accent(opt.color) : MK.ink();
      mk("path", {
        d: polyPath(pts, opt.close),
        fill: "none", stroke: c, "stroke-width": opt.w || 1.4,
        "stroke-dasharray": opt.dash ? "5 4" : null,
        "stroke-linecap": "round", "stroke-linejoin": "round"
      }, stage);
    }

    S.polyline = function (pts, opt) {
      rec(function () { polyRaw(pts, opt); });
      return S;
    };

    function newell(pts) {
      var n = [0, 0, 0];
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      return n;
    }

    S.solid = function (verts, faces, opt) {
      opt = opt || {};
      /* opt.faceInfo: 与 faces 对齐的数组，或 opt.info 统一说明——可见面可点击高亮 */
      var sid = (opt.faceInfo || opt.info) ? "s" + (++pickSeq) : null;
      rec(function () {
        var cd = camDir();
        var faceVisible = [], i, j;
        for (i = 0; i < faces.length; i++) {
          var f = faces[i];
          var pts = f.map(function (k) { return verts[k]; });
          var n = newell(pts);
          var dot = n[0] * cd[0] + n[1] * cd[1] + n[2] * cd[2];
          faceVisible.push(dot > 0);
        }

        var order = faces.map(function (f2, idx) {
          var c0 = [0, 0, 0];
          f2.forEach(function (vi) {
            c0[0] += verts[vi][0] / f2.length;
            c0[1] += verts[vi][1] / f2.length;
            c0[2] += verts[vi][2] / f2.length;
          });
          return { idx: idx, d: depth(c0) };
        }).sort(function (a, b) { return a.d - b.d; });

        for (i = 0; i < order.length; i++) {
          var fi = order[i].idx;
          var fp = faces[fi].map(function (vi) { return verts[vi]; });
          var hl = sid !== null && highlight === sid + "#" + fi;
          var pel = mk("path", {
            d: polyPath(fp, true),
            fill: opt.fillColor || MK.tint(opt.color || "blue"),
            "fill-opacity": hl ? 0.62 : (opt.opacity === undefined ? 0.3 : opt.opacity),
            stroke: hl ? MK.strong(opt.color || "blue") : "none",
            "stroke-width": hl ? 2.4 : 0
          }, stage);
          if (sid !== null && faceVisible[fi]) {
            pel.style.cursor = "pointer";
            pel.__mvPick = {
              id: sid + "#" + fi,
              info: opt.faceInfo ? (opt.faceInfo[fi] || opt.info || ("面 " + (fi + 1))) : (opt.info || ("面 " + (fi + 1)))
            };
          }
        }

        var em = {}, hm = {};
        for (i = 0; i < faces.length; i++) {
          var fa = faces[i];
          for (j = 0; j < fa.length; j++) {
            var a = fa[j], b = fa[(j + 1) % fa.length];
            var key = Math.min(a, b) + "_" + Math.max(a, b);
            var recE = { a: Math.min(a, b), b: Math.max(a, b) };
            if (faceVisible[i]) em[key] = recE;
            else if (!em[key]) hm[key] = recE;
          }
        }

        if (opt.autoHide !== false) {
          for (var hk in hm) {
            if (em[hk]) continue;
            lineRaw(verts[hm[hk].a], verts[hm[hk].b], {
              color: opt.hideColor || "gray",
              dash: true, w: 1.1, opacity: 0.9
            });
          }
        } else {
          for (var hk2 in hm) if (!em[hk2]) em[hk2] = hm[hk2];
        }

        for (var k3 in em) {
          var e3 = em[k3];
          lineRaw(verts[e3.a], verts[e3.b], {
            color: opt.color || "blue", w: opt.w || 1.5
          });
        }
      });
      return S;
    };

    S.box = function (mn, mx, opt) {
      var x0 = Math.min(mn[0], mx[0]), x1 = Math.max(mn[0], mx[0]);
      var y0 = Math.min(mn[1], mx[1]), y1 = Math.max(mn[1], mx[1]);
      var z0 = Math.min(mn[2], mx[2]), z1 = Math.max(mn[2], mx[2]);
      var v = [
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
      ];
      var f = [
        [0, 3, 2, 1], [4, 5, 6, 7],
        [0, 1, 5, 4], [2, 3, 7, 6],
        [0, 4, 7, 3], [1, 2, 6, 5]
      ];
      return S.solid(v, f, opt);
    };

    S.prism = function (base, h, opt) {
      var n = base.length, v = [], i;
      for (i = 0; i < n; i++) v.push([base[i][0], base[i][1], 0]);
      for (i = 0; i < n; i++) v.push([base[i][0], base[i][1], h]);
      var bot = [];
      for (i = n - 1; i >= 0; i--) bot.push(i);
      var top = [];
      for (i = 0; i < n; i++) top.push(i + n);
      var sides = [];
      for (i = 0; i < n; i++) sides.push([i, (i + 1) % n, (i + 1) % n + n, i + n]);
      return S.solid(v, sides.concat([bot, top]), opt);
    };

    S.pyramid = function (base, apex, opt) {
      var n = base.length, v = base.map(function (p) { return [p[0], p[1], 0]; });
      v.push(apex);
      var bot = [];
      for (var i = n - 1; i >= 0; i--) bot.push(i);
      var sides = [];
      for (i = 0; i < n; i++) sides.push([i, (i + 1) % n, n]);
      return S.solid(v, sides.concat([bot]), opt);
    };

    S.plane = function (o0, u, v, opt) {
      opt = opt || {};
      var a = o0, b = [o0[0] + u[0], o0[1] + u[1], o0[2] + u[2]];
      var c = [b[0] + v[0], b[1] + v[1], b[2] + v[2]];
      var d = [o0[0] + v[0], o0[1] + v[1], o0[2] + v[2]];
      return S.face([a, b, c, d], opt);
    };

    S.sphere = function (c0, r, opt) {
      opt = opt || {};
      var pid = opt.info ? "p" + (++pickSeq) : null;
      rec(function () {
        var hl = pid !== null && highlight === pid;
        var c = opt.color ? MK.accent(opt.color) : MK.accent("teal");
        var q = proj(c0);
        var cel = mk("circle", {
          cx: q[0], cy: q[1], r: r * scale,
          fill: MK.tint(opt.color || "teal"), "fill-opacity": hl ? 0.55 : 0.3,
          stroke: hl ? MK.strong(opt.color || "teal") : c, "stroke-width": hl ? 2.6 : 1.4
        }, stage);
        if (pid !== null) { cel.style.cursor = "pointer"; cel.__mvPick = { id: pid, info: opt.info }; }
        var rings = opt.rings || 1;
        for (var k = 0; k < rings; k++) {
          var zz = c0[2] + (k === 0 ? 0 : r * 0.5);
          var rr = Math.sqrt(Math.max(0, r * r - (zz - c0[2]) * (zz - c0[2])));
          var pts = [];
          for (var i = 0; i <= 72; i++) {
            var t = i / 72 * Math.PI * 2;
            pts.push([c0[0] + rr * Math.cos(t), c0[1] + rr * Math.sin(t), zz]);
          }
          mk("path", {
            d: polyPath(pts, false), fill: "none", stroke: c,
            "stroke-width": 1, "stroke-dasharray": k === 0 ? null : "4 3", opacity: 0.8
          }, stage);
        }
        if (opt.meridian !== false) {
          var mp = [];
          for (var j = 0; j <= 72; j++) {
            var th = j / 72 * Math.PI * 2;
            mp.push([c0[0], c0[1] + r * Math.cos(th), c0[2] + r * Math.sin(th)]);
          }
          mk("path", {
            d: polyPath(mp, false), fill: "none", stroke: c,
            "stroke-width": 1, "stroke-dasharray": "4 3", opacity: 0.7
          }, stage);
        }
      });
      return S;
    };

    S.cylinder = function (c0, r, h, opt) {
      opt = opt || {};
      rec(function () {
        var c = opt.color ? MK.accent(opt.color) : MK.accent("teal");
        var i, t, pts;
        for (var k = 0; k < 2; k++) {
          pts = [];
          var zz = c0[2] + k * h;
          for (i = 0; i <= 72; i++) {
            t = i / 72 * Math.PI * 2;
            pts.push([c0[0] + r * Math.cos(t), c0[1] + r * Math.sin(t), zz]);
          }
          mk("path", {
            d: polyPath(pts, true), fill: "none", stroke: c, "stroke-width": 1.4,
            "stroke-dasharray": k === 0 ? "5 4" : null
          }, stage);
        }
        var p1 = proj([c0[0] + r * Math.cos(yaw - Math.PI / 2), c0[1] + r * Math.sin(yaw - Math.PI / 2), c0[2]]);
        var p2 = proj([c0[0] + r * Math.cos(yaw - Math.PI / 2), c0[1] + r * Math.sin(yaw - Math.PI / 2), c0[2] + h]);
        var p3 = proj([c0[0] + r * Math.cos(yaw + Math.PI / 2), c0[1] + r * Math.sin(yaw + Math.PI / 2), c0[2]]);
        var p4 = proj([c0[0] + r * Math.cos(yaw + Math.PI / 2), c0[1] + r * Math.sin(yaw + Math.PI / 2), c0[2] + h]);
        mk("line", { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: c, "stroke-width": 1.4 }, stage);
        mk("line", { x1: p3[0], y1: p3[1], x2: p4[0], y2: p4[1], stroke: c, "stroke-width": 1.4, "stroke-dasharray": "5 4" }, stage);
      });
      return S;
    };

    S.angle = function (v, a, b, opt) {
      opt = opt || {};
      rec(function () {
        var r = opt.r || 0.5;
        var A = [a[0] - v[0], a[1] - v[1], a[2] - v[2]];
        var B = [b[0] - v[0], b[1] - v[1], b[2] - v[2]];
        var la = Math.hypot(A[0], A[1], A[2]) || 1;
        var lb = Math.hypot(B[0], B[1], B[2]) || 1;
        var ua = [A[0] / la, A[1] / la, A[2] / la];
        var ub = [B[0] / lb, B[1] / lb, B[2] / lb];
        var n = 0;
        for (var i = 0; i < 3; i++) n += ua[i] * ub[i];
        n = Math.max(-1, Math.min(1, n));
        var ang = Math.acos(n);
        var pts = [];
        for (var k = 0; k <= 24 && ang > 1e-6; k++) {
          var t = k / 24;
          var s1 = Math.sin((1 - t) * ang) / Math.sin(ang);
          var s2 = Math.sin(t * ang) / Math.sin(ang);
          var dir = [];
          for (var j = 0; j < 3; j++) dir.push(s1 * ua[j] + s2 * ub[j]);
          var dn = Math.hypot(dir[0], dir[1], dir[2]) || 1;
          pts.push([v[0] + r * dir[0] / dn, v[1] + r * dir[1] / dn, v[2] + r * dir[2] / dn]);
        }
        polyRaw(pts, { color: opt.color || "teal", w: 1.2 });
        if (opt.label !== false) {
          var mid = pts[Math.floor(pts.length / 2)] || v;
          var pm = proj([v[0] + (mid[0] - v[0]) * 1.45, v[1] + (mid[1] - v[1]) * 1.45, v[2] + (mid[2] - v[2]) * 1.45]);
          MK.txt(overlay, pm[0], pm[1] + 4, opt.label || ((ang * 180 / Math.PI).toFixed(0) + "°"), {
            size: 11, fill: MK.accent(opt.color || "teal"), anchor: "middle"
          });
        }
      });
      return S;
    };

    /* 点按（位移 < 6px）走拾取；拖动走旋转；双击复位。
       注意：pointerdown 里 setPointerCapture 会把后续事件重定向到 svg，
       所以拾取目标必须在 pointerdown 时就记下来。 */
    function applyPick(pk) {
      if (pk) {
        if (highlight === pk.id) { highlight = null; infoText = ""; }
        else { highlight = pk.id; infoText = pk.info; }
        S.redraw();
        if (pickCb) pickCb(highlight === null ? null : pk.info, pk);
        return;
      }
      if (highlight !== null) {
        highlight = null; infoText = "";
        S.redraw();
        if (pickCb) pickCb(null);
      }
    }

    (function attachNav() {
      svg.style.touchAction = "none";
      svg.style.cursor = "grab";
      var down = false, moved = false, lx = 0, ly = 0, downPick = null;
      svg.addEventListener("pointerdown", function (e) {
        /* 中键和 Alt+左键留给查看器的平移，这里不接管（否则两个手势同时发生） */
        if (e.button !== 0 || e.altKey) return;
        down = true; moved = false; lx = e.clientX; ly = e.clientY;
        downPick = (e.target && e.target.__mvPick) ? e.target.__mvPick : null;
        svg.style.cursor = "grabbing";
        if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (er) {} }
      });
      svg.addEventListener("pointermove", function (e) {
        if (!down) return;
        var dx = e.clientX - lx, dy = e.clientY - ly;
        if (!moved && Math.hypot(dx, dy) > 6) moved = true;
        if (!moved) return;
        lx = e.clientX; ly = e.clientY;
        yaw += dx * 0.008;
        pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.008));
        if (userRedraw) userRedraw(); else S.redraw();
      });
      var up = function () {
        if (down && !moved) applyPick(downPick);
        down = false; svg.style.cursor = "grab";
      };
      svg.addEventListener("pointerup", up);
      svg.addEventListener("pointercancel", function () { down = false; svg.style.cursor = "grab"; });
      svg.addEventListener("pointerleave", function () { down = false; svg.style.cursor = "grab"; });
      svg.addEventListener("dblclick", function () {
        yaw = initYaw; pitch = initPitch;
        if (userRedraw) userRedraw(); else S.redraw();
      });
    })();

    /* 旋转开箱即用；传 redraw 仅为了兼容旧式用法 */
    S.drag = function (fn) { userRedraw = fn || null; return S; };
    S.onPick = function (fn) { pickCb = fn || null; return S; };

    S.reset = function (fn) {
      yaw = initYaw; pitch = initPitch;
      if (fn) fn(); else S.redraw();
      return S;
    };

    return S;
  }

  MK.space = space;
})(window);
