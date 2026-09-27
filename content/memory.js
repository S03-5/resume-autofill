// ============================================================
// 字段映射记忆：把「这个网站的这一个框 = 简历里的某个字段」记下来，
// 下次再遇到同一个框就不用重新认了。
//
// 存储：chrome.storage.local 的 siteMaps，结构
//   { "app.mokahr.com": { "<唯一选择器>": { key, label, fp, at } } }
//
// 命中优先级：记忆（用户显式确认过）> 站点适配器 > 智能识别。
// 记错了随时能在弹窗里删掉单条，或者清空整个站点。
//
// 两条写入途径（都由 content.js 发起）：
//   1. 战报浮层里点「记住」——当场纠正一个插件没认出来的框
//   2. 悬浮球「点选生成适配器」——连点几个框，顺带产出 SITE_ADAPTERS 代码片段
//
// 为什么同时存「选择器」和「指纹」：
//   选择器精确，但招聘站点一改版、或者列表里插了一条，结构就变了；
//   指纹（tag + name / placeholder / aria-label / 标签文字）糙一些，但抗改版。
//   命中时先按选择器找，找不到再按指纹兜底。
// ============================================================
(function () {
  if (window.__JIANLI_MEMORY_READY__) return;
  window.__JIANLI_MEMORY_READY__ = true;

  const STORAGE_KEY = "siteMaps";

  // 长得像框架自动生成的 id（React useId、antd/rc、MUI、Radix…），
  // 这类 id 每次渲染都会变，写进选择器等于没写
  const UNSTABLE_ID = [
    /^:r/, /^rc[_-]/, /^mui-/, /^radix-/, /^headlessui-/, /^el-id-/,
    /^react-select/, /^downshift-/, /\d{5,}/
  ];

  // 这些子域名不参与“站点简称”的推导：app.mokahr.com 应该叫 mokahr 而不是 app
  const SUBDOMAIN_NOISE = new Set([
    "www", "app", "m", "campus", "job", "jobs", "hr", "zhaopin",
    "recruit", "recruiting", "career", "careers", "talent", "apply", "portal"
  ]);

  let maps = {};
  let loaded = false;
  let loading = null;

  // ---------- 工具 ----------

  function esc(v) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(String(v));
    return String(v).replace(/[^a-zA-Z0-9_-]/g, c => "\\" + c);
  }

  function escAttr(v) {
    return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function countOf(sel) {
    try { return document.querySelectorAll(sel).length; } catch (e) { return -1; }
  }

  function normalizeHost(host) {
    return String(host || "")
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/:\d+$/, "");
  }

  // 查找顺序：先精确站点，再退一级到主域（在 mokahr.com 上记的，app.mokahr.com 也能用）
  function hostChain(host) {
    const h = normalizeHost(host);
    if (!h) return [];
    const parts = h.split(".");
    const out = [h];
    if (parts.length > 2) out.push(parts.slice(-2).join("."));
    return out;
  }

  function isStableId(id) {
    if (!id || id.length > 48) return false;
    // 冒号在 CSS 选择器里要转义，而且 ":r1:" 这种就是 React 自动 id，直接排除
    if (!/^[A-Za-z][\w.-]*$/.test(id)) return false;
    return !UNSTABLE_ID.some(re => re.test(id));
  }

  // 取一个“看起来稳定”的 class：不要 CSS Module 的哈希尾巴，不要超长的
  function stableClass(node) {
    if (!node.classList) return "";
    for (const c of node.classList) {
      if (c.length < 2 || c.length > 28) continue;
      if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(c)) continue;
      if (/\d{4,}/.test(c)) continue;
      // ant-select-selection-search-input 这种虽然稳定，但太长且没有区分度，跳过
      return c;
    }
    return "";
  }

  // 不带 nth-of-type 的最小片段；单靠 tag+class 不唯一时才加序号
  function simplePart(node) {
    const tag = node.tagName.toLowerCase();
    const cls = stableClass(node);
    let part = tag;
    if (cls) {
      const withCls = tag + "." + esc(cls);
      if (countOf(withCls) === 1) return withCls;
      part = withCls;
    }
    const parent = node.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
    }
    return part;
  }

  // 生成一个在整页里唯一的选择器：id → name → 逐级向上拼路径（越短越好）
  function uniqueSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    const tag = el.tagName.toLowerCase();

    if (isStableId(el.id)) {
      const sel = "#" + esc(el.id);
      if (countOf(sel) === 1) return sel;
    }
    const name = el.getAttribute("name");
    if (name) {
      const sel = tag + '[name="' + escAttr(name) + '"]';
      if (countOf(sel) === 1) return sel;
    }

    let node = el;
    let sel = simplePart(el);
    let depth = 0;
    while (node && node.parentElement && node !== document.documentElement && depth < 8) {
      if (countOf(sel) === 1) return sel;
      node = node.parentElement;
      sel = simplePart(node) + " > " + sel;
      depth++;
    }
    return countOf(sel) === 1 ? sel : sel;
  }

  // 元素指纹：选择器失效时的兜底匹配依据
  function labelText(el) {
    const out = [];
    try {
      if (el.labels) {
        for (const l of el.labels) {
          const t = (l.innerText || "").trim();
          if (t) out.push(t);
        }
      }
    } catch (e) { /* ignore */ }
    try {
      const wrap = el.closest ? el.closest("label") : null;
      if (wrap) {
        const t = (wrap.innerText || "").trim();
        if (t) out.push(t);
      }
      const prev = el.previousElementSibling;
      if (prev && prev.innerText && !prev.matches("input,textarea,select") && prev.innerText.trim().length <= 40) {
        out.push(prev.innerText.trim());
      }
    } catch (e) { /* ignore */ }
    return out.filter(Boolean);
  }

  function fingerprint(el) {
    const labels = labelText(el);
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      name: el.getAttribute("name") || "",
      ph: el.getAttribute("placeholder") || "",
      aria: el.getAttribute("aria-label") || "",
      label: (labels[0] || "").slice(0, 30)
    };
  }

  function fpMatch(fp, el) {
    if (!fp || !el || !el.tagName) return false;
    if (fp.tag && el.tagName.toLowerCase() !== fp.tag) return false;
    // name / placeholder / aria-label 任意一项完全一致就算同一个框
    if (fp.name && fp.name === (el.getAttribute("name") || "")) return true;
    if (fp.ph && fp.ph === (el.getAttribute("placeholder") || "")) return true;
    if (fp.aria && fp.aria === (el.getAttribute("aria-label") || "")) return true;
    if (fp.label && fp.label.length >= 2) {
      if (labelText(el).some(t => t === fp.label)) return true;
    }
    return false;
  }

  // ---------- 存储 ----------

  async function ensureLoaded() {
    if (loaded) return maps;
    if (loading) return loading;
    try {
      const res = await chrome.storage.local.get([STORAGE_KEY]);
      maps = (res && res[STORAGE_KEY]) || {};
    } catch (e) {
      maps = {};
    }
    loaded = true;
    return maps;
  }

  function persist() {
    try { chrome.storage.local.set({ [STORAGE_KEY]: maps }); } catch (e) { /* 存储失败不阻塞填写 */ }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      // 弹窗里删了/清空了映射，页面这边实时跟上
      maps = changes[STORAGE_KEY].newValue || {};
      loaded = true;
    });
  } catch (e) { /* 没有 storage 权限时忽略 */ }

  function all() { return maps; }

  function listFor(host) {
    const out = [];
    for (const h of hostChain(host)) {
      const m = maps[h];
      if (!m) continue;
      for (const sel of Object.keys(m)) {
        const e = m[sel] || {};
        out.push({
          host: h,
          selector: sel,
          key: e.key || "",
          label: e.label || e.key || "",
          at: e.at || 0,
          fp: e.fp || null
        });
      }
    }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  function countFor(host) { return listFor(host).length; }

  // ---------- 命中 ----------

  function sameTarget(sel, el) {
    try { return document.querySelector(sel) === el; } catch (e) { return false; }
  }

  /**
   * 在给定的候选控件里解析出「哪些框被记过、各自对应哪个字段」。
   * @param {string} host 当前站点
   * @param {Element[]} els 候选控件
   * @returns {Map<Element, {key,label,selector,host,via}>}
   */
  function resolve(host, els) {
    const out = new Map();
    if (!els || !els.length) return out;

    const entries = [];
    for (const h of hostChain(host)) {
      const m = maps[h];
      if (!m) continue;
      for (const sel of Object.keys(m)) {
        entries.push(Object.assign({ selector: sel, host: h }, m[sel] || {}));
      }
    }
    if (!entries.length) return out;

    const pool = new Set(els);
    const taken = new Set();

    // 1. 选择器命中（精确）。
    //    要求这个选择器在全页里唯一。站点改版后旧选择器可能变宽（比如从
    //    input:nth-of-type(1) 退化成 input，一下子匹配到好几个框），
    //    这种时候宁可不认、退回智能识别，也不能把值填到错的框上。
    for (const e of entries) {
      let nodes;
      try { nodes = document.querySelectorAll(e.selector); } catch (err) { continue; }
      if (nodes.length !== 1) continue;
      const n = nodes[0];
      if (!pool.has(n) || taken.has(n)) continue;
      taken.add(n);
      out.set(n, { key: e.key, label: e.label, selector: e.selector, host: e.host, via: "selector" });
    }

    // 2. 指纹兜底（抗改版）
    for (const e of entries) {
      if (!e.fp) continue;
      for (const el of els) {
        if (taken.has(el)) continue;
        if (fpMatch(e.fp, el)) {
          taken.add(el);
          out.set(el, { key: e.key, label: e.label, selector: e.selector, host: e.host, via: "fingerprint" });
          break;
        }
      }
    }
    return out;
  }

  // ---------- 写入 ----------

  /**
   * 记住「这个框 = 某字段」。同一个框改记别的字段时会覆盖，不会留下两条互抢。
   */
  function remember(host, el, key, label) {
    const h = normalizeHost(host);
    if (!h || !el || !el.tagName || !key) return null;
    const selector = uniqueSelector(el);
    if (!selector) return null;

    if (!maps[h]) maps[h] = {};
    // 同一个元素之前记过、但选择器变了：把旧记录清掉
    for (const sel of Object.keys(maps[h])) {
      if (sel === selector) continue;
      if (sameTarget(sel, el)) delete maps[h][sel];
    }

    const entry = maps[h][selector] || {};
    entry.key = key;
    entry.label = label || key;
    entry.fp = fingerprint(el);
    entry.at = Date.now();
    maps[h][selector] = entry;
    persist();
    return { host: h, selector, entry };
  }

  function forget(host, selector) {
    const h = normalizeHost(host);
    if (!h || !selector || !maps[h]) return false;
    if (!maps[h][selector]) return false;
    delete maps[h][selector];
    if (!Object.keys(maps[h]).length) delete maps[h];
    persist();
    return true;
  }

  function clearHost(host) {
    const h = normalizeHost(host);
    if (!h || !maps[h]) return 0;
    const n = Object.keys(maps[h]).length;
    delete maps[h];
    persist();
    return n;
  }

  function clearAll() {
    const n = Object.keys(maps).reduce((a, h) => a + Object.keys(maps[h] || {}).length, 0);
    maps = {};
    persist();
    return n;
  }

  // ---------- 代码片段生成 ----------

  function baseHost(host) {
    const h = normalizeHost(host);
    // IP 直连（本地测试页、内网系统）没有「主域」可言，原样返回
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
    const parts = h.split(".");
    return parts.length > 2 ? parts.slice(-2).join(".") : h;
  }

  function adapterId(host) {
    const parts = normalizeHost(host).split(".");
    const label = parts.find(p => !SUBDOMAIN_NOISE.has(p)) || parts[0] || "site";
    return label.replace(/[^a-z0-9]/gi, "") || "site";
  }

  /**
   * 把收集到的映射生成一段可直接粘进 content/sites.js 的适配器代码。
   * @param {string} host
   * @param {{key:string,label:string,selector:string}[]} entries
   * @param {string} name 站点显示名（一般是页面标题）
   */
  function adapterSnippet(host, entries, name) {
    const list = (entries || []).filter(e => e && e.key && e.selector);
    if (!host || !list.length) return "";

    // 同一个字段可能有多个框（比如“学校”在教育经历和基本信息里各有一个）
    const grouped = new Map();
    for (const e of list) {
      if (!grouped.has(e.key)) grouped.set(e.key, []);
      const arr = grouped.get(e.key);
      if (!arr.includes(e.selector)) arr.push(e.selector);
    }

    const base = baseHost(host);
    const hosts = base === normalizeHost(host) ? [base] : [base, normalizeHost(host)];
    const display = String(name || host).replace(/\s+/g, " ").trim().slice(0, 24) || host;

    const lines = [];
    lines.push("    {");
    lines.push('      id: "' + escAttr(adapterId(host)) + '",');
    lines.push('      name: "' + escAttr(display) + '",');
    lines.push('      hosts: [' + hosts.map(h => '"' + escAttr(h) + '"').join(", ") + '],');
    lines.push("      fields: {");
    for (const [key, sels] of grouped) {
      lines.push("        " + key + ": [" + sels.map(s => "'" + String(s).replace(/'/g, "\\'") + "'").join(", ") + "],");
    }
    lines.push("      }");
    lines.push("    },");
    return lines.join("\n");
  }

  window.JIANLI_MEMORY = {
    STORAGE_KEY,
    ensureLoaded,
    all,
    listFor,
    countFor,
    resolve,
    remember,
    forget,
    clearHost,
    clearAll,
    uniqueSelector,
    fingerprint,
    fpMatch,
    adapterSnippet,
    normalizeHost,
    hostChain
  };
})();
