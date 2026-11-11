import fs from "node:fs";
import path from "node:path";

const input = process.argv[2];
const output = process.argv[3];

if (!input) {
  console.error("用法: node build-standalone.mjs <输入.html> [输出.html]");
  process.exit(2);
}
if (!fs.existsSync(input)) {
  console.error("文件不存在: " + input);
  process.exit(2);
}

const out = output || input.replace(/\.html?$/i, "") + ".standalone.html";
let html = fs.readFileSync(input, "utf8");
let inlined = 0;

html = html.replace(
  /<script\s+src=["']([^"']+)["']\s*>\s*<\/script>/gi,
  function (whole, src) {
    if (/^(https?:)?\/\//.test(src)) return whole;
    const file = path.resolve(path.dirname(path.resolve(input)), src);
    if (!fs.existsSync(file)) {
      console.warn("跳过（找不到文件）: " + src);
      return whole;
    }
    inlined++;
    const code = fs.readFileSync(file, "utf8").replace(/<\/script>/gi, "<\\/script>");
    return "<script>\n" + code + "\n</script>";
  }
);

fs.writeFileSync(out, html, "utf8");
const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`已生成 ${out}（内联 ${inlined} 个脚本，${kb} KB）`);
