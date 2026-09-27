// ============================================================
// 自动跑测试页并把断言结果打印到终端
//
// 用法（在插件目录下）：
//   node test/run-page.js                  # 默认跑 v2-step2.html
//   node test/run-page.js v2-step1.html    # 指定页面
//
// 它做三件事：起一个临时静态服务器 → 用系统 Chrome 无头打开测试页 →
// 等页面自己跑完断言后，把逐项结果和失败原因打印出来。
//
// 依赖 playwright-core（只要环境里能 require 到就行，不装进本项目）。
// 用 WorkBuddy 托管的 Node 运行时，需要带上 NODE_PATH：
//   export NODE_PATH="C:\Users\<你>\.workbuddy\binaries\node\workspace\node_modules"
// 如果环境里没有 playwright-core，直接双击测试页在浏览器里手工看结果也一样。
// ============================================================
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PAGE = process.argv[2] || "v2-step2.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf"
};

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const target = path.normalize(path.join(ROOT, urlPath));
      if (!target.startsWith(path.normalize(ROOT)) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(fs.readFileSync(target));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

  // 诊断打点：默认关闭，排查"结果打印完了进程却不退出"时开 JIANLI_TRACE=1。
  // 用 appendFileSync 是刻意的 —— 走同步写，不受 stdout 缓冲和事件循环影响。
  const TRACE_ON = !!process.env.JIANLI_TRACE;
  const TRACE = path.join(os.tmpdir(), "jianli-runpage-trace.log");
  const T0 = Date.now();
  const trace = msg => {
    if (!TRACE_ON) return;
    try { fs.appendFileSync(TRACE, "+" + (Date.now() - T0) + "ms " + PAGE + " " + msg + "\n"); } catch (e) {}
  };

  // 结果落盘（同步追加，一行一个 JSON）。作用有两个：
  // 1) 外层批量跑（test/run-all.js）据此判定通过与否 —— 不依赖退出码，因为
  //    下面那个"退出时同步 flush 管道阻塞"的坑会让退出码变得不可靠；
  // 2) 万一进程最后被杀掉，已经写好的结果也不会丢。
  const RESULT_FILE = path.join(__dirname, ".last-run.jsonl");
  const writeResult = (code, counts, note) => {
    try {
      fs.appendFileSync(RESULT_FILE, JSON.stringify({
        page: PAGE, code, ...counts, note: note || "", at: new Date().toISOString()
      }) + "\n");
    } catch (e) {}
  };

  // 无头 Chrome 在 Windows 上有个坑：browser.close() 经常不返回（实测每页都卡满
  // 兜底的 3 秒），于是 Chrome 变成孤儿进程一直活着、占着 stdio 管道。
  // 这时 process.exit() 会在同步 flush 这些管道时**永久阻塞** —— 实测现象是
  // 打点显示已经走到 finish(0)、进程却活满 60 秒被外层 timeout 杀掉，退出码 124。
  // 所以退出前必须先把浏览器整棵进程树收掉，管道一关，退出才走得通。
  let browserRef = null;
  let browserKilled = false;
  function killBrowserTree() {
    if (browserKilled) return;   // 只收一次，避免拿着已被回收的 PID 去 taskkill 误伤别的进程
    browserKilled = true;
    try {
      const bp = browserRef && browserRef.process && browserRef.process();
      const pid = bp && bp.pid;
      if (!pid) return;
      if (process.platform === "win32") execSync("taskkill /PID " + pid + " /T /F", { stdio: "ignore" });
      else process.kill(-pid, "SIGKILL");
    } catch (e) { /* 浏览器早就退了，或者 taskkill 权限不足 —— 都不影响主流程 */ }
  }

  async function main() {
  trace("enter");
  // 全局看门狗：在 main 最开头就装好，覆盖「启动浏览器 → 打开页面 → 等测试跑完 → 读结果」全流程。
  // 真机踩过：单页跑约 11 秒，但连续跑 10 页时个别页会卡在启动/加载阶段不返回，
  // 被外层 timeout 杀掉后得到 exit=124 —— 明明断言全过、退出码却不是 0，自动化里就成了假失败。
  // 更早的版本把兜底定时器放在函数末尾，结果页面一卡死就永远走不到那一步，形同虚设。
  // 这里给整脚本一个硬上限，并用独立退出码 2 区分「环境卡死」和「断言失败(1)」。
  const WATCHDOG_MS = 75000;
  let watchdogDone = false;
  const watchdog = setTimeout(() => {
    if (watchdogDone) return;
    trace("watchdog fired");
    console.error("!! 看门狗触发：测试页 " + (WATCHDOG_MS / 1000) + " 秒内没跑完（多半是无头 Chrome 卡住了，不是断言失败）");
    writeResult(2, {}, "看门狗超时");
    killBrowserTree();
    process.exit(2);
  }, WATCHDOG_MS);
  const finish = code => {
    trace("finish(" + code + ")");
    watchdogDone = true;
    clearTimeout(watchdog);
    killBrowserTree();
    process.exit(code);
  };

  let chromium;
  try {
    chromium = require("playwright-core").chromium;
  } catch (e) {
    console.log("找不到 playwright-core，无法自动跑测试。");
    console.log("请改为在浏览器里直接打开：" + path.join(ROOT, "test", PAGE));
    finish(1);
  }

  const server = await startServer();
  const url = "http://127.0.0.1:" + server.address().port + "/test/" + PAGE;
  console.log("测试页：" + url);

  // 无头浏览器用哪个：默认 Chrome，起不来就退回 Edge。
  // 两者都是 Chromium 内核，playwright-core 都认，Edge 是 Windows 自带的、不用额外下载。
  // 想指定就设 JIANLI_BROWSER=msedge / chrome / chromium。
  const CHANNELS = process.env.JIANLI_BROWSER
    ? [process.env.JIANLI_BROWSER]
    : ["chrome", "msedge", "chromium"];
  let browser = null, channelErr = null;
  for (const ch of CHANNELS) {
    try {
      browser = await chromium.launch({ channel: ch, headless: true });
      trace("launched " + ch);
      break;
    } catch (e) { channelErr = e; }
  }
  if (!browser) {
    console.log("起不了无头浏览器（试过：" + CHANNELS.join(" / ") + "）：" + (channelErr && channelErr.message));
    console.log("可以在浏览器里直接打开：" + url);
    server.close();
    finish(1);
  }
  browserRef = browser;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  // 带上出错位置：只打 message 的话，同名全局变量撞车这类问题根本看不出来
  page.on("pageerror", e => {
    const frames = String(e.stack || "").split("\n").slice(1, 4).map(s => s.trim().replace(/^at\s+/, "").replace(/\s*\(.*/, ""));
    pageErrors.push("pageerror: " + e.message + (frames.length ? "  @ " + frames.join(" ← ") : ""));
  });
  page.on("console", m => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  const finished = await page.waitForFunction(
    () => document.body && document.body.dataset.jianliDone === "1",
    // 正常一页总共约 11 秒，给 40 秒足够宽裕；上限之和（30+40）刻意压在看门狗 75 秒之内，
    // 这样"测试没跑完"能走到友好提示，而不是被动等看门狗硬杀
    { timeout: 40000 }
  ).then(() => true).catch(() => false);

  if (!finished) console.log("!! 超时：测试没有跑完（页面可能卡在中途）");

  // 测试页有两种呈现格式，这里统一读成 { summary, items[] }
  const res = await page.evaluate(() => {
    const summaryEl = document.getElementById("summary");
    if (summaryEl) {
      return {
        summary: summaryEl.textContent.trim(),
        items: Array.from(document.querySelectorAll("#list .item")).map(e => ({
          pass: e.classList.contains("pass"),
          text: e.textContent.replace(/\s+/g, " ").trim()
        }))
      };
    }
    const head = document.querySelector("#report .head");
    const rows = Array.from(document.querySelectorAll("#report tr"));
    return {
      summary: head ? head.textContent.trim() : "(读不到结果)",
      items: rows.map(r => ({
        pass: r.classList.contains("ok"),
        text: (r.textContent || "").replace(/\s+/g, " ").trim()
      }))
    };
  });

  console.log("\n【汇总】" + res.summary);
  res.items.forEach(i => console.log("  " + (i.pass ? "✓" : "✗") + " " + i.text));

  const fails = res.items.filter(i => !i.pass);

  // 结果到手了，立刻装上强制退出定时器 —— 必须装在这里，不能放到函数末尾。
  // 页面卡死时，后面任何一次 page.xxx（读 #raw、读 __trace）都可能永远不返回，
  // 挂在末尾的定时器根本没机会执行。真机踩过：汇总打印完进程却一直挂着，
  // 被外层 timeout 杀掉后 exit=124/127，表现为"明明全过却不是 0"的假失败。
  const exitCode = fails.length || !finished ? 1 : 0;
  trace("summary printed, exitCode=" + exitCode);
  writeResult(exitCode, {
    total: res.items.length,
    passed: res.items.length - fails.length,
    failed: fails.length,
    finished
  }, finished ? "" : "测试页没跑完（超时）");
  const forceExit = setTimeout(() => { trace("forceExit fired"); killBrowserTree(); process.exit(exitCode); }, 8000);
  forceExit.unref && forceExit.unref();

  // 卡死的页面同样会让下面的诊断读取挂住，统一加 3 秒上限：宁可少打诊断，也要拿到退出码
  const withTimeout = (p, ms) => Promise.race([
    Promise.resolve(p).catch(() => null),
    new Promise(r => { const t = setTimeout(() => r(null), ms); t.unref && t.unref(); })
  ]);

  if (fails.length) {
    console.log("\n【失败项】");
    fails.forEach(f => console.log("  ✗ " + f.text));

    // 有些测试页会把内容脚本的原始返回贴在 #raw 里，一并打出来便于定位原因
    const raw = await withTimeout(page.textContent("#raw"), 3000);
    if (raw && raw.trim() && raw.trim() !== "undefined") {
      let printed = false;
      try {
        const obj = JSON.parse(raw);
        const bad = (obj.results || []).filter(r => !r.ok);
        console.log("\n【内容脚本返回的失败明细】");
        if (!bad.length) console.log("  （results 里没有 ok:false 的项 —— 说明是「填了但没落到页面上」）");
        bad.forEach(b => console.log("  ✗ " + b.label + " ← " + b.reason));
        if (obj.unknownTotal) console.log("  未识别控件数：" + obj.unknownTotal);
        // 关键诊断：filled=0 且 results 为空 = 一个填写计划都没生成（多半是候选被过滤光了），
        // 而不是「填了但没落到页面上」。这两种故障的排查方向完全相反。
        if (typeof obj.filled === "number") {
          console.log("  内容脚本填写成功 filled=" + obj.filled +
            "，results 条数=" + ((obj.results || []).length));
        }
        if (typeof obj.inferred !== "undefined") {
          console.log("  岗位推断 inferred=" + JSON.stringify(obj.inferred));
        }
        printed = true;
      } catch (e) { /* 不是 JSON 就退回原文打印 */ }
      if (!printed) {
        console.log("\n【页面里的原始返回（节选）】");
        console.log(raw.trim().split("\n").slice(0, 60).join("\n"));
      }
    }

    // 测试页若记录了交互轨迹，一并打印，便于看插件点了哪里
    const traceLog = (await withTimeout(page.evaluate(() => window.__trace || []), 3000)) || [];
    if (traceLog.length) {
      console.log("\n【交互轨迹】");
      traceLog.slice(0, 60).forEach(t => console.log("  " + t));
    }
  } else {
    console.log("\n【失败项】无");
  }

  const errs = [...new Set(pageErrors)];
  if (errs.length) {
    console.log("\n【页面报错】");
    errs.slice(0, 12).forEach(e => console.log("  " + e));
  }

  // 正常收尾：不再指望 browser.close()（它实测从不返回），直接收进程树。
  // finish() 内部会先 killBrowserTree() 再 process.exit，顺序不能反 ——
  // 先退出的话会卡在管道 flush 上（见上面 killBrowserTree 的注释）。
  trace("closing browser");
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise(r => setTimeout(r, 1500))
  ]);
  trace("browser closed / raced");
  server.close();
  clearTimeout(forceExit);
  finish(exitCode);
}

main().catch(e => { console.error("运行失败：" + e.message); process.exit(1); });
