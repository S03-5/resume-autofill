// ============================================================
// 填表引擎：智能字段识别 + 站点适配器 + 表单填充
// 支持 input / textarea / select / 单选按钮 / contenteditable 富文本
// ============================================================
(function () {
  if (window.__JIANLI_CONTENT_READY__) return;
  window.__JIANLI_CONTENT_READY__ = true;

  const FIELD_DEFS = window.JIANLI_FIELD_DEFS;
  const SITE_ADAPTERS = window.JIANLI_SITE_ADAPTERS;
  const SCORE_THRESHOLD = 22;

  // 这些词出现在元素属性里时直接跳过，避免误填登录/搜索/验证码框
  const BLOCK_WORDS = [
    "password", "pwd", "验证码", "captcha", "username", "user name",
    "login", "signin", "登录", "注册", "search", "搜索", "keyword", "关键词"
  ];

  function getHostAdapter() {
    const host = location.hostname;
    return SITE_ADAPTERS.find(a =>
      a.hosts.some(h => host === h || host.endsWith("." + h))
    ) || null;
  }

  function collectLabels(el) {
    const out = [];
    try {
      if (el.labels) {
        for (const l of el.labels) {
          const t = l.innerText.trim();
          if (t) out.push(t);
        }
      }
    } catch (e) { /* ignore */ }
    if (el.id) {
      try {
        const lf = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lf && lf.innerText.trim()) out.push(lf.innerText.trim());
      } catch (e) { /* ignore */ }
    }
    const parentLabel = el.closest ? el.closest("label") : null;
    if (parentLabel && parentLabel.innerText.trim()) out.push(parentLabel.innerText.trim());
    const prev = el.previousElementSibling;
    if (prev && prev.innerText && !prev.matches("input,textarea,select") && prev.innerText.trim().length <= 40) {
      out.push(prev.innerText.trim());
    }
    // 向上两级查找“短文本”标签，兼容 <label>姓名</label><div><input/></div> 这类嵌套结构
    let node = el.parentElement;
    for (let depth = 0; depth < 2 && node; depth++) {
      const sib = node.previousElementSibling;
      if (sib && !sib.matches("input,textarea,select") && !sib.querySelector("input,textarea,select") &&
          sib.innerText && sib.innerText.trim().length <= 40) {
        out.push(sib.innerText.trim());
      }
      for (const child of node.children) {
        if (child === el || child.contains(el)) continue;
        if (!child.querySelector("input,textarea,select") && child.innerText && child.innerText.trim().length <= 40) {
          out.push(child.innerText.trim());
        }
      }
      node = node.parentElement;
    }
    return out.filter(Boolean);
  }

  // 收集用于识别的文本信号，每个信号带一个来源权重
  function getSignals(el) {
    const s = [];
    const push = (v, w) => {
      if (v && String(v).trim()) s.push({ t: String(v).trim(), w });
    };
    push(el.getAttribute("placeholder"), 15);
    push(el.getAttribute("aria-label"), 15);
    push(el.getAttribute("data-label"), 15);
    push(el.getAttribute("data-placeholder"), 15);
    push(el.getAttribute("title"), 10);
    push(el.getAttribute("autocomplete"), 20);
    push(el.name, 8);
    push(el.id, 8);
    push(el.getAttribute("data-name"), 8);
    push(el.getAttribute("data-title"), 10);
    push(typeof el.className === "string" ? el.className : "", 3);
    for (const l of collectLabels(el)) push(l, 15);
    return s;
  }

  function isFillable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "INPUT") {
      const type = (el.type || "").toLowerCase();
      if (["hidden", "password", "button", "submit", "reset", "file", "image"].includes(type)) return false;
      return !el.disabled && !el.readOnly;
    }
    if (tag === "TEXTAREA" || tag === "SELECT") return !el.disabled && !el.readOnly;
    return false;
  }

  function isBlocked(el) {
    const text = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.className]
      .filter(Boolean).join(" ").toLowerCase();
    return BLOCK_WORDS.some(b => text.includes(b.toLowerCase()));
  }

  function collectCandidates() {
    const sel = 'input, textarea, select, [contenteditable="true"], [role="textbox"][contenteditable]';
    const nodes = document.querySelectorAll(sel);
    const out = [];
    for (const el of nodes) {
      if (isFillable(el) && !isBlocked(el)) out.push(el);
    }
    return out;
  }

  // 扫描当前页面所有可填字段，供“对比插件字段”使用
  function scanFields() {
    const candidates = collectCandidates();
    const adapter = getHostAdapter();
    const fields = [];
    const keys = Object.keys(FIELD_DEFS);

    for (const el of candidates) {
      const signalCache = new Map([[el, getSignals(el)]]);
      let bestKey = null;
      let bestScore = 0;
      for (const key of keys) {
        const s = elementFieldScore(el, FIELD_DEFS[key], signalCache);
        if (s >= SCORE_THRESHOLD && s > bestScore) {
          bestScore = s;
          bestKey = key;
        }
      }
      const info = {
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        name: el.name || "",
        id: el.id || "",
        placeholder: el.getAttribute("placeholder") || "",
        aria: el.getAttribute("aria-label") || "",
        label: collectLabels(el).join(" / "),
        autocomplete: el.getAttribute("autocomplete") || "",
        matched: bestKey,
        score: bestScore
      };
      if (el.tagName === "SELECT") {
        info.options = Array.from(el.options).map(o => o.textContent.trim());
      }
      if (el.isContentEditable) info.contenteditable = true;
      fields.push(info);
    }

    return {
      ok: true,
      url: location.href,
      host: location.hostname,
      adapter: adapter ? adapter.name : null,
      fields
    };
  }

  function elementFieldScore(el, field, signalCache) {
    const signals = signalCache.get(el);
    let best = 0;
    for (const sig of signals) {
      const text = sig.t.toLowerCase();
      for (const kw of field.keywords) {
        const k = kw.toLowerCase();
        const idx = text.indexOf(k);
        if (idx === -1) continue;
        let s = sig.w + k.length * 4;
        if (text === k) s += 40;
        // 关键词落在标签/提示词末尾时更可信（如“最高学历专业”里“专业”更具体）；
        // 刻意不给“关键词在开头”加分，避免“最高学历学校”被“最高学历”抢走
        if (idx + k.length === text.length) s += 20;
        if (k.length >= 4) s += 4;
        if (s > best) best = s;
      }
    }
    return best;
  }

  function findByAdapter(adapter, fieldKey) {
    if (!adapter || !adapter.fields || !adapter.fields[fieldKey]) return null;
    for (const sel of adapter.fields[fieldKey]) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of els) {
        if (isFillable(el) && !isBlocked(el)) return el;
      }
    }
    return null;
  }

  // 身份类字段允许同时填写多个同类输入框（如快手“最高学历学校”和“教育经历-学校”）
  const MULTI_FILL_KEYS = new Set([
    "name", "phone", "email", "gender", "birth", "id_number",
    "country", "nationality", "political", "school", "degree",
    "major", "college", "current_residence", "graduate_year"
  ]);
  const MULTI_FILL_MAX = 3;

  // 生成填写计划：适配器选择器优先，智能识别兜底；按得分从高到低贪心分配
  function buildPlan(data, adapter, extraFields) {
    const allFields = Object.assign({}, FIELD_DEFS, extraFields || {});
    const candidates = collectCandidates();
    const used = new Set();
    const plan = [];
    const itemsByKey = new Map();
    const addItem = (key, el, source, score) => {
      used.add(el);
      if (!itemsByKey.has(key)) itemsByKey.set(key, []);
      itemsByKey.get(key).push({ key, el, source, score });
    };

    // 1. 适配器选择器优先（每个字段最多命中一个）
    for (const key of Object.keys(allFields)) {
      if (!data[key]) continue;
      const adapterEl = findByAdapter(adapter, key);
      if (adapterEl && !used.has(adapterEl)) {
        addItem(key, adapterEl, "adapter", 999);
      }
    }

    // 2. 智能匹配：收集所有候选，按得分排序后贪心认领
    const triples = [];
    const signalCache = new Map(candidates.map(el => [el, getSignals(el)]));
    for (const el of candidates) {
      if (used.has(el)) continue;
      for (const key of Object.keys(allFields)) {
        if (!data[key]) continue;
        const score = elementFieldScore(el, allFields[key], signalCache);
        if (score >= SCORE_THRESHOLD) triples.push({ key, el, score });
      }
    }
    triples.sort((a, b) => b.score - a.score);
    const countByKey = new Map();
    for (const t of triples) {
      if (used.has(t.el)) continue;
      const n = countByKey.get(t.key) || 0;
      if (MULTI_FILL_KEYS.has(t.key)) {
        if (n >= MULTI_FILL_MAX) continue;
      } else if (n >= 1) {
        continue;
      }
      countByKey.set(t.key, n + 1);
      addItem(t.key, t.el, "smart", t.score);
    }

    for (const key of Object.keys(allFields)) {
      if (itemsByKey.has(key)) {
        for (const item of itemsByKey.get(key)) plan.push(item);
      }
    }
    return plan;
  }

  // 通过原生 setter 赋值并派发事件，兼容 React / Vue 受控组件
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

  function fillContentEditable(el, value) {
    el.textContent = "";
    const parts = String(value).split("\n");
    parts.forEach((p, i) => {
      if (i > 0) el.appendChild(document.createElement("br"));
      el.appendChild(document.createTextNode(p));
    });
    fireInput(el);
    return { ok: true };
  }

  function fillRadioGroup(el, value) {
    const name = el.name;
    const radios = name
      ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))
      : [el];
    const v = String(value).trim();
    for (const r of radios) {
      const texts = collectLabels(r).join(" ") + " " + r.value;
      if (texts.includes(v)) {
        if (!r.checked) r.click();
        return { ok: true };
      }
    }
    return { ok: false, reason: `没有找到选项“${v}”` };
  }

  function fillSelect(el, value) {
    const v = String(value).trim();
    let target = null;
    for (const opt of el.options) {
      const t = opt.textContent.trim();
      if (t === v) { target = opt; break; }
      if (!target && (t.includes(v) || v.includes(t))) target = opt;
    }
    if (!target) return { ok: false, reason: `选项里没有“${v}”` };
    setNativeValue(el, target.value);
    fireInput(el);
    return { ok: true };
  }

  function fillElement(el, value) {
    if (el.isContentEditable) return fillContentEditable(el, value);
    const tag = el.tagName;
    if (tag === "SELECT") return fillSelect(el, value);
    if (tag === "INPUT" && (el.type === "radio" || el.type === "checkbox")) {
      return fillRadioGroup(el, value);
    }

    let val = String(value);
    if (tag === "INPUT" && el.type === "date" && /^\d{4}-\d{2}$/.test(val)) val += "-01";
    setNativeValue(el, val);
    fireInput(el);
    return { ok: true };
  }

  function highlight(el, label) {
    try {
      el.style.outline = "2px dashed #16a34a";
      el.style.outlineOffset = "2px";
      el.setAttribute("data-jianli-filled", label);
    } catch (e) { /* ignore */ }
  }

  function runFill(data, mode, customFields) {
    const extraFields = {};
    const cfList = customFields || [];
    for (const cf of cfList) {
      if (cf && cf.label && cf.value) {
        extraFields["custom_" + cf.id] = {
          label: cf.label,
          type: "text",
          options: [],
          keywords: [cf.label]
        };
      }
    }
    const allDefs = Object.assign({}, FIELD_DEFS, extraFields);
    const adapter = getHostAdapter();
    const plan = buildPlan(data || {}, adapter, extraFields);
    const results = plan.map(item => {
      const def = allDefs[item.key];
      const r = fillElement(item.el, data[item.key]);
      if (r.ok) highlight(item.el, def.label);
      return {
        key: item.key,
        label: def.label,
        ok: !!r.ok,
        reason: r.reason || "",
        source: item.source
      };
    });
    const filled = results.filter(r => r.ok).length;
    return {
      ok: true,
      filled,
      total: plan.length,
      adapter: adapter ? adapter.name : null,
      host: location.hostname,
      results
    };
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 自动填写：仅限支持的招聘网站，且至少能识别到 2 个高置信字段时才执行
  async function tryAutoFill() {
    try {
      if (sessionStorage.getItem("jianli_autofilled")) return;
      const adapter = getHostAdapter();
      if (!adapter) return;
      const stored = await chrome.storage.local.get(["settings", "resumeData"]);
      if (!stored.settings || !stored.settings.autoFill) return;
      await sleep(1600); // 等待页面动态渲染
      const plan = buildPlan(stored.resumeData || {}, adapter);
      const confident = plan.filter(p => p.source === "adapter" || p.score >= 30).length;
      if (confident < 2) return;
      runFill(stored.resumeData || {}, "auto");
      sessionStorage.setItem("jianli_autofilled", "1");
    } catch (e) { /* 自动填写失败不影响使用 */ }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "FILL_PAGE") {
      sendResponse(runFill(msg.data || {}, msg.mode || "manual", msg.customFields));
    } else if (msg.type === "GET_STATUS") {
      const adapter = getHostAdapter();
      sendResponse({
        ok: true,
        url: location.href,
        host: location.hostname,
        title: document.title,
        adapter: adapter ? adapter.name : null,
        candidates: collectCandidates().length
      });
    } else if (msg.type === "SCAN_FIELDS") {
      sendResponse(scanFields());
    }
  });

  tryAutoFill();
})();
