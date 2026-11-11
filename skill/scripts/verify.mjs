import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const EDGE = process.env.MK_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const PROBE = `
<div id="mk-diag-host"></div>
<script>
(function(){
  var out = [];
  var svgs = document.querySelectorAll("svg");
  for (var i = 0; i < svgs.length; i++) {
    var svg = svgs[i];
    var vb = (svg.getAttribute("viewBox") || "0 0 680 400").trim().split(/\\s+/).map(Number);
    var W = vb[2], H = vb[3];
    var overflow = [], small = [], noFill = 0, clipped = 0;
    var nodes = svg.querySelectorAll("text,path,line,circle,rect,polygon,polyline");
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j], b;
      try { b = el.getBBox(); } catch (e) { continue; }
      if (!b || (b.width === 0 && b.height === 0)) continue;
      var inClip = el.closest ? el.closest("[clip-path]") : null;
      var outside = b.x < -1 || b.y < -1 || b.x + b.width > W + 1 || b.y + b.height > H + 1;
      if (outside) {
        if (inClip && el.tagName !== "text") { clipped++; continue; }
        overflow.push({
          tag: el.tagName,
          x: +b.x.toFixed(1), y: +b.y.toFixed(1),
          w: +b.width.toFixed(1), h: +b.height.toFixed(1),
          t: (el.textContent || "").replace(/\\s+/g, " ").slice(0, 20)
        });
      }
      if (el.tagName === "text") {
        var fsz = parseFloat(getComputedStyle(el).fontSize || "0");
        if (fsz && fsz < 11) small.push({ t: (el.textContent || "").slice(0, 16), fs: fsz });
      }
      if ((el.tagName === "path" || el.tagName === "rect" || el.tagName === "circle" || el.tagName === "polygon") &&
          el.getAttribute("fill") === null && getComputedStyle(el).fill === "none") noFill++;
    }
    out.push({
      svg: i, W: W, H: H,
      nodes: nodes.length,
      dashed: svg.querySelectorAll("[stroke-dasharray]").length,
      overflowCount: overflow.length,
      overflow: overflow.slice(0, 10),
      smallText: small.slice(0, 5),
      clippedOffscreen: clipped
    });
  }
  var ta = document.createElement("textarea");
  ta.id = "mk-diag";
  ta.textContent = JSON.stringify(out);
  document.body.appendChild(ta);
  document.title = "MKDIAG " + out.length + " SVGS";
})();
</script>
`;

function run(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error("文件不存在: " + abs);
    process.exit(2);
  }
  const html = fs.readFileSync(abs, "utf8");
  const injected = html.replace(/<\/body>/i, PROBE + "\n</body>");
  const tmp = path.join(path.dirname(abs), ".mk-verify-" + path.basename(abs));
  fs.writeFileSync(tmp, injected, "utf8");

  let dom = "";
  try {
    dom = execFileSync(EDGE, [
      "--headless=new", "--disable-gpu", "--no-first-run",
      "--user-data-dir=" + path.join(os.tmpdir(), "mk-verify-profile"),
      "--virtual-time-budget=2500",
      "--dump-dom",
      pathToFileURL(tmp).href
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    console.error("浏览器执行失败: " + e.message);
    process.exit(3);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }

  const m = dom.match(/<textarea id="mk-diag">([\s\S]*?)<\/textarea>/);
  if (!m) {
    console.error("未取到检测结果，页面脚本可能未执行");
    process.exit(4);
  }
  const raw = m[1]
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&");

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    console.error("结果解析失败: " + raw.slice(0, 200));
    process.exit(5);
  }

  let bad = 0;
  console.log("\n文件: " + path.basename(abs));
  console.log("-".repeat(62));
  for (const s of data) {
    const tag = s.overflowCount > 0 || s.smallText.length > 0 ? "FAIL" : "OK  ";
    if (tag === "FAIL") bad++;
    console.log(
      `${tag} 图 ${s.svg + 1}  viewBox ${s.W}x${s.H}  元素 ${s.nodes}  虚线 ${s.dashed}` +
      (s.clippedOffscreen ? `  已裁剪(${s.clippedOffscreen})` : "")
    );
    for (const o of s.overflow) {
      console.log(`      越界 ${o.tag} [${o.x},${o.y} ${o.w}x${o.h}] ${o.t ? '"' + o.t + '"' : ""}`);
    }
    for (const t of s.smallText) {
      console.log(`      字号过小 ${t.fs}px "${t.t}"`);
    }
  }
  console.log("-".repeat(62));
  console.log(bad === 0 ? `全部通过（${data.length} 张图）` : `${bad}/${data.length} 张图有问题`);
  process.exit(bad === 0 ? 0 : 1);
}

run(process.argv[2] || "");
