// ============================================================
// 弹窗逻辑：简历数据编辑（自动保存）、经历块编辑、附件配置、
// 一键填写、扫描字段、导入/导出
// ============================================================
(function () {
  const FIELD_DEFS = window.JIANLI_FIELD_DEFS;
  const BLOCK_DEFS = window.JIANLI_BLOCK_DEFS || {};
  const MEMORY = window.JIANLI_MEMORY;
  const PROFILES = window.JIANLI_PROFILES;
  const LEDGER = window.JIANLI_LEDGER;
  const DEFAULTS = (typeof window.JIANLI_getDefaults === "function")
    ? window.JIANLI_getDefaults()
    : { resumeData: {}, blocks: {}, attachment: null, settings: {} };

  // 字段分组与页面里的「这个框是什么字段」选择面板共用同一份定义（content/sites.js）
  const GROUPS = window.JIANLI_FIELD_GROUPS || [];

  // 经历块里用多行文本的字段
  const BLOCK_TEXTAREA_KEYS = new Set(["desc"]);

  let resumeData = {};
  let blocks = {};
  let attachment = null;
  let settings = {};
  let customFields = [];
  let recognized = {};
  let saveTimer = null;
  // 方案名的行内编辑状态：{ onCommit }
  let nameEditor = null;
  // 当前方案名，附件区要拿它说明「这份附件属于哪套方案」
  let currentProfileName = "";

  const $ = s => document.querySelector(s);
  const form = $("#form");

  // 建节点的小工具（方案提示那种一段段拼起来的文字用得上）
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // ---------- 数据合并与保存 ----------

  function mergeData(base, saved) {
    const out = {};
    for (const key of Object.keys(FIELD_DEFS)) {
      out[key] = (saved && saved[key] !== undefined && saved[key] !== null)
        ? saved[key]
        : base[key] || "";
    }
    return out;
  }

  // 经历块按行补齐（工具本体在 defaults.js）。老用户 storage 里的块没有
  // 后来新增的字段（学位 / 学习形式），如果直接整体替换，新字段在弹窗里会消失。
  function mergeBlocks(base, saved) {
    if (typeof window.JIANLI_mergeBlocks === "function") return window.JIANLI_mergeBlocks(base, saved);
    return Object.assign(JSON.parse(JSON.stringify(base || {})), saved || {});
  }

  function scheduleSave() {
    $("#saveState").textContent = "保存中…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveNow(); }, 300);
  }

  // 立即落盘：写镜像的同时，把内容收回当前方案。
  // 用户切换方案 / 关闭窗口前会调它，免得 debounce 还没到就把改动丢了。
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    return new Promise(resolve => {
      chrome.storage.local.set({ resumeData, blocks, attachment, settings }, () => resolve(true));
    }).then(async () => {
      try {
        if (PROFILES) await PROFILES.syncMirror({ resumeData, blocks, attachment });
      } catch (e) { /* 方案同步失败不影响镜像本身已保存 */ }
      $("#saveState").textContent = "已自动保存";
      return true;
    });
  }

  // ---------- 字段表单 ----------

  function makeControl(key, def) {
    let control;
    if (def.type === "textarea") {
      control = document.createElement("textarea");
      control.value = resumeData[key] || "";
    } else if (def.type === "select") {
      control = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "（请选择）";
      control.appendChild(empty);
      def.options.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        control.appendChild(o);
      });
      control.value = resumeData[key] || "";
    } else {
      control = document.createElement("input");
      control.type = "text";
      control.value = resumeData[key] || "";
      control.placeholder = "填写" + def.label;
    }
    control.id = "f_" + key;
    const onChange = () => { resumeData[key] = control.value; scheduleSave(); };
    control.addEventListener("input", onChange);
    control.addEventListener("change", onChange);
    return control;
  }

  function renderForm() {
    form.innerHTML = "";
    GROUPS.forEach(group => {
      const div = document.createElement("div");
      div.className = "group";
      const h3 = document.createElement("h3");
      h3.textContent = group.title;
      div.appendChild(h3);
      group.keys.forEach(key => {
        const def = FIELD_DEFS[key];
        if (!def) return;
        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("label");
        label.htmlFor = "f_" + key;
        label.textContent = def.label;
        field.appendChild(label);
        field.appendChild(makeControl(key, def));
        div.appendChild(field);
      });
      form.appendChild(div);
    });

    renderBlockGroups();
    renderCustomFields();
  }

  // ---------- 经历块编辑 ----------

  function renderBlockGroups() {
    for (const blockKey of Object.keys(BLOCK_DEFS)) {
      const def = BLOCK_DEFS[blockKey];
      if (!def) continue;
      const list = Array.isArray(blocks[blockKey]) ? blocks[blockKey] : [];

      const div = document.createElement("div");
      div.className = "group";
      div.id = "blockGroup_" + blockKey;

      const h3 = document.createElement("h3");
      h3.textContent = def.label + "（用于校招站点的多行经历表单，可增删）";
      div.appendChild(h3);

      const listWrap = document.createElement("div");
      listWrap.className = "block-list";

      list.forEach((item, idx) => {
        const card = document.createElement("div");
        card.className = "block-card";

        const head = document.createElement("div");
        head.className = "block-card-head";
        const nameSpan = document.createElement("span");
        nameSpan.textContent = `第 ${idx + 1} 条`;
        const delBtn = document.createElement("button");
        delBtn.className = "ghost danger block-del";
        delBtn.textContent = "删除";
        delBtn.addEventListener("click", () => {
          blocks[blockKey].splice(idx, 1);
          scheduleSave();
          renderBlockGroups();
        });
        head.appendChild(nameSpan);
        head.appendChild(delBtn);
        card.appendChild(head);

        def.fields.forEach(f => {
          const row = document.createElement("div");
          row.className = "block-field";
          const lab = document.createElement("label");
          lab.textContent = f.label;
          row.appendChild(lab);

          let input;
          if (BLOCK_TEXTAREA_KEYS.has(f.key)) {
            input = document.createElement("textarea");
            input.rows = 3;
          } else {
            input = document.createElement("input");
            input.type = "text";
          }
          input.value = item[f.key] || "";
          input.placeholder = f.label;
          const onChange = () => { item[f.key] = input.value; scheduleSave(); };
          input.addEventListener("input", onChange);
          row.appendChild(input);
          card.appendChild(row);
        });

        listWrap.appendChild(card);
      });

      const addBtn = document.createElement("button");
      addBtn.className = "ghost";
      addBtn.textContent = "＋ 添加一条" + def.label;
      addBtn.addEventListener("click", () => {
        if (!Array.isArray(blocks[blockKey])) blocks[blockKey] = [];
        const blank = {};
        def.fields.forEach(f => { blank[f.key] = ""; });
        blocks[blockKey].push(blank);
        scheduleSave();
        renderBlockGroups();
      });

      div.appendChild(listWrap);
      div.appendChild(addBtn);
      form.appendChild(div);
    }
  }

  // ---------- 自定义字段 ----------

  function renderCustomFields() {
    const div = document.createElement("div");
    div.className = "group";
    div.id = "customGroup";
    const h3 = document.createElement("h3");
    h3.textContent = "自定义字段（遇到新字段自己加，填写时会自动匹配）";
    div.appendChild(h3);
    form.appendChild(div);

    customFields.forEach((cf, idx) => {
      const row = document.createElement("div");
      row.className = "custom-row";

      const lab = document.createElement("input");
      lab.type = "text";
      lab.className = "custom-label-input";
      lab.placeholder = "字段名（如：户口性质）";
      lab.value = cf.label || "";
      lab.addEventListener("input", () => { cf.label = lab.value; saveCustomFields(); });

      const val = document.createElement("input");
      val.type = "text";
      val.placeholder = "填写内容";
      val.value = cf.value || "";
      val.addEventListener("input", () => { cf.value = val.value; saveCustomFields(); });

      const del = document.createElement("button");
      del.className = "custom-del";
      del.textContent = "删除";
      del.addEventListener("click", () => {
        customFields.splice(idx, 1);
        saveCustomFields();
        renderForm();
      });

      row.appendChild(lab);
      row.appendChild(val);
      row.appendChild(del);
      div.appendChild(row);
    });

    const addBtn = document.createElement("button");
    addBtn.id = "addCustomBtn";
    addBtn.className = "ghost";
    addBtn.textContent = "＋ 添加自定义字段";
    addBtn.addEventListener("click", () => {
      customFields.push({ id: "cf_" + Date.now() + "_" + customFields.length, label: "", value: "" });
      saveCustomFields();
      renderForm();
    });
    div.appendChild(addBtn);
  }

  function saveCustomFields() {
    chrome.storage.local.set({ customFields: customFields.filter(cf => cf.label || cf.value) });
  }

  // ---------- 简历方案 ----------

  // 方案切换 / 增删之后，从镜像重新读一份并重渲染表单
  async function reloadCurrentProfile() {
    const stored = await chrome.storage.local.get(["resumeData", "blocks", "attachment"]);
    resumeData = mergeData(DEFAULTS.resumeData, stored.resumeData);
    blocks = mergeBlocks(DEFAULTS.blocks, stored.blocks);
    attachment = (stored.attachment === undefined) ? null : stored.attachment;
    renderForm();
    renderAttachment();
  }

  async function renderProfileBar() {
    const hint = $("#profileHint");
    if (!PROFILES) {
      hint.textContent = "方案模块未加载，当前只有一套数据";
      hint.title = hint.textContent;
      return;
    }
    await PROFILES.ensureLoaded();
    const items = PROFILES.list();
    const activeId = PROFILES.getActiveId();

    const sel = $("#profileSelect");
    sel.textContent = "";
    for (const p of items) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name + (p.hasAttachment ? " 📎" : "");
      sel.appendChild(o);
    }
    sel.value = activeId;
    $("#profileDelBtn").disabled = items.length <= 1;

    const cur = items.find(x => x.id === activeId);
    hint.textContent = "";
    hint.title = "";
    if (!cur) return;
    currentProfileName = cur.name;
    hint.appendChild(el("b", null, cur.name));
    hint.appendChild(el("span", null, "："));
    hint.appendChild(el("span", "ok", cur.fieldCount + " 个字段已填"));
    hint.appendChild(el("span", null, " · "));
    hint.appendChild(el("span", null, cur.blockCount + " 条经历"));
    hint.appendChild(el("span", null, " · "));
    hint.appendChild(el("span", cur.hasAttachment ? "ok" : "warn",
      cur.hasAttachment ? ("附件 " + (cur.attachmentName || "已配置")) : "无附件"));
    hint.appendChild(el("span", null, "（共 " + items.length + " 套方案）"));
    // 这行默认被压成一行省略号，全文挂到 title，鼠标悬停才看得到
    hint.title = hint.textContent;
    // 附件区要跟着换名字（它显示的是「属于哪套方案」）
    renderAttachment();
  }

  // 切换方案：先把当前改动落盘，再换镜像，最后重渲染
  async function doSwitchProfile(id) {
    if (!PROFILES) return;
    if (id === PROFILES.getActiveId()) return;
    await saveNow();
    const r = await PROFILES.setActive(id);
    if (!r.ok) { showStatus(r.reason || "切换方案失败", false); return; }
    await reloadCurrentProfile();
    await renderProfileBar();
    showStatus("已切换到方案「" + r.name + "」" + (r.attachment ? "（附件：" + r.attachment.name + "）" : "（这套方案还没有附件）"), true);
  }

  async function doCreateProfile() {
    if (!PROFILES) { showStatus("方案模块未加载", false); return; }
    await saveNow();
    const r = await PROFILES.create("", { activate: true });
    if (!r.ok) { showStatus(r.reason || "新建失败", false); return; }
    await reloadCurrentProfile();
    await renderProfileBar();
    // 新建后直接让改名，省一次点击
    openNameEditor("", "给新方案起个名字", async (name) => {
      const rr = await PROFILES.rename(r.id, name);
      if (!rr.ok) { showStatus(rr.reason || "重命名失败", false); return; }
      await renderProfileBar();
      showStatus("已新建方案「" + rr.name + "」", true);
    });
  }

  async function doDuplicateProfile() {
    if (!PROFILES) return;
    await saveNow();
    const src = PROFILES.list().find(x => x.id === PROFILES.getActiveId());
    if (!src) return;
    const r = await PROFILES.duplicate(src.id, null);
    if (!r.ok) { showStatus(r.reason || "复制失败", false); return; }
    await reloadCurrentProfile();
    await renderProfileBar();
    showStatus("已复制为「" + r.name + "」，之后改它只影响这一套", true);
  }

  // 方案名的行内编辑：扩展弹窗里 window.prompt 被浏览器禁用，只能自己做一个
  function openNameEditor(value, placeholder, onCommit) {
    const sel = $("#profileSelect");
    const input = $("#profileNameInput");
    if (!sel || !input) return;
    input.value = value || "";
    input.placeholder = placeholder || "方案名称";
    sel.hidden = true;
    input.hidden = false;
    nameEditor = { onCommit };
    setTimeout(() => { try { input.focus(); input.select(); } catch (e) { /* ignore */ } }, 0);
  }

  function closeNameEditor() {
    const sel = $("#profileSelect");
    const input = $("#profileNameInput");
    if (!input || input.hidden) return;
    input.hidden = true;
    if (sel) sel.hidden = false;
    nameEditor = null;
  }

  async function commitNameEditor() {
    const ctx = nameEditor;
    if (!ctx) return;
    const input = $("#profileNameInput");
    const name = (input.value || "").trim();
    closeNameEditor();
    if (!name) return;
    await ctx.onCommit(name);
  }

  async function doDeleteProfile() {
    if (!PROFILES) return;
    const cur = PROFILES.list().find(x => x.id === PROFILES.getActiveId());
    if (!cur) return;
    if (!confirm("删除方案「" + cur.name + "」？\n\n这套方案里的字段内容、经历块和附件会一起删掉，不可恢复。其它方案不受影响。")) return;
    const r = await PROFILES.remove(cur.id);
    if (!r.ok) { showStatus(r.reason || "删除失败", false); return; }
    await reloadCurrentProfile();
    await renderProfileBar();
    showStatus("已删除方案「" + r.removedName + "」" + (r.switched ? "，已自动切到下一套" : ""), true);
  }

  // ---------- 简历附件 ----------

  function renderAttachment() {
    const info = $("#attachInfo");
    const delBtn = $("#attachDelBtn");
    const scope = currentProfileName ? "方案「" + currentProfileName + "」" : "当前方案";
    if (!attachment || !attachment.dataUrl) {
      info.textContent = scope + "尚未上传附件";
      info.className = "attach-info";
      delBtn.hidden = true;
      return;
    }
    const kb = Math.round((attachment.size || 0) / 1024);
    const mb = Math.round(((attachment.dataUrl.length * 0.75) / 1024 / 1024) * 10) / 10;
    info.textContent = `${scope}：${attachment.name}（${kb} KB，占用存储约 ${mb} MB）`;
    info.className = "attach-info ok";
    delBtn.hidden = false;
  }

  function handleAttachFile(file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      showStatus("附件超过 4MB，Base64 后体积会翻倍，建议压缩后再上传", false);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      attachment = {
        name: file.name,
        type: file.type || "",
        size: file.size,
        dataUrl: reader.result
      };
      renderAttachment();
      saveNow().then(async () => {
        await renderProfileBar();
        showStatus("附件已保存到" + (currentProfileName ? "方案「" + currentProfileName + "」" : "当前方案") + "，填写时会尝试自动上传到页面的附件框", true);
      });
    };
    reader.onerror = () => showStatus("读取附件失败", false);
    reader.readAsDataURL(file);
  }

  // ---------- 简历识别 ----------

  function doRecognize() {
    const text = $("#resumeText").value;
    if (!text || !text.trim()) {
      showStatus("请先粘贴简历文本", false);
      return;
    }
    // 乱码不但识别不出东西，还会在「应用」后污染整份简历，所以先体检再识别。
    // 用宽松档：用户自己粘贴的文本里出现冷门符号很正常，别误拦。
    const health = window.JIANLI_FILEPARSE.textHealth(text, { lenient: true });
    if (!health.ok) {
      recognized = {};
      $("#recognizeOut").hidden = true;
      $("#applyRecognizeBtn").hidden = true;
      showStatus("这段文字看起来是乱码，已停止识别（" + health.reason + "）。" +
        "请重新从 Word 里复制简历全文，或改用「导入文件」（可选 .txt / .docx / .pdf）。", false);
      return;
    }
    recognized = window.JIANLI_RECOGNIZE.parseResume(text);
    const lines = [];
    for (const k of Object.keys(recognized)) {
      lines.push((FIELD_DEFS[k] ? FIELD_DEFS[k].label : k) + " = " + recognized[k].replace(/\n/g, " ⏎ "));
    }
    $("#recognizeOut").textContent = "识别到 " + lines.length + " 项：\n" + lines.join("\n");
    $("#recognizeOut").hidden = false;
    $("#applyRecognizeBtn").hidden = lines.length === 0;
    if (lines.length === 0) showStatus("没有识别到内容，请检查粘贴的文本是否完整", false);
  }

  function doApplyRecognize() {
    let applied = 0;
    let skipped = 0;
    for (const k of Object.keys(recognized)) {
      if (resumeData[k] !== undefined && !resumeData[k]) {
        resumeData[k] = recognized[k];
        applied++;
      } else if (resumeData[k] !== undefined) {
        skipped++;
      }
    }
    renderForm();
    chrome.storage.local.set({ resumeData }, () => {
      showStatus("已应用 " + applied + " 项（跳过已有内容 " + skipped + " 项）", true);
    });
  }

  // 所有格式统一走这一条路：整份读成字节 → 交给 fileparse 按魔数判格式 + 嗅探编码
  // → 过乱码体检 → 合格才写进输入框。
  //
  // 之前这里按扩展名分派，非 .docx/.pdf 一律 reader.readAsText()：readAsText 不带
  // 编码参数时按 UTF-8 读，而 Windows 中文环境导出的 txt 多是 ANSI(GBK)，于是
  // 整篇变成「一屏方块 + 零星怪符号」—— 就是用户截图里那个样子。而且无论读出
  // 什么都会照样塞进输入框，用户还看不出哪里出了问题。
  function handleResumeFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let res;
      try {
        res = await window.JIANLI_FILEPARSE.extract(reader.result, file.name || "");
      } catch (e) {
        showStatus("文件解析失败：" + e.message, false);
        return;
      }
      if (!res.ok) {
        // 关键：可疑文本一个字都不往输入框里放。放进去的下一步就是「应用到简历数据」，
        // 乱码被应用后污染的是整份简历，比留空严重得多。
        showStatus(res.message, false);
        return;
      }
      $("#resumeText").value = res.text;
      doRecognize();
      if (res.note) showStatus(res.note + "（识别编码：" + res.encoding + "）", true);
    };
    reader.onerror = () => showStatus("读取文件失败，请重试或改用复制粘贴", false);
    reader.readAsArrayBuffer(file);
  }

  // ---------- 状态与页面检测 ----------

  function showStatus(text, ok) {
    const box = $("#status");
    box.textContent = text;
    box.className = "status " + (ok ? "ok" : "err");
  }

  async function getTabStatus() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return null;
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
    } catch (e) {
      return { notInjected: true, title: tab.title, url: tab.url };
    }
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ""; }
  }

  async function refreshSiteHint() {
    const st = await getTabStatus();
    const el = $("#siteHint");
    if (!st) {
      el.textContent = "未检测到当前页面";
      el.title = "";
      pageHost = "";
      renderMemory();
      return;
    }
    pageHost = st.host || hostOf(st.url) || "";
    pageTitle = st.title || "";
    const widgetPart = st.widgets ? `｜组件型控件 ${st.widgets} 个` : "";
    const memPart = st.memory ? `｜已记住 ${st.memory} 条映射` : "";
    // 页面标题里能读出岗位/城市时提示一下：填表会按这个改名「期望职位」
    const inf = st.inferred;
    const inferPart = (inf && settings.inferPosition !== false && (inf.position || inf.city))
      ? `｜检测到岗位「${inf.position || "未识别"}」${inf.city ? "（" + inf.city + "）" : ""}`
      : "";
    if (st.adapter) {
      el.textContent = `当前站点：${st.adapter}（已适配）｜可识别字段约 ${st.candidates} 个${widgetPart}${memPart}${inferPart}`;
    } else if (st.notInjected) {
      el.textContent = "当前页面：暂未注入脚本，点击“立即填写”即可注入并识别字段";
    } else {
      el.textContent = `当前站点未单独适配（智能识别兜底）｜可识别字段约 ${st.candidates} 个${widgetPart}${memPart}${inferPart}`;
    }
    // 这行默认被压成一行省略号，全文挂到 title，鼠标悬停才看得到
    el.title = el.textContent;
    renderMemory();
  }

  // ---------- 填写 ----------

  async function doFill() {
    const btn = $("#fillBtn");
    btn.disabled = true;
    btn.textContent = "填写中…";
    try {
      const resp = await chrome.runtime.sendMessage({ type: "FILL_TAB" });
      if (resp && resp.ok) {
        const groups = { field: [], block: [], attachment: [] };
        (resp.results || []).forEach(r => {
          (groups[r.category] || groups.field).push(r);
        });
        const lines = [];
        const put = (title, arr) => {
          if (!arr.length) return;
          lines.push(title);
          arr.forEach(r => lines.push(`  ${r.ok ? "✓" : "✗"} ${r.label}${r.reason ? "（" + r.reason + "）" : ""}`));
        };
        put("常规字段", groups.field);
        put("经历块", groups.block);
        put("附件", groups.attachment);

        // 岗位推断：插件按页面标题改写了意向字段，得让用户看见这次改动
        const inf = resp.inferred;
        if (inf && inf.applied) {
          const parts = [];
          if (inf.applied.position) parts.push("期望职位 → " + inf.applied.position);
          if (inf.applied.city) parts.push("期望城市 → " + inf.applied.city);
          if (parts.length) lines.unshift("🎯 按当前岗位调整：" + parts.join("；"));
        }

        // 待手填清单：让用户知道还差哪些，以及差在哪
        const pending = resp.pending || [];
        const unknown = resp.unknown || [];
        if (pending.length || unknown.length) {
          lines.push(`还差 ${pending.length + unknown.length} 个需要你手动填：`);
          pending.forEach(p => {
            lines.push(`  · ${p.label}${p.reason ? "（" + p.reason + "）" : ""}`);
            // 匹配不上一个下拉时，把它实际有哪些选项列出来，省得回页面一个个点
            if (p.options && p.options.length) {
              const list = p.options.slice(0, 18).join(" / ");
              lines.push(`      该框的选项：${list}${p.options.length > 18 ? " 等 " + p.options.length + " 项" : ""}`);
            }
          });
          unknown.forEach(u => lines.push(`  · ${u.label}（插件不认识这个框）`));
          if (resp.unknownTotal > unknown.length) {
            lines.push(`  · 另有 ${resp.unknownTotal - unknown.length} 个未列出`);
          }
        }

        showStatus(
          `成功填写 ${resp.filled} / ${resp.total} 项` +
          (resp.adapter ? `（${resp.adapter}）` : "（智能识别）") +
          (lines.length ? "\n" + lines.join("\n") : "\n没有找到可填写的字段（可能需要先进入简历编辑页）") +
          (resp.snapshotCount ? `\n\n提示：按 Ctrl+Shift+Z 或点 ↩ 可撤销这次填写；页面上点右下角小球可查看战报并定位未填项。` : ""),
          true
        );
      } else {
        showStatus((resp && resp.reason) || "填写失败", false);
      }
    } catch (e) {
      showStatus("无法执行：请确认当前是网页页面", false);
    } finally {
      btn.disabled = false;
      btn.textContent = "⚡ 立即填写当前页面";
      refreshSiteHint();
    }
  }

  async function doUndo() {
    const btn = $("#undoBtn");
    btn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "UNDO_TAB" });
      if (resp && resp.ok) {
        showStatus(
          `已撤销：${resp.restored} 个框恢复成填写前的原值` +
          (resp.failed ? `（${resp.failed} 个已不在页面上，跳过）` : ""),
          true
        );
      } else {
        showStatus((resp && resp.reason) || "没有可撤销的内容", false);
      }
    } catch (e) {
      showStatus("无法执行：请确认当前是网页页面", false);
    } finally {
      btn.disabled = false;
    }
  }

  async function doScan() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    const out = $("#scanOut");
    const summary = $("#scanSummary");
    const copyBtn = $("#copyScanBtn");
    if (!tab || !tab.id) {
      summary.textContent = "未找到当前标签页";
      return;
    }
    summary.textContent = "扫描中…";
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_FIELDS" });
      if (resp && resp.ok) {
        const widgetCount = resp.fields.filter(f => f.widget && f.widget !== "native").length;
        out.value = JSON.stringify(resp.fields, null, 2);
        out.hidden = false;
        copyBtn.hidden = false;
        summary.textContent = `共 ${resp.fields.length} 个可填字段` +
          (widgetCount ? `，其中组件型控件 ${widgetCount} 个` : "") +
          (resp.adapter ? "（站点：" + resp.adapter + "）" : "");
      } else {
        summary.textContent = "页面没有响应";
      }
    } catch (e) {
      summary.textContent = "内容脚本未注入：请先刷新页面再扫描";
    }
  }

  // ---------- 投递台账 ----------

  async function renderLedger() {
    const listBox = $("#ledgerList");
    const statsEl = $("#ledgerStats");
    if (!listBox || !statsEl) return;
    if (!LEDGER) { statsEl.textContent = "台账模块未加载"; return; }

    await LEDGER.ensureLoaded();
    const st = LEDGER.stats();
    statsEl.className = "attach-info" + (st.total ? " ok" : "");
    statsEl.textContent = st.total
      ? `共 ${st.total} 条投递 · 今天 ${st.today} 条 · 近 7 天 ${st.week} 条 · 还没出结果 ${st.pending} 条 · 已通过 ${st.offer} 条`
      : "还没有记录。投完简历在页面右下角点「记一笔投递」，就会出现在这里。";

    // 状态筛选项只填一次，之后保留用户选中的值
    const sel = $("#ledgerFilter");
    if (sel && !sel.dataset.filled) {
      for (const s of LEDGER.STATUSES) {
        const o = document.createElement("option");
        o.value = s.key;
        o.textContent = s.label;
        sel.appendChild(o);
      }
      sel.dataset.filled = "1";
    }

    const rows = LEDGER.list({
      status: sel ? sel.value : "",
      keyword: ($("#ledgerSearch") && $("#ledgerSearch").value.trim()) || ""
    });

    listBox.textContent = "";
    if (!rows.length) {
      listBox.appendChild(el("div", "lg-empty", st.total ? "没有符合筛选条件的记录" : "台账还是空的"));
      return;
    }
    for (const r of rows) listBox.appendChild(makeLedgerRow(r));
  }

  function makeLedgerRow(r) {
    const row = el("div", "lg-row");

    const head = el("div", "lg-head");
    const title = el("div", "lg-title");
    title.appendChild(el("b", null, r.company || "（没写公司）"));
    if (r.position) title.appendChild(el("span", "lg-pos", " · " + r.position));
    head.appendChild(title);

    const st = document.createElement("select");
    st.className = "lg-status";
    st.title = "改状态";
    for (const s of LEDGER.STATUSES) {
      const o = document.createElement("option");
      o.value = s.key;
      o.textContent = s.label;
      st.appendChild(o);
    }
    st.value = r.status;
    st.style.borderColor = LEDGER.STATUS_COLOR[r.status] || "";
    st.addEventListener("change", async () => {
      const res = await LEDGER.update(r.id, { status: st.value });
      if (!res.ok) { showStatus(res.reason || "改状态失败", false); return; }
      const keep = st.value;
      await renderLedger();
      showStatus("状态已改为「" + (LEDGER.STATUS_LABEL[keep] || keep) + "」", true);
    });
    head.appendChild(st);

    const del = el("button", "lg-del", "删除");
    del.addEventListener("click", async () => {
      if (!confirm("从台账里删掉「" + (r.company || r.position || "这条") + "」？")) return;
      await LEDGER.remove(r.id);
      await renderLedger();
      showStatus("已删除 1 条记录", true);
    });
    head.appendChild(del);
    row.appendChild(head);

    const bits = [LEDGER.fmtDate(r.appliedAt)];
    if (r.city) bits.push(r.city);
    if (r.siteName) bits.push(r.siteName);
    if (r.profileName) bits.push("方案：" + r.profileName);
    row.appendChild(el("div", "lg-meta", bits.filter(Boolean).join(" · ")));

    // 详情折起来放：列表上一眼看到的是公司和岗位，要改字段才展开
    const det = document.createElement("details");
    det.className = "lg-detail";
    const sum = document.createElement("summary");
    sum.textContent = "编辑 / 备注 / 链接";
    det.appendChild(sum);

    const fields = [["company", "公司"], ["position", "岗位"], ["city", "城市"], ["note", "备注"]];
    for (const [key, label] of fields) {
      const line = el("div", "lg-edit-row");
      line.appendChild(el("label", null, label));
      const input = document.createElement("input");
      input.type = "text";
      input.value = r[key] || "";
      input.addEventListener("change", async () => {
        const patch = {};
        patch[key] = input.value;
        const res = await LEDGER.update(r.id, patch);
        if (!res.ok) { showStatus(res.reason || "保存失败", false); return; }
        await renderLedger();
        showStatus("已保存", true);
      });
      line.appendChild(input);
      det.appendChild(line);
    }

    if (r.url) {
      const link = document.createElement("a");
      link.className = "lg-link";
      link.href = r.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "打开岗位页面";
      det.appendChild(link);
    }
    row.appendChild(det);
    return row;
  }

  function exportLedgerCsv() {
    if (!LEDGER) return;
    const rows = LEDGER.list({
      status: $("#ledgerFilter") ? $("#ledgerFilter").value : "",
      keyword: ($("#ledgerSearch") && $("#ledgerSearch").value.trim()) || ""
    });
    if (!rows.length) { showStatus("台账里没有可导出的记录", false); return; }
    const blob = new Blob([LEDGER.toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "投递台账_" + (LEDGER.fmtDay(Date.now()) || "导出") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
    showStatus("已导出 " + rows.length + " 条记录，Excel 可直接打开", true);
  }

  async function doLedgerAddPage() {
    const btn = $("#ledgerAddBtn");
    btn.disabled = true;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) { showStatus("没有找到当前标签页", false); return; }
      let resp;
      try {
        resp = await chrome.tabs.sendMessage(tab.id, { type: "LEDGER_ADD_PAGE" });
      } catch (e) {
        showStatus("当前页面还没注入脚本。先点「立即填写」注入一次，或者直接在页面上点右下角小球里的「记一笔投递」", false);
        return;
      }
      if (resp && resp.ok) {
        await renderLedger();
        showStatus(resp.duplicate ? "这条已经在台账里了，没重复添加" : "已把当前页记进台账", true);
      } else {
        showStatus((resp && resp.reason) || "记录失败", false);
      }
    } finally {
      btn.disabled = false;
    }
  }

  function toggleManualForm(show) {
    const f = $("#ledgerAddForm");
    if (!f) return;
    f.hidden = !show;
    if (show) {
      $("#ledgerNewCompany").value = "";
      $("#ledgerNewPosition").value = "";
      $("#ledgerNewCity").value = "";
      try { $("#ledgerNewCompany").focus(); } catch (e) { /* ignore */ }
    }
  }

  async function saveManualLedger() {
    if (!LEDGER) return;
    const company = $("#ledgerNewCompany").value.trim();
    const position = $("#ledgerNewPosition").value.trim();
    if (!company && !position) { showStatus("公司和岗位至少填一个", false); return; }
    const r = await LEDGER.add({
      company,
      position,
      city: $("#ledgerNewCity").value.trim(),
      status: "applied",
      appliedAt: Date.now()
    });
    if (!r.ok) { showStatus(r.reason, false); return; }
    toggleManualForm(false);
    await renderLedger();
    showStatus(r.duplicate ? "这条已经在台账里了" : "已添加一条记录", true);
  }

  // ---------- 字段记忆 ----------

  function adapterNameFor(host) {
    const h = String(host || "").toLowerCase();
    const a = (window.JIANLI_SITE_ADAPTERS || []).find(x =>
      (x.hosts || []).some(y => h === y || h.endsWith("." + y))
    );
    return a ? a.name : (pageTitle.split(/[-_|·]/)[0].trim() || host || "当前站点");
  }

  async function renderMemory() {
    const box = $("#memoryList");
    const sum = $("#memorySummary");
    if (!box || !sum) return;
    if (!MEMORY) { sum.textContent = "字段记忆模块未加载"; return; }

    await MEMORY.ensureLoaded();
    const maps = MEMORY.all();
    const hosts = Object.keys(maps).filter(h => Object.keys(maps[h] || {}).length);
    const total = hosts.reduce((a, h) => a + Object.keys(maps[h]).length, 0);
    const cur = MEMORY.normalizeHost(pageHost);
    const curCount = cur ? MEMORY.countFor(cur) : 0;

    sum.className = "attach-info" + (total ? " ok" : "");
    sum.textContent = total
      ? `共记住 ${total} 条映射，覆盖 ${hosts.length} 个站点` + (cur ? `；当前站点 ${curCount} 条` : "")
      : "还没有任何记忆。在页面上用悬浮球的「记住」或「点选生成适配器」添加，会出现在这里。";

    box.textContent = "";
    if (!total) return;

    hosts.sort((a, b) => {
      const wa = a === cur ? 0 : 1;
      const wb = b === cur ? 0 : 1;
      return wa - wb || a.localeCompare(b);
    });

    for (const h of hosts) {
      const head = document.createElement("div");
      head.className = "mem-host";
      head.textContent = h + "（" + Object.keys(maps[h]).length + " 条）" + (h === cur ? " · 当前" : "");
      box.appendChild(head);

      for (const sel of Object.keys(maps[h])) {
        const e = maps[h][sel] || {};
        const row = document.createElement("div");
        row.className = "mem-row";

        const lab = document.createElement("span");
        lab.className = "mem-label";
        lab.textContent = e.label || e.key || "(未命名)";
        lab.title = (e.key || "") + " → " + sel;

        const code = document.createElement("code");
        code.className = "mem-sel";
        code.textContent = sel;
        code.title = sel;

        const del = document.createElement("button");
        del.className = "mem-del";
        del.textContent = "删除";
        del.addEventListener("click", async () => {
          MEMORY.forget(h, sel);
          await renderMemory();
          showStatus(`已删除 ${h} 上的 1 条映射`, true);
        });

        row.appendChild(lab);
        row.appendChild(code);
        row.appendChild(del);
        box.appendChild(row);
      }
    }
  }

  async function doCopyAdapter() {
    if (!MEMORY) return;
    const entries = pageHost ? MEMORY.listFor(pageHost) : [];
    if (!entries.length) {
      showStatus("当前站点还没有记忆。先在页面上点悬浮球的「点选生成适配器」，或对没认出来的框点「记住」", false);
      return;
    }
    const code = MEMORY.adapterSnippet(pageHost, entries, adapterNameFor(pageHost));
    try {
      await navigator.clipboard.writeText(code);
      showStatus("适配器代码已复制（" + entries.length + " 个字段）。粘到 content/sites.js 的 JIANLI_SITE_ADAPTERS 里，就变成正式适配器了", true);
    } catch (e) {
      showStatus("复制失败：" + e.message, false);
    }
  }

  async function doPick() {
    const btn = $("#pickBtn");
    btn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "PICK_TAB" });
      if (resp && resp.ok) {
        // 弹窗会在用户点到页面时自动关闭，那一下就白点了；这里主动关掉，让用户从容点选
        showStatus("已进入点选模式，页面顶部会有一条提示。把鼠标移到要记录的输入框上点一下即可（Esc 退出）", true);
        setTimeout(() => { try { window.close(); } catch (e) { /* ignore */ } }, 700);
      } else {
        showStatus((resp && resp.reason) || "无法在当前页面进入点选模式", false);
      }
    } catch (e) {
      showStatus("无法执行：请确认当前是网页页面", false);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- 导入导出 ----------

  function exportData() {
    const payload = {
      version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "",
      exportedAt: new Date().toISOString(),
      resumeData,
      blocks,
      settings,
      customFields,
      // 多套方案连同附件一起导出：不带上附件，这份备份换台电脑就用不了
      profiles: PROFILES ? PROFILES.exportAll() : null
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "简历数据.json";
    a.click();
    URL.revokeObjectURL(url);
    const n = PROFILES ? PROFILES.count() : 0;
    showStatus(n > 1 ? ("已导出 " + n + " 套方案（含附件，文件可能较大）") : "已导出（含附件）", true);
  }

  // 带多套方案的导入：整体替换（会先跟用户确认）
  async function applyProfilesImport(parsed) {
    const n = parsed.profiles.length;
    if (!confirm("这份文件里有 " + n + " 套简历方案。\n\n导入会替换掉你现在的全部方案（含附件），确定继续？")) return;
    const r = await PROFILES.importAll(parsed);
    if (!r.ok) { showStatus(r.reason || "导入失败", false); return; }
    if (parsed.settings) settings = Object.assign({}, settings, parsed.settings);
    if (parsed.customFields) customFields = parsed.customFields;
    await chrome.storage.local.set({ settings, customFields });
    await reloadCurrentProfile();
    renderSettingsInputs();
    await renderProfileBar();
    showStatus("已导入 " + r.count + " 套方案，当前用的是「" + currentProfileName + "」", true);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);

        // 新格式：文件里带 profiles（多套方案 + 附件），走整体恢复
        if (PROFILES && Array.isArray(parsed.profiles) && parsed.profiles.length) {
          applyProfilesImport(parsed);
          return;
        }

        // 老格式：只有一份数据，合并进当前方案
        const incoming = parsed.resumeData || parsed;
        resumeData = mergeData(DEFAULTS.resumeData, incoming);
        if (parsed.blocks) blocks = mergeBlocks(DEFAULTS.blocks, parsed.blocks);
        if (parsed.settings) settings = Object.assign({}, settings, parsed.settings);
        if (parsed.customFields) customFields = parsed.customFields;
        renderForm();
        renderSettingsInputs();
        chrome.storage.local.set({ resumeData, blocks, settings, customFields }, async () => {
          if (PROFILES) {
            try { await PROFILES.syncMirror({ resumeData, blocks, attachment }); } catch (e) { /* ignore */ }
            await renderProfileBar();
          }
          showStatus("导入成功，已保存到当前方案", true);
        });
      } catch (e) {
        showStatus("JSON 文件格式错误", false);
      }
    };
    reader.readAsText(file);
  }

  // ---------- 设置 ----------

  function renderSettingsInputs() {
    $("#optSkipFilled").checked = settings.skipFilled !== false;
    $("#optDeepFill").checked = settings.deepFill !== false;
    $("#optAutoAttach").checked = settings.autoAttach !== false;
    $("#optShowHud").checked = settings.showHud !== false;
    $("#optUseMemory").checked = settings.useMemory !== false;
    $("#optInferPosition").checked = settings.inferPosition !== false;
    $("#optLedgerPrompt").checked = settings.ledgerPrompt !== false;
    $("#autoFill").checked = !!settings.autoFill;
    const hk = settings.hotkey || "command";
    const sel = $("#optHotkey");
    sel.value = Array.from(sel.options).some(o => o.value === hk) ? hk : "command";
    if (sel.value !== hk) {
      // 老数据里可能存着不认识的键位，回写一次保证一致
      settings.hotkey = sel.value;
      chrome.storage.local.set({ settings });
    }
  }

  function bindSettings() {
    const bind = (sel, key) => {
      $(sel).addEventListener("change", (e) => {
        settings[key] = e.target.checked;
        chrome.storage.local.set({ settings });
      });
    };
    bind("#optSkipFilled", "skipFilled");
    bind("#optDeepFill", "deepFill");
    bind("#optAutoAttach", "autoAttach");
    bind("#optShowHud", "showHud");
    bind("#autoFill", "autoFill");
    bind("#optUseMemory", "useMemory");
    bind("#optInferPosition", "inferPosition");
    bind("#optLedgerPrompt", "ledgerPrompt");

    $("#optHotkey").addEventListener("change", (e) => {
      settings.hotkey = e.target.value;
      chrome.storage.local.set({ settings });
    });
  }

  // ---------- 初始化 ----------

  async function init() {
    // 版本号单一来源：直接读 manifest，避免多处手写不一致
    try {
      const v = chrome.runtime.getManifest().version;
      $("#appTitle").textContent = "📋 简历助手 v" + v;
      document.title = "简历助手 v" + v;
    } catch (e) { /* ignore */ }

    // 方案模块要最先就位：老版本升级上来时它会把原有数据原样包成「默认方案」
    if (PROFILES) {
      try { await PROFILES.ensureLoaded(); } catch (e) { /* 失败时退化成只有一套数据 */ }
    }

    const stored = await chrome.storage.local.get(
      ["resumeData", "settings", "customFields", "blocks", "attachment"]
    );
    resumeData = mergeData(DEFAULTS.resumeData, stored.resumeData);
    blocks = mergeBlocks(DEFAULTS.blocks, stored.blocks);
    settings = Object.assign({}, DEFAULTS.settings, stored.settings || {});
    attachment = (stored.attachment === undefined) ? DEFAULTS.attachment : stored.attachment;
    customFields = stored.customFields || [];

    renderForm();
    renderAttachment();
    renderSettingsInputs();
    bindSettings();
    await renderProfileBar();

    // ---------- 简历方案 ----------
    $("#profileSelect").addEventListener("change", (e) => doSwitchProfile(e.target.value));
    $("#profileNewBtn").addEventListener("click", doCreateProfile);
    $("#profileDupBtn").addEventListener("click", doDuplicateProfile);
    $("#profileRenameBtn").addEventListener("click", () => {
      if (!PROFILES) return;
      const cur = PROFILES.list().find(x => x.id === PROFILES.getActiveId());
      if (!cur) return;
      openNameEditor(cur.name, "方案名称", async (name) => {
        const r = await PROFILES.rename(cur.id, name);
        if (!r.ok) { showStatus(r.reason || "重命名失败", false); return; }
        await renderProfileBar();
        showStatus("方案已改名为「" + r.name + "」", true);
      });
    });
    $("#profileDelBtn").addEventListener("click", doDeleteProfile);

    const nameInput = $("#profileNameInput");
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitNameEditor(); }
      else if (e.key === "Escape") { e.preventDefault(); closeNameEditor(); }
    });
    nameInput.addEventListener("blur", () => { commitNameEditor(); });

    $("#fillBtn").addEventListener("click", doFill);
    $("#undoBtn").addEventListener("click", doUndo);
    $("#scanBtn").addEventListener("click", doScan);
    $("#closeBtn").addEventListener("click", () => window.close());
    $("#openWinBtn").addEventListener("click", () => {
      chrome.windows.create({
        url: chrome.runtime.getURL("popup/popup.html"),
        type: "popup",
        width: 460,
        height: 760
      });
      window.close();
    });
    $("#recognizeBtn").addEventListener("click", doRecognize);
    $("#importTxtBtn").addEventListener("click", () => $("#txtFile").click());
    $("#txtFile").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) handleResumeFile(e.target.files[0]);
    });
    $("#applyRecognizeBtn").addEventListener("click", doApplyRecognize);

    $("#attachBtn").addEventListener("click", () => $("#attachFile").click());
    $("#attachFile").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) handleAttachFile(e.target.files[0]);
    });
    $("#attachDelBtn").addEventListener("click", () => {
      attachment = null;
      renderAttachment();
      chrome.storage.local.set({ attachment: null }, () => showStatus("附件已删除", true));
    });

    $("#copyScanBtn").addEventListener("click", () => {
      const out = $("#scanOut");
      navigator.clipboard.writeText(out.value).then(() => {
        showStatus("字段清单已复制，直接粘贴给我即可", true);
      });
    });

    // ---------- 字段记忆 ----------
    $("#pickBtn").addEventListener("click", doPick);
    $("#memCopyBtn").addEventListener("click", doCopyAdapter);
    $("#memClearHostBtn").addEventListener("click", async () => {
      if (!MEMORY) return;
      if (!pageHost) { showStatus("没有检测到当前站点", false); return; }
      if (!confirm("清空 " + pageHost + " 上的全部字段记忆？")) return;
      const n = MEMORY.clearHost(pageHost);
      await renderMemory();
      showStatus(n ? "已清空 " + pageHost + " 上的 " + n + " 条映射" : "当前站点本来就没有记忆", !!n);
    });
    $("#memClearAllBtn").addEventListener("click", async () => {
      if (!MEMORY) return;
      if (!confirm("清空全部站点的字段记忆？清空后所有站点都要重新认，且不可恢复。")) return;
      const n = MEMORY.clearAll();
      await renderMemory();
      showStatus("已清空全部 " + n + " 条映射", true);
    });
    $("#memoryBox").addEventListener("toggle", () => {
      if ($("#memoryBox").open) renderMemory();
    });

    // ---------- 投递台账 ----------
    $("#ledgerBox").addEventListener("toggle", () => {
      if ($("#ledgerBox").open) renderLedger();
    });
    $("#ledgerAddBtn").addEventListener("click", doLedgerAddPage);
    $("#ledgerManualBtn").addEventListener("click", () => {
      toggleManualForm($("#ledgerAddForm").hidden);
    });
    $("#ledgerNewSave").addEventListener("click", saveManualLedger);
    $("#ledgerNewCancel").addEventListener("click", () => toggleManualForm(false));
    $("#ledgerNewCompany").addEventListener("keydown", e => { if (e.key === "Enter") saveManualLedger(); });
    $("#ledgerNewPosition").addEventListener("keydown", e => { if (e.key === "Enter") saveManualLedger(); });
    $("#ledgerNewCity").addEventListener("keydown", e => { if (e.key === "Enter") saveManualLedger(); });
    $("#ledgerCsvBtn").addEventListener("click", exportLedgerCsv);
    $("#ledgerClearBtn").addEventListener("click", async () => {
      if (!LEDGER) return;
      const st = LEDGER.stats();
      if (!st.total) { showStatus("台账本来就是空的", false); return; }
      if (!confirm("清空全部 " + st.total + " 条投递记录？清空后不可恢复，建议先导出 CSV 备份。")) return;
      await LEDGER.clear();
      await renderLedger();
      showStatus("台账已清空", true);
    });

    $("#exportBtn").addEventListener("click", exportData);
    $("#importBtn").addEventListener("click", () => $("#fileInput").click());
    $("#fileInput").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
    });
    $("#resetBtn").addEventListener("click", () => {
      if (!confirm("确定恢复默认简历数据？\n\n当前方案的全部字段和经历块会被覆盖，其它方案也会被一并清掉，只留这一套默认数据。")) return;
      chrome.runtime.sendMessage({ type: "RESET_DEFAULTS" }, async (resp) => {
        if (!resp || !resp.ok) { showStatus("恢复默认失败", false); return; }
        if (PROFILES) {
          try {
            await PROFILES.ensureLoaded();
            await PROFILES.resetAll({ resumeData: DEFAULTS.resumeData, blocks: DEFAULTS.blocks });
          } catch (e) { /* 方案重置失败时镜像仍是干净的，不影响使用 */ }
        }
        resumeData = mergeData(DEFAULTS.resumeData, null);
        blocks = JSON.parse(JSON.stringify(DEFAULTS.blocks || {}));
        attachment = DEFAULTS.attachment;
        settings = Object.assign({}, DEFAULTS.settings);
        renderForm();
        renderAttachment();
        renderSettingsInputs();
        await renderProfileBar();
        showStatus("已恢复默认数据", true);
      });
    });

    // 弹窗可能被随手关掉，别让 debounce 里还没落盘的改动丢在内存里
    const flushPending = () => {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      chrome.storage.local.set({ resumeData, blocks, attachment, settings });
      if (PROFILES) { try { PROFILES.syncMirror({ resumeData, blocks, attachment }); } catch (e) { /* ignore */ } }
    };
    window.addEventListener("beforeunload", flushPending);
    document.addEventListener("visibilitychange", () => { if (document.hidden) flushPending(); });

    // 站点提示 / 方案提示默认压成一行省略，点一下展开全文、再点收起。
    // 用委托会漏掉动态创建的行，这里元素是静态的，直接绑。
    document.querySelectorAll(".fold-line").forEach(node => {
      node.addEventListener("click", () => node.classList.toggle("expand"));
    });

    refreshSiteHint();
  }

  init();
})();
