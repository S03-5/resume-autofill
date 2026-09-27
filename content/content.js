// ============================================================
// 填表引擎：智能字段识别 + 站点适配器 + 组件型控件 + 经历块 + 附件上传
// 支持 input / textarea / select / 单选 / contenteditable / 组件库自绘控件
// ============================================================
(function () {
  if (window.__JIANLI_CONTENT_READY__) return;
  window.__JIANLI_CONTENT_READY__ = true;

  const FIELD_DEFS = window.JIANLI_FIELD_DEFS;
  const SITE_ADAPTERS = window.JIANLI_SITE_ADAPTERS;
  const WIDGETS = window.JIANLI_WIDGETS;
  const BLOCKS = window.JIANLI_BLOCKS;
  const HUD = window.JIANLI_HUD;
  const MEMORY = window.JIANLI_MEMORY;
  const INFER = window.JIANLI_INFER;
  const LEDGER = window.JIANLI_LEDGER;
  // 选项匹配统一走这一个模块（原生下拉 / 单选组 / 组件型下拉 / 级联都用它）
  const MATCHER = window.JIANLI_MATCHER;
  const SCORE_THRESHOLD = 22;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 当前生效的设置（弹窗改设置后通过 storage.onChanged 实时刷新）
  let settings = {};
  // 上一次填写的原值快照，供「撤销」使用；一次只保留最近一次
  let undoRecord = null;
  // 上一次填写的「待手填」DOM 引用（不能跨进程传递，只在页面内给战报浮层用）
  let lastRefs = { pending: [], unknown: [] };
  // 悬浮球位置（独立于 settings 存储，拖动后即时记忆）
  let hudPos = null;

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

  // 给「没被认出来的空白框」起一个人能看懂的名字，用于战报浮层
  function describeEl(el) {
    const labels = collectLabels(el).filter(t => t && t.length <= 30);
    const raw = labels[0]
      || el.getAttribute("placeholder")
      || el.getAttribute("aria-label")
      || el.getAttribute("data-label")
      || el.name
      || el.id
      || "";
    const text = String(raw).replace(/\s+/g, " ").trim().slice(0, 30);
    if (text) return text;
    const tag = el.tagName.toLowerCase();
    if (el.isContentEditable) return "富文本输入框（无标签）";
    if (tag === "select") return "下拉框（无标签）";
    if (tag === "textarea") return "多行输入框（无标签）";
    return "输入框（无标签）";
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
      if (el.disabled) return false;
      // 组件库自绘控件的内部输入框是只读的（antd Select / Element Select / 日期控件），
      // 只读但在组件容器内时要保留，否则这类控件永远发现不了
      if (el.readOnly && !(WIDGETS && WIDGETS.rootOf(el))) return false;
      return true;
    }
    if (tag === "TEXTAREA" || tag === "SELECT") return !el.disabled && !el.readOnly;
    return false;
  }

  function isBlocked(el) {
    // class 只在「不是组件型控件」时才参与判断：
    // antd Select 的内部输入框 class 就叫 xxx-selection-search-input，
    // 按 class 判定会把它当搜索框排除掉，导致所有非原生下拉都填不上。
    const isWidget = !!(WIDGETS && WIDGETS.rootOf(el));
    const text = [
      el.name,
      el.id,
      el.getAttribute("placeholder"),
      el.getAttribute("aria-label"),
      isWidget ? "" : el.className
    ].filter(Boolean).join(" ").toLowerCase();
    return BLOCK_WORDS.some(b => text.includes(b.toLowerCase()));
  }

  const CANDIDATE_SEL = 'input, textarea, select, [contenteditable="true"], [role="textbox"][contenteditable]';

  function collectCandidates(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll(CANDIDATE_SEL);
    const out = [];
    for (const el of nodes) {
      if (isFillable(el) && !isBlocked(el)) out.push(el);
    }
    return out;
  }

  // 同 collectCandidates，但不套 isBlocked。
  // 记忆里的映射是用户自己确认过的，哪怕这个框的 class 带「search」也该被填。
  function collectFillable(root) {
    const scope = root || document;
    const out = [];
    for (const el of scope.querySelectorAll(CANDIDATE_SEL)) {
      if (isFillable(el)) out.push(el);
    }
    return out;
  }

  // 扫描当前页面所有可填字段，供「扫描本页字段 / 适配器生成器」使用
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
        widget: WIDGETS ? WIDGETS.classify(el) : "native",
        readonly: !!el.readOnly,
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

  // 在指定子树内按关键词找最匹配的可填控件（供经历块逐行填充使用）
  function matchIn(root, keywords, used) {
    let best = null, bestScore = 0;
    for (const el of collectCandidates(root)) {
      if (used && used.has(el)) continue;
      const signals = getSignals(el);
      for (const sig of signals) {
        const text = sig.t.toLowerCase();
        for (const kw of keywords) {
          const k = String(kw).toLowerCase();
          const idx = text.indexOf(k);
          if (idx === -1) continue;
          let s = sig.w + k.length * 4;
          if (text === k) s += 40;
          if (idx + k.length === text.length) s += 20;
          if (s >= SCORE_THRESHOLD && s > bestScore) { bestScore = s; best = el; }
        }
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
    "major", "college", "current_residence", "graduate_year",
    // 学位和学习形式跟学历一样，会在「主表单」和「教育经历」里各出现一次，
    // 只填第一处的话另一处会一直空着
    "degree_name", "study_mode"
  ]);
  const MULTI_FILL_MAX = 3;

  // 经历块「独占区」的缓存。这类区块（家庭情况）的控件不参与主表单匹配，
  // 否则「姓名」「电话」这种与本人同名的标签会被主表单抢填。
  // 区块定位要遍历 DOM，一次填充只算一次。
  let exclusiveAreasCache = null;
  function exclusiveAreas() {
    if (exclusiveAreasCache) return exclusiveAreasCache;
    try {
      exclusiveAreasCache = (BLOCKS && BLOCKS.exclusiveAreas) ? BLOCKS.exclusiveAreas() : [];
    } catch (e) {
      exclusiveAreasCache = [];
    }
    return exclusiveAreasCache;
  }

  // 生成填写计划：记忆映射 > 适配器选择器 > 智能识别；按得分从高到低贪心分配
  function buildPlan(data, adapter, extraFields, options) {
    const opts = options || {};
    const allFields = Object.assign({}, FIELD_DEFS, extraFields || {});
    let candidates = collectCandidates();
    // 经历块的独占区（家庭情况）整块交给 blocks.js 按成员填，
    // 主表单的全页关键词匹配碰不到里面 —— 那里的「姓名」「电话」标签和本人同名，
    // 一旦参与匹配，你父亲的姓名框会被填成你自己的名字，且之后改不回来。
    const owned = exclusiveAreas();
    if (owned.length) {
      candidates = candidates.filter(el => !owned.some(a => a.contains(el)));
    }
    // 只填空白框：跳过页面上已经有内容的控件
    if (opts.skipFilled) {
      candidates = candidates.filter(el => !hasValue(el));
    }
    const used = new Set();
    const plan = [];
    const itemsByKey = new Map();
    const addItem = (key, el, source, score) => {
      used.add(el);
      if (!itemsByKey.has(key)) itemsByKey.set(key, []);
      itemsByKey.get(key).push({ key, el, source, score });
    };

    // 0. 记忆映射优先
    //    用户手动纠正过的框，一律按他说的算，不再让智能识别去猜。
    //    这里用 collectFillable（不过滤 isBlocked）：用户明确指定过的框，
    //    哪怕 class 里带 “search” 也该填。
    const knownEmpty = [];
    if (opts.useMemory !== false && MEMORY) {
      let memo = new Map();
      try { memo = MEMORY.resolve(location.hostname, collectFillable()); } catch (e) { memo = new Map(); }
      for (const [el, entry] of memo) {
        if (used.has(el) || !el.isConnected || !entry.key) continue;
        const skip = opts.skipFilled && hasValue(el);
        used.add(el); // 认领掉，避免又跑到「未识别」清单里
        if (skip) continue;
        if (!data[entry.key]) {
          // 插件认识这个框，但简历里没有对应内容 —— 单独告诉用户
          if (allFields[entry.key] || entry.key.startsWith("custom_")) {
            knownEmpty.push({ key: entry.key, label: entry.label || entry.key, el, via: entry.via || "selector" });
          }
          continue;
        }
        addItem(entry.key, el, "memory", 1200);
      }
    }

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

    // 3. 未被任何字段认领、且当前为空的控件：这些才是用户真正需要手填的
    const untouched = [];
    for (const el of candidates) {
      if (used.has(el)) continue;
      if (hasValue(el)) continue;
      untouched.push(el);
    }

    return { plan, untouched, knownEmpty };
  }

  function hasValue(el) {
    try {
      if (el.isContentEditable) return !!String(el.textContent || "").trim();
      if (el.tagName === "SELECT") {
        const v = el.value || "";
        // 「（请选择）」「请选择」这类占位项不算已填
        if (!v) return false;
        const opt = el.options[el.selectedIndex];
        const t = opt ? opt.textContent.trim() : "";
        return !/^$|请选择|请下拉选择|^--|^－/.test(t);
      }
      if (el.type === "radio" || el.type === "checkbox") {
        const name = el.name;
        if (!name) return !!el.checked;
        return !!document.querySelector(`input[type="${el.type}"][name="${CSS.escape(name)}"]:checked`);
      }
      return !!String(el.value || "").trim();
    } catch (e) { return false; }
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

  function fillRadioGroup(el, value, fieldKey) {
    const name = el.name;
    const radios = name
      ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))
      : [el];
    const v = String(value).trim();
    // 一个单选框可能有多个候选文本：label 文字、value 属性、邻近文字
    const textOf = r => {
      const t = collectLabels(r).slice();
      if (r.value) t.push(r.value);
      return t.length ? t : [""];
    };
    const hit = MATCHER && MATCHER.pick(v, radios, fieldKey, textOf);
    if (hit) {
      if (!hit.item.checked) hit.item.click();
      return { ok: true, via: "radio", picked: hit.text };
    }
    return {
      ok: false,
      reason: `没有选项匹配「${v}」`,
      options: radios.map(textOf).map(t => t[0]).filter(Boolean)
    };
  }

  function fillSelect(el, value, fieldKey) {
    const v = String(value).trim();
    const opts = Array.from(el.options || []);
    // 选项文本优先，其次 value 属性（有些站点把中文写在 value 里）
    const textOf = o => {
      const t = [];
      const tx = (o.textContent || "").trim();
      if (tx) t.push(tx);
      if (o.value && o.value !== tx) t.push(o.value);
      return t.length ? t : [""];
    };
    const hit = MATCHER && MATCHER.pick(v, opts, fieldKey, textOf);
    if (hit) {
      setNativeValue(el, hit.item.value);
      fireInput(el);
      return { ok: true, via: "select", picked: hit.text };
    }
    return {
      ok: false,
      reason: `选项里没有匹配「${v}」的项`,
      options: opts.map(o => (o.textContent || "").trim()).filter(Boolean)
    };
  }

  // 统一的单控件填充入口：组件型控件交给 widgets.js，其余走原生路径
  async function fillOne(el, value, options, fieldKey) {
    const opts = options || {};
    if (!opts.deepFill && WIDGETS && WIDGETS.classify(el) !== "native") {
      return { ok: false, reason: "组件型控件（已关闭深度填充）" };
    }
    if (el.isContentEditable) return fillContentEditable(el, value);
    const tag = el.tagName;
    if (tag === "SELECT") return fillSelect(el, value, fieldKey);
    if (tag === "INPUT" && (el.type === "radio" || el.type === "checkbox")) {
      return fillRadioGroup(el, value, fieldKey);
    }

    // 组件型控件：先试原生赋值，不行再点面板
    if (WIDGETS) {
      const kind = WIDGETS.classify(el);
      if (kind === "cascade" || kind === "dropdown" || kind === "date") {
        return await WIDGETS.fillWidget(el, value, fieldKey);
      }
    }

    let val = String(value);
    if (tag === "INPUT" && el.type === "date" && /^\d{4}-\d{2}$/.test(val)) val += "-01";
    setNativeValue(el, val);
    fireInput(el);
    return { ok: true };
  }

  function labelOf(el) {
    if (el.isContentEditable) return "富文本";
    if (el.tagName === "SELECT") return "下拉";
    if (el.tagName === "TEXTAREA") return "多行文本";
    if (el.tagName === "INPUT") return el.type || "文本";
    return el.tagName.toLowerCase();
  }

  // 记录元素被我们改过的样式/属性，撤销时原样还回去（避免污染站点自己的样式）
  const styleBackup = new WeakMap();

  function backupStyle(el) {
    if (!el || styleBackup.has(el)) return;
    try {
      styleBackup.set(el, {
        outline: el.style.outline,
        offset: el.style.outlineOffset,
        mark: el.getAttribute("data-jianli-filled")
      });
    } catch (e) { /* ignore */ }
  }

  function restoreStyle(el) {
    const b = styleBackup.get(el);
    if (!b) return;
    try {
      el.style.outline = b.outline;
      el.style.outlineOffset = b.offset;
      if (b.mark === null) el.removeAttribute("data-jianli-filled");
      else el.setAttribute("data-jianli-filled", b.mark);
    } catch (e) { /* ignore */ }
    styleBackup.delete(el);
  }

  function highlight(el, label) {
    try {
      backupStyle(el);
      el.style.outline = "2px dashed #16a34a";
      el.style.outlineOffset = "2px";
      el.setAttribute("data-jianli-filled", label);
      // 组件型控件的输入框在容器内，把标记也打到容器上更显眼
      const root = WIDGETS && WIDGETS.rootOf(el);
      if (root && root !== el && !root.hasAttribute("data-jianli-filled")) {
        backupStyle(root);
        root.style.outline = "2px dashed #16a34a";
        root.style.outlineOffset = "2px";
        root.setAttribute("data-jianli-filled", label);
      }
    } catch (e) { /* ignore */ }
  }

  function clearHighlight(el) {
    restoreStyle(el);
    try {
      const root = WIDGETS && WIDGETS.rootOf(el);
      if (root && root !== el) restoreStyle(root);
    } catch (e) { /* ignore */ }
  }

  // 填写前的原值快照（供撤销使用）
  function snapshotOf(el) {
    try {
      if (el.isContentEditable) return { value: el.textContent };
      if (el.type === "radio" || el.type === "checkbox") return { value: el.checked ? "1" : "" };
      return { value: el.value };
    } catch (e) { return null; }
  }

  // 岗位推断：把当前岗位页的岗位名 / 城市覆盖到「期望职位 / 期望城市」上。
  // 这是用户明确选定的行为（总是用推断值覆盖），所以这里不做空值判断，直接改；
  // 关掉「按岗位自动推断意向字段」开关就完全不碰用户自己填的内容。
  // 推断不出来时返回 null，原值保持不变 —— 宁可不改也不改错。
  function applyInferred(data, opts) {
    if (!INFER || !data) return null;
    if (opts && opts.inferPosition === false) return null;
    let inf;
    try { inf = INFER.inferPage(); } catch (e) { return null; }
    if (!inf || (!inf.position && !inf.city)) return null;

    const before = { position: data.position || "", city: data.city || "" };
    const applied = {};
    if (inf.position && inf.position !== before.position) {
      data.position = inf.position;
      applied.position = inf.position;
    }
    if (inf.city && inf.city !== before.city) {
      data.city = inf.city;
      applied.city = inf.city;
    }
    // 推断结果和页面上已有的一致，就不算改动，免得战报里多一条噪音
    if (!Object.keys(applied).length) return null;

    return {
      applied,                 // { position?, city? } 实际覆盖了什么
      before,                  // 覆盖前的值（撤销后页面会回到这个）
      raw: inf.raw,            // 推断依据的原始标题，战报里给用户看
      sourcePos: inf.sourcePos,
      sourceCity: inf.sourceCity
    };
  }

  async function runFill(payload) {
    const msg = payload || {};
    const data = msg.data || {};
    const opts = msg.options || {};
    const customFields = msg.customFields || [];

    // 每次填充重新定位经历块独占区：上一轮可能刚点过「添加」按钮，
    // 或页面重新渲染过，缓存的 DOM 引用会失效
    exclusiveAreasCache = null;

    const extraFields = {};
    for (const cf of customFields) {
      if (cf && cf.label && cf.value) {
        extraFields["custom_" + cf.id] = {
          label: cf.label,
          type: "text",
          options: [],
          keywords: [cf.label]
        };
      }
    }
    // 岗位推断要排在建计划之前：覆盖后的值直接参与字段匹配
    const inferred = applyInferred(data, opts);
    const allDefs = Object.assign({}, FIELD_DEFS, extraFields);
    const adapter = getHostAdapter();
    // 记忆表在内存里的副本要先加载好，否则第一遍填写用不上历史映射
    if (MEMORY) {
      try { await MEMORY.ensureLoaded(); } catch (e) { /* 读不到记忆时退回智能识别 */ }
    }
    const built = buildPlan(data, adapter, extraFields, opts);
    const plan = built.plan;
    const results = [];
    const snapshot = [];

    // 1. 常规字段
    for (const item of plan) {
      const def = allDefs[item.key];
      const before = snapshotOf(item.el);
      const r = await fillOne(item.el, data[item.key], opts, item.key);
      if (r.ok) {
        highlight(item.el, def.label);
        snapshot.push({ el: item.el, before });
      }
      results.push({
        key: item.key,
        label: def.label,
        ok: !!r.ok,
        reason: r.reason || "",
        source: item.source,
        via: r.via || "",
        picked: r.picked || "",
        // 匹配不上时带上该控件的全部选项，战报里列给用户看
        options: r.options && r.options.length ? r.options : null,
        category: "field",
        type: labelOf(item.el),
        _el: item.el
      });
    }

    // 2. 页面里没认出来的空白控件（战报里单列，提示用户手填）
    const unknownEls = built.untouched.slice(0, 15);

    // 2.5 记忆里认识、但简历里没有对应内容的框
    const knownEmptyRefs = (built.knownEmpty || [])
      .slice(0, 10)
      .map(k => ({ key: k.key, label: k.label, el: k.el }));

    // 3. 重复经历块
    if (opts.fillBlocks !== false && BLOCKS && msg.blocks) {
      try {
        const blockResults = await BLOCKS.fillBlocks(msg.blocks, {
          matchIn,
          fill: async (el, value, key) => {
            const before = snapshotOf(el);
            const res = await fillOne(el, value, Object.assign({ deepFill: true }, opts), key);
            if (res && res.ok) { highlight(el, "经历块"); snapshot.push({ el, before }); }
            return res || { ok: false, reason: "未处理" };
          }
        }, opts);
        for (const b of blockResults) {
          results.push({
            key: "block_" + b.block,
            label: b.label + (b.filledRows ? `（${b.filledRows} 条）` : ""),
            ok: !!b.ok,
            reason: b.reason || "",
            category: "block",
            type: "经历块"
          });
        }
      } catch (e) {
        results.push({ key: "block_error", label: "经历块", ok: false, reason: "处理异常：" + e.message, category: "block", type: "经历块" });
      }
    }

    // 4. 简历附件
    if (opts.autoAttach !== false && msg.attachment) {
      try {
        const a = await BLOCKS.attachResume(msg.attachment);
        results.push({
          key: "attachment",
          label: "简历附件",
          ok: !!a.ok,
          reason: a.reason || (a.name ? "已上传 " + a.name : ""),
          category: "attachment",
          type: "文件"
        });
      } catch (e) {
        results.push({ key: "attachment", label: "简历附件", ok: false, reason: "处理异常：" + e.message, category: "attachment", type: "文件" });
      }
    }

    const filled = results.filter(r => r.ok).length;

    // 记录快照供撤销；同一次填写只保留最近一份
    if (snapshot.length) {
      undoRecord = { at: Date.now(), host: location.hostname, url: location.href, items: snapshot };
    }

    // 待手填 = 已知字段但没填上 + 页面里完全没认出来的空白框
    const pendingRefs = results
      .filter(r => !r.ok && r.category === "field" && r._el)
      .map(r => ({ label: r.label, reason: r.reason, options: r.options || null, el: r._el }))
      .slice(0, 15);
    const unknownRefs = unknownEls.map(el => ({
      label: describeEl(el),
      title: "插件不认识这个框，需要你手动填；也可以点右边的「记住」直接告诉它",
      el,
      onRemember: (target, row) => {
        openFieldPicker(target, {
          sub: "点下面任意一项，插件就记住「" + describeEl(target) + "」该填什么，以后自动认出来",
          onPick: async (key, label) => {
            const r = await rememberField(target, key, label);
            if (r) markRemembered(row, label);
          }
        });
      }
    }));

    // DOM 引用没法跨进程传给弹窗，单独存在模块变量里给战报浮层用
    lastRefs = { pending: pendingRefs, unknown: unknownRefs, knownEmpty: knownEmptyRefs };

    return {
      ok: true,
      filled,
      total: results.length,
      adapter: adapter ? adapter.name : null,
      host: location.hostname,
      // results 里带着 DOM 引用，跨进程消息传不过去，这里剥掉
      results: results.map(r => ({
        key: r.key, label: r.label, ok: r.ok, reason: r.reason,
        source: r.source, via: r.via, category: r.category, type: r.type
      })),
      pending: pendingRefs.map(p => ({ label: p.label, reason: p.reason, options: p.options })),
      unknown: unknownRefs.map(u => ({ label: u.label })),
      knownEmpty: knownEmptyRefs.map(k => ({ label: k.label })),
      unknownTotal: built.untouched.length,
      memory: MEMORY ? MEMORY.countFor(location.hostname) : 0,
      inferred: inferred || null,
      snapshotCount: snapshot.length
    };
  }

  // ---------- 撤销 ----------

  // 把单个控件恢复到填写前的值
  function restoreValue(el, before) {
    if (!before) return false;
    clearHighlight(el);
    if (el.isContentEditable) {
      el.textContent = before.value || "";
      fireInput(el);
      return true;
    }
    if (el.type === "radio" || el.type === "checkbox") {
      const want = !!before.value;
      if (el.checked !== want) {
        el.checked = want;
        fireInput(el);
      }
      return true;
    }
    setNativeValue(el, before.value || "");
    fireInput(el);
    return true;
  }

  async function applyUndo() {
    if (!undoRecord || !undoRecord.items.length) {
      if (HUD) HUD.toast("这次会话还没有填写记录，没有可撤销的内容");
      return { ok: false, reason: "没有可撤销的填写记录" };
    }
    let restored = 0;
    let failed = 0;
    // 倒序还原，保证后填的先撤
    for (const it of undoRecord.items.slice().reverse()) {
      try {
        if (!it.el || !it.el.isConnected) { failed++; continue; }
        restoreValue(it.el, it.before);
        restored++;
      } catch (e) { failed++; }
    }
    const total = undoRecord.items.length;
    undoRecord = null;
    if (HUD) {
      HUD.hideReport();
      HUD.toast(
        "已撤销：" + restored + " 个框恢复原值" + (failed ? "，" + failed + " 个已不在页面上" : ""),
        failed ? "err" : "ok"
      );
    }
    return { ok: true, restored, failed, total };
  }

  // 自动填写：仅限支持的招聘网站，且至少能识别到 2 个高置信字段时才执行
  async function tryAutoFill() {
    try {
      if (sessionStorage.getItem("jianli_autofilled")) return;
      const adapter = getHostAdapter();
      if (!adapter) return;
      const stored = await chrome.storage.local.get(
        ["settings", "resumeData", "blocks", "attachment", "customFields"]
      );
      const st = stored.settings || {};
      if (!st.autoFill) return;
      await sleep(1600); // 等待页面动态渲染
      if (MEMORY) { try { await MEMORY.ensureLoaded(); } catch (e) { /* 退回智能识别 */ } }
      const data = buildFillData(stored);
      const built = buildPlan(data, adapter, null, st);
      const confident = built.plan.filter(p => p.source === "memory" || p.source === "adapter" || p.score >= 30).length;
      if (confident < 2) return;
      const res = await runFill({
        data,
        mode: "auto",
        options: st,
        blocks: stored.blocks,
        attachment: stored.attachment,
        customFields: stored.customFields
      });
      sessionStorage.setItem("jianli_autofilled", "1");
      // 自动填写不弹战报（避免打扰），只用一条轻提示告知结果
      if (HUD && res && res.filled) {
        HUD.toast("已自动填写 " + res.filled + " 个字段，点右下角小球可查看详情", "ok");
      }
    } catch (e) { /* 自动填写失败不影响使用 */ }
  }

  // ---------- 字段记忆：把「这个框 = 某字段」记下来 ----------

  // 字段选择面板的可选项：按简历分组，末尾追加上用户自己的自定义字段
  function fieldPickerGroups(extra) {
    const groups = [];
    for (const g of (window.JIANLI_FIELD_GROUPS || [])) {
      const items = g.keys.filter(k => FIELD_DEFS[k]).map(k => ({
        key: k,
        label: FIELD_DEFS[k].label,
        hint: k
      }));
      if (items.length) groups.push({ title: g.title, items });
    }
    const custom = [];
    for (const key of Object.keys(extra || {})) {
      if (key.indexOf("custom_") === 0) custom.push({ key, label: extra[key].label, hint: "自定义" });
    }
    if (custom.length) groups.push({ title: "自定义字段", items: custom });
    return groups;
  }

  async function readCustomFieldDefs() {
    const extra = {};
    try {
      const stored = await chrome.storage.local.get(["customFields"]);
      for (const cf of (stored.customFields || [])) {
        if (cf && cf.id && cf.label) extra["custom_" + cf.id] = { label: cf.label, keywords: [cf.label] };
      }
    } catch (e) { /* 读不到就没有自定义字段可选 */ }
    return extra;
  }

  async function openFieldPicker(el, opts) {
    if (!HUD) return;
    const o = opts || {};
    const extra = await readCustomFieldDefs();
    HUD.showFieldPicker({
      title: o.title || "这个框对应简历里的哪个字段？",
      sub: o.sub || describeEl(el),
      groups: fieldPickerGroups(extra),
      onPick: (key, label) => { if (o.onPick) o.onPick(key, label, el); },
      onCancel: o.onCancel
    });
  }

  // 记住映射；如果简历里有这个字段的值，顺手补填一次
  async function rememberField(el, key, label) {
    if (!MEMORY || !el) return null;
    try { await MEMORY.ensureLoaded(); } catch (e) { /* 继续尝试 */ }
    const r = MEMORY.remember(location.hostname, el, key, label);
    if (!r) {
      if (HUD) HUD.toast("没能记住这个框（它可能已经不在页面上了）", "err");
      return null;
    }
    const stored = await readStoredData();
    const data = buildFillData(stored);
    let filled = false;
    if (data[key]) {
      const res = await fillOne(el, data[key], Object.assign({ deepFill: true }, settings), key);
      if (res && res.ok) { highlight(el, label); filled = true; }
    }
    if (HUD) {
      HUD.toast(
        filled
          ? "已记住：这个框 = " + label + "，并把内容填了进去"
          : "已记住：这个框 = " + label + "（你简历里这个字段是空的，所以先没填）",
        "ok"
      );
    }
    return r;
  }

  // 记住之后，把战报里那一行的「记住」换成结果，让用户看到确实生效了
  function markRemembered(row, label) {
    if (!row) return;
    const rm = row.querySelector(".rm");
    if (rm) rm.remove();
    const rs = row.querySelector(".rs");
    if (rs) {
      rs.textContent = "→ " + label;
      rs.style.color = "#16a34a";
    }
  }

  // ---------- 点选模式：点页面元素 → 指定字段 → 生成适配器代码 ----------

  const PICK_HINT = "点选模式：把鼠标移到要记录的框上点一下，然后选它对应哪个字段。点完可以生成站点适配器代码。";
  const pickStyleBackup = new WeakMap();
  let pick = null;             // { hovered, entries: [{key,label,selector}] }
  const pickCollected = new Set();

  function paintPick(el, color) {
    if (!el) return;
    if (!pickStyleBackup.has(el)) {
      pickStyleBackup.set(el, { outline: el.style.outline, offset: el.style.outlineOffset });
    }
    el.style.outline = "2px solid " + color;
    el.style.outlineOffset = "2px";
  }

  function unpaintPick(el) {
    const b = pickStyleBackup.get(el);
    if (!b) return;
    try {
      el.style.outline = b.outline;
      el.style.outlineOffset = b.offset;
    } catch (e) { /* ignore */ }
    pickStyleBackup.delete(el);
  }

  function clearCollectedPaint() {
    for (const el of pickCollected) unpaintPick(el);
    pickCollected.clear();
  }

  function fillablesIn(node) {
    const out = [];
    if (!node || !node.querySelectorAll) return out;
    for (const el of node.querySelectorAll(CANDIDATE_SEL)) {
      if (isFillable(el)) out.push(el);
    }
    return out;
  }

  // 用户点到标签文字上时，替他找到旁边真正的输入框
  function resolveControl(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id === "jianli-hud-host") return null;
    if (isFillable(el)) return el;

    const forId = el.getAttribute && el.getAttribute("for");
    if (forId) {
      try {
        const t = document.getElementById(forId);
        if (t && isFillable(t)) return t;
      } catch (e) { /* ignore */ }
    }

    let node = el;
    for (let i = 0; i < 3 && node && node !== document.body && node !== document.documentElement; i++) {
      const inside = fillablesIn(node);
      if (inside.length === 1) return inside[0];
      const around = node.parentElement ? fillablesIn(node.parentElement) : [];
      if (around.length === 1) return around[0];
      node = node.parentElement;
    }
    return null;
  }

  function onPickMove(e) {
    if (!pick) return;
    const el = resolveControl(e.target);
    if (el === pick.hovered) return;
    if (pick.hovered && !pickCollected.has(pick.hovered)) unpaintPick(pick.hovered);
    pick.hovered = el;
    if (el && !pickCollected.has(el)) paintPick(el, "#2563eb");
  }

  function onPickDown(e) {
    if (!pick) return;
    const t = e.target;
    if (t && t.id === "jianli-hud-host") return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onPickKey(e) {
    if (!pick) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (pick.entries.length) showPickResult();
      else endPick();
    }
  }

  async function onPickClick(e) {
    if (!pick) return;
    const t = e.target;
    if (t && t.id === "jianli-hud-host") return;   // 点到插件自己的浮层，忽略
    e.preventDefault();
    e.stopPropagation();

    const el = resolveControl(t);
    if (!el) {
      if (HUD) HUD.toast("这里没有找到可填的输入框，换个位置再点一次（Esc 退出）", "err");
      return;
    }
    if (pick.hovered && !pickCollected.has(pick.hovered)) unpaintPick(pick.hovered);
    pick.hovered = null;
    pickEvents(false);
    paintPick(el, "#16a34a");
    pickCollected.add(el);
    if (HUD) HUD.hidePickBar();

    const extra = await readCustomFieldDefs();
    if (!HUD) return;
    HUD.showFieldPicker({
      title: "这个框对应简历里的哪个字段？",
      sub: "已选中的框：" + describeEl(el) + "\n选择器：" + (MEMORY ? MEMORY.uniqueSelector(el) : ""),
      groups: fieldPickerGroups(extra),
      onPick: async (key, label) => {
        const r = await rememberField(el, key, label);
        if (!r) return;
        if (pick) pick.entries.push({ key, label, selector: r.selector });
        showPickResult();
      },
      onCancel: () => {
        if (pick && pick.entries.length) showPickResult();
        else endPick();
      }
    });
  }

  function pickEvents(on) {
    const fn = on ? "addEventListener" : "removeEventListener";
    document[fn]("mousemove", onPickMove, true);
    document[fn]("mousedown", onPickDown, true);
    document[fn]("click", onPickClick, true);
    document[fn]("keydown", onPickKey, true);
  }

  function startPick() {
    if (pick) { endPick(); return { ok: true, reason: "已退出点选模式" }; }
    refreshHud();
    if (HUD) {
      // 点选是用户主动发起的工具，即使关掉了悬浮球也临时挂上界面
      try { HUD.mount(true, hudPos); } catch (e) { /* ignore */ }
      HUD.hideMenu();
      HUD.hideReport();
      HUD.closeModals();
    }
    pick = { hovered: null, entries: [] };
    pickEvents(true);
    if (HUD) HUD.showPickBar(PICK_HINT, { onCancel: endPick });
    return { ok: true };
  }

  function resumePick() {
    if (!pick) pick = { hovered: null, entries: [] };
    pickEvents(true);
    if (HUD) {
      HUD.showPickBar(PICK_HINT, {
        onCancel: () => { if (pick && pick.entries.length) showPickResult(); else endPick(); }
      });
    }
  }

  function endPick() {
    pickEvents(false);
    if (pick && pick.hovered && !pickCollected.has(pick.hovered)) unpaintPick(pick.hovered);
    if (pick) {
      for (const en of pick.entries) {
        try {
          const n = document.querySelector(en.selector);
          if (n) unpaintPick(n);
        } catch (e) { /* ignore */ }
      }
    }
    pick = null;
    clearCollectedPaint();
    if (HUD) { HUD.hidePickBar(); HUD.closeModals(); }
    refreshHud();
  }

  function pickSnippet() {
    if (!MEMORY || !pick) return "";
    const adapter = getHostAdapter();
    return MEMORY.adapterSnippet(location.hostname, pick.entries, (adapter && adapter.name) || document.title);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { /* 降级到 execCommand */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function showPickResult() {
    if (!HUD || !pick) return;
    const entries = pick.entries;
    HUD.showListPanel({
      title: "已收集 " + entries.length + " 个字段映射",
      sub: entries.length
        ? "映射已经存下来了，下次进这个站点会自动认。下面的代码可以直接粘到 content/sites.js 的 JIANLI_SITE_ADAPTERS 里，变成正式适配器。"
        : "还没收集到映射。点「继续点选」，然后去页面上点要记录的输入框。",
      emptyText: "点「继续点选」去页面上点输入框",
      items: entries.map(en => ({ label: en.label, hint: en.selector })),
      actions: [
        {
          label: "继续点选",
          onClick: () => { HUD.closeModals(); resumePick(); }
        },
        {
          label: "复制代码",
          primary: true,
          title: "生成 SITE_ADAPTERS 代码片段并复制到剪贴板",
          onClick: async () => {
            const code = pickSnippet();
            if (!code) { HUD.toast("还没有可导出的映射", "err"); return; }
            const ok = await copyText(code);
            if (ok) HUD.toast("适配器代码已复制到剪贴板", "ok");
            else {
              try { console.log("[简历助手] 适配器代码：\n" + code); } catch (e) { /* ignore */ }
              HUD.toast("复制被浏览器拦住了，代码已打印到控制台（F12 查看）", "err");
            }
          }
        },
        {
          label: "完成",
          onClick: () => endPick()
        }
      ],
      onClose: () => endPick()
    });
  }

  // ---------- 投递台账 ----------

  function ledgerLabel(r) {
    const rec = r || {};
    const parts = [];
    if (rec.company) parts.push(rec.company);
    if (rec.position) parts.push(rec.position);
    return parts.join(" · ") || "这条记录";
  }

  // 台账里要记下「这次投的是哪套方案」，从方案存储里读当前方案名
  async function currentProfileName() {
    try {
      const raw = await chrome.storage.local.get(["profiles", "activeProfileId"]);
      const list = Array.isArray(raw.profiles) ? raw.profiles : [];
      const p = list.find(x => x.id === raw.activeProfileId) || list[0];
      return p ? String(p.name || "") : "";
    } catch (e) { return ""; }
  }

  // 悬浮球菜单里的「记一笔」：把当前页面的公司和岗位记进台账
  async function quickAddLedger() {
    if (!LEDGER) {
      if (HUD) HUD.toast("台账模块未加载，试试重新加载扩展", "err");
      return { ok: false, reason: "台账模块未加载" };
    }
    if (HUD) HUD.hideMenu();
    const info = LEDGER.parsePage();
    if (!info || (!info.company && !info.position)) {
      if (HUD) HUD.toast("这个页面读不出公司和岗位，到插件弹窗的「投递台账」里手动加一条吧", "err");
      return { ok: false, reason: "页面信息不足" };
    }
    info.profileName = await currentProfileName();
    const r = await LEDGER.add(info);
    if (!r.ok) {
      if (HUD) HUD.toast(r.reason, "err");
      return r;
    }
    if (HUD) {
      HUD.toast(
        r.duplicate
          ? "这条已经在台账里了：" + ledgerLabel(r.record)
          : "已记入台账：" + ledgerLabel(r.record) + "（弹窗里可改状态、导出 CSV）",
        r.duplicate ? "" : "ok"
      );
    }
    return r;
  }

  // 投递成功页提示。
  // 用户选的是「手动记一笔 + 成功页提示」，所以这里只问一句，绝不自动入账 ——
  // 招聘网站的成功页判定不可能百分百准，自动记账等于往台账里灌脏数据。
  async function checkAppliedPage() {
    if (!LEDGER || !HUD) return;
    if (settings.ledgerPrompt === false) return;
    if (window.top !== window.self) return;

    let info = null;
    try { info = LEDGER.detectAppliedPage(); } catch (e) { return; }
    if (!info) return;

    // 同一个链接只问一次：SPA 来回切路由时不至于反复弹
    const seenKey = "jianli_ledger_prompted";
    let seen = [];
    try { seen = JSON.parse(sessionStorage.getItem(seenKey) || "[]"); } catch (e) { seen = []; }
    const sig = info.url || (info.company + "|" + info.position);
    if (Array.isArray(seen) && seen.includes(sig)) return;
    seen = (Array.isArray(seen) ? seen : []).concat([sig]).slice(-20);
    try { sessionStorage.setItem(seenKey, JSON.stringify(seen)); } catch (e) { /* ignore */ }

    try {
      await LEDGER.ensureLoaded();
      if (LEDGER.findDuplicate(info)) return;   // 已经记过的就不再打扰
    } catch (e) { /* 读不到台账时照常提示，用户点了会再判一次 */ }

    info.profileName = await currentProfileName();
    const detail = ledgerLabel(info) + (info.city ? "（" + info.city + "）" : "");

    HUD.showPrompt({
      title: "检测到投递成功",
      text: detail + "\n要不要记进投递台账？",
      actions: [
        {
          label: "记一笔",
          primary: true,
          onClick: async () => {
            const r = await LEDGER.add(info);
            HUD.hidePrompt();
            HUD.toast(r.ok ? ("已记入台账：" + ledgerLabel(info)) : r.reason, r.ok ? "ok" : "err");
            refreshHud();
          }
        },
        { label: "不用", onClick: () => { HUD.hidePrompt(); refreshHud(); } }
      ],
      onClose: () => refreshHud()
    });
  }

  // ---------- 填写入口 ----------

  async function readStoredData() {
    const stored = await chrome.storage.local.get(
      ["settings", "resumeData", "blocks", "attachment", "customFields"]
    );
    settings = Object.assign({}, settings, stored.settings || {});
    return stored;
  }

  // 拼出真正要填的数据：简历字段 + 自定义字段。
  // 自定义字段以 custom_<id> 为键参与匹配，漏了这一步它们就永远填不上。
  function buildFillData(stored) {
    const data = Object.assign({}, (stored && stored.resumeData) || {});
    for (const cf of ((stored && stored.customFields) || [])) {
      if (cf && cf.id && cf.label && cf.value) data["custom_" + cf.id] = cf.value;
    }
    return data;
  }

  // 统一的「填写当前页面」入口：悬浮球、自定义快捷键、弹窗都走这里
  async function triggerFill(source) {
    if (HUD) { HUD.hideMenu(); HUD.setBusy(true); }
    refreshHud(); // 确保悬浮球就位（战报浮层是挂靠在它旁边的）
    try {
      const stored = await readStoredData();
      const res = await runFill({
        data: buildFillData(stored),
        mode: source || "manual",
        options: settings,
        blocks: stored.blocks,
        attachment: stored.attachment,
        customFields: stored.customFields
      });
      if (HUD && HUD.isMounted()) HUD.showReport(res, lastRefs);
      return res;
    } catch (e) {
      if (HUD) HUD.toast("填写失败：" + e.message, "err");
      return { ok: false, reason: e.message };
    } finally {
      if (HUD) HUD.setBusy(false);
    }
  }

  // ---------- 悬浮球与快捷键 ----------

  // 只在顶层窗口、且页面确实像个表单页时才显示悬浮球，避免在所有网页上乱飘
  function shouldShowHud() {
    if (settings.showHud === false) return false;
    if (window.top !== window.self) return false;
    if (getHostAdapter()) return true;
    return collectCandidates().length >= 3;
  }

  function refreshHud() {
    if (!HUD) return;
    try {
      HUD.mount(shouldShowHud(), hudPos);
    } catch (e) { /* HUD 失败不影响填表 */ }
  }

  // 自定义快捷键：manifest 的 Ctrl+Shift+F 是由浏览器统一处理的，
  // 其余组合键在这里监听，方便避开站内快捷键冲突
  const HOTKEY_SPECS = {
    "alt+shift+f": { alt: true, shift: true, ctrl: false, key: "f" },
    "alt+q": { alt: true, shift: false, ctrl: false, key: "q" },
    "ctrl+shift+u": { alt: false, shift: true, ctrl: true, key: "u" }
  };

  function onHotkey(e) {
    const spec = HOTKEY_SPECS[settings.hotkey];
    if (!spec) return;                       // command / off 都不在这里处理
    if (e.metaKey) return;
    if (String(e.key || "").toLowerCase() !== spec.key) return;
    if (!!e.altKey !== spec.alt || !!e.shiftKey !== spec.shift || !!e.ctrlKey !== spec.ctrl) return;
    e.preventDefault();
    e.stopPropagation();
    triggerFill("hotkey");
  }

  async function initHudAndHotkey() {
    if (!HUD) return;
    try {
      const stored = await chrome.storage.local.get(["settings", "hudPos"]);
      settings = Object.assign({}, settings, stored.settings || {});
      hudPos = stored.hudPos || null;
    } catch (e) { /* 用空设置兜底 */ }

    HUD.registerAction({
      id: "fill",
      icon: "⚡",
      label: "填写当前页面",
      primary: true,
      onClick: () => triggerFill("hud")
    });
    HUD.registerAction({
      id: "undo",
      icon: "↩",
      label: "撤销上次填写",
      hint: "把上一次填进去的内容恢复成填写前的原值",
      onClick: () => applyUndo()
    });
    HUD.registerAction({
      id: "pick",
      icon: "🎯",
      label: "点选生成适配器",
      hint: "点页面上的输入框，告诉插件它是什么字段；记下来的映射下次自动生效，还能导出成站点适配器代码",
      onClick: () => startPick()
    });
    HUD.registerAction({
      id: "ledger",
      icon: "📝",
      label: "记一笔投递",
      hint: "把当前页面的公司和岗位记进投递台账，之后能在插件弹窗里改状态、导出 CSV",
      onClick: () => quickAddLedger()
    });

    refreshHud();
    // 页面动态渲染较慢时（SPA）再复查两次，决定要不要显示悬浮球
    setTimeout(refreshHud, 2500);
    setTimeout(refreshHud, 6000);
    // 投递成功页的提示等页面稳一稳再判断，免得抢在渲染完成前读到空内容
    setTimeout(() => { checkAppliedPage(); }, 2600);

    document.addEventListener("keydown", onHotkey, true);

    // 弹窗里改了设置 / 拖动悬浮球换了位置，这里实时同步
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings) {
        settings = Object.assign({}, settings, changes.settings.newValue || {});
        refreshHud();
      }
      if (changes.hudPos) {
        hudPos = changes.hudPos.newValue || null;
        HUD.mount(shouldShowHud(), hudPos);
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "FILL_PAGE") {
      runFill(msg).then(sendResponse).catch(e => sendResponse({ ok: false, reason: "填写异常：" + e.message }));
      return true; // 异步响应
    } else if (msg.type === "UNDO_FILL") {
      applyUndo().then(sendResponse).catch(e => sendResponse({ ok: false, reason: e.message }));
      return true;
    } else if (msg.type === "LEDGER_ADD_PAGE") {
      // 弹窗里的「把当前页记进台账」，走和悬浮球「记一笔」同一条通路
      quickAddLedger().then(sendResponse).catch(e => sendResponse({ ok: false, reason: e.message }));
      return true;
    } else if (msg.type === "HUD_FILL") {
      // 由背景页/快捷键触发，走和悬浮球一致的通路（带战报浮层）
      triggerFill("hud").then(sendResponse).catch(e => sendResponse({ ok: false, reason: e.message }));
      return true;
    } else if (msg.type === "GET_STATUS") {
      const adapter = getHostAdapter();
      const widgetCount = WIDGETS
        ? collectCandidates().filter(el => WIDGETS.classify(el) !== "native").length
        : 0;
      // 页面标题里能读出岗位名/城市时一并返回，弹窗里据此提示「检测到岗位 XX」
      let inferred = null;
      try { inferred = INFER ? INFER.inferPage() : null; } catch (e) { inferred = null; }
      sendResponse({
        ok: true,
        url: location.href,
        host: location.hostname,
        title: document.title,
        adapter: adapter ? adapter.name : null,
        candidates: collectCandidates().length,
        widgets: widgetCount,
        canUndo: !!(undoRecord && undoRecord.items.length),
        memory: MEMORY ? MEMORY.countFor(location.hostname) : 0,
        inferred: (inferred && (inferred.position || inferred.city)) ? inferred : null,
        picking: !!pick,
        hud: HUD ? HUD.isMounted() : false
      });
    } else if (msg.type === "SCAN_FIELDS") {
      sendResponse(scanFields());
    } else if (msg.type === "START_PICK") {
      // 弹窗/背景页发起的「点选生成适配器」：进入点选模式并返回提示
      const r = startPick();
      sendResponse(Object.assign({ host: location.hostname }, r));
    } else if (msg.type === "LOCATE_FIELD") {
      // 弹窗里点「定位」时，把对应控件滚动到视野里
      const el = findElementBySelector(msg.selector);
      if (el && HUD) { HUD.locate(el); sendResponse({ ok: true }); }
      else sendResponse({ ok: false, reason: "页面上找不到这个控件" });
    }
  });

  // 按 CSS 选择器定位控件（弹窗只传选择器字符串，DOM 引用跨进程传不了）
  function findElementBySelector(sel) {
    if (!sel) return null;
    try {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) if (isFillable(el)) return el;
      return nodes[0] || null;
    } catch (e) { return null; }
  }

  initHudAndHotkey();
  tryAutoFill();
})();
