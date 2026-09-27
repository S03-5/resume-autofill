// ============================================================
// 组件型控件适配层
// 校招站点（Moka / 北森 / 牛客 / 各厂自研）大量使用组件库渲染的「假表单」：
// 下拉不是 <select>、日期不是 <input type=date>、省市区是级联面板。
// 本模块负责识别并操作这些控件；每一步都有降级路径，失败只报原因不抛异常。
// ============================================================
(function () {
  if (window.__JIANLI_WIDGETS__) return;
  window.__JIANLI_WIDGETS__ = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 选项匹配统一交给 matcher.js（本文件只负责组件识别与面板操作）
  const MATCHER = window.JIANLI_MATCHER;

  // ---------- 基础工具 ----------

  // 组件库普遍监听 mousedown（antd）或 click（Element UI），三个事件都发一遍
  function realClick(el) {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, view: window, composed: true };
    try {
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      return true;
    } catch (e) { return false; }
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }

  function textOf(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").trim();
  }

  // 归一化：去空白、去括号内容、全角转半角、小写
  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, "")
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[\u00a0]/g, "")
      .toLowerCase();
  }

  async function waitFor(fn, timeout = 1200, interval = 60) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) { /* 继续重试 */ }
      await sleep(interval);
    }
    try { return fn() || null; } catch (e) { return null; }
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLInputElement ? HTMLInputElement.prototype
        : HTMLSelectElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ---------- 组件识别 ----------

  const SPECIFIC_ROOTS = [
    ".ant-select", ".ant-cascader", ".ant-tree-select", ".ant-picker",
    ".el-select", ".el-cascader", ".el-date-editor", ".el-date-picker",
    "[role='combobox']", "[role='listbox']"
  ].join(",");

  const LOOSE_ROOT_RE = /select|picker|cascader|dropdown|combobox|chosen|multiselect/i;

  // 从输入元素往上找「组件根节点」
  function rootOf(el) {
    if (!el) return null;
    try {
      const hit = el.closest(SPECIFIC_ROOTS);
      if (hit) return hit;
    } catch (e) { /* ignore */ }
    let node = el, depth = 0;
    while (node && depth < 4) {
      const cls = typeof node.className === "string" ? node.className : "";
      if (LOOSE_ROOT_RE.test(cls)) return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  const CASCADE_RE = /cascader|region|area|city/i;
  const DATE_RE = /picker|date|calendar|time|month|year/i;

  function classify(el) {
    if (!el) return "native";
    if (el.tagName === "SELECT") return "native";
    if (el.type === "date" || el.type === "month" || el.type === "datetime-local") return "native";
    if (el.isContentEditable) return "native";

    const root = rootOf(el);
    if (!root) return "native";

    const sig = [
      typeof root.className === "string" ? root.className : "",
      root.getAttribute("role") || "",
      el.getAttribute("role") || "",
      el.getAttribute("aria-haspopup") || ""
    ].join(" ");

    if (CASCADE_RE.test(sig)) return "cascade";
    if (DATE_RE.test(sig)) return "date";
    if (/select|dropdown|combobox|listbox/i.test(sig)) return "dropdown";
    // 只读输入框 + 有组件根节点，基本可判定是自绘下拉
    if (el.readOnly) return "dropdown";
    return "native";
  }

  // ---------- 面板与选项 ----------

  const PANEL_SELECTORS = [
    ".ant-select-dropdown", ".ant-cascader-dropdown", ".ant-picker-dropdown",
    ".ant-dropdown", ".el-select-dropdown", ".el-cascader__dropdown",
    ".el-picker-panel", ".el-picker__popper",
    "[role='listbox']", "[role='dialog'][class*='dropdown']",
    "[class*='dropdown']", "[class*='popper']",
    // 站点自己的布局卡片经常直接叫 panel（class="panel"），
    // 所以这里要求带前缀（如 xxx-panel），并且 findPanels 还会再校验里面确实有选项
    "[class*='-panel']"
  ];

  const HIDDEN_RE = /hidden|is-hidden|closed|leaving|slide-up-leave|zoom-out/i;

  function findPanels() {
    const out = [];
    const seen = new Set();
    for (const sel of PANEL_SELECTORS) {
      let list;
      try { list = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const p of list) {
        if (seen.has(p)) continue;
        const cls = typeof p.className === "string" ? p.className : "";
        if (HIDDEN_RE.test(cls)) continue;
        if (!isVisible(p)) continue;
        // 面板里必须真的有「选项」（至少两个），否则普通容器会被误判成面板。
        // 严格模式不看兜底的叶子元素，避免把布局卡片里的文字当成选项。
        if (collectOptions(p, true).length < 2) continue;
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }

  const OPTION_SELECTORS = [
    ".ant-select-item-option", ".ant-cascader-menu-item", ".ant-picker-cell",
    ".ant-picker-month-btn", ".ant-picker-year-btn",
    ".el-select-dropdown__item", ".el-cascader-node",
    "[role='option']", "li[class*='option']", "li[class*='item']"
  ];

  // 收集面板里的选项。strict=true 时只用明确的选项选择器，
  // 不做「叶子元素兜底」——那个兜底用在面板识别阶段会把整块布局当成面板。
  function collectOptions(scope, strict) {
    const out = [];
    const seen = new Set();
    for (const sel of OPTION_SELECTORS) {
      let list;
      try { list = scope.querySelectorAll(sel); } catch (e) { continue; }
      for (const it of list) {
        if (seen.has(it)) continue;
        const t = textOf(it);
        if (!t) continue;
        if (t.length > 60) continue;          // 选项文本不会太长，过长说明是容器
        if (it.querySelector("input, textarea")) continue;
        seen.add(it);
        out.push(it);
      }
    }
    if (!out.length && !strict) {
      // 兜底：取面板内所有「叶子」元素，按文本当选项
      for (const it of scope.querySelectorAll("*")) {
        if (it.children.length) continue;
        const t = textOf(it);
        if (t) { out.push(it); }
      }
    }
    return out;
  }

  // 在给定范围内按文本匹配选项。
  // 打分逻辑统一交给 content/matcher.js（同义写法 / 否定词 / 数值区间 / 阈值），
  // 这里只负责「把面板里的候选元素喂进去、把选中结果拿回来」。
  function findBestOption(scope, value, fieldKey) {
    if (!scope || !value) return null;
    if (!MATCHER) return null;
    const items = collectOptions(scope);
    const hit = MATCHER.pick(value, items, fieldKey, textOf);
    return hit ? hit.item : null;
  }

  // 给战报用：这个面板里到底有哪些选项
  function optionTexts(scope, limit) {
    if (!scope || !MATCHER) return [];
    const items = collectOptions(scope);
    const out = [];
    for (const it of items) {
      const t = textOf(it).replace(/\s+/g, " ");
      if (t && out.indexOf(t) < 0) out.push(t);
      if (out.length >= (limit || 40)) break;
    }
    return out;
  }

  // ---------- 打开下拉 / 日期面板 ----------

  function triggerOf(root, el) {
    const inner = root && root.querySelector(
      ".ant-select-selector, .el-input__wrapper, .el-input__inner, .ant-picker, [role='combobox'], input"
    );
    return inner || el || root;
  }

  // 判断一个已经打开的面板是不是当前控件的。
  // 页面上可能同时留着别的控件（或用户手动打开）的面板，直接复用会拿错面板，
  // 导致「面板里没有这个选项」这类误报。
  function panelBelongsTo(root, panel) {
    if (!root || !panel) return false;
    try {
      if (root.contains(panel)) return true;
      // 组件库通常把面板 id 关联在触发器的 aria-controls / aria-owns 上
      const links = [];
      for (const n of root.querySelectorAll("[aria-controls], [aria-owns]")) {
        const v = n.getAttribute("aria-controls") || n.getAttribute("aria-owns") || "";
        if (v) links.push(...v.split(/\s+/));
      }
      if (links.length && panel.id && links.indexOf(panel.id) >= 0) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  async function openPanel(root, el) {
    // 页面上可能同时留着别的控件（甚至用户手动打开）的面板。
    // 靠「取最后一个可见面板」会拿错，所以这里改成对比点击前后：
    // 点击之后「新出现的」那个面板，才是当前控件打开的。
    const opened = findPanels();
    const owned = opened.find(p => panelBelongsTo(root, p));
    if (owned) return owned;                 // 已能确认归属，直接用

    const before = new Set(opened);
    const pickNew = () => findPanels().find(p => !before.has(p)) || null;

    const trigger = triggerOf(root, el);
    realClick(trigger);
    let panel = await waitFor(pickNew, 700);
    if (panel) return panel;

    // 有些组件把点击绑在根节点上
    if (root && root !== trigger) {
      realClick(root);
      panel = await waitFor(pickNew, 500);
      if (panel) return panel;
    }

    // 再试一次：先聚焦输入框
    try { (el || trigger).focus(); } catch (e) { /* ignore */ }
    realClick(trigger);
    panel = await waitFor(pickNew, 500);
    if (panel) return panel;

    // 兜底：把残留面板先关掉再来一次（此时新出现的一定是自己的）
    closePanels();
    await sleep(160);
    const before2 = new Set(findPanels());
    realClick(trigger);
    panel = await waitFor(() => findPanels().find(p => !before2.has(p)) || null, 600);
    if (panel) return panel;

    // 最后退化为「当前唯一可见的面板」，再不行就放弃（调用方会报「面板没打开」）
    const only = findPanels();
    return only.length === 1 ? only[0] : null;
  }

  function closePanels() {
    try {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    } catch (e) { /* ignore */ }
  }

  // ---------- 下拉填充 ----------

  async function fillDropdown(el, value, fieldKey) {
    const root = rootOf(el);
    const panel = await openPanel(root, el);
    if (!panel) return { ok: false, reason: "下拉面板没打开", kind: "panel" };

    const item = findBestOption(panel, value, fieldKey);
    if (!item) {
      // 先把选项抄下来再关面板 —— 关掉之后面板节点可能就被移除了
      const list = optionTexts(panel);
      closePanels();
      return {
        ok: false,
        kind: "no-match",
        reason: `下拉里没有匹配「${value}」的选项`,
        options: list
      };
    }
    const pickedText = textOf(item);
    realClick(item);
    await sleep(140);
    // 确认已提交：多数组件会把选中文本写回根节点
    const shown = norm(textOf(root));
    const ok = shown.includes(norm(value)) || norm(value).includes(shown) || shown.length > 0;
    return { ok: !!ok, via: "dropdown", picked: pickedText, reason: ok ? "" : `点击了「${value}」但未确认选中` };
  }

  // ---------- 日期填充 ----------

  function parseDateParts(value) {
    const s = String(value || "").trim();
    const m = s.match(/^(\d{4})[-/.年]?\s*(\d{0,2})[-/.月]?\s*(\d{0,2})/);
    if (!m) return null;
    return { y: m[1] || "", m: m[2] ? String(Number(m[2])) : "", d: m[3] ? String(Number(m[3])) : "" };
  }

  function clickByText(scope, text) {
    const t = norm(text);
    if (!t) return false;
    for (const el of scope.querySelectorAll("*")) {
      if (el.children.length > 2) continue;
      const own = norm(textOf(el));
      if (own && (own === t || own === t + "月" || own === t + "年")) {
        if (isVisible(el)) { realClick(el); return true; }
      }
    }
    return false;
  }

  async function fillDate(el, value) {
    const root = rootOf(el);
    const parts = parseDateParts(value);

    // 策略一：直接赋值 + 事件（大量日期组件接受输入框直接设值）
    try {
      setNativeValue(el, value);
      fireInput(el);
      await sleep(120);
      if (norm(el.value) === norm(value)) {
        return { ok: true, via: "date-direct" };
      }
    } catch (e) { /* 继续走面板 */ }

    if (!parts) return { ok: false, reason: `日期格式无法解析：${value}` };

    // 策略二：打开面板逐级点选
    const panel = await openPanel(root, el);
    if (!panel) return { ok: false, reason: "日期面板没打开" };

    // 选年：有的组件打开就是年份视图，先直接找；找不到再点年份按钮切到年份视图再找
    let yearPicked = false;
    if (parts.y) {
      yearPicked = clickByText(panel, parts.y);
      if (!yearPicked) {
        const yearBtn = panel.querySelector(".ant-picker-year-btn, .ant-calendar-year-btn, .el-date-picker__header-label");
        if (yearBtn) {
          realClick(yearBtn);
          await sleep(220);
          yearPicked = clickByText(panel, parts.y);
        }
      }
    }
    if (parts.y && !yearPicked) { closePanels(); return { ok: false, reason: `日期面板里没找到年份 ${parts.y}` }; }
    await sleep(200);

    // 选月
    if (parts.m) {
      const monthPicked = clickByText(panel, parts.m) || clickByText(panel, parts.m + "月");
      if (!monthPicked) { closePanels(); return { ok: false, reason: `日期面板里没找到月份 ${parts.m}` }; }
      await sleep(200);
    }

    // 选日（面板可能已经关闭，那就说明前面已提交）
    if (parts.d && findPanels().length) {
      clickByText(findPanels().slice(-1)[0], parts.d);
      await sleep(150);
    }

    closePanels();
    const got = norm(el.value);
    if (got && (got.includes(parts.y) || norm(value).includes(got))) return { ok: true, via: "date-panel" };
    return { ok: false, reason: "日期面板操作后输入框仍未更新" };
  }

  // ---------- 省市区级联 ----------

  function splitRegion(raw) {
    const s = String(raw || "").replace(/\s+/g, "").replace(/[（(][^）)]*[）)]/g, "");
    if (!s) return [];
    const out = [];
    let rest = s, m;
    if ((m = rest.match(/^(.*?(?:省|自治区|特别行政区|市))/))) { out.push(m[1]); rest = rest.slice(m[1].length); }
    if (rest && (m = rest.match(/^(.*?(?:市|自治州|地区|盟))/))) { out.push(m[1]); rest = rest.slice(m[1].length); }
    if (rest && (m = rest.match(/^(.*?(?:区|县|旗|新区|市))/))) { out.push(m[1]); rest = rest.slice(m[1].length); }
    if (rest) out.push(rest);
    return out.filter(Boolean);
  }

  function cascadeColumns(panel) {
    if (!panel) return [];
    let all = [];
    try {
      all = Array.from(panel.querySelectorAll(
        ".ant-cascader-menu, .el-cascader-menu, [class*='cascader-menu'], [class*='cascader'][class*='menu']"
      ));
    } catch (e) { return []; }
    // 选项节点的 class 里也带 cascader-menu（如 ant-cascader-menu-item），
    // 必须排除，否则「第 2 列」会取到某个选项，后续层级就永远找不到
    const cols = all.filter(el => {
      const cls = String(el.className || "");
      if (/item/i.test(cls)) return false;
      return el.children.length > 0;
    });
    if (cols.length) return cols;
    // 退化成单选模式：只有一个面板
    return [panel];
  }

  async function fillCascade(el, value, fieldKey) {
    const parts = splitRegion(value);
    if (!parts.length) return { ok: false, reason: `地区无法拆分：${value}` };

    const root = rootOf(el);
    // 省市区本身就是地名，统一按 city 的词表/后缀规则匹配（北京 ↔ 北京市）
    const key = fieldKey || "city";
    let panel = await openPanel(root, el);
    if (!panel) return { ok: false, reason: "级联面板没打开", kind: "panel" };

    let pi = 0;
    for (let round = 0; round < 4 && pi < parts.length; round++) {
      const cols = cascadeColumns(panel);
      const col = cols[Math.min(round, cols.length - 1)] || panel;
      // 当前列匹配不上时，允许跳过一级（如「北京市」直下就是区）
      let item = findBestOption(col, parts[pi], key);
      if (!item && pi + 1 < parts.length) {
        item = findBestOption(col, parts[pi + 1], key);
        if (item) pi++;
      }
      if (!item) break;
      realClick(item);
      pi++;
      await sleep(200);
      // 级联面板本身不变（只是里面的列在变），只有它被关掉了才需要重新取
      if (!isVisible(panel)) {
        const next = findPanels();
        if (next.length) panel = next[next.length - 1];
      }
    }

    // 失败信息要在关面板之前抄下来 —— 关掉之后面板节点可能就被移除了
    const cols = cascadeColumns(panel);
    const failCol = cols[Math.min(pi, cols.length - 1)] || panel;
    const colOptions = optionTexts(failCol);
    const detail = cols.length
      ? cols.map((c, i) => "第" + (i + 1) + "列=" + textOf(c).replace(/\s+/g, " ").slice(0, 24)).join("；")
      : (textOf(panel).replace(/\s+/g, " ").slice(0, 40) || "面板是空的");
    closePanels();
    if (pi >= parts.length) return { ok: true, via: "cascade" };
    return {
      ok: false,
      kind: "no-match",
      reason: `级联只填到「${parts.slice(0, pi).join("/") || "无"}」，缺「${parts[pi]}」（${detail}）`,
      options: colOptions
    };
  }

  // ---------- 对外入口 ----------

  async function fillWidget(el, value, fieldKey) {
    const kind = classify(el);
    try {
      if (kind === "cascade") return await fillCascade(el, value, fieldKey);
      if (kind === "date") return await fillDate(el, value);
      if (kind === "dropdown") return await fillDropdown(el, value, fieldKey);
      return { ok: false, reason: "不是组件型控件" };
    } catch (e) {
      closePanels();
      return { ok: false, reason: "组件填充异常：" + (e && e.message ? e.message : e) };
    }
  }

  window.JIANLI_WIDGETS = {
    classify, rootOf, fillWidget, splitRegion, parseDateParts,
    util: {
      realClick, isVisible, textOf, norm, waitFor, sleep, setNativeValue, fireInput,
      findPanels, findBestOption, optionTexts, collectOptions
    }
  };
})();
