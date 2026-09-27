// ============================================================
// 投递台账
// ------------------------------------------------------------
// 秋招最烦的是「这家我投过没？什么时候投的？用的哪版简历？」。
// 这个模块把每次投递记成一条记录，存本机，可以按状态筛选、导出成 CSV。
//
// 记录时机由用户掌控：投完在页面右下角小球里点「记一笔」，或者检测到
// 投递成功页时弹个提示问一句 —— 绝不替用户自动入账，免得台账里混进垃圾数据。
//
// 同一个岗位链接重复记录时不会新增第二条，而是把已有那条返回去。
// ============================================================
(function () {
  const G = (typeof window !== "undefined") ? window : self;

  const KEY = "ledger";
  const MAX_RECORDS = 500;

  // 状态机：投出去 → 笔试 → 面试 → 出结果
  const STATUSES = [
    { key: "applied", label: "已投递", color: "#1d4ed8" },
    { key: "exam", label: "笔试", color: "#7c3aed" },
    { key: "interview", label: "面试中", color: "#0891b2" },
    { key: "offer", label: "已通过", color: "#16a34a" },
    { key: "rejected", label: "已拒/无回应", color: "#dc2626" }
  ];
  const STATUS_LABEL = {};
  const STATUS_COLOR = {};
  for (const s of STATUSES) {
    STATUS_LABEL[s.key] = s.label;
    STATUS_COLOR[s.key] = s.color;
  }

  let records = null;
  let loaded = false;
  let loading = null;

  // ---------- 基础工具 ----------

  function storageGet(keys) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(keys, res => resolve(res || {}));
      } catch (e) { resolve({}); }
    });
  }

  function storageSet(obj) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.set(obj, () => resolve(true));
      } catch (e) { resolve(false); }
    });
  }

  function uid() {
    return "l_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function isStatus(k) {
    return Object.prototype.hasOwnProperty.call(STATUS_LABEL, k);
  }

  function str(v, max) {
    const s = String(v === undefined || v === null ? "" : v).trim();
    return max ? s.slice(0, max) : s;
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function fmtDay(ts) {
    const s = fmtDate(ts);
    return s ? s.slice(0, 10) : "";
  }

  function normalize(rec) {
    const r = rec || {};
    const now = Date.now();
    return {
      id: r.id || uid(),
      company: str(r.company, 60),
      position: str(r.position, 60),
      city: str(r.city, 20),
      status: isStatus(r.status) ? r.status : "applied",
      url: str(r.url, 500),
      host: str(r.host, 120),
      siteName: str(r.siteName, 30),
      profileName: str(r.profileName, 30),
      note: str(r.note, 300),
      appliedAt: typeof r.appliedAt === "number" && r.appliedAt > 0 ? r.appliedAt : now,
      updatedAt: typeof r.updatedAt === "number" && r.updatedAt > 0 ? r.updatedAt : now
    };
  }

  // ---------- 读写 ----------

  async function load() {
    const raw = await storageGet([KEY]);
    records = Array.isArray(raw[KEY]) ? raw[KEY].map(normalize).filter(r => r.company || r.position) : [];
    loaded = true;
    return records;
  }

  function ensureLoaded() {
    if (loaded) return Promise.resolve(records);
    if (!loading) loading = load().finally(() => { loading = null; });
    return loading;
  }

  function persist() {
    if (records.length > MAX_RECORDS) records = records.slice(0, MAX_RECORDS);
    return storageSet({ [KEY]: records });
  }

  // ---------- 页面解析 ----------

  function siteNameFor(host) {
    const h = String(host || "").toLowerCase();
    if (!h) return "";
    const adapters = G.JIANLI_SITE_ADAPTERS || [];
    const a = adapters.find(x => (x.hosts || []).some(y => h === y || h.endsWith("." + y)));
    return a ? a.name : "";
  }

  // 从当前页面读出公司 / 岗位 / 城市 / 链接（推断交给 infer.js）
  function parsePage() {
    if (typeof document === "undefined") return null;
    const INFER = G.JIANLI_INFER;
    const inf = INFER ? INFER.inferPage() : { company: "", position: "", city: "" };
    let url = "", host = "";
    try { url = location.href; host = location.hostname; } catch (e) { /* 拿不到就算了 */ }
    return normalize({
      company: inf.company || "",
      position: inf.position || "",
      city: inf.city || "",
      url,
      host,
      siteName: siteNameFor(host),
      status: "applied",
      appliedAt: Date.now()
    });
  }

  // 投递成功页的判定。宁可漏判也不误判：记录页里也常出现「投递成功」几个字，
  // 所以先把投递记录/列表类页面排除掉；连公司或岗位都认不出来的页也不提示。
  const SUCCESS_PATTERNS = [
    /投递成功/, /简历已投递/, /已成功投递/, /投递完成/, /申请成功/,
    /已投递成功/, /成功提交申请/, /简历投递成功/
  ];
  const LIST_PATTERNS = [
    /投递记录/, /投递历史/, /我的投递/, /申请记录/, /已投职位/, /投递管理/, /投递列表/
  ];

  // 纯函数版判定：只看文本，便于单测。真正调用时喂的是页面正文
  function judgeAppliedText(text) {
    const t = String(text || "").slice(0, 8000);
    if (!t) return false;
    if (LIST_PATTERNS.some(re => re.test(t))) return false;
    return SUCCESS_PATTERNS.some(re => re.test(t));
  }

  function detectAppliedPage() {
    if (typeof document === "undefined" || !document.body) return null;
    let text = "";
    try { text = (document.body.innerText || "").slice(0, 8000); } catch (e) { return null; }
    if (!judgeAppliedText(text)) return null;
    const info = parsePage();
    if (!info || (!info.company && !info.position)) return null;
    return info;
  }

  // ---------- 查询 ----------

  function list(opts) {
    const o = opts || {};
    let out = (records || []).slice();
    if (o.status && isStatus(o.status)) out = out.filter(r => r.status === o.status);
    if (o.keyword) {
      const k = String(o.keyword).toLowerCase();
      out = out.filter(r => [r.company, r.position, r.city, r.note, r.profileName]
        .some(v => String(v || "").toLowerCase().includes(k)));
    }
    out.sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));
    return out;
  }

  function get(id) {
    return (records || []).find(r => r.id === id) || null;
  }

  function count() {
    return (records || []).length;
  }

  function stats() {
    const now = Date.now();
    const dayMs = 86400000;
    const byStatus = {};
    for (const s of STATUSES) byStatus[s.key] = 0;
    for (const r of (records || [])) {
      if (byStatus[r.status] !== undefined) byStatus[r.status]++;
    }
    return {
      total: (records || []).length,
      today: (records || []).filter(r => (r.appliedAt || 0) >= startOfDay(now)).length,
      week: (records || []).filter(r => (r.appliedAt || 0) >= now - 7 * dayMs).length,
      byStatus,
      // 还没出结果的：投出去了在等笔试/面试，或者约了面试还没结果
      pending: byStatus.applied + byStatus.exam + byStatus.interview,
      offer: byStatus.offer
    };
  }

  // 同一条投递的判定：有链接就认链接，没链接才退化成「公司 + 岗位」
  function isSameRecord(a, b) {
    if (a.url && b.url) return a.url === b.url;
    return !!a.company && a.company === b.company && a.position === b.position;
  }

  function findDuplicate(rec) {
    const r = normalize(rec);
    return (records || []).find(x => isSameRecord(x, r)) || null;
  }

  // ---------- 增删改 ----------

  // 记一笔。已经在台账里的不会重复添加，而是把已有的那条返回去
  async function add(rec) {
    await ensureLoaded();
    const item = normalize(rec);
    if (!item.company && !item.position) {
      return { ok: false, reason: "公司和岗位都没认出来，先在弹窗里手动补一下再记" };
    }
    const dup = findDuplicate(item);
    if (dup) return { ok: true, duplicate: true, id: dup.id, record: dup };
    records.unshift(item);
    await persist();
    return { ok: true, duplicate: false, id: item.id, record: item };
  }

  async function update(id, patch) {
    await ensureLoaded();
    const r = get(id);
    if (!r) return { ok: false, reason: "台账里找不到这条记录" };
    const p = patch || {};
    if (p.company !== undefined) r.company = str(p.company, 60);
    if (p.position !== undefined) r.position = str(p.position, 60);
    if (p.city !== undefined) r.city = str(p.city, 20);
    if (p.note !== undefined) r.note = str(p.note, 300);
    if (p.profileName !== undefined) r.profileName = str(p.profileName, 30);
    if (p.status !== undefined && isStatus(p.status)) r.status = p.status;
    if (typeof p.appliedAt === "number" && p.appliedAt > 0) r.appliedAt = p.appliedAt;
    r.updatedAt = Date.now();
    await persist();
    return { ok: true, record: r };
  }

  async function remove(id) {
    await ensureLoaded();
    const idx = (records || []).findIndex(r => r.id === id);
    if (idx < 0) return { ok: false, reason: "台账里找不到这条记录" };
    const removed = records[idx];
    records.splice(idx, 1);
    await persist();
    return { ok: true, removed };
  }

  async function clear() {
    await ensureLoaded();
    const n = (records || []).length;
    records = [];
    await persist();
    return { ok: true, removed: n };
  }

  // ---------- 导出 ----------

  function csvCell(v) {
    const s = String(v === undefined || v === null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    const head = ["公司", "岗位", "城市", "状态", "投递时间", "来源站点", "简历方案", "岗位链接", "备注"];
    const body = (rows || records || []).map(r => [
      r.company,
      r.position,
      r.city,
      STATUS_LABEL[r.status] || r.status,
      fmtDate(r.appliedAt),
      r.siteName,
      r.profileName,
      r.url,
      r.note
    ]);
    // 开头的 BOM 是给 Excel 认 UTF-8 用的，否则中文会变乱码
    return "\ufeff" + [head].concat(body).map(row => row.map(csvCell).join(",")).join("\r\n");
  }

  G.JIANLI_LEDGER = {
    KEY,
    STATUSES,
    STATUS_LABEL,
    STATUS_COLOR,
    MAX_RECORDS,
    ensureLoaded,
    list,
    get,
    count,
    stats,
    isStatus,
    isSameRecord,
    findDuplicate,
    add,
    update,
    remove,
    clear,
    parsePage,
    detectAppliedPage,
    judgeAppliedText,
    siteNameFor,
    toCsv,
    fmtDate,
    fmtDay
  };
})();
