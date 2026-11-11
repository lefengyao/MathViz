(function (g) {
  "use strict";

  var MK = g.MK;
  if (!MK) throw new Error("mk-core.js must load before mk-graph.js");
  var mk = MK.mk, tw = MK.textWidth;

  function distSeg(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var L2 = dx * dx + dy * dy;
    var t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function graph(o) {
    o = o || {};
    var box = o.box || [40, 24, 600, 360];
    var bx = box[0], by = box[1], bw = box[2], bh = box[3];
    var H = o.h || Math.ceil(by + bh + 26);
    var directed = o.directed !== false;

    var nodes = (o.nodes || []).map(function (n) {
      if (typeof n === "string") return { id: n, label: n };
      var c = {};
      for (var k in n) c[k] = n[k];
      c.id = n.id !== undefined ? n.id : n.label;
      c.label = n.label !== undefined ? n.label : n.id;
      return c;
    });
    var ix = {};
    nodes.forEach(function (n, i) { ix[n.id] = i; n._i = i; });

    var edges = (o.edges || []).map(function (e) {
      if (Array.isArray(e)) return { s: e[0], t: e[1], label: e[2] };
      var c = {};
      for (var k in e) c[k] = e[k];
      return c;
    });

    var svg = mk("svg", {
      viewBox: "0 0 " + (o.w || 680) + " " + H,
      width: "100%", role: "img", xmlns: "http://www.w3.org/2000/svg"
    });
    svg.style.display = "block";
    mk("title", null, svg).textContent = o.title || "关系图";
    mk("desc", null, svg).textContent = o.desc || "";

    var gEdges = mk("g", null, svg);
    var gNodes = mk("g", null, svg);
    var gLabels = mk("g", null, svg);
    var gTop = mk("g", null, svg);
    var gInfo = mk("g", null, svg);

    /* —— 节点点选：点击高亮 + 底部信息栏；节点带 info 时显示说明文字 —— */
    var selNode = null;
    var infoText = "";
    var pickCb = null;

    function drawInfo() {
      while (gInfo.firstChild) gInfo.removeChild(gInfo.firstChild);
      if (!infoText) return;
      var W = o.w || 680;
      var tw = Math.min(MK.textWidth(infoText, 12) + 20, W - 24);
      var Hh = H;
      mk("rect", {
        x: 10, y: Hh - 30, width: tw, height: 22, rx: 6,
        fill: MK.dark ? "#45423A" : "#33312B", "fill-opacity": 0.9, stroke: "none"
      }, gInfo);
      MK.txt(gInfo, 20, Hh - 15, infoText, { size: 12, fill: "#F5F3EC" });
    }

    svg.addEventListener("click", function (e) {
      var t = e.target;
      var id = t && t.__mvNode;
      if (id !== undefined && id !== null) {
        var n = nodes[ix[id]];
        if (selNode === id) { selNode = null; infoText = ""; }
        else { selNode = id; infoText = (n && n.info) ? n.info : ("节点 " + (n && n.label !== undefined ? n.label : id)); }
        G.draw();
        if (pickCb) pickCb(selNode === null ? null : id, n);
        return;
      }
      if (selNode !== null) { selNode = null; infoText = ""; G.draw(); if (pickCb) pickCb(null); }
    });

    var G = {
      svg: svg, nodes: nodes, edges: edges, ix: ix,
      gEdges: gEdges, gNodes: gNodes, gTop: gTop,
      W: o.w || 680, H: H,
      color: MK.accent, tint: MK.tint, strong: MK.strong, ink: MK.ink,
      dark: MK.dark
    };

    function radius(n) {
      if (n.r) return n.r;
      var s = String(n.label === undefined ? n.id : n.label);
      return Math.max(15, tw(s, 12) / 2 + 9);
    }
    G.radius = radius;

    G.layoutCircle = function (opt) {
      opt = opt || {};
      var cx = opt.cx || bx + bw / 2;
      var cy = opt.cy || by + bh / 2;
      var maxR = 0;
      nodes.forEach(function (n) { maxR = Math.max(maxR, radius(n)); });
      var R = opt.r || Math.min(bw, bh) / 2 - maxR - 18;
      nodes.forEach(function (n, i) {
        if (n.fixed) return;
        var a = -Math.PI / 2 + i * 2 * Math.PI / nodes.length;
        n.x = cx + R * Math.cos(a);
        n.y = cy + R * Math.sin(a);
      });
      return G;
    };

    G.layoutGrid = function (opt) {
      opt = opt || {};
      var cols = opt.cols || Math.ceil(Math.sqrt(nodes.length));
      var gx = bw / (cols + 1);
      var rows = Math.ceil(nodes.length / cols);
      var gy = bh / (rows + 0.6);
      nodes.forEach(function (n, i) {
        n.x = bx + gx * (i % cols + 1);
        n.y = by + gy * (Math.floor(i / cols) + 0.8);
      });
      return G;
    };

    G.layoutTree = function (rootId, opt) {
      opt = opt || {};
      var root = ix[rootId] !== undefined ? ix[rootId] : 0;
      var adj = {};
      nodes.forEach(function (n) { adj[n.id] = []; });
      edges.forEach(function (e) {
        adj[e.s].push(e.t);
        if (!directed) adj[e.t].push(e.s);
      });
      var depth = {}, q = [nodes[root].id];
      depth[nodes[root].id] = 0;
      while (q.length) {
        var u = q.shift();
        (adj[u] || []).forEach(function (v) {
          if (depth[v] === undefined) { depth[v] = depth[u] + 1; q.push(v); }
        });
      }
      nodes.forEach(function (n) {
        if (depth[n.id] === undefined) depth[n.id] = 0;
      });
      var levels = {};
      nodes.forEach(function (n) { (levels[depth[n.id]] = levels[depth[n.id]] || []).push(n.id); });
      var keys = Object.keys(levels).map(Number).sort(function (a, b) { return a - b; });
      var maxW = 0;
      keys.forEach(function (d) { maxW = Math.max(maxW, levels[d].length); });
      var slot = Math.min(100, bw / (maxW + 0.3));
      var rowH = keys.length > 1 ? bh / (keys.length + 0.15) : 0;
      keys.forEach(function (d, di) {
        var arr = levels[d];
        var startX = bx + bw / 2 - (arr.length - 1) * slot / 2;
        arr.forEach(function (id, k) {
          var n = nodes[ix[id]];
          if (n.fixed) return;
          n.x = startX + k * slot;
          n.y = by + rowH * (di + 0.65);
        });
      });
      return G;
    };

    G.layoutLayered = function (opt) {
      opt = opt || {};
      var indeg = {}, adj = {}, pred = {};
      nodes.forEach(function (n) { indeg[n.id] = 0; adj[n.id] = []; pred[n.id] = []; });
      edges.forEach(function (e) {
        if (!adj[e.s] || !adj[e.t]) return;
        adj[e.s].push(e.t);
        pred[e.t].push(e.s);
        indeg[e.t] = (indeg[e.t] || 0) + 1;
      });
      var layer = {}, done = {};
      var cur = [];
      nodes.forEach(function (n) { if (!indeg[n.id]) { layer[n.id] = 0; cur.push(n.id); } });
      if (!cur.length) nodes.forEach(function (n) { layer[n.id] = 0; });
      var guard = 0;
      while (cur.length && guard++ < 300) {
        var next = [];
        cur.forEach(function (id) {
          if (done[id]) return;
          done[id] = 1;
          (adj[id] || []).forEach(function (v) {
            indeg[v]--;
            if (indeg[v] === 0) { layer[v] = (layer[id] || 0) + 1; next.push(v); }
          });
        });
        cur = next;
      }
      nodes.forEach(function (n) { if (layer[n.id] === undefined) layer[n.id] = 0; });

      var levels = {};
      nodes.forEach(function (n) { (levels[layer[n.id]] = levels[layer[n.id]] || []).push(n.id); });
      var keys = Object.keys(levels).map(Number).sort(function (a, b) { return a - b; });

      var posIdx = {};
      function reindex() {
        keys.forEach(function (d) {
          levels[d].forEach(function (id, i) { posIdx[id] = i; });
        });
      }
      reindex();
      for (var pass = 0; pass < 4; pass++) {
        for (var ki = 1; ki < keys.length; ki++) {
          var arr = levels[keys[ki]];
          arr.sort(function (a, b) {
            var pa = pred[a].filter(function (id) { return posIdx[id] !== undefined; });
            var pb = pred[b].filter(function (id) { return posIdx[id] !== undefined; });
            var va = pa.length ? pa.reduce(function (s, id) { return s + posIdx[id]; }, 0) / pa.length : 999;
            var vb = pb.length ? pb.reduce(function (s, id) { return s + posIdx[id]; }, 0) / pb.length : 999;
            return va - vb;
          });
          reindex();
        }
      }

      var rowH = bh / (keys.length + 0.45);
      var maxW = 0;
      keys.forEach(function (d) { maxW = Math.max(maxW, levels[d].length); });
      keys.forEach(function (d, di) {
        var arr = levels[d];
        var gx = arr.length > 1 ? bw / (arr.length - 1 + 0.9) : bw;
        arr.forEach(function (id, k) {
          var n = nodes[ix[id]];
          if (n.fixed) return;
          n.x = arr.length > 1 ? bx + bw * 0.05 + gx * k : bx + bw / 2;
          n.y = by + rowH * (di + 0.7);
        });
      });
      return G;
    };

    G.layoutForce = function (opt) {
      opt = opt || {};
      var iters = opt.iters || 320;
      var n0 = nodes.length;
      if (n0 === 1) { nodes[0].x = bx + bw / 2; nodes[0].y = by + bh / 2; return G; }
      G.layoutCircle({ r: Math.min(bw, bh) * 0.34 });
      var k = Math.sqrt(bw * bh / n0) * 0.72;
      var t = bw * 0.09;
      var disp, i, j;
      for (var it = 0; it < iters; it++) {
        disp = nodes.map(function () { return { x: 0, y: 0 }; });
        for (i = 0; i < n0; i++) {
          for (j = i + 1; j < n0; j++) {
            var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
            var d = Math.hypot(dx, dy) || 0.01;
            var f = k * k / d;
            disp[i].x += dx / d * f; disp[i].y += dy / d * f;
            disp[j].x -= dx / d * f; disp[j].y -= dy / d * f;
          }
        }
        edges.forEach(function (e) {
          var a = nodes[ix[e.s]], b = nodes[ix[e.t]];
          if (!a || !b) return;
          var dx = a.x - b.x, dy = a.y - b.y;
          var d = Math.hypot(dx, dy) || 0.01;
          var f = d * d / k;
          disp[ix[e.s]].x -= dx / d * f; disp[ix[e.s]].y -= dy / d * f;
          disp[ix[e.t]].x += dx / d * f; disp[ix[e.t]].y += dy / d * f;
        });
        for (i = 0; i < n0; i++) {
          var dd = Math.hypot(disp[i].x, disp[i].y) || 0.01;
          var lim = Math.min(dd, t);
          nodes[i].x += disp[i].x / dd * lim;
          nodes[i].y += disp[i].y / dd * lim;
          var rr = radius(nodes[i]);
          nodes[i].x = Math.max(bx + rr + 4, Math.min(bx + bw - rr - 4, nodes[i].x));
          nodes[i].y = Math.max(by + rr + 4, Math.min(by + bh - rr - 4, nodes[i].y));
        }
        t *= 0.985;
      }
      return G;
    };

    G.layout = function (kind, opt) {
      kind = kind || o.layout || "circle";
      if (kind === "circle") return G.layoutCircle(opt);
      if (kind === "tree") return G.layoutTree(o.root || nodes[0].id, opt);
      if (kind === "layered") return G.layoutLayered(opt);
      if (kind === "force") return G.layoutForce(opt);
      if (kind === "grid") return G.layoutGrid(opt);
      return G;
    };

    var groups = {};
    function buildGroups() {
      groups = {};
      edges.forEach(function (e) {
        var k = e.s === e.t ? "self" + e.s : (e.s < e.t ? e.s + "_" + e.t : e.t + "_" + e.s);
        (groups[k] = groups[k] || []).push(e);
      });
    }

    function clearAll() {
      [gEdges, gNodes, gLabels, gTop].forEach(function (gg) {
        while (gg.firstChild) gg.removeChild(gg.firstChild);
      });
    }
    G.clear = function () { clearAll(); return G; };

    function route(e, curveAll) {
      var na = nodes[ix[e.s]], nb = nodes[ix[e.t]];
      if (!na || !nb) return null;
      var ra = radius(na), rb = radius(nb);
      if (e.s === e.t) return { self: true, na: na, ra: ra };

      if (e._geo) return e._geo;

      var a0 = { x: na.x, y: na.y }, b0 = { x: nb.x, y: nb.y };
      var dx = b0.x - a0.x, dy = b0.y - a0.y;
      var L = Math.hypot(dx, dy) || 1;
      var ux = dx / L, uy = dy / L;
      var key = e.s < e.t ? e.s + "_" + e.t : e.t + "_" + e.s;
      var grp = groups[key] || [e];
      var gi = grp.indexOf(e);
      var off = 0;
      if (grp.length > 1) off = (gi - (grp.length - 1) / 2) * 26;
      if (curveAll && !off) off = 24;

      var sx = a0.x + ux * ra, sy = a0.y + uy * ra;
      var ex = b0.x - ux * rb, ey = b0.y - uy * rb;
      if (directed) { ex -= ux * 8; ey -= uy * 8; }

      var best = null;
      for (var k = 0; k < nodes.length; k++) {
        var nn = nodes[k];
        if (nn.id === e.s || nn.id === e.t) continue;
        var dd = distSeg(nn.x, nn.y, a0.x, a0.y, b0.x, b0.y);
        var rr = radius(nn);
        if (dd < rr + 10 && (!best || dd - rr < best.gap)) best = { n: nn, gap: dd - rr };
      }
      if (best && !off) {
        var cr = ux * (best.n.y - a0.y) - uy * (best.n.x - a0.x);
        off = (cr > 0 ? -1 : 1) * (radius(best.n) + 30);
      }

      var geo = { sx: sx, sy: sy, ex: ex, ey: ey, ux: ux, uy: uy, off: off, na: na, nb: nb };
      e._geo = geo;
      return geo;
    }
    var routeKey = 0;
    G.invalidate = function () {
      routeKey++;
      edges.forEach(function (e) { e._geo = null; });
      return G;
    };

    function arrowHead(x1, y1, x2, y2, col) {
      var dx = x1 - x2, dy = y1 - y2;
      var L = Math.hypot(dx, dy) || 1;
      var ux = dx / L, uy = dy / L;
      var s = 6.5;
      mk("path", {
        d: "M" + x1 + " " + y1 +
          "L" + (x1 - ux * s - uy * s * 0.42) + " " + (y1 - uy * s + ux * s * 0.42) +
          "L" + (x1 - ux * s + uy * s * 0.42) + " " + (y1 - uy * s - ux * s * 0.42) + "Z",
        fill: col, stroke: "none"
      }, gEdges);
    }

    G.draw = function (opt) {
      opt = opt || {};
      clearAll();
      buildGroups();
      G.invalidate();

      edges.forEach(function (e) {
        var g = route(e, opt.curve === "all");
        if (!g) return;
        var col = e.color ? MK.accent(e.color) : (opt.edgeColor ? MK.accent(opt.edgeColor) : MK.ink());
        var w = e.w || 1.4;
        var dash = e.dash ? "5 4" : null;

        if (g.self) {
          var c0 = g.na, r0 = g.ra;
          mk("path", {
            d: "M" + (c0.x - r0 * 0.62) + " " + (c0.y - r0 * 0.72) +
              "C" + (c0.x - r0 * 1.7) + " " + (c0.y - r0 * 2.05) + " " +
              (c0.x + r0 * 1.7) + " " + (c0.y - r0 * 2.05) + " " +
              (c0.x + r0 * 0.62) + " " + (c0.y - r0 * 0.72),
            fill: "none", stroke: col, "stroke-width": w, "stroke-dasharray": dash
          }, gEdges);
          if (directed) arrowHead(c0.x + r0 * 0.62, c0.y - r0 * 0.72, c0.x + r0 * 0.62, c0.y - r0 * 1.4, col);
          if (e.label) MK.txt(gLabels, c0.x, c0.y - r0 * 1.86, String(e.label), { size: 11, fill: col, anchor: "middle" });
          return;
        }

        if (g.off !== 0) {
          var mxp = (g.sx + g.ex) / 2, myp = (g.sy + g.ey) / 2;
          var px = -g.uy, py = g.ux;
          var cxp = mxp + px * g.off * 1.55, cyp = myp + py * g.off * 1.55;
          mk("path", {
            d: "M" + g.sx + " " + g.sy + "Q" + cxp + " " + cyp + " " + g.ex + " " + g.ey,
            fill: "none", stroke: col, "stroke-width": w, "stroke-dasharray": dash
          }, gEdges);
          if (directed) arrowHead(g.ex, g.ey, cxp, cyp, col);
          if (e.label) {
            var qx = 0.25 * g.sx + 0.5 * cxp + 0.25 * g.ex;
            var qy = 0.25 * g.sy + 0.5 * cyp + 0.25 * g.ey;
            MK.txt(gLabels, qx + px * 9, qy + py * 9 + 4, String(e.label), { size: 11, fill: col, anchor: "middle" });
          }
        } else {
          mk("line", {
            x1: g.sx, y1: g.sy, x2: g.ex, y2: g.ey, stroke: col,
            "stroke-width": w, "stroke-dasharray": dash, "stroke-linecap": "round"
          }, gEdges);
          if (directed) arrowHead(g.ex, g.ey, g.sx, g.sy, col);
          if (e.label) {
            var px2 = -g.uy, py2 = g.ux;
            MK.txt(gLabels, (g.sx + g.ex) / 2 + px2 * 11, (g.sy + g.ey) / 2 + py2 * 11 + 4, String(e.label), {
              size: 11, fill: col, anchor: "middle"
            });
          }
        }
      });

      nodes.forEach(function (n) {
        var r = radius(n);
        var sel = selNode === n.id;
        var fill = n.fill || MK.tint(n.color || (opt.nodeColor || "blue"));
        var stroke = sel ? MK.strong(n.color || opt.nodeColor || "blue")
          : (n.color ? MK.accent(n.color) : MK.accent(opt.nodeColor || "blue"));
        var circ = mk("circle", {
          cx: n.x, cy: n.y, r: r, fill: fill, stroke: stroke,
          "stroke-width": sel ? 3 : (n.w || 1.4), "fill-opacity": 0.85
        }, gNodes);
        circ.style.cursor = "pointer";
        circ.__mvNode = n.id;
        if (n.accept) {
          mk("circle", { cx: n.x, cy: n.y, r: r - 4, fill: "none", stroke: stroke, "stroke-width": 1.2 }, gNodes);
        }
        var lab = MK.txt(gNodes, n.x, n.y + 4.5, String(n.label), {
          size: n.size || 12,
          fill: n.textColor ? MK.strong(n.textColor) : MK.strong(n.color || opt.nodeColor || "blue"),
          anchor: "middle"
        });
        lab.style.cursor = "pointer";
        lab.__mvNode = n.id;
        if (n.sub) {
          MK.txt(gNodes, n.x, n.y + r + 13, String(n.sub), { size: 11, fill: MK.ink(), anchor: "middle" });
        }
      });
      drawInfo();
      return G;
    };

    /* 点选交互：G.onPick(fn) 注册回调；G.pick(id) 程序化选中 */
    G.onPick = function (fn) { pickCb = fn || null; return G; };
    G.pick = function (id) {
      selNode = (id !== null && ix[id] !== undefined) ? id : null;
      infoText = "";
      if (selNode !== null) {
        var n = nodes[ix[selNode]];
        infoText = (n && n.info) ? n.info : ("节点 " + (n && n.label !== undefined ? n.label : selNode));
      }
      G.draw();
      return G;
    };

    function findEdge(s, t) {
      for (var i = 0; i < edges.length; i++) {
        if (edges[i].s === s && edges[i].t === t) return edges[i];
        if (!directed && edges[i].s === t && edges[i].t === s) return edges[i];
      }
      return null;
    }

    G.path = function (seq, opt) {
      opt = opt || {};
      var col = MK.accent(opt.color || "red");
      if (!Object.keys(groups).length) buildGroups();
      for (var i = 0; i < seq.length - 1; i++) {
        var e = findEdge(seq[i], seq[i + 1]);
        if (!e) { e = { s: seq[i], t: seq[i + 1] }; }
        var g = route(e);
        if (!g) continue;
        var w = opt.w || 3;
        if (g.off !== 0) {
          var mxp = (g.sx + g.ex) / 2, myp = (g.sy + g.ey) / 2;
          var px = -g.uy, py = g.ux;
          var cxp = mxp + px * g.off * 1.55, cyp = myp + py * g.off * 1.55;
          mk("path", {
            d: "M" + g.sx + " " + g.sy + "Q" + cxp + " " + cyp + " " + g.ex + " " + g.ey,
            fill: "none", stroke: col, "stroke-width": w, "stroke-linecap": "round", opacity: 0.88
          }, gTop);
          if (directed) arrowHeadTop(g.ex, g.ey, cxp, cyp, col);
        } else {
          mk("line", {
            x1: g.sx, y1: g.sy, x2: g.ex, y2: g.ey,
            stroke: col, "stroke-width": w, "stroke-linecap": "round", opacity: 0.88
          }, gTop);
          if (directed) arrowHeadTop(g.ex, g.ey, g.sx, g.sy, col);
        }
      }
      return G;
    };

    function arrowHeadTop(x1, y1, x2, y2, col) {
      var dx = x1 - x2, dy = y1 - y2;
      var L = Math.hypot(dx, dy) || 1;
      var ux = dx / L, uy = dy / L;
      var s = 7.5;
      mk("path", {
        d: "M" + x1 + " " + y1 +
          "L" + (x1 - ux * s - uy * s * 0.44) + " " + (y1 - uy * s + ux * s * 0.44) +
          "L" + (x1 - ux * s + uy * s * 0.44) + " " + (y1 - uy * s - ux * s * 0.44) + "Z",
        fill: col, stroke: "none"
      }, gTop);
    }

    G.mark = function (id, opt) {
      opt = opt || {};
      var n = nodes[ix[id]];
      if (!n) return G;
      mk("circle", {
        cx: n.x, cy: n.y, r: radius(n) + (opt.gap || 5),
        fill: "none", stroke: MK.accent(opt.color || "red"),
        "stroke-width": opt.w || 2, opacity: 0.9
      }, gTop);
      return G;
    };

    return G;
  }

  MK.graph = graph;

  MK.matrix = function (o) {
    o = o || {};
    var x = o.x || 80, y = o.y || 48, c = o.cell || 34;
    var rows = o.rows || [], cols = o.cols || rows;
    var data = o.data || [];
    var svg = o.svg || mk("svg", {
      viewBox: "0 0 " + (o.w || 680) + " " + Math.ceil(y + rows.length * c + 50),
      width: "100%", role: "img", xmlns: "http://www.w3.org/2000/svg"
    });
    if (!o.svg) svg.style.display = "block";
    var g = mk("g", null, svg);
    var faint = MK.dark ? "#55534E" : "#D3D1C7";

    if (o.label) MK.txt(g, x - 26, y - 30, o.label, { size: 12, fill: MK.ink() });
    cols.forEach(function (cl, j) {
      MK.txt(g, x + c * (j + 0.5), y - 10, String(cl), {
        size: 12, fill: MK.ink(), anchor: "middle", italic: true, serif: true
      });
    });
    rows.forEach(function (rl, i) {
      MK.txt(g, x - 10, y + c * (i + 0.5) + 4, String(rl), {
        size: 12, fill: MK.ink(), anchor: "end", italic: true, serif: true
      });
      cols.forEach(function (cl, j) {
        var v = data[i] ? data[i][j] : "";
        var on = v === 1 || v === "1" || v === true;
        mk("rect", {
          x: x + c * j, y: y + c * i, width: c, height: c,
          fill: on ? MK.tint("blue") : "none",
          stroke: faint, "stroke-width": 0.5
        }, g);
        MK.txt(g, x + c * (j + 0.5), y + c * (i + 0.5) + 4.5, String(v), {
          size: 12, fill: on ? MK.strong("blue") : MK.ink(),
          anchor: "middle", mono: true, weight: on ? 500 : 400
        });
      });
    });
    mk("rect", {
      x: x, y: y, width: c * cols.length, height: c * rows.length,
      fill: "none", stroke: MK.ink(), "stroke-width": 1
    }, g);
    return svg;
  };

  MK.venn = function (o) {
    o = o || {};
    var box = o.box || [40, 24, 600, 320];
    var bx = box[0], by = box[1], bw = box[2], bh = box[3];
    var sets = o.sets || [];
    var r = o.r || Math.min(bw / 3.4, bh / 2.95);
    var cy = by + bh / 2 + 0.115 * r;
    var H = o.h || Math.ceil(cy + r * 1.86 + 14);
    var svg = mk("svg", {
      viewBox: "0 0 " + (o.w || 680) + " " + H,
      width: "100%", role: "img", xmlns: "http://www.w3.org/2000/svg"
    });
    svg.style.display = "block";
    mk("title", null, svg).textContent = o.title || "集合关系";
    var g = mk("g", null, svg);
    var cx = bx + bw / 2;
    var pos;
    if (sets.length === 2) {
      pos = [[cx - r * 0.55, cy], [cx + r * 0.55, cy]];
    } else {
      pos = [[cx - r * 0.5, cy - r * 0.32], [cx + r * 0.5, cy - r * 0.32], [cx, cy + r * 0.55]];
    }
    sets.forEach(function (s, i) {
      var c = s.color || ["blue", "coral", "teal"][i % 3];
      mk("circle", {
        cx: pos[i][0], cy: pos[i][1], r: r,
        fill: MK.tint(c), "fill-opacity": 0.32,
        stroke: MK.accent(c), "stroke-width": 1.4
      }, g);
      var ly = sets.length === 2 ? pos[i][1] - r - 10
        : (i < 2 ? pos[i][1] - r - 10 : pos[i][1] + r + 20);
      MK.txt(g, pos[i][0], ly, String(s.label || i), {
        size: 13, fill: MK.strong(c), anchor: "middle", italic: true, serif: true
      });
    });
    var PRESET3 = {
      a: [-1.15, -0.18], b: [1.15, -0.18], c: [0, 1.32],
      ab: [0, -0.82], ac: [-0.62, 0.32], bc: [0.62, 0.32], abc: [0, 0.02]
    };
    var PRESET2 = { a: [-1.35, 0], b: [1.35, 0], ab: [0, 0] };

    if (o.labels) {
      var pre = sets.length === 2 ? PRESET2 : PRESET3;
      Object.keys(o.labels).forEach(function (key) {
        var p = pre[key];
        if (!p) return;
        MK.txt(g, cx + p[0] * r, cy + p[1] * r + 4, String(o.labels[key]), {
          size: 12, fill: MK.ink(), anchor: "middle"
        });
      });
    }

    (o.regions || []).forEach(function (rg) {
      var p = pos[rg.set];
      if (!p) return;
      var px2 = rg.at ? cx + rg.at[0] : p[0] + (rg.dx || 0);
      var py2 = rg.at ? cy + rg.at[1] : p[1] + (rg.dy || 0);
      MK.txt(g, px2, py2, String(rg.text), {
        size: 12, fill: rg.color ? MK.strong(rg.color) : MK.ink(), anchor: "middle"
      });
    });
    return svg;
  };
})(window);
