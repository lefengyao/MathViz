/* 工程类图形运行时：电路原理图（schematic）、PCB 布局（pcb）、机械工程图（eng）
   依赖 mk-core.js（MK.mk / MK.txt / 调色板）。
   共同原则和数学图一致：**模型只写"放什么、连哪里"，像素坐标由运行时算**。
   - schematic 坐标单位是网格（1 = 一个 cell），元件居中放在 at:[列,行]，行向下增大
   - pcb 坐标单位是毫米（mm），原点在板框左上角，y 向下
   - eng 坐标单位是毫米（mm），y 向上（同机械制图习惯），由运行时翻转 */
(function (g) {
  "use strict";

  var MK = g.MK;
  if (!MK) throw new Error("mk-core.js must load before mk-eng.js");

  var mk = MK.mk, txt = MK.txt, tw = MK.textWidth;
  var D = MK.dark;

  /* —— 颜色：全部走主题，深色/浅色自动换 —— */
  function line() { return D ? "#DBD8CF" : "#2B2925"; }
  function soft() { return D ? "#9A988F" : "#6E6C64"; }
  function faint() { return D ? "#4A4844" : "#DCDAD2"; }
  function paper() { return D ? "#232321" : "#FBFAF6"; }

  /* —— 统一画布：所有分组按固定层序创建，后建的在上 —— */
  function sheet(o, defBox) {
    var box = o.box || defBox;
    var W = o.w || 680;
    var H = o.h || Math.ceil(box[1] + box[3] + 26);
    var svg = mk("svg", {
      viewBox: "0 0 " + W + " " + H, width: "100%", role: "img",
      xmlns: "http://www.w3.org/2000/svg"
    });
    svg.style.display = "block";
    mk("title", null, svg).textContent = o.title || "工程图";
    mk("desc", null, svg).textContent = o.desc || "";

    /* 所有图元都放进 wrap：自适应时只量它，标题不算内容（标题自己会被重新安置） */
    var wrap = mk("g", { "class": "mv-fit" }, svg);
    var gs = {};
    ["base", "wire", "junc", "sym", "over"].forEach(function (k) {
      gs[k] = mk("g", { "class": "mv-layer-" + k }, wrap);
    });
    var titleEl = null;
    if (o.title) {
      titleEl = txt(svg, box[0], box[1] - 10, o.title, {
        size: 12.5, weight: 500, fill: line(), halo: false
      });
    }
    return { svg: svg, W: W, H: H, box: box, g: gs, wrap: wrap, titleEl: titleEl };
  }

  function fmtNum(v, dp) {
    var s = (Math.round(v * Math.pow(10, dp || 0)) / Math.pow(10, dp || 0)).toFixed(dp || 0);
    return s.replace(/\.0+$/, "");
  }

  /* ================================================================== */
  /* 一、电路原理图                                                      */
  /* ================================================================== */

  /* 符号定义：都在「以元件中心为原点、1 单位 = 1 cell」的局部坐标里画，
     旋转交给 <g transform="rotate(deg)">。ports 是端口的基准偏移，
     会按同样的角度旋转后再转成网格坐标，因此连线一定落在引脚上。 */
  var SYM = {
    resistor: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.6, st); lead(q, c, 0.6, 1, st);
        box(q, -0.6 * c, -0.22 * c, 1.2 * c, 0.44 * c, st);
      }
    },
    cap: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.16, st); lead(q, c, 0.16, 1, st);
        vline(q, -0.16 * c, -0.45 * c, 0.45 * c, st);
        vline(q, 0.16 * c, -0.45 * c, 0.45 * c, st);
      }
    },
    capPolar: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.16, st); lead(q, c, 0.16, 1, st);
        vline(q, -0.16 * c, -0.45 * c, 0.45 * c, st);
        var p = arcPath(0.16 * c, 0, 0.45 * c, -70, 70);
        mk("path", { d: p, fill: "none", stroke: st.stroke, "stroke-width": st["stroke-width"] }, q);
        plus(q, -0.42 * c, -0.55 * c, st);
      }
    },
    ind: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.6, st); lead(q, c, 0.6, 1, st);
        var r = 0.3 * c, d = "M" + (-0.6 * c) + " 0";
        for (var i = 0; i < 4; i++) {
          d += "A" + r + " " + r + " 0 0 1 " + (-0.6 * c + 2 * r * (i + 1)) + " 0";
        }
        mk("path", { d: d, fill: "none", stroke: st.stroke, "stroke-width": st["stroke-width"] }, q);
      }
    },
    diode: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.4, st); lead(q, c, 0.4, 1, st);
        tri(q, [[-0.4, -0.4], [-0.4, 0.4], [0.4, 0]], c, st);
        vline(q, 0.4 * c, -0.42 * c, 0.42 * c, st);
      }
    },
    led: {
      ports: { l: [-1, 0], r: [1, 0] },
      labx: 1.24,
      draw: function (q, c, st) {
        lead(q, c, -1, -0.4, st); lead(q, c, 0.4, 1, st);
        tri(q, [[-0.4, -0.4], [-0.4, 0.4], [0.4, 0]], c, st);
        vline(q, 0.4 * c, -0.42 * c, 0.42 * c, st);
        arrow(q, [0.1 * c, -0.45 * c], [0.55 * c, -0.9 * c], st);
        arrow(q, [0.35 * c, -0.3 * c], [0.8 * c, -0.75 * c], st);
      }
    },
    zener: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.4, st); lead(q, c, 0.4, 1, st);
        tri(q, [[-0.4, -0.4], [-0.4, 0.4], [0.4, 0]], c, st);
        vline(q, 0.4 * c, -0.42 * c, 0.42 * c, st);
        seg(q, 0.4 * c, -0.42 * c, 0.55 * c, -0.58 * c, st);
        seg(q, 0.4 * c, 0.42 * c, 0.25 * c, 0.58 * c, st);
      }
    },
    npn: {
      ports: { b: [-1.2, 0], c: [1, -1.2], e: [1, 1.2] },
      dirs: { b: [-1, 0], c: [0, -1], e: [0, 1] },
      draw: function (q, c, st) {
        seg(q, -1.2 * c, 0, -0.48 * c, 0, st);
        vline(q, -0.48 * c, -0.6 * c, 0.6 * c, st);
        seg(q, -0.48 * c, -0.24 * c, 1 * c, -1.2 * c, st);
        seg(q, -0.48 * c, 0.24 * c, 1 * c, 1.2 * c, st);
        arrow(q, [0.55 * c, 0.62 * c], [0.86 * c, 1.02 * c], st);
      }
    },
    pnp: {
      ports: { b: [-1.2, 0], c: [1, -1.2], e: [1, 1.2] },
      dirs: { b: [-1, 0], c: [0, -1], e: [0, 1] },
      draw: function (q, c, st) {
        seg(q, -1.2 * c, 0, -0.48 * c, 0, st);
        vline(q, -0.48 * c, -0.6 * c, 0.6 * c, st);
        seg(q, -0.48 * c, -0.24 * c, 1 * c, -1.2 * c, st);
        seg(q, -0.48 * c, 0.24 * c, 1 * c, 1.2 * c, st);
        /* PNP 的箭头在发射极上、指向基极 */
        arrow(q, [0.86 * c, 1.02 * c], [0.56 * c, 0.64 * c], st);
      }
    },
    mosfet: {
      ports: { g: [-1.3, 0], d: [1, -1.2], s: [1, 1.2] },
      dirs: { g: [-1, 0], d: [0, -1], s: [0, 1] },
      draw: function (q, c, st) {
        seg(q, -1.3 * c, 0, -0.62 * c, 0, st);
        vline(q, -0.62 * c, -0.55 * c, 0.55 * c, st);
        vline(q, -0.36 * c, -0.55 * c, -0.18 * c, st);
        vline(q, -0.36 * c, -0.12 * c, 0.12 * c, st);
        vline(q, -0.36 * c, 0.18 * c, 0.55 * c, st);
        seg(q, -0.36 * c, -0.36 * c, 1 * c, -1.2 * c, st);
        seg(q, -0.36 * c, 0.36 * c, 1 * c, 1.2 * c, st);
        seg(q, -0.36 * c, 0, -0.36 * c, 0, st);
        arrow(q, [-0.1 * c, 0], [-0.3 * c, 0], st);
      }
    },
    opamp: {
      ports: { n: [-2, -0.6], p: [-2, 0.6], out: [2, 0] },
      dirs: { n: [-1, 0], p: [-1, 0], out: [1, 0] },
      draw: function (q, c, st) {
        seg(q, -2 * c, -0.6 * c, -1.4 * c, -0.6 * c, st);
        seg(q, -2 * c, 0.6 * c, -1.4 * c, 0.6 * c, st);
        seg(q, 1.4 * c, 0, 2 * c, 0, st);
        tri(q, [[-1.4, -1.2], [-1.4, 1.2], [1.4, 0]], c, st);
        sym(q, -1.1 * c, -0.6 * c, "\u2212", st, 13);
        sym(q, -1.1 * c, 0.6 * c, "+", st, 13);
      }
    },
    battery: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.24, st); lead(q, c, 0.24, 1, st);
        vline(q, -0.24 * c, -0.42 * c, 0.42 * c, st);
        vline(q, -0.08 * c, -0.2 * c, 0.2 * c, st);
        vline(q, 0.08 * c, -0.42 * c, 0.42 * c, st);
        vline(q, 0.24 * c, -0.2 * c, 0.2 * c, st);
      }
    },
    ac: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.4, st); lead(q, c, 0.4, 1, st);
        mk("circle", { cx: 0, cy: 0, r: 0.4 * c, fill: "none", stroke: st.stroke, "stroke-width": st["stroke-width"] }, q);
        var p = "M" + (-0.2 * c) + " 0";
        for (var i = 0; i <= 16; i++) {
          var t = i / 16, x = -0.2 * c + 0.4 * c * t;
          p += "L" + x.toFixed(2) + " " + (-Math.sin(t * Math.PI * 2) * 0.14 * c).toFixed(2);
        }
        mk("path", { d: p, fill: "none", stroke: st.stroke, "stroke-width": 1.2, "stroke-linecap": "round" }, q);
      }
    },
    ground: {
      ports: { t: [0, -1] },
      draw: function (q, c, st) {
        seg(q, 0, -1 * c, 0, -0.12 * c, st);
        hline(q, -0.4 * c, 0.4 * c, -0.12 * c, st);
        hline(q, -0.26 * c, 0.26 * c, 0.06 * c, st);
        hline(q, -0.12 * c, 0.12 * c, 0.24 * c, st);
      }
    },
    vcc: {
      ports: { b: [0, 1] },
      draw: function (q, c, st) {
        seg(q, 0, 1 * c, 0, 0.2 * c, st);
        arrow(q, [0, 0.35 * c], [0, -0.12 * c], st);
      }
    },
    switch: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.5, st); lead(q, c, 0.5, 1, st);
        dot(q, -0.5 * c, 0, st); dot(q, 0.5 * c, 0, st);
        seg(q, -0.5 * c, 0, 0.4 * c, -0.38 * c, st);
      }
    },
    fuse: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.6, st); lead(q, c, 0.6, 1, st);
        box(q, -0.6 * c, -0.2 * c, 1.2 * c, 0.4 * c, st);
        seg(q, -0.6 * c, 0, 0.6 * c, 0, st);
      }
    },
    lamp: {
      ports: { l: [-1, 0], r: [1, 0] },
      draw: function (q, c, st) {
        lead(q, c, -1, -0.4, st); lead(q, c, 0.4, 1, st);
        mk("circle", { cx: 0, cy: 0, r: 0.4 * c, fill: "none", stroke: st.stroke, "stroke-width": st["stroke-width"] }, q);
        seg(q, -0.28 * c, -0.28 * c, 0.28 * c, 0.28 * c, st);
        seg(q, -0.28 * c, 0.28 * c, 0.28 * c, -0.28 * c, st);
      }
    }
  };

  /* —— 局部绘图小工具（都在元件的 g 里，坐标是 px）—— */
  function seg(q, x1, y1, x2, y2, st) {
    return mk("line", {
      x1: x1, y1: y1, x2: x2, y2: y2,
      stroke: st.stroke, "stroke-width": st["stroke-width"], "stroke-linecap": "round"
    }, q);
  }
  function lead(q, c, x1, x2, st) { return seg(q, x1 * c, 0, x2 * c, 0, st); }
  function vline(q, x, y1, y2, st) { return seg(q, x, y1, x, y2, st); }
  function hline(q, x1, x2, y, st) { return seg(q, x1, y, x2, y, st); }
  function box(q, x, y, w, h, st) {
    return mk("rect", {
      x: x, y: y, width: w, height: h, rx: 1.5, fill: "none",
      stroke: st.stroke, "stroke-width": st["stroke-width"]
    }, q);
  }
  function tri(q, pts, c, st) {
    var d = "M" + pts.map(function (p) {
      return (p[0] * c).toFixed(2) + " " + (p[1] * c).toFixed(2);
    }).join("L") + "Z";
    return mk("path", { d: d, fill: "none", stroke: st.stroke, "stroke-width": st["stroke-width"], "stroke-linejoin": "round" }, q);
  }
  function arcPath(cx, cy, r, a1, a2) {
    var t1 = a1 * Math.PI / 180, t2 = a2 * Math.PI / 180;
    var p1 = [cx + r * Math.cos(t1), cy + r * Math.sin(t1)];
    var p2 = [cx + r * Math.cos(t2), cy + r * Math.sin(t2)];
    return "M" + p1[0].toFixed(2) + " " + p1[1].toFixed(2) +
      "A" + r + " " + r + " 0 0 1 " + p2[0].toFixed(2) + " " + p2[1].toFixed(2);
  }
  function arrow(q, a, b, st) {
    seg(q, a[0], a[1], b[0], b[1], st);
    var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    var ux = dx / L, uy = dy / L, h = 5.5, w = 2.6;
    mk("path", {
      d: "M" + b[0] + " " + b[1] +
        "L" + (b[0] - ux * h - uy * w) + " " + (b[1] - uy * h + ux * w) +
        "L" + (b[0] - ux * h + uy * w) + " " + (b[1] - uy * h - ux * w) + "Z",
      fill: st.stroke, stroke: "none"
    }, q);
  }
  function dot(q, x, y, st) {
    return mk("circle", { cx: x, cy: y, r: 2.2, fill: st.stroke }, q);
  }
  function plus(q, x, y, st) {
    seg(q, x - 4, y, x + 4, y, st);
    seg(q, x, y - 4, x, y + 4, st);
  }
  function sym(q, x, y, s, st, size) {
    var t = txt(q, x, y, s, { size: size || 12, fill: st.stroke, anchor: "middle", baseline: "middle", halo: false });
    return t;
  }

  function schematic(o) {
    o = o || {};
    var sh = sheet(o, [40, 30, 600, 360]);
    var bx = sh.box[0], by = sh.box[1], bw = sh.box[2], bh = sh.box[3];
    var cell = o.cell || 46;
    var ox = bx + 6, oy = by + 10;
    var G = sh.g;

    function P(x, y) { return [ox + x * cell, oy + y * cell]; }

    var comps = {};   /* id -> {pos:{}, dir:{}, def, at, rot} */
    var segs = [];

    function rotv(dx, dy, deg) {
      var d = ((deg % 360) + 360) % 360;
      if (d === 90) return [-dy, dx];
      if (d === 180) return [-dx, -dy];
      if (d === 270) return [dy, -dx];
      return [dx, dy];
    }

    function place(kind, opt) {
      opt = opt || {};
      var def = SYM[kind];
      if (!def) throw new Error("没有这个元件: " + kind + "（可用：" + Object.keys(SYM).join(", ") + "）");
      var at = opt.at || [0, 0];
      var deg = opt.rot || 0;
      var c0 = P(at[0], at[1]);
      var st = {
        stroke: opt.color ? MK.accent(opt.color) : line(),
        "stroke-width": opt.w || 1.6
      };
      var q = mk("g", { transform: "translate(" + c0[0].toFixed(2) + "," + c0[1].toFixed(2) + ") rotate(" + deg + ")" }, G.sym);
      def.draw(q, cell, st);

      var pos = {}, dir = {};
      for (var k in def.ports) {
        var base = def.ports[k];
        var off = rotv(base[0], base[1], deg);
        pos[k] = [at[0] + off[0], at[1] + off[1]];
        /* 引脚朝向默认取端口偏移方向；三极管这类引脚画成斜线、
           但外部接线应该直上直下的，用 def.dirs 单独指定 */
        var bd = (def.dirs && def.dirs[k]) || base;
        var L = Math.hypot(bd[0], bd[1]) || 1;
        var d0 = rotv(bd[0] / L, bd[1] / L, deg);
        dir[k] = [Math.round(d0[0] * 1000) / 1000, Math.round(d0[1] * 1000) / 1000];
      }
      if (opt.id) comps[opt.id] = { pos: pos, dir: dir, kind: kind, at: at, rot: deg };

      /* 标注：横放时名字在上、参数在下；竖放时都挪到右侧，避免压线 */
      var vertical = (deg % 180) !== 0;
      /* 有些符号本体往右伸得远（LED 的发光箭头），单独给个标注基准 */
      var labx = (def.labx || 1.06) * cell;
      if (opt.label) {
        var lp = vertical ? [c0[0] + labx, c0[1] - 2] : [c0[0], c0[1] - 0.42 * cell];
        txt(G.sym, lp[0], lp[1], opt.label, {
          size: opt.size || 12, fill: line(), anchor: vertical ? "start" : "middle", mono: true
        });
      }
      if (opt.value) {
        var vp = vertical ? [c0[0] + labx, c0[1] + 13] : [c0[0], c0[1] + 0.62 * cell + 4];
        txt(G.sym, vp[0], vp[1], opt.value, {
          size: opt.size || 11.5, fill: soft(), anchor: vertical ? "start" : "middle", mono: true
        });
      }
      return comps[opt.id];
    }

    function port(ref) {
      var s = String(ref), dot = s.lastIndexOf(".");
      if (dot <= 0) throw new Error("端口写法要对：'元件id.端口名'，例如 'R1.r'，收到 " + s);
      var id = s.slice(0, dot), pn = s.slice(dot + 1);
      var comp = comps[id];
      if (!comp) throw new Error("还没放置元件 " + id + "，不能从它连出（先调用 " + id + " 的绘制函数）");
      if (!comp.pos[pn]) {
        throw new Error(id + " 没有端口 " + pn + "（可用：" + Object.keys(comp.pos).join(", ") + "）");
      }
      return { p: comp.pos[pn], d: comp.dir[pn] };
    }

    function same(a, b) { return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6; }
    function onSeg(p, s) {
      var a = s[0], b = s[1];
      var L2 = Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2);
      if (L2 < 1e-12) return false;          /* 零长度线段不参与判定，否则每个点都算"落在线上" */
      var cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (Math.abs(cross) > 1e-6) return false;
      var t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]));
      return t >= -1e-9 && t <= L2 + 1e-9;
    }

    function junctions() {
      while (G.junc.firstChild) G.junc.removeChild(G.junc.firstChild);
      if (!segs.length) return;
      var key = function (p) { return p[0].toFixed(3) + "," + p[1].toFixed(3); };
      var cand = {}, pins = {}, i, j;
      for (i = 0; i < segs.length; i++) {
        cand[key(segs[i][0])] = segs[i][0];
        cand[key(segs[i][1])] = segs[i][1];
      }
      /* 元件引脚也参与判定：两条线汇到同一个引脚时也该打结点 */
      for (var id in comps) {
        for (var pn in comps[id].pos) {
          var pp = comps[id].pos[pn];
          cand[key(pp)] = pp;
          pins[key(pp)] = (pins[key(pp)] || 0) + 1;
        }
      }
      for (var k in cand) {
        var p2 = cand[k], deg = pins[k] || 0;
        for (i = 0; i < segs.length; i++) if (onSeg(p2, segs[i])) deg++;
        if (deg >= 3) {
          var q = P(p2[0], p2[1]);
          mk("circle", { cx: q[0], cy: q[1], r: 3, fill: line() }, G.junc);
        }
      }
    }

    /* 折返清理：A→B→A 这种尖刺会让导线看起来描粗一遍，
       典型场景是终点引脚朝上、而模型给的最后一个折点落在了引脚下方。
       去掉中间那个折点后，导线正好从外侧落到引脚上。 */
    function despike(pts) {
      var out = pts.slice(), changed = true;
      while (changed && out.length > 2) {
        changed = false;
        for (var i = 1; i < out.length - 1; i++) {
          var a = out[i - 1], b = out[i], c = out[i + 1];
          var abx = b[0] - a[0], aby = b[1] - a[1];
          var bcx = c[0] - b[0], bcy = c[1] - b[1];
          var cross = abx * bcy - aby * bcx;
          var dotp = abx * bcx + aby * bcy;
          if (Math.abs(cross) < 1e-6 && dotp < -1e-9) {
            out.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      return out;
    }

    function dedupe(pts) {
      var out = [];
      for (var i = 0; i < pts.length; i++) {
        if (!out.length || !same(out[out.length - 1], pts[i])) out.push(pts[i]);
      }
      return out.length >= 2 ? out : pts;
    }

    /* 自动正交走线：
       1) 导线与目标引脚成直角、且已经对齐 -> 直接落到引脚上（最常见的接法）
       2) 其余情况按引脚朝向决定先横先竖，末端顺着引脚方向插入半格
       3) 目标引脚在反方向时走中线绕行 */
    function route(a, b, opt) {
      opt = opt || {};
      var A = typeof a === "string" ? port(a) : { p: a, d: null };
      var B = typeof b === "string" ? port(b) : { p: b, d: null };
      var stub = opt.stub === undefined ? 0.5 : opt.stub;
      var pts = [A.p];
      var p1 = A.p;
      if (A.d) { p1 = [A.p[0] + A.d[0] * stub, A.p[1] + A.d[1] * stub]; pts.push(p1); }

      var bh = !!(B.d && Math.abs(B.d[0]) > 0.5), bv = !!(B.d && Math.abs(B.d[1]) > 0.5);
      var dx = B.p[0] - p1[0], dy = B.p[1] - p1[1];
      var alignedH = Math.abs(dy) < 1e-9;     /* 同一水平线 */
      var alignedV = Math.abs(dx) < 1e-9;     /* 同一竖直线 */

      if (opt.via && opt.via.length) {
        var cur = p1, prevDir = A.d;
        for (var i = 0; i < opt.via.length; i++) {
          var t = opt.via[i];
          var hFirst = prevDir ? Math.abs(prevDir[0]) > 0.5 : true;
          if (!(Math.abs(cur[0] - t[0]) < 1e-9 || Math.abs(cur[1] - t[1]) < 1e-9)) {
            pts.push(hFirst ? [t[0], cur[1]] : [cur[0], t[1]]);
          }
          pts.push(t);
          cur = t; prevDir = null;
        }
        if (!(Math.abs(cur[0] - B.p[0]) < 1e-9 || Math.abs(cur[1] - B.p[1]) < 1e-9)) {
          pts.push([B.p[0], cur[1]]);
        }
        pts.push(B.p);
      } else if ((alignedH && !bh) || (alignedV && !bv)) {
        /* 与引脚垂直且已对齐 -> 垂直入射，一步到位 */
        pts.push(B.p);
      } else {
        var p2 = B.p;
        if (B.d) { p2 = [B.p[0] + B.d[0] * stub, B.p[1] + B.d[1] * stub]; }
        var flat = Math.abs(p1[1] - p2[1]) < 1e-9, vert = Math.abs(p1[0] - p2[0]) < 1e-9;
        var ah = !!(A.d && Math.abs(A.d[0]) > 0.5), av = !!(A.d && Math.abs(A.d[1]) > 0.5);
        /* 背对背：两个引脚都朝外，直连会从元件身上穿过去，必须绕一条外边 */
        var away = false;
        if (A.d && B.d) {
          var ux = B.p[0] - A.p[0], uy = B.p[1] - A.p[1];
          away = (A.d[0] * ux + A.d[1] * uy) < 0 && (-B.d[0] * ux - B.d[1] * uy) < 0;
        }
        if (away && (ah || bh)) {
          var lane = A.p[1] - 2;
          if (lane < -0.5) lane = A.p[1] + 2;
          pts.push([p1[0], lane], [p2[0], lane], p2);
        } else if (away && (av || bv)) {
          var laneX = A.p[0] - 2;
          if (laneX < -0.5) laneX = A.p[0] + 2;
          pts.push([laneX, p1[1]], [laneX, p2[1]], p2);
        } else if (!flat && !vert) {
          if (ah && bv) {
            pts.push([p1[0], p2[1]], p2);
          } else if (av && bh) {
            pts.push([p2[0], p1[1]], p2);
          } else if (ah || bh) {
            var mx = (p1[0] + p2[0]) / 2;
            pts.push([mx, p1[1]], [mx, p2[1]], p2);
          } else if (av || bv) {
            var my = (p1[1] + p2[1]) / 2;
            pts.push([p1[0], my], [p2[0], my], p2);
          } else {
            pts.push([p2[0], p1[1]], p2);
          }
        } else {
          pts.push(p2);
        }
        pts.push(B.p);
      }
      return drawWire(despike(dedupe(pts)), opt);
    }

    function drawWire(pts, opt) {
      opt = opt || {};
      /* 折返清理后可能出现相邻重复点，再收敛一次，避免零长度线段 */
      pts = dedupe(despike(dedupe(pts)));
      var q = pts.map(function (p) { return P(p[0], p[1]); });
      var d = "";
      for (var i = 0; i < q.length; i++) d += (i ? "L" : "M") + q[i][0].toFixed(2) + " " + q[i][1].toFixed(2);
      mk("path", {
        d: d, fill: "none",
        stroke: opt.color ? MK.accent(opt.color) : line(),
        "stroke-width": opt.w || 1.5,
        "stroke-linecap": "round", "stroke-linejoin": "round",
        "stroke-dasharray": opt.dash ? "5 4" : null
      }, G.wire);
      for (var j = 0; j < pts.length - 1; j++) {
        if (!same(pts[j], pts[j + 1])) segs.push([pts[j], pts[j + 1]]);
      }
      junctions();
      return pts;
    }

    var C = {
      svg: sh.svg, g: G, cell: cell, at: P,
      scale: function () { return cell; }
    };

    Object.keys(SYM).forEach(function (kind) {
      C[kind] = function (opt) { return place(kind, opt); };
    });

    C.wire = function (a, b, opt) { return route(a, b, opt); };

    C.wires = function (list, opt) {
      (list || []).forEach(function (pair) {
        if (pair && pair.length >= 2) C.wire(pair[0], pair[1], pair[2] || opt);
      });
      return C;
    };

    C.dot = function (p, opt) {
      opt = opt || {};
      var q = P(p[0], p[1]);
      mk("circle", { cx: q[0], cy: q[1], r: opt.r || 3, fill: line() }, G.junc);
      return C;
    };

    C.label = function (p, s, opt) {
      opt = opt || {};
      var q = P(p[0], p[1]);
      txt(G.over, q[0] + (opt.dx || 0), q[1] + (opt.dy || 0), s, {
        size: opt.size || 11.5, fill: opt.color ? MK.accent(opt.color) : line(),
        anchor: opt.anchor || "middle", italic: opt.italic, mono: opt.mono
      });
      return C;
    };

    /* 变压器 / 芯片这类方框器件：左右上下都能挂引脚，端口名就是引脚名 */
    C.ic = function (opt) {
      opt = opt || {};
      var at = opt.at || [0, 0], w = opt.w || 4, h = opt.h || 3;
      var x0 = at[0] - w / 2, y0 = at[1] - h / 2;
      var a = P(x0, y0), b = P(x0 + w, y0 + h);
      mk("rect", {
        x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1], rx: 3,
        fill: "none", stroke: line(), "stroke-width": 1.7
      }, G.sym);
      var pos = {}, dir = {};
      var stub = 0.5;
      function pins(list, side) {
        list = list || [];
        for (var i = 0; i < list.length; i++) {
          var name = typeof list[i] === "string" ? list[i] : list[i].name;
          var label = typeof list[i] === "string" ? name : (list[i].label || name);
          var t = (i + 0.5) / list.length;
          var edge, out, p, anchor;
          if (side === "left") {
            edge = [x0, y0 + h * t]; out = [-stub, 0];
            p = [edge[0] - stub, edge[1]]; anchor = "start";
          } else if (side === "right") {
            edge = [x0 + w, y0 + h * t]; out = [stub, 0];
            p = [edge[0] + stub, edge[1]]; anchor = "end";
          } else if (side === "top") {
            edge = [x0 + w * t, y0]; out = [0, -stub];
            p = [edge[0], edge[1] - stub]; anchor = "middle";
          } else {
            edge = [x0 + w * t, y0 + h]; out = [0, stub];
            p = [edge[0], edge[1] + stub]; anchor = "middle";
          }
          var e1 = P(edge[0], edge[1]), e2 = P(p[0], p[1]);
          mk("line", { x1: e1[0], y1: e1[1], x2: e2[0], y2: e2[1], stroke: line(), "stroke-width": 1.5 }, G.sym);
          var tx = e1[0] + (side === "left" ? 5 : side === "right" ? -5 : 0);
          var ty = e1[1] + (side === "left" || side === "right" ? 4 : (side === "top" ? 13 : -6));
          txt(G.sym, tx, ty, label, { size: 10.5, fill: soft(), anchor: anchor, mono: true, halo: false });
          pos[name] = p;
          var L = Math.hypot(out[0], out[1]) || 1;
          dir[name] = [out[0] / L, out[1] / L];
        }
      }
      pins(opt.left, "left"); pins(opt.right, "right");
      pins(opt.top, "top"); pins(opt.bottom, "bottom");
      if (opt.id) comps[opt.id] = { pos: pos, dir: dir, kind: "ic", at: at, rot: 0 };
      if (opt.label) {
        txt(G.sym, (a[0] + b[0]) / 2, a[1] + 15, opt.label, { size: 12, fill: line(), anchor: "middle", mono: true });
      }
      return comps[opt.id];
    };

    /* 网格点（调试用，可选） */
    C.grid = function (opt) {
      opt = opt || {};
      var step = opt.step || 1, cols = opt.cols || Math.floor(bw / cell), rows = opt.rows || Math.floor(bh / cell);
      var gg = mk("g", { stroke: faint(), "stroke-width": 0.5, opacity: 0.55 }, G.base);
      for (var i = 0; i <= cols; i++) {
        for (var j = 0; j <= rows; j++) {
          var q = P(i * step, j * step);
          mk("circle", { cx: q[0], cy: q[1], r: 1.2, fill: faint(), stroke: "none" }, gg);
        }
      }
      return C;
    };

    /* 自检：未连接的端口（模型最常犯的错就是线悬空） */
    C.floating = function () {
      var out = [];
      for (var id in comps) {
        for (var pn in comps[id].pos) {
          var p = comps[id].pos[pn], hit = false;
          for (var i = 0; i < segs.length && !hit; i++) hit = onSeg(p, segs[i]);
          if (!hit) out.push(id + "." + pn);
        }
      }
      return out;
    };
    C.report = function () {
      var f = C.floating();
      return { floating: f, wires: segs.length, ok: f.length === 0 };
    };

    /* 行数写多了会顶出画布：只往外扩，不缩放（cell 是模型选定的尺寸，不该被改） */
    var raf0 = g.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf0(function () { growToContent(sh.svg, sh.wrap); });

    return C;
  }

  /* ================================================================== */
  /* 二、PCB 布局                                                        */
  /* ================================================================== */
  function pcb(o) {
    o = o || {};
    var sh = sheet(o, [40, 24, 600, 380]);
    var box = sh.box, G = sh.g;
    var board = o.board || [60, 40];
    var bw = board[0], bh = board[1];
    var margin = o.pad === undefined ? 56 : o.pad;
    var s = Math.min((box[2] - margin * 2) / bw, (box[3] - margin * 2 - 12) / bh);
    var ox = box[0] + (box[2] - bw * s) / 2;
    var oy = box[1] + (box[3] - bh * s) / 2 + 14;

    function P(x, y) { return [ox + x * s, oy + y * s]; }
    function mm(v) { return v * s; }

    var col = {
      top: MK.accent("red"),
      bottom: MK.accent("blue"),
      pad: MK.accent("amber"),
      silk: soft(),
      edge: line()
    };

    var C = {
      svg: sh.svg, g: G, at: P, s: s, mm: mm,
      color: col
    };

    function layerColor(l) { return l === "bottom" ? col.bottom : col.top; }

    /* 板框（边沿）与底色 */
    C.outline = function (opt) {
      opt = opt || {};
      var a = P(0, 0), b = P(bw, bh);
      mk("rect", {
        x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1],
        rx: opt.r === undefined ? 6 : mm(opt.r),
        fill: opt.fill === false ? "none" : paper(),
        stroke: col.edge, "stroke-width": 1.8
      }, G.base);
      if (opt.text !== false) {
        txt(G.over, (a[0] + b[0]) / 2, b[1] + 15,
          (opt.text || (fmtNum(bw, 1) + " × " + fmtNum(bh, 1) + " mm")), {
            size: 11, fill: soft(), anchor: "middle", mono: true, halo: false
          });
      }
      return C;
    };

    C.grid = function (opt) {
      opt = opt || {};
      var step = opt.step || 5;
      var gg = mk("g", { stroke: faint(), "stroke-width": 0.5, opacity: 0.6 }, G.base);
      for (var x = step; x < bw; x += step) {
        var p1 = P(x, 0), p2 = P(x, bh);
        mk("line", { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }, gg);
      }
      for (var y = step; y < bh; y += step) {
        var q1 = P(0, y), q2 = P(bw, y);
        mk("line", { x1: q1[0], y1: q1[1], x2: q2[0], y2: q2[1] }, gg);
      }
      return C;
    };

    function padAt(p, w, h, layer, opt) {
      opt = opt || {};
      var q = P(p[0], p[1]);
      var c = layerColor(layer);
      if (opt.shape === "circle") {
        mk("circle", { cx: q[0], cy: q[1], r: mm(w) / 2, fill: c, stroke: "none" }, G.base);
      } else {
        mk("rect", {
          x: q[0] - mm(w) / 2, y: q[1] - mm(h) / 2,
          width: mm(w), height: mm(h), rx: opt.shape === "oval" ? mm(Math.min(w, h)) / 2 : mm(0.15),
          fill: c, stroke: "none"
        }, G.base);
      }
      if (opt.drill) {
        mk("circle", { cx: q[0], cy: q[1], r: mm(opt.drill) / 2, fill: paper(), stroke: "none" }, G.base);
      }
      return q;
    }

    /* 焊盘：w/h 是外径（mm），drill 给孔就是通孔焊盘 */
    C.pad = function (p, opt) {
      opt = opt || {};
      return padAt(p, opt.w || 2, opt.h || opt.w || 2, opt.layer || "top", opt);
    };

    C.via = function (p, opt) {
      opt = opt || {};
      var pad = opt.pad || 0.6, drill = opt.drill || 0.3;
      var q = P(p[0], p[1]);
      mk("circle", { cx: q[0], cy: q[1], r: mm(pad) / 2, fill: col.pad, stroke: "none" }, G.base);
      mk("circle", { cx: q[0], cy: q[1], r: mm(drill) / 2, fill: paper(), stroke: "none" }, G.base);
      return C;
    };

    /* 走线：pts 是顶点数组（mm），直接折线 */
    C.trace = function (pts, opt) {
      opt = opt || {};
      if (!pts || pts.length < 2) return C;
      var q = pts.map(function (p) { return P(p[0], p[1]); });
      var d = "";
      for (var i = 0; i < q.length; i++) d += (i ? "L" : "M") + q[i][0].toFixed(2) + " " + q[i][1].toFixed(2);
      mk("path", {
        d: d, fill: "none", stroke: layerColor(opt.layer),
        "stroke-width": Math.max(1.2, mm(opt.w || 0.35)),
        "stroke-linecap": "round", "stroke-linejoin": "round",
        opacity: opt.layer === "bottom" ? 0.9 : 1
      }, G.wire);
      return C;
    };

    /* 自动 45° 走线：横 -> 45° -> 横（或竖 -> 45° -> 竖） */
    C.route = function (a, b, opt) {
      opt = opt || {};
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var ax = Math.abs(dx), ay = Math.abs(dy);
      var sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
      var pts = [a];
      if (ax > ay) {
        var d1 = (ax - ay) / 2;
        pts.push([a[0] + sx * d1, a[1]], [a[0] + sx * (d1 + ay), b[1]], b);
      } else {
        var d2 = (ay - ax) / 2;
        pts.push([a[0], a[1] + sy * d2], [b[0], a[1] + sy * (d2 + ax)], b);
      }
      return C.trace(pts, opt);
    };

    /* 常见封装：单位 mm，pitch 是焊盘中心距 */
    var FP = {
      "0603": { pw: 0.9, ph: 1.1, pitch: 1.6 },
      "0805": { pw: 1.2, ph: 1.4, pitch: 1.9 },
      "1206": { pw: 1.4, ph: 1.8, pitch: 2.6 },
      "1210": { pw: 1.5, ph: 2.2, pitch: 2.9 }
    };

    function rotOff(dx, dy, deg) {
      var d = ((deg % 360) + 360) % 360;
      if (d === 90) return [-dy, dx];
      if (d === 180) return [-dx, -dy];
      if (d === 270) return [dy, -dx];
      return [dx, dy];
    }

    /* 位号放在封装上方、参数放下方，偏移量用 mm 给，避免压住焊盘 */
    function refText(p, ref, value, dyRef, dyVal) {
      var q = P(p[0], p[1]);
      if (ref) txt(G.over, q[0], q[1] + mm(dyRef), ref, { size: 10.5, fill: col.silk, anchor: "middle", mono: true });
      if (value) txt(G.over, q[0], q[1] + mm(dyVal), value, { size: 10, fill: col.silk, anchor: "middle", mono: true });
    }

    function twoPad(opt, d) {
      var deg = opt.rot || 0;
      var o1 = rotOff(-d.pitch / 2, 0, deg), o2 = rotOff(d.pitch / 2, 0, deg);
      padAt([opt.at[0] + o1[0], opt.at[1] + o1[1]], d.pw, d.ph, opt.layer || "top", opt);
      padAt([opt.at[0] + o2[0], opt.at[1] + o2[1]], d.pw, d.ph, opt.layer || "top", opt);
      /* 丝印框 */
      var w = d.pitch + d.pw + 0.3, h = Math.max(d.ph, 0.9) + 0.4;
      var q = P(opt.at[0], opt.at[1]);
      mk("g", { transform: "translate(" + q[0].toFixed(2) + "," + q[1].toFixed(2) + ") rotate(" + deg + ")" }, G.sym);
      var gq = G.sym.lastChild;
      mk("rect", {
        x: -mm(w) / 2, y: -mm(h) / 2, width: mm(w), height: mm(h),
        fill: "none", stroke: col.silk, "stroke-width": 0.8, "stroke-dasharray": "3 2"
      }, gq);
      refText(opt.at, opt.ref, opt.value, -(d.ph / 2 + 1.3), d.ph / 2 + 2.0);
    }

    C.footprint = function (kind, opt) {
      opt = opt || {};
      opt.at = opt.at || [0, 0];
      var k = String(kind).toLowerCase();
      if (FP[k]) { twoPad(opt, FP[k]); return C; }

      if (k === "sot23") {
        var d = 0.95;
        padAt([opt.at[0] - d, opt.at[1] + 1.0], 0.9, 1.0, opt.layer, opt);
        padAt([opt.at[0] + d, opt.at[1] + 1.0], 0.9, 1.0, opt.layer, opt);
        padAt([opt.at[0], opt.at[1] - 1.0], 0.9, 1.0, opt.layer, opt);
        var q1 = P(opt.at[0], opt.at[1]);
        mk("rect", {
          x: q1[0] - mm(1.5) / 2, y: q1[1] - mm(1.4) / 2, width: mm(1.5), height: mm(1.4),
          fill: "none", stroke: col.silk, "stroke-width": 0.8, "stroke-dasharray": "3 2"
        }, G.sym);
        refText(opt.at, opt.ref, opt.value, -3.0, 3.0);
        return C;
      }

      if (k === "soic8" || k === "soic") {
        var n = opt.pins || 8, pitch = opt.pitch || 1.27, row = opt.row || 1.75;
        var half = Math.floor(n / 2);
        for (var i = 0; i < half; i++) {
          var x = opt.at[0] + (i - (half - 1) / 2) * pitch;
          padAt([x, opt.at[1] - row], 0.6, 1.6, opt.layer, opt);
          padAt([x, opt.at[1] + row], 0.6, 1.6, opt.layer, opt);
        }
        var c0 = P(opt.at[0], opt.at[1]);
        var w2 = mm((half - 1) * pitch + 1.6), h2 = mm(row * 2 - 0.6);
        mk("rect", {
          x: c0[0] - w2 / 2, y: c0[1] - h2 / 2, width: w2, height: h2,
          fill: "none", stroke: col.silk, "stroke-width": 0.8, "stroke-dasharray": "3 2"
        }, G.sym);
        refText(opt.at, opt.ref, opt.value, -(row + 0.9), row + 2.7);
        return C;
      }

      if (k === "dip8" || k === "dip") {
        var n2 = opt.pins || 8, pitch2 = opt.pitch || 2.54, row2 = opt.row || 3.5;
        var half2 = Math.floor(n2 / 2);
        for (var j = 0; j < half2; j++) {
          var x2 = opt.at[0] + (j - (half2 - 1) / 2) * pitch2;
          padAt([x2, opt.at[1] - row2], 1.6, 1.6, opt.layer, { shape: "circle", drill: 0.8, layer: opt.layer });
          padAt([x2, opt.at[1] + row2], 1.6, 1.6, opt.layer, { shape: "circle", drill: 0.8, layer: opt.layer });
        }
        var c1 = P(opt.at[0], opt.at[1]);
        mk("rect", {
          x: c1[0] - mm((half2 - 1) * pitch2 + 2) / 2, y: c1[1] - mm(row2 * 2 - 1.6) / 2,
          width: mm((half2 - 1) * pitch2 + 2), height: mm(row2 * 2 - 1.6),
          fill: "none", stroke: col.silk, "stroke-width": 0.8, "stroke-dasharray": "3 2"
        }, G.sym);
        refText(opt.at, opt.ref, opt.value, -(row2 + 1.0), row2 + 2.9);
        return C;
      }

      if (k === "header") {
        var n3 = opt.n || 4, pitch3 = opt.pitch || 2.54;
        var deg3 = opt.rot || 0;
        for (var m = 0; m < n3; m++) {
          var off = rotOff((m - (n3 - 1) / 2) * pitch3, 0, deg3);
          padAt([opt.at[0] + off[0], opt.at[1] + off[1]], 1.7, 1.7, opt.layer,
            { shape: "circle", drill: 1.0, layer: opt.layer });
        }
        refText(opt.at, opt.ref, opt.value, -2.0, 2.4);
        return C;
      }

      throw new Error("没有这个封装: " + kind + "（可用：0603 0805 1206 1210 sot23 soic8 dip8 header）");
    };

    /* 丝印：文字、线段、外框 */
    C.silk = function (a, b, opt) {
      opt = opt || {};
      if (typeof a === "string") {
        var q = P(b[0], b[1]);
        txt(G.over, q[0], q[1], a, { size: opt.size || 11, fill: col.silk, anchor: opt.anchor || "start", mono: opt.mono !== false });
        return C;
      }
      var p1 = P(a[0], a[1]), p2 = P(b[0], b[1]);
      mk("line", { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: col.silk, "stroke-width": opt.w || 0.9, "stroke-dasharray": opt.dash ? "4 3" : null }, G.sym);
      return C;
    };

    C.text = function (p, s, opt) {
      opt = opt || {};
      var q = P(p[0], p[1]);
      txt(G.over, q[0], q[1], s, {
        size: opt.size || 11, fill: opt.color ? MK.accent(opt.color) : soft(),
        anchor: opt.anchor || "start", mono: opt.mono !== false
      });
      return C;
    };

    /* 尺寸标注（mm）：offset 是尺寸线距基准线的法向距离 */
    /* 尺寸线默认放在板外：横向朝上、纵向朝右，offset 是离被测边的距离（mm） */
    C.dim = function (a, b, opt) {
      opt = opt || {};
      var horiz = opt.dir ? opt.dir === "h" : Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
      var off = Math.abs(opt.offset === undefined ? 6 : opt.offset);
      var val = opt.text || (fmtNum(horiz ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]), 1));
      var st = { stroke: soft(), "stroke-width": 0.9 };
      if (horiz) {
        var above = opt.side !== "below";
        var sg = above ? -1 : 1;
        var y = (above ? Math.min(a[1], b[1]) : Math.max(a[1], b[1])) + sg * off;
        [a, b].forEach(function (p) {
          var s1 = P(p[0], p[1] + sg * 1.5), s2 = P(p[0], y + sg * 1.5);
          seg(G.over, s1[0], s1[1], s2[0], s2[1], st);
        });
        var d1 = P(a[0], y), d2 = P(b[0], y);
        seg(G.over, d1[0], d1[1], d2[0], d2[1], st);
        dimArrow(G.over, d1, d2, st, mm(2.2)); dimArrow(G.over, d2, d1, st, mm(2.2));
        txt(G.over, (d1[0] + d2[0]) / 2, d1[1] + (above ? -5 : 13), val,
          { size: 11, fill: soft(), anchor: "middle", mono: true });
      } else {
        var right = opt.side !== "left";
        var sgv = right ? 1 : -1;
        var x = (right ? Math.max(a[0], b[0]) : Math.min(a[0], b[0])) + sgv * off;
        [a, b].forEach(function (p) {
          var s1 = P(p[0] + sgv * 1.5, p[1]), s2 = P(x + sgv * 1.5, p[1]);
          seg(G.over, s1[0], s1[1], s2[0], s2[1], st);
        });
        var k1 = P(x, a[1]), k2 = P(x, b[1]);
        seg(G.over, k1[0], k1[1], k2[0], k2[1], st);
        dimArrow(G.over, k1, k2, st, mm(2.2)); dimArrow(G.over, k2, k1, st, mm(2.2));
        txt(G.over, k1[0] + (right ? 6 : -6), (k1[1] + k2[1]) / 2 + 4, val,
          { size: 11, fill: soft(), anchor: right ? "start" : "end", mono: true });
      }
      return C;
    };

    C.dimX = function (a, b, opt) { opt = opt || {}; opt.dir = opt.dir || "h"; return C.dim(a, b, opt); };
    C.dimY = function (a, b, opt) { opt = opt || {}; opt.dir = opt.dir || "v"; return C.dim(a, b, opt); };

    C.legend = function (opt) {
      opt = opt || {};
      /* 允许直接传数组：P.legend([{color:'top',text:'顶层'}]) */
      var items = Array.isArray(opt) ? opt : (opt.items || [
        { text: "顶层铜", color: "top" }, { text: "底层铜", color: "bottom" },
        { text: "焊盘/过孔", color: "pad" }, { text: "丝印", color: "silk" }
      ]);
      var gap = 13;
      var x = box[0] + 6, y = sh.H - gap * items.length - 8;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var c = it.color === "top" ? col.top : it.color === "bottom" ? col.bottom
          : it.color === "pad" ? col.pad : col.silk;
        mk("line", { x1: x, y1: y + i * gap, x2: x + 14, y2: y + i * gap, stroke: c, "stroke-width": 3 }, G.over);
        txt(G.over, x + 19, y + i * gap + 4, it.text, { size: 10.5, fill: soft(), anchor: "start", halo: false });
      }
      return C;
    };

    return C;
  }

  /* 尺寸箭头：箭尖在 from，指向背离 to 的方向；hl 是箭头长度（px） */
  function dimArrow(q, from, to, st, hl) {
    var dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy) || 1;
    var ux = dx / L, uy = dy / L, h = hl || 7, w = h * 0.32;
    mk("path", {
      d: "M" + from[0] + " " + from[1] +
        "L" + (from[0] + ux * h - uy * w) + " " + (from[1] + uy * h + ux * w) +
        "L" + (from[0] + ux * h + uy * w) + " " + (from[1] + uy * h - ux * w) + "Z",
      fill: st.stroke, stroke: "none"
    }, q);
  }

  /* ================================================================== */
  /* 三、机械工程图                                                      */
  /* ================================================================== */
  /* —— 内容兜底：ext 只是「比例提示」，真正的画面以画出来的东西为准 ——
     模型经常把 ext 写大一倍（于是整张图缩在画布左下角一小块）或写小
     （于是图形溢出 viewBox 被裁掉）。脚本跑完后按内容 bbox 重设 viewBox，
     两种情况一起解决。显式传了 scale 的图不动——那种是想要固定比例。 */
  function fitToContent(svg, wrap, titleEl, pad) {
    pad = pad === undefined ? 10 : pad;
    var bb;
    try { bb = wrap.getBBox(); } catch (e) { return false; }   /* 没挂进文档时拿不到，保持原样 */
    if (!bb || !(bb.width > 4) || !(bb.height > 4)) return false;
    var p = String(svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    if (p.length !== 4 || !isFinite(p[2]) || p[2] <= 0 || !isFinite(p[3]) || p[3] <= 0) return false;

    var head = titleEl ? 18 : 0;          /* 标题单独占一行，往上让出来 */
    var x = Math.floor(bb.x - pad), y = Math.floor(bb.y - pad - head);
    var w = Math.ceil(bb.width + pad * 2), h = Math.ceil(bb.height + pad * 2 + head);
    /* 本来就已经贴合就别动，免得同一张图每次渲染差几像素 */
    if (Math.abs(x - p[0]) < 3 && Math.abs(y - p[1]) < 3
      && Math.abs(w - p[2]) < 6 && Math.abs(h - p[3]) < 6) return false;

    svg.setAttribute("viewBox", x + " " + y + " " + w + " " + h);
    if (titleEl) {
      titleEl.setAttribute("x", x + 2);
      titleEl.setAttribute("y", y + 13);
    }
    return true;
  }

  /* —— 只扩不缩：原理图按 cell 摆元件，行数多了会顶出画布，
     这里把画幅往外扩到能装下（缩放交给 cell，别动）—— */
  function growToContent(svg, wrap, pad) {
    pad = pad === undefined ? 8 : pad;
    var bb;
    try { bb = wrap.getBBox(); } catch (e) { return false; }
    if (!bb || !(bb.width > 4) || !(bb.height > 4)) return false;
    var p = String(svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    if (p.length !== 4 || !(p[2] > 0) || !(p[3] > 0)) return false;

    var x = Math.min(p[0], Math.floor(bb.x - pad));
    var y = Math.min(p[1], Math.floor(bb.y - pad));
    var x2 = Math.max(p[0] + p[2], Math.ceil(bb.x + bb.width + pad));
    var y2 = Math.max(p[1] + p[3], Math.ceil(bb.y + bb.height + pad));
    if (x === p[0] && y === p[1] && x2 === p[0] + p[2] && y2 === p[1] + p[3]) return false;

    svg.setAttribute("viewBox", x + " " + y + " " + (x2 - x) + " " + (y2 - y));
    return true;
  }

  function eng(o) {
    o = o || {};    var sh = sheet(o, [40, 30, 600, 380]);
    var box = sh.box, G = sh.g;
    var ext = o.ext || [160, 100];          /* 可视范围（mm） */
    var s = o.scale || Math.min((box[2] - 24) / ext[0], (box[3] - 24) / ext[1]);
    var ox = box[0] + 12, oy = box[1] + 12;

    function P(x, y) { return [ox + x * s, oy + (ext[1] - y) * s]; }
    function mm(v) { return v * s; }

    var STY = {
      solid: { w: 1.7, dash: null },
      thin: { w: 0.9, dash: null },
      dash: { w: 0.9, dash: "7 4" },
      center: { w: 0.9, dash: "14 3 3 3" },
      phantom: { w: 0.9, dash: "14 3 3 3 3 3" }
    };

    function sty(name, wOverride) {
      var b = STY[name] || STY.thin;
      return { stroke: name === "solid" ? line() : soft(), "stroke-width": wOverride || b.w, dash: b.dash };
    }

    function drawSeg(a, b, st) {
      mk("line", {
        x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        stroke: st.stroke, "stroke-width": st["stroke-width"],
        "stroke-dasharray": st.dash || null, "stroke-linecap": "butt"
      }, G.sym);
    }

    var E = { svg: sh.svg, g: G, at: P, s: s, mm: mm, ext: ext };

    E.line = function (a, b, opt) {
      opt = opt || {};
      drawSeg(P(a[0], a[1]), P(b[0], b[1]), sty(opt.style || "solid", opt.w));
      return E;
    };

    E.poly = function (pts, opt) {
      opt = opt || {};
      if (!pts || pts.length < 2) return E;
      var q = pts.map(function (p) { return P(p[0], p[1]); });
      var d = "";
      for (var i = 0; i < q.length; i++) d += (i ? "L" : "M") + q[i][0].toFixed(2) + " " + q[i][1].toFixed(2);
      if (opt.close) d += "Z";
      var st = sty(opt.style || "solid", opt.w);
      mk("path", {
        d: d, fill: opt.fill ? (opt.fill === true ? MK.tint("gray") : opt.fill) : "none",
        stroke: st.stroke, "stroke-width": st["stroke-width"],
        "stroke-dasharray": st.dash || null, "stroke-linejoin": "round", "stroke-linecap": "round"
      }, G.sym);
      return E;
    };

    E.rect = function (p, w, h, opt) {
      opt = opt || {};
      return E.poly([[p[0], p[1]], [p[0] + w, p[1]], [p[0] + w, p[1] + h], [p[0], p[1] + h]], opt);
    };

    E.circle = function (c, r, opt) {
      opt = opt || {};
      var q = P(c[0], c[1]);
      var st = sty(opt.style || "solid", opt.w);
      mk("circle", {
        cx: q[0], cy: q[1], r: mm(r), fill: opt.fill || "none",
        stroke: st.stroke, "stroke-width": st["stroke-width"], "stroke-dasharray": st.dash || null
      }, G.sym);
      return E;
    };

    E.arc = function (c, r, a1, a2, opt) {
      opt = opt || {};
      var n = 64, pts = [];
      var t1 = a1 * Math.PI / 180, t2 = a2 * Math.PI / 180;
      for (var i = 0; i <= n; i++) {
        var t = t1 + (t2 - t1) * i / n;
        pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
      }
      return E.poly(pts, opt);
    };

    /* 剖面线：把多边形按角度旋转后扫水平线求交，再转回来 */
    E.hatch = function (poly, opt) {
      opt = opt || {};
      var ang = (opt.angle === undefined ? 45 : opt.angle) * Math.PI / 180;
      var gap = opt.gap || 3.2;
      var cx = 0, cy = 0;
      poly.forEach(function (p) { cx += p[0]; cy += p[1]; });
      cx /= poly.length; cy /= poly.length;
      var ca = Math.cos(-ang), sa = Math.sin(-ang);
      var rot = poly.map(function (p) {
        var dx = p[0] - cx, dy = p[1] - cy;
        return [dx * ca - dy * sa, dx * sa + dy * ca];
      });
      var ymin = Infinity, ymax = -Infinity;
      rot.forEach(function (p) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; });
      var st = sty("thin", opt.w || 0.8);
      for (var yy = ymin + gap * 0.5; yy < ymax; yy += gap) {
        var xs = [];
        for (var i = 0; i < rot.length; i++) {
          var a = rot[i], b = rot[(i + 1) % rot.length];
          if ((a[1] <= yy && b[1] > yy) || (b[1] <= yy && a[1] > yy)) {
            var t = (yy - a[1]) / (b[1] - a[1]);
            xs.push(a[0] + t * (b[0] - a[0]));
          }
        }
        xs.sort(function (p, q) { return p - q; });
        for (var j = 0; j + 1 < xs.length; j += 2) {
          var p1 = unrot(xs[j], yy), p2 = unrot(xs[j + 1], yy);
          drawSeg(P(p1[0], p1[1]), P(p2[0], p2[1]), st);
        }
      }
      function unrot(x, y) {
        var c2 = Math.cos(ang), s2 = Math.sin(ang);
        return [cx + x * c2 - y * s2, cy + x * s2 + y * c2];
      }
      return E;
    };

    /* 中心线十字 */
    E.centerMark = function (c, opt) {
      opt = opt || {};
      var r = opt.r || 4;
      E.line([c[0] - r, c[1]], [c[0] + r, c[1]], { style: "center" });
      E.line([c[0], c[1] - r], [c[0], c[1] + r], { style: "center" });
      return E;
    };

    /* 线性尺寸：a、b 是被测两点，offset 是尺寸线沿法向外移的距离（mm） */
    E.dim = function (a, b, opt) {
      opt = opt || {};
      var horiz = opt.dir ? opt.dir === "h" : Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
      var off = Math.abs(opt.offset === undefined ? 12 : opt.offset);
      var val = opt.text || fmtNum(horiz ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]), opt.dp || 0);
      var thin = sty("thin");

      /* side 决定尺寸线落在零件的哪一侧：h 方向默认 bottom（y 更小），v 方向默认 left */
      if (horiz) {
        var side = opt.side || "bottom";
        var baseY = opt.baseY === undefined ? Math.min(a[1], b[1]) : opt.baseY;
        var sg = side === "top" ? 1 : -1;
        var y = baseY + sg * off;
        /* 尺寸界线：从被测点留 1mm 空隙，画到尺寸线外 2mm */
        drawSeg(P(a[0], a[1] + sg * 1), P(a[0], y + sg * 2), thin);
        drawSeg(P(b[0], b[1] + sg * 1), P(b[0], y + sg * 2), thin);
        var d1 = P(a[0], y), d2 = P(b[0], y);
        drawSeg(d1, d2, thin);
        dimArrow(G.sym, d1, d2, thin, mm(3.2)); dimArrow(G.sym, d2, d1, thin, mm(3.2));
        txt(G.over, (d1[0] + d2[0]) / 2, d1[1] - 5, val, { size: 11, fill: soft(), anchor: "middle", mono: true });
      } else {
        var sideV = opt.side || "left";
        var baseX = opt.baseX === undefined ? Math.min(a[0], b[0]) : opt.baseX;
        var sgv = sideV === "right" ? 1 : -1;
        var x = baseX + sgv * off;
        drawSeg(P(a[0] + sgv * 1, a[1]), P(x + sgv * 2, a[1]), thin);
        drawSeg(P(b[0] + sgv * 1, b[1]), P(x + sgv * 2, b[1]), thin);
        var k1 = P(x, a[1]), k2 = P(x, b[1]);
        drawSeg(k1, k2, thin);
        dimArrow(G.sym, k1, k2, thin, mm(3.2)); dimArrow(G.sym, k2, k1, thin, mm(3.2));
        var tx = sgv < 0 ? k1[0] - 5 : k1[0] + 5;
        txt(G.over, tx, (k1[1] + k2[1]) / 2 + 4, val,
          { size: 11, fill: soft(), anchor: sgv < 0 ? "end" : "start", mono: true });
      }
      return E;
    };

    E.dimX = function (a, b, opt) { opt = opt || {}; opt.dir = "h"; return E.dim(a, b, opt); };
    E.dimY = function (a, b, opt) { opt = opt || {}; opt.dir = "v"; return E.dim(a, b, opt); };

    /* 直径 / 半径 */
    E.dimDia = function (c, p, opt) {
      opt = opt || {};
      var thin = sty("thin");
      var dx = p[0] - c[0], dy = p[1] - c[1], L = Math.hypot(dx, dy) || 1;
      var ux = dx / L, uy = dy / L;
      var a = P(c[0] - ux * L, c[1] - uy * L), b = P(c[0] + ux * L, c[1] + uy * L);
      drawSeg(a, b, thin);
      dimArrow(G.sym, a, b, thin, mm(3.2)); dimArrow(G.sym, b, a, thin, mm(3.2));
      var val = opt.text || ("\u03c6" + fmtNum(2 * L, opt.dp || 0));
      txt(G.over, b[0] + (opt.dx === undefined ? 6 : opt.dx), b[1] + (opt.dy === undefined ? 4 : opt.dy), val,
        { size: 11, fill: soft(), anchor: opt.anchor || "start", mono: true });
      return E;
    };

    E.dimRad = function (c, p, opt) {
      opt = opt || {};
      var thin = sty("thin");
      var a = P(c[0], c[1]), b = P(p[0], p[1]);
      drawSeg(a, b, thin);
      dimArrow(G.sym, b, a, thin, mm(3.2));
      var L = Math.hypot(p[0] - c[0], p[1] - c[1]);
      var val = opt.text || ("R" + fmtNum(L, opt.dp || 0));
      txt(G.over, b[0] + (opt.dx === undefined ? 5 : opt.dx), b[1] + (opt.dy === undefined ? -5 : opt.dy),
        val, { size: 11, fill: soft(), anchor: opt.anchor || "start", mono: true });
      return E;
    };

    /* 角度标注：v 是顶点，p1/p2 是两侧点，r 是弧半径（mm） */
    E.dimAngle = function (v, p1, p2, opt) {
      opt = opt || {};
      var thin = sty("thin");
      var a1 = Math.atan2(p1[1] - v[1], p1[0] - v[0]) * 180 / Math.PI;
      var a2 = Math.atan2(p2[1] - v[1], p2[0] - v[0]) * 180 / Math.PI;
      var r = opt.r || Math.min(12, 0.6 * Math.min(
        Math.hypot(p1[0] - v[0], p1[1] - v[1]), Math.hypot(p2[0] - v[0], p2[1] - v[1])));
      E.arc(v, r, a1, a2, { style: "thin" });
      var d = a2 - a1;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      var val = opt.text || (fmtNum(Math.abs(d), 1) + "\u00b0");
      var am = (a1 + d / 2) * Math.PI / 180;
      var q = P(v[0] + (r + 4) * Math.cos(am), v[1] + (r + 4) * Math.sin(am));
      txt(G.over, q[0], q[1] + 4, val, { size: 11, fill: soft(), anchor: "middle", mono: true });
      return E;
    };

    /* 引线标注：从 p 引到 to，再折一小段水平尾巴写文字 */
    E.leader = function (p, to, text, opt) {
      opt = opt || {};
      var thin = sty("thin", opt.w || 0.9);
      var a = P(p[0], p[1]), b = P(to[0], to[1]);
      drawSeg(a, b, thin);
      dimArrow(G.sym, a, b, thin, mm(3.2));
      var tail = opt.tail === undefined ? 14 : opt.tail;
      var dir = b[0] >= a[0] ? 1 : -1;
      var end = [b[0] + dir * tail, b[1]];
      drawSeg(b, end, thin);
      txt(G.over, end[0] + (dir > 0 ? 3 : -3), end[1] - 4, text,
        { size: 11, fill: soft(), anchor: dir > 0 ? "start" : "end", mono: opt.mono !== false });
      return E;
    };

    /* 表面粗糙度（GB）：顶点贴在被测表面上，两条 60° 边向上 */
    E.roughness = function (p, text, opt) {
      opt = opt || {};
      var thin = sty("thin", 1.0);
      var a = P(p[0], p[1]);
      var shortL = mm(2.6), longL = mm(5.2), k = 0.866;
      var l1 = [a[0] - shortL * 0.5, a[1] - shortL * k];
      var l2 = [a[0] + longL * 0.5, a[1] - longL * k];
      drawSeg(a, l1, thin); drawSeg(a, l2, thin);
      txt(G.over, l2[0] + 2, l2[1] - 3, text || "Ra 3.2",
        { size: 10.5, fill: soft(), anchor: opt.anchor || "start", mono: true });
      return E;
    };

    /* 基准符号：方框 + 字母 + 实心三角，p 是贴在要素上的点 */
    E.datum = function (p, letter, opt) {
      opt = opt || {};
      var thin = sty("thin", 1.0);
      var a = P(p[0], p[1]);
      var up = opt.down ? 1 : -1;
      var tri = 6;
      mk("path", {
        d: "M" + a[0] + " " + a[1] +
          "L" + (a[0] - tri * 0.58) + " " + (a[1] + up * tri) +
          "L" + (a[0] + tri * 0.58) + " " + (a[1] + up * tri) + "Z",
        fill: "none", stroke: soft(), "stroke-width": 1
      }, G.sym);
      var by = a[1] + up * (tri + 12);
      drawSeg([a[0], a[1] + up * tri], [a[0], by + up * 6], thin);
      mk("rect", {
        x: a[0] - 7, y: by - 7, width: 14, height: 14,
        fill: "none", stroke: soft(), "stroke-width": 1
      }, G.sym);
      txt(G.over, a[0], by + 4, letter || "A", { size: 11, fill: soft(), anchor: "middle", mono: true });
      return E;
    };

    /* 视图名：文字 + 下方粗划线 */
    E.viewLabel = function (x, y, label, opt) {
      opt = opt || {};
      var q = P(x, y);
      var w = tw(label, 12) + 6;
      txt(G.over, q[0], q[1], label, { size: 12, fill: line(), anchor: "middle" });
      mk("line", { x1: q[0] - w / 2, y1: q[1] + 5, x2: q[0] + w / 2, y2: q[1] + 5, stroke: line(), "stroke-width": 1.6 }, G.over);
      return E;
    };

    /* 剖切符号：粗短画 + 投射箭头 + 字母 */
    E.sectionCut = function (a, b, opt) {
      opt = opt || {};
      var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      var ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      var thick = sty("solid", 2.6);
      [a, b].forEach(function (p, i) {
        var e = [p[0] + ux * 3, p[1] + uy * 3];
        drawSeg(P(p[0] - ux * 3, p[1] - uy * 3), P(e[0], e[1]), thick);
        /* 箭头：先画一段 6mm 的细线，再在末端补实心三角 */
        var tip = [e[0] + nx * 7, e[1] + ny * 7];
        var e1 = P(e[0], e[1]), t1 = P(tip[0], tip[1]);
        drawSeg(e1, t1, thick);
        dimArrow(G.sym, t1, e1, thick, mm(3));
        var lp = P(e[0] + nx * 11, e[1] + ny * 11);
        if (opt.label) txt(G.over, lp[0], lp[1] + 4, opt.label + (i ? "\u2032" : ""), { size: 12, fill: line(), anchor: "middle", mono: true });
      });
      return E;
    };

    /* 零件序号：圆 + 数字 + 引线 */
    E.balloon = function (n, p, opt) {
      opt = opt || {};
      var q = P(p[0], p[1]);
      var r = opt.r || 9;
      var thin = sty("thin");
      if (opt.to) {
        var t = P(opt.to[0], opt.to[1]);
        drawSeg(t, [q[0], q[1] + r], thin);
      }
      mk("circle", { cx: q[0], cy: q[1], r: r, fill: "none", stroke: line(), "stroke-width": 1.2 }, G.over);
      txt(G.over, q[0], q[1] + 4, String(n), { size: 11, fill: line(), anchor: "middle", mono: true });
      return E;
    };

    E.text = function (p, s, opt) {
      opt = opt || {};
      var q = P(p[0], p[1]);
      txt(G.over, q[0] + (opt.dx || 0), q[1] + (opt.dy || 0), s, {
        size: opt.size || 11, fill: opt.color ? MK.accent(opt.color) : soft(),
        anchor: opt.anchor || "start", mono: opt.mono !== false
      });
      return E;
    };

    /* 手动触发（测试/按需重排用）；正常情况下下面这行 rAF 会自动跑一次 */
    E.fit = function () { return fitToContent(sh.svg, sh.wrap, sh.titleEl); };

    /* 模型是同步画完的，所以下一帧就是「脚本已结束」的时刻 */
    if (!o.scale) {
      var raf = g.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      raf(function () { fitToContent(sh.svg, sh.wrap, sh.titleEl); });
    }

    return E;
  }

  MK.schematic = schematic;
  MK.pcb = pcb;
  MK.eng = eng;
})(window);
