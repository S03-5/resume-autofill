// ============================================================
// 弹窗布局验证
//
// 弹窗不是标签页，run-page.js 那套跑不了。这里直接把 popup/popup.html 当成
// 普通网页打开，注入一份 chrome.* 的替身，然后在 420×600 的视口里量：
// 字段编辑区到底拿到了多少可见高度、上方常驻内容占了多少。
//
// 为什么值得单独写一个：这次的需求表面是「把设置收起来」，可验收标准其实是
// 「main 的高度」。样式改动很隐蔽 —— flex 列布局里上方多一行，main 就少一行，
// 而 popup 平时没法自动化打开，只能真跑一遍才看得见。
//
// 用法（在插件目录下）：
//   node test/run-popup.js
//   node test/run-popup.js --shot     # 额外存一张渲染截图，便于肉眼核对
//
// 依赖 playwright-core（环境里能 require 到即可，不装进本项目）。
// 用 WorkBuddy 托管的 Node 运行时，需要带上 NODE_PATH：
//   export NODE_PATH="C:\Users\<你>\.workbuddy\binaries\node\workspace\node_modules"
// ============================================================
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const PAGE = "popup/popup.html";
const WANT_SHOT = process.argv.includes("--shot");

// 弹窗里 5 个配置面板的 id，必须全在「更多设置」折叠区里面
const PANELS = ["importBox", "attachBox", "settingsBox", "memoryBox", "ledgerBox"];

// 视口按真实弹窗尺寸来：popup.css 里 body 就是 420px 宽 / 最高 600px
const VIEWPORT = { width: 420, height: 600 };

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

// getTabStatus() 拿到的页面状态。这里刻意给一串很长的文本，
// 就是为了验证站点提示那行真的会被压成一行省略号。
const TAB_STATUS = {
  adapter: "示例招聘网",
  candidates: 89,
  widgets: 38,
  memory: 1,
  host: "jobs.example.com",
  title: "机械设计工程师 - 示例集团 2026 校园招聘",
  url: "https://jobs.example.com/apply/12345",
  inferred: { position: "机械设计工程师", city: "长春" }
};

// 真实扩展里的 chrome.* 是浏览器注入的，这里手工造一份。
// 注意 popup.js / profiles.js / ledger.js 混用了 Promise 和 callback 两种风格，
// 所以每个方法都要「返回 Promise，同时若有 callback 就调 callback」。
function chromeStubSource() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;
  return `
  (() => {
    const store = {};
    const dual = (fn) => function (...args) {
      let cb = null;
      if (typeof args[args.length - 1] === "function") cb = args.pop();
      let p;
      try { p = Promise.resolve(fn.apply(null, args)); }
      catch (e) { p = Promise.reject(e); }
      if (cb) { p.then(r => cb(r)).catch(() => cb(undefined)); return undefined; }
      return p;
    };
    const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

    window.chrome = {
      storage: {
        local: {
          get: dual(keys => {
            const out = {};
            if (keys == null) {
              for (const k of Object.keys(store)) out[k] = clone(store[k]);
              return out;
            }
            for (const k of [].concat(keys)) if (k in store) out[k] = clone(store[k]);
            return out;
          }),
          set: dual(obj => { Object.assign(store, clone(obj)); return true; }),
          remove: dual(keys => { for (const k of [].concat(keys)) delete store[k]; return true; }),
          clear: dual(() => { for (const k of Object.keys(store)) delete store[k]; return true; })
        }
      },
      tabs: {
        query: dual(() => [{ id: 1, title: ${JSON.stringify(TAB_STATUS.title)}, url: ${JSON.stringify(TAB_STATUS.url)} }]),
        sendMessage: dual(() => (${JSON.stringify(TAB_STATUS)}))
      },
      windows: { create: dual(() => ({ id: 1 })) },
      runtime: {
        id: "test-extension-id",
        getURL: p => p,
        getManifest: () => ({ version: ${JSON.stringify(version)} }),
        sendMessage: dual(() => ({ ok: true, results: [] })),
        onMessage: { addListener() {} }
      }
    };
  })();
  `;
}

async function main() {
  let chromium;
  try {
    chromium = require("playwright-core").chromium;
  } catch (e) {
    console.log("找不到 playwright-core，无法自动跑弹窗验证。");
    console.log("请改为在浏览器里直接打开：" + path.join(ROOT, PAGE));
    process.exit(1);
  }

  const server = await startServer();
  const url = "http://127.0.0.1:" + server.address().port + "/" + PAGE;
  console.log("弹窗页面：" + url);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  await ctx.addInitScript(chromeStubSource());
  const page = await ctx.newPage();

  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

  await page.goto(url, { waitUntil: "load" });

  // 等到表单渲染出来再量，否则量到的是空壳
  const ready = await page.waitForFunction(
    () => document.querySelectorAll("#form .field").length > 0,
    { timeout: 20000 }
  ).then(() => true).catch(() => false);
  if (!ready) console.log("!! 表单没有渲染出来，量到的尺寸不可信");

  const res = await page.evaluate((panels) => {
    const out = [];
    const t = (label, ok, detail) => out.push({
      label, ok: !!ok, detail: detail === undefined || detail === null ? "" : String(detail)
    });
    const h = el => (el ? Math.round(el.getBoundingClientRect().height) : -1);
    const $ = s => document.querySelector(s);

    const body = document.body;
    const main = $("#form");
    const more = $("#moreBox");
    const site = $("#siteHint");
    const prof = $("#profileHint");

    // 布局账目：把每个区块真实占掉的高度记下来。这个数只有真打开量才准，
    // 调弹窗间距时不看账目基本等于猜。
    const bodyTop = body.getBoundingClientRect().top;
    const ledger = [];
    for (const sel of ["header", "#status", "#siteHint", ".profile-bar", "#profileHint",
                       "#moreBox", ".toolbar", "#scanOut", "#form", "footer"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      ledger.push({
        sel,
        top: Math.round(r.top - bodyTop),
        h: Math.round(r.height),
        margin: Math.round((parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0))
      });
    }

    // ---- 结构：5 个面板必须收在折叠区里 ----
    t("弹窗里有「更多设置」折叠区", !!more);
    if (!more) return out;
    t("「更多设置」默认收起", more.open === false, more.open ? "open=true" : "open=false");
    panels.forEach(id => {
      const el = document.getElementById(id);
      t("「" + id + "」收在「更多设置」内部", !!el && more.contains(el));
    });

    // ---- 核心指标：字段区拿到了多少高度 ----
    const bodyH = Math.round(body.getBoundingClientRect().height);
    const mainH = h(main);
    t("字段编辑区可见高度 ≥ 350px（改前约 170px）", mainH >= 350, mainH + "px");

    const above = Math.round(main.getBoundingClientRect().top - body.getBoundingClientRect().top);
    t("字段区上方的常驻内容 ≤ 210px（改前约 380px）", above <= 210, above + "px");

    t("字段区高度占弹窗的一半以上", mainH / bodyH >= 0.5, Math.round(mainH / bodyH * 100) + "%");

    t("字段是真的渲染出来了", document.querySelectorAll("#form .field").length > 5,
      document.querySelectorAll("#form .field").length + " 个");

    // ---- 两处提示压成一行 ----
    const siteH = h(site), profH = h(prof);
    t("站点提示压成了一行", siteH > 0 && siteH <= 22, siteH + "px");
    t("方案提示压成了一行", profH > 0 && profH <= 22, profH + "px");
    t("站点提示保留了悬停全文", (site.getAttribute("title") || "").length > 20,
      "title " + (site.getAttribute("title") || "").length + " 字");
    t("方案提示保留了悬停全文", (prof.getAttribute("title") || "").length > 10,
      "title " + (prof.getAttribute("title") || "").length + " 字");

    // ---- 点击展开 / 收起 ----
    site.click();
    const siteExpanded = h(site);
    const mainAfterExpand = h(main);
    t("点站点提示能展开全文", siteExpanded > siteH + 4, siteH + "px → " + siteExpanded + "px");
    // 提示长高必然要让 main 变矮（两者共享那 600px），所以验的是「让渡量对得上」，
    // 而不是 main 纹丝不动 —— 后者只有把提示压成一条线才做得到。
    t("展开提示时字段区只让出等量高度", Math.abs((mainH - mainAfterExpand) - (siteExpanded - siteH)) <= 2,
      "main −" + (mainH - mainAfterExpand) + "px / 提示 +" + (siteExpanded - siteH) + "px");
    site.click();
    t("再点一下能收回去", h(site) === siteH, h(site) + "px");

    // ---- 展开「更多设置」：自保检查 ----
    more.open = true;
    const moreH = h(more);
    const overflow = Math.round(body.scrollHeight - body.getBoundingClientRect().height);
    t("展开后折叠区有高度上限（不无限撑高）", moreH > 100 && moreH <= 500, moreH + "px");
    t("展开后弹窗内容没有溢出（超出的部分会看不见）", overflow <= 4,
      overflow > 0 ? "溢出 " + overflow + "px" : "无溢出");
    t("展开后字段区被让位但不为负", h(main) >= 0, h(main) + "px");

    // 内层面板还能独立展开吗（「填写选项」是内层最长的一个，拿它压测上限）
    const sb = document.getElementById("settingsBox");
    sb.open = true;
    t("内层面板可以独立展开", sb.open === true && h(sb) > 60, h(sb) + "px");
    const deepOverflow = Math.round(body.scrollHeight - body.getBoundingClientRect().height);
    t("展开最长的内层面板后弹窗仍不溢出", deepOverflow <= 4,
      deepOverflow > 0 ? "溢出 " + deepOverflow + "px" : "无溢出");
    t("内层内容超出时靠折叠区自己滚动，不撑破弹窗", h(more) <= 420, "折叠区 " + h(more) + "px");
    sb.open = false;

    more.open = false;
    t("收起「更多设置」后字段区高度恢复", h(main) === mainH, h(main) + "px");

    t("弹窗整体高度不超过 600px", bodyH <= 600, bodyH + "px");
    return { items: out, ledger };
  }, PANELS);

  const items = res.items;

  console.log("\n【布局账目】从上到下，含上下外边距（body 高 600px 是硬上限）");
  res.ledger.forEach(l => console.log(
    "  " + l.sel.padEnd(14) +
    " top " + String(l.top).padStart(4) +
    "   高 " + String(l.h).padStart(4) +
    "   外边距 " + l.margin
  ));

  console.log("\n【汇总】" + items.filter(r => r.ok).length + " / " + items.length + " 项通过");
  items.forEach(r => console.log("  " + (r.ok ? "✓" : "✗") + " " + r.label + (r.detail ? "  [" + r.detail + "]" : "")));

  const fails = items.filter(r => !r.ok);
  console.log("\n【失败项】" + (fails.length ? "" : "无"));
  fails.forEach(f => console.log("  ✗ " + f.label + (f.detail ? "  [" + f.detail + "]" : "")));

  if (WANT_SHOT) {
    const shot = path.join(os.tmpdir(), "jianli-popup-collapsed.png");
    await page.screenshot({ path: shot, fullPage: false });
    await page.evaluate(() => { document.getElementById("moreBox").open = true; });
    const shot2 = path.join(os.tmpdir(), "jianli-popup-expanded.png");
    await page.screenshot({ path: shot2, fullPage: false });
    console.log("\n【截图】\n  " + shot + "\n  " + shot2);
  }

  const errs = [...new Set(pageErrors)];
  if (errs.length) {
    console.log("\n【页面报错】");
    errs.slice(0, 10).forEach(e => console.log("  " + e));
  }

  await browser.close();
  server.close();
  process.exit(fails.length || !ready ? 1 : 0);
}

main().catch(e => { console.error("运行失败：" + e.message); process.exit(1); });
