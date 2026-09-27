// ============================================================
// 本地测试服务器：把整个插件目录用 http 提供服务，方便在浏览器里打开测试页。
// 用法：node test/serve.js  [端口，默认 8791]
// 然后访问 http://localhost:8791/test/v2-step1.html
//
// 说明：测试页会自己在页面里加载插件脚本（带 chrome 模拟），
//       所以直接用 file:// 双击打开也能跑，这个服务器只是备选方案。
// ============================================================
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2] || 8791);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf"
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const target = path.normalize(path.join(ROOT, urlPath));
  if (!target.startsWith(path.normalize(ROOT))) { res.writeHead(403); return res.end("forbidden"); }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  res.end(fs.readFileSync(target));
});

server.listen(PORT, () => {
  console.log("测试服务器已启动");
  console.log("  根目录：" + ROOT);
  console.log("  第一步：http://localhost:" + PORT + "/test/v2-step1.html");
  console.log("  第二步：http://localhost:" + PORT + "/test/v2-step2.html");
  console.log("  第三步：http://localhost:" + PORT + "/test/v3-step3.html");
  console.log("  第四步：http://localhost:" + PORT + "/test/v4-step4.html");
  console.log("  第五步：http://localhost:" + PORT + "/test/v5-step5.html");
  console.log("  显隐回归：http://localhost:" + PORT + "/test/v6-hud-visible.html");
  console.log("  匹配端到端：http://localhost:" + PORT + "/test/v7-match.html");
  console.log("  按 Ctrl+C 停止");
});
