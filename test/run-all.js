// ============================================================
// 一次跑完所有测试页，输出一张总表
//
// 用法（在插件目录下）：
//   node test/run-all.js               # 跑全部 test/*.html 断言页
//   node test/run-all.js v10 v5        # 只跑名字里带这些片段的页面
//   node test/run-all.js --list        # 只列出会被跑到的页面
//   node test/run-all.js --keep-going  # 某页失败也继续（默认就是继续）
//
// 为什么要单独有这么一个脚本，而不是让 shell for 循环去跑？
// 因为无头 Chrome 在 Windows 上会卡：run-page.js 结束时进程可能挂在
// "退出时同步 flush 管道"上不返回（详见 run-page.js 里 killBrowserTree 的注释），
// 于是每页的**退出码**变得不可靠 —— 明明断言全过却是 124。
// 所以这里做了两件事：
//   1) 判定结果只认 run-page.js 同步落盘的 test/.last-run.jsonl，不看退出码；
//   2) 每页独立超时，超时用 taskkill /T 把整棵进程树（含 Chrome）收掉，不留孤儿。
//
// 纯静态检查（check/logic/matcher）不在这里跑，它们本来就秒级且稳定：
//   node test/check.js && node test/logic.js && node test/matcher.js
// ============================================================
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const RESULT_FILE = path.join(__dirname, ".last-run.jsonl");
const PAGE_TIMEOUT_MS = Number(process.env.JIANLI_PAGE_TIMEOUT_MS || 45000);

const argv = process.argv.slice(2);
const listOnly = argv.includes("--list");
const filters = argv.filter(a => !a.startsWith("--"));

// 自动发现断言页，新增测试页不用回来登记（和 check.js 一个思路）
let pages = fs.readdirSync(__dirname)
  .filter(f => /^v\d.*\.html$/i.test(f))
  .sort((a, b) => {
    const na = (a.match(/^v(\d+)/) || [0, 0])[1];
    const nb = (b.match(/^v(\d+)/) || [0, 0])[1];
    return na - nb || a.localeCompare(b);
  });

if (filters.length) pages = pages.filter(p => filters.some(f => p.includes(f)));

if (!pages.length) {
  console.log("没有匹配的测试页。");
  process.exit(1);
}
if (listOnly) {
  console.log("会被跑到的测试页（" + pages.length + " 个）：");
  pages.forEach(p => console.log("  " + p));
  process.exit(0);
}

function killTree(pid) {
  try {
    if (process.platform === "win32") execSync("taskkill /PID " + pid + "/T /F", { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch (e) {}
}

// 同步落盘的结果才是判定依据：读最后一条该页的记录
function readResult(page) {
  let text = "";
  try { text = fs.readFileSync(RESULT_FILE, "utf8"); } catch (e) { return null; }
  const lines = text.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(lines[i]);
      if (o.page === page) return o;
    } catch (e) { /* 半行，跳过 */ }
  }
  return null;
}

function runPage(page) {
  return new Promise(resolve => {
    const started = Date.now();
    // 每页开始前先清掉该页的旧记录，免得读到上一轮的残留
    try {
      const kept = fs.existsSync(RESULT_FILE)
        ? fs.readFileSync(RESULT_FILE, "utf8").split("\n").filter(Boolean)
            .filter(l => { try { return JSON.parse(l).page !== page; } catch (e) { return false; } })
        : [];
      fs.writeFileSync(RESULT_FILE, kept.length ? kept.join("\n") + "\n" : "");
    } catch (e) {}

    const child = spawn(process.execPath, [path.join(__dirname, "run-page.js"), page], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "", err = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });

    // 只在子进程**确实还活着**时才动手收树。
    // 少了这个判断，会在子进程已退出后拿着一个被系统回收的旧 PID 去 taskkill，
    // 万一那个 PID 已经分配给别的进程，就会误杀无关程序（实测把运行器自己干掉了）。
    let killed = false;
    let resultSeen = false;
    const safeKill = () => {
      if (killed || child.exitCode !== null || !child.pid) return;
      killed = true;
      killTree(child.pid);
    };

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; safeKill(); }, PAGE_TIMEOUT_MS);

    // 结果一落盘就立刻收进程树、开始下一页。
    // 这是整套东西的关键：run-page.js 打印完结果后会卡在 process.exit() 上不返回
    // （Windows 下同步 flush 管道被孤儿 Chrome 占住），我们没必要陪它等满超时 ——
    // 结果已经写进 JSONL 了，收到就杀，单页耗时从 60 秒压回 10 秒。
    const poll = setInterval(() => {
      if (resultSeen) return;
      if (readResult(page)) { resultSeen = true; safeKill(); }
    }, 300);

    child.on("close", () => {
      clearTimeout(timer);
      clearInterval(poll);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const rec = readResult(page);
      let state, passed = 0, total = 0;
      if (rec && typeof rec.total === "number" && rec.total > 0) {
        passed = rec.passed || 0;
        total = rec.total;
        state = rec.code === 0 && rec.failed === 0 ? "pass" : "fail";
        if (rec.code === 2) state = "hang";
      } else {
        // 连结果都没落盘 —— 页面根本没跑起来
        state = timedOut ? "hang" : "crash";
      }
      resolve({ page, state, passed, total, secs, timedOut, out, err });
    });
  });
}

(async () => {
  // 先把上一轮的总记录清空，避免任何跨轮串味
  try { fs.writeFileSync(RESULT_FILE, ""); } catch (e) {}

  console.log("跑 " + pages.length + " 个测试页，单页上限 " + (PAGE_TIMEOUT_MS / 1000) + " 秒\n");

  const rows = [];
  for (const page of pages) {
    process.stdout.write("  " + page.padEnd(22) + " ... ");
    const r = await runPage(page);
    rows.push(r);
    const label = { pass: "通过", fail: "失败", hang: "卡住", crash: "没跑起来" }[r.state];
    console.log(label + "  " + r.passed + " / " + r.total + "  (" + r.secs + "s)");
    if (r.state !== "pass") {
      const body = (r.out || "").trim();
      if (body) {
        console.log("  ── 该页输出 ──");
        body.split("\n").slice(0, 40).forEach(l => console.log("  | " + l.replace(/\s+$/, "")));
      }
      if ((r.err || "").trim()) console.log("  | stderr: " + r.err.trim().split("\n").slice(0, 5).join(" | "));
    }
  }

  const totalAssert = rows.reduce((s, r) => s + r.total, 0);
  const passedAssert = rows.reduce((s, r) => s + r.passed, 0);
  const bad = rows.filter(r => r.state !== "pass");

  console.log("\n" + "=".repeat(56));
  console.log("页面 " + (rows.length - bad.length) + " / " + rows.length + " 全过，断言 " + passedAssert + " / " + totalAssert);
  if (bad.length) {
    console.log("有问题的页面：");
    bad.forEach(r => console.log("  " + r.page + "  →  " + r.state + "（" + r.passed + " / " + r.total + "）"));
    console.log("\n注意：state=卡住 说明是无头浏览器的问题，不是断言失败 —— 单独重跑一次通常就好：");
    console.log("  node test/run-page.js " + bad[0].page);
  }
  console.log("=".repeat(56));
  process.exit(bad.length ? 1 : 0);
})();
