// ============================================================
// 多套简历方案
// ------------------------------------------------------------
// 一套方案 = 一份字段数据 + 一份经历块 + 一个简历附件。
// 比如「嵌入式岗」和「算法岗」可以各有一套：项目经历排序不同、附件 PDF 不同，
// 切换之后填表用的就是当前那套，不用每次手改字段。
//
// 关键设计：resumeData / blocks / attachment 这三个 key 始终是「当前方案」的镜像。
// content.js、background.js 这些只读镜像的模块因此完全不需要知道方案的存在，
// 老版本升级上来的数据也不会丢，迁移成本接近零。
//
// 附件另外做了一层去重：简历 PDF 的 base64 动辄几 MB，两套方案用同一份文件时
// 只存一份。文件内容放在 attachments 库里，方案里只留一个引用 id；而 attachment
// 镜像始终是解析好的完整对象，读取方拿到的还是原来的格式。
// ============================================================
(function () {
  const G = (typeof window !== "undefined") ? window : self;

  const KEY_PROFILES = "profiles";
  const KEY_ACTIVE = "activeProfileId";
  const KEY_ATTACH = "attachments";

  const DEFAULT_NAME = "默认方案";
  const MAX_PROFILES = 20;
  const MAX_NAME_LEN = 30;

  let profiles = null;     // [{id,name,data,blocks,attachmentRef,createdAt,updatedAt}]
  let activeId = "";
  let attachLib = {};      // { ref: {name,type,size,dataUrl} }
  let loaded = false;
  let loading = null;

  // ---------- 基础工具 ----------

  function clone(v) {
    if (v === undefined || v === null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

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

  // 只对首尾片段 + 长度做哈希：几 MB 的 base64 全量扫一遍太慢，PDF 头尾已经足够区分
  function sampleHash(att) {
    const s = String((att && att.dataUrl) || "");
    const key = [
      (att && att.name) || "",
      (att && att.size) || 0,
      s.length,
      s.slice(0, 4096),
      s.slice(-4096)
    ].join("|");
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return "a" + h.toString(16);
  }

  // ---------- 附件库 ----------

  // 把带 dataUrl 的附件存进库，返回引用 id（同一份文件重复上传只会存一次）
  async function putAttachment(att) {
    if (!att || !att.dataUrl) return "";
    const ref = sampleHash(att);
    if (!attachLib[ref]) {
      attachLib[ref] = {
        name: att.name || "resume.pdf",
        type: att.type || "",
        size: att.size || 0,
        dataUrl: att.dataUrl
      };
      await storageSet({ [KEY_ATTACH]: attachLib });
    }
    return ref;
  }

  // 引用 id → 完整附件对象（attachment 镜像用的就是这个格式）
  function embedAttachment(ref) {
    const a = ref && attachLib[ref];
    return a ? Object.assign({}, a) : null;
  }

  // 清理没人引用的附件，避免删掉方案后 base64 还占着存储
  async function gcAttachments() {
    const keep = new Set((profiles || []).map(p => p.attachmentRef).filter(Boolean));
    let changed = false;
    for (const ref of Object.keys(attachLib)) {
      if (!keep.has(ref)) { delete attachLib[ref]; changed = true; }
    }
    if (changed) await storageSet({ [KEY_ATTACH]: attachLib });
    return changed;
  }

  // ---------- 读写 ----------

  async function persist() {
    await storageSet({
      [KEY_PROFILES]: profiles,
      [KEY_ACTIVE]: activeId,
      [KEY_ATTACH]: attachLib
    });
  }

  function getActive() {
    if (!profiles || !profiles.length) return null;
    return profiles.find(p => p.id === activeId) || profiles[0];
  }

  function normalizeProfile(p) {
    return {
      id: p.id || uid("p_"),
      name: String(p.name || "未命名方案").slice(0, MAX_NAME_LEN),
      data: isPlainObject(p.data) ? p.data : {},
      blocks: isPlainObject(p.blocks) ? p.blocks : {},
      attachmentRef: p.attachmentRef || "",
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || p.createdAt || Date.now()
    };
  }

  async function load() {
    const raw = await storageGet([KEY_PROFILES, KEY_ACTIVE, KEY_ATTACH, "resumeData", "blocks", "attachment"]);
    attachLib = isPlainObject(raw[KEY_ATTACH]) ? raw[KEY_ATTACH] : {};
    profiles = Array.isArray(raw[KEY_PROFILES])
      ? raw[KEY_PROFILES].filter(p => isPlainObject(p) && p.id).map(normalizeProfile)
      : [];
    activeId = String(raw[KEY_ACTIVE] || "");

    if (!profiles.length) {
      // 首次升级上来：把原有的那一份数据原样包成「默认方案」，用户不会丢任何东西
      const ref = await putAttachment(raw.attachment);
      const now = Date.now();
      profiles = [normalizeProfile({
        id: uid("p_"),
        name: DEFAULT_NAME,
        data: isPlainObject(raw.resumeData) ? raw.resumeData : {},
        blocks: isPlainObject(raw.blocks) ? raw.blocks : {},
        attachmentRef: ref,
        createdAt: now,
        updatedAt: now
      })];
      activeId = profiles[0].id;
      await persist();
      // 镜像补齐：老用户如果只有 resumeData 没有 blocks，这里一并写全
      await writeMirror();
    }

    if (!profiles.some(p => p.id === activeId)) activeId = profiles[0].id;
    loaded = true;
    return { profiles, activeId };
  }

  function ensureLoaded() {
    if (loaded) return Promise.resolve({ profiles, activeId });
    if (!loading) {
      loading = load().finally(() => { loading = null; });
    }
    return loading;
  }

  // 当前方案 → 镜像三个 key
  async function writeMirror() {
    const p = getActive();
    if (!p) return;
    await storageSet({
      resumeData: clone(p.data) || {},
      blocks: clone(p.blocks) || {},
      attachment: embedAttachment(p.attachmentRef)
    });
  }

  // 弹窗编辑完字段后调用：把镜像内容收回当前方案
  async function syncMirror(mirror) {
    await ensureLoaded();
    const p = getActive();
    if (!p) return { ok: false, reason: "没有可用方案" };
    const m = mirror || {};
    if (isPlainObject(m.resumeData)) p.data = clone(m.resumeData);
    if (isPlainObject(m.blocks)) p.blocks = clone(m.blocks);
    if ("attachment" in m) {
      p.attachmentRef = (m.attachment && m.attachment.dataUrl) ? await putAttachment(m.attachment) : "";
    }
    p.updatedAt = Date.now();
    await persist();
    await gcAttachments();
    return { ok: true, id: p.id };
  }

  // ---------- 查询 ----------

  function countFilled(data) {
    if (!isPlainObject(data)) return 0;
    let n = 0;
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (v !== "" && v !== null && v !== undefined) n++;
    }
    return n;
  }

  function countBlocks(blocks) {
    if (!isPlainObject(blocks)) return 0;
    let n = 0;
    for (const k of Object.keys(blocks)) {
      if (Array.isArray(blocks[k])) n += blocks[k].length;
    }
    return n;
  }

  function list() {
    return (profiles || []).map(p => ({
      id: p.id,
      name: p.name,
      active: p.id === activeId,
      updatedAt: p.updatedAt || 0,
      hasAttachment: !!p.attachmentRef,
      attachmentName: (attachLib[p.attachmentRef] && attachLib[p.attachmentRef].name) || "",
      fieldCount: countFilled(p.data),
      blockCount: countBlocks(p.blocks)
    }));
  }

  function get(id) {
    const p = (profiles || []).find(x => x.id === id);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      data: clone(p.data),
      blocks: clone(p.blocks),
      attachment: embedAttachment(p.attachmentRef)
    };
  }

  function getActiveId() {
    return activeId;
  }

  function count() {
    return (profiles || []).length;
  }

  // ---------- 增删改 ----------

  // 切换方案：把目标方案的内容写成镜像，之后填表就用它了
  async function setActive(id) {
    await ensureLoaded();
    const p = profiles.find(x => x.id === id);
    if (!p) return { ok: false, reason: "方案不存在" };
    activeId = p.id;
    await storageSet({ [KEY_ACTIVE]: activeId });
    await writeMirror();
    return {
      ok: true,
      id: p.id,
      name: p.name,
      data: clone(p.data),
      blocks: clone(p.blocks),
      attachment: embedAttachment(p.attachmentRef)
    };
  }

  async function create(name, opts) {
    await ensureLoaded();
    const o = opts || {};
    if (profiles.length >= MAX_PROFILES) {
      return { ok: false, reason: "方案最多 " + MAX_PROFILES + " 套，先删掉不用的再新建" };
    }
    const src = o.copyFrom ? profiles.find(p => p.id === o.copyFrom) : null;
    const now = Date.now();
    const p = normalizeProfile({
      id: uid("p_"),
      name: String(name || "").trim() || ("方案 " + (profiles.length + 1)),
      data: src ? clone(src.data) : {},
      blocks: src ? clone(src.blocks) : {},
      // 复制方案时沿用同一份附件引用：内容不复制，两套方案共用一个 PDF 不占双倍空间
      attachmentRef: src ? src.attachmentRef : "",
      createdAt: now,
      updatedAt: now
    });
    profiles.push(p);
    await persist();
    if (o.activate !== false) await setActive(p.id);
    return { ok: true, id: p.id, name: p.name, copiedFrom: src ? src.id : "" };
  }

  async function duplicate(id, name) {
    await ensureLoaded();
    const src = profiles.find(p => p.id === id);
    if (!src) return { ok: false, reason: "方案不存在" };
    return create(name || (src.name + " 副本"), { copyFrom: src.id, activate: true });
  }

  async function rename(id, name) {
    await ensureLoaded();
    const p = profiles.find(x => x.id === id);
    if (!p) return { ok: false, reason: "方案不存在" };
    const n = String(name || "").trim();
    if (!n) return { ok: false, reason: "方案名不能为空" };
    p.name = n.slice(0, MAX_NAME_LEN);
    p.updatedAt = Date.now();
    await persist();
    return { ok: true, id: p.id, name: p.name };
  }

  async function remove(id) {
    await ensureLoaded();
    if (profiles.length <= 1) return { ok: false, reason: "至少要保留一套方案" };
    const idx = profiles.findIndex(x => x.id === id);
    if (idx < 0) return { ok: false, reason: "方案不存在" };
    const removedName = profiles[idx].name;
    const wasActive = profiles[idx].id === activeId;
    profiles.splice(idx, 1);
    if (wasActive) {
      activeId = profiles[Math.min(idx, profiles.length - 1)].id;
      await persist();
      await writeMirror();
    } else {
      await persist();
    }
    await gcAttachments();
    return { ok: true, activeId, removedName, switched: wasActive };
  }

  // ---------- 导入导出 ----------

  // 导出带上附件内容：换电脑时没有附件这份备份就不完整
  function exportAll() {
    return {
      profiles: (profiles || []).map(p => ({
        name: p.name,
        data: clone(p.data),
        blocks: clone(p.blocks),
        attachment: embedAttachment(p.attachmentRef),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      })),
      // 方案 id 每次导入都会重新生成，所以用「第几套」来记住导出时用的是哪套
      activeIndex: Math.max(0, (profiles || []).findIndex(p => p.id === activeId)),
      activeProfileId: activeId
    };
  }

  async function importAll(payload) {
    await ensureLoaded();
    const incoming = (payload && Array.isArray(payload.profiles)) ? payload.profiles : [];
    if (!incoming.length) return { ok: false, reason: "文件里没有方案数据" };

    const next = [];
    const now = Date.now();
    for (const p of incoming) {
      if (!isPlainObject(p)) continue;
      const ref = (p.attachment && p.attachment.dataUrl) ? await putAttachment(p.attachment) : "";
      next.push(normalizeProfile({
        id: uid("p_"),
        name: p.name || "未命名方案",
        data: isPlainObject(p.data) ? p.data : {},
        blocks: isPlainObject(p.blocks) ? p.blocks : {},
        attachmentRef: ref,
        createdAt: p.createdAt || now,
        updatedAt: p.updatedAt || now
      }));
    }
    if (!next.length) return { ok: false, reason: "文件里没有可用的方案" };

    profiles = next.slice(0, MAX_PROFILES);
    // 导出时用的是第几套，导入后还原成同一套
    const wanted = Number.isInteger(payload.activeIndex) ? payload.activeIndex : 0;
    activeId = (profiles[wanted] || profiles[0]).id;
    await persist();
    await writeMirror();
    await gcAttachments();
    return { ok: true, count: profiles.length, activeId };
  }

  // 清空回默认：只留一套空白方案（「恢复默认」按钮用）
  async function resetAll(blank) {
    const now = Date.now();
    const p = normalizeProfile({
      id: uid("p_"),
      name: DEFAULT_NAME,
      data: isPlainObject(blank && blank.resumeData) ? blank.resumeData : {},
      blocks: isPlainObject(blank && blank.blocks) ? blank.blocks : {},
      attachmentRef: "",
      createdAt: now,
      updatedAt: now
    });
    profiles = [p];
    activeId = p.id;
    await persist();
    await writeMirror();
    await gcAttachments();
    return { ok: true, id: p.id };
  }

  // 存储占用估算，弹窗里给个提示用
  function storageEstimate() {
    let attachBytes = 0;
    for (const ref of Object.keys(attachLib)) {
      attachBytes += String(attachLib[ref].dataUrl || "").length;
    }
    return {
      profileCount: profiles ? profiles.length : 0,
      attachCount: Object.keys(attachLib).length,
      attachMB: Math.round((attachBytes * 0.75 / 1024 / 1024) * 10) / 10
    };
  }

  G.JIANLI_PROFILES = {
    KEY_PROFILES,
    KEY_ACTIVE,
    KEY_ATTACH,
    DEFAULT_NAME,
    MAX_PROFILES,
    ensureLoaded,
    list,
    get,
    getActive,
    getActiveId,
    count,
    setActive,
    create,
    duplicate,
    rename,
    remove,
    syncMirror,
    writeMirror,
    exportAll,
    importAll,
    resetAll,
    embedAttachment,
    storageEstimate,
    _uid: uid
  };
})();
