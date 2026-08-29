// ============================================================
// 弹窗逻辑：简历数据编辑（自动保存）、一键填写、导入/导出
// ============================================================
(function () {
  const FIELD_DEFS = window.JIANLI_FIELD_DEFS;
  const DEFAULTS = window.JIANLI_DEFAULTS;

  const GROUPS = [
    { title: "基本信息", keys: ["name", "gender", "birth", "height", "weight", "hometown", "nationality", "country", "current_residence", "id_number", "phone", "email", "political", "graduate_status", "english_level", "english_score", "recruit_source", "emergency_contact", "emergency_phone", "student_cadre"] },
    { title: "教育信息", keys: ["school", "degree", "major", "major_category", "college", "graduate_year", "education_period", "grade_ranking", "gpa", "thesis_title", "research_topic", "lab", "advisor", "education"] },
    { title: "求职意向", keys: ["city", "position", "salary", "job_type"] },
    { title: "经历与介绍", keys: ["intro", "internship_position", "campus_position", "internship", "work", "project", "patent", "monograph", "skills", "awards", "paper", "language", "certificate", "portfolio", "hobby"] }
  ];

  let resumeData = {};
  let customFields = [];
  let recognized = {};
  let saveTimer = null;

  const $ = s => document.querySelector(s);
  const form = $("#form");

  function mergeData(base, saved) {
    const out = {};
    for (const key of Object.keys(FIELD_DEFS)) {
      out[key] = (saved && saved[key] !== undefined && saved[key] !== null)
        ? saved[key]
        : base[key] || "";
    }
    return out;
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
        const field = document.createElement("div");
        field.className = "field";

        const label = document.createElement("label");
        label.htmlFor = "f_" + key;
        label.textContent = def.label;
        field.appendChild(label);

        let control;
        if (def.type === "textarea") {
          control = document.createElement("textarea");
          control.id = "f_" + key;
          control.value = resumeData[key] || "";
        } else if (def.type === "select") {
          control = document.createElement("select");
          control.id = "f_" + key;
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
          control.id = "f_" + key;
          control.type = "text";
          control.value = resumeData[key] || "";
          control.placeholder = "填写" + def.label;
        }
        control.addEventListener("input", () => {
          resumeData[key] = control.value;
          scheduleSave();
        });
        control.addEventListener("change", () => {
          resumeData[key] = control.value;
          scheduleSave();
        });
        field.appendChild(control);
        div.appendChild(field);
      });
      form.appendChild(div);
    });

    // 自定义字段组
    const customDiv = document.createElement("div");
    customDiv.className = "group";
    const h3c = document.createElement("h3");
    h3c.textContent = "自定义字段（遇到新字段自己加，填写时会自动匹配）";
    customDiv.appendChild(h3c);
    customDiv.id = "customGroup";
    form.appendChild(customDiv);
    renderCustomFields();
  }

  function renderCustomFields() {
    const group = document.getElementById("customGroup");
    if (!group) return;
    while (group.children.length > 1) group.removeChild(group.lastChild);

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
        renderCustomFields();
      });

      row.appendChild(lab);
      row.appendChild(val);
      row.appendChild(del);
      group.appendChild(row);
    });

    const addBtn = document.createElement("button");
    addBtn.id = "addCustomBtn";
    addBtn.className = "ghost";
    addBtn.textContent = "＋ 添加自定义字段";
    addBtn.addEventListener("click", () => {
      customFields.push({ id: "cf_" + Date.now() + "_" + customFields.length, label: "", value: "" });
      saveCustomFields();
      renderCustomFields();
    });
    group.appendChild(addBtn);
  }

  function saveCustomFields() {
    chrome.storage.local.set({ customFields: customFields.filter(cf => cf.label || cf.value) });
  }

  function doRecognize() {
    const text = $("#resumeText").value;
    if (!text || !text.trim()) {
      showStatus("请先粘贴简历文本", false);
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

  function handleResumeFile(file) {
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".docx") || name.endsWith(".pdf")) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          let text;
          if (name.endsWith(".docx")) {
            text = await window.JIANLI_FILEPARSE.parseDocx(reader.result);
          } else {
            text = await window.JIANLI_FILEPARSE.parsePdf(reader.result);
          }
          text = window.JIANLI_FILEPARSE.normalize(text);
          if (!text || text.length < 30) {
            showStatus("未能从文件中提取到足够文本（可能是扫描版 PDF），请直接复制粘贴简历文字", false);
            return;
          }
          $("#resumeText").value = text;
          doRecognize();
        } catch (e) {
          showStatus("文件解析失败：" + e.message, false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        $("#resumeText").value = reader.result;
        doRecognize();
      };
      reader.readAsText(file);
    }
  }

  function scheduleSave() {
    $("#saveState").textContent = "保存中…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ resumeData }, () => {
        $("#saveState").textContent = "已自动保存";
      });
    }, 300);
  }

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

  async function refreshSiteHint() {
    const st = await getTabStatus();
    const el = $("#siteHint");
    if (!st) {
      el.textContent = "未检测到当前页面";
      return;
    }
    if (st.adapter) {
      el.textContent = `当前站点：${st.adapter}（已适配）｜页面可识别字段约 ${st.candidates} 个`;
    } else if (st.notInjected) {
      el.textContent = "当前页面：暂未注入脚本，点击“立即填写”即可注入并识别字段";
    } else {
      el.textContent = `当前站点未单独适配（智能识别兜底）｜页面可识别字段约 ${st.candidates} 个`;
    }
  }

  async function doFill() {
    const btn = $("#fillBtn");
    btn.disabled = true;
    btn.textContent = "填写中…";
    try {
      const resp = await chrome.runtime.sendMessage({ type: "FILL_TAB" });
      if (resp && resp.ok) {
        const detail = resp.results && resp.results.length
          ? resp.results.map(r => (r.ok ? "✓ " : "✗ ") + r.label + (r.reason ? "（" + r.reason + "）" : "")).join("\n")
          : "没有找到可填写的字段（可能需要先进入简历编辑页）";
        showStatus(
          `成功填写 ${resp.filled} / ${resp.total} 个字段` +
          (resp.adapter ? `（${resp.adapter}）` : "（智能识别）") +
          "\n" + detail,
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
        out.value = JSON.stringify(resp.fields, null, 2);
        out.hidden = false;
        copyBtn.hidden = false;
        summary.textContent = `共 ${resp.fields.length} 个可填字段${resp.adapter ? "（站点：" + resp.adapter + "）" : ""}`;
      } else {
        summary.textContent = "页面没有响应";
      }
    } catch (e) {
      summary.textContent = "内容脚本未注入：请先刷新页面再扫描";
    }
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(resumeData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "简历数据.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        resumeData = mergeData(DEFAULTS.resumeData, parsed);
        renderForm();
        chrome.storage.local.set({ resumeData }, () => {
          showStatus("导入成功，已保存", true);
        });
      } catch (e) {
        showStatus("JSON 文件格式错误", false);
      }
    };
    reader.readAsText(file);
  }

  async function init() {
    const stored = await chrome.storage.local.get(["resumeData", "settings", "customFields"]);
    resumeData = mergeData(DEFAULTS.resumeData, stored.resumeData);
    customFields = stored.customFields || [];
    renderForm();
    $("#autoFill").checked = !!(stored.settings && stored.settings.autoFill);

    $("#fillBtn").addEventListener("click", doFill);
    $("#scanBtn").addEventListener("click", doScan);
    $("#closeBtn").addEventListener("click", () => window.close());
    $("#openWinBtn").addEventListener("click", () => {
      chrome.windows.create({
        url: chrome.runtime.getURL("popup/popup.html"),
        type: "popup",
        width: 460,
        height: 720
      });
      window.close();
    });
    $("#recognizeBtn").addEventListener("click", doRecognize);
    $("#importTxtBtn").addEventListener("click", () => $("#txtFile").click());
    $("#txtFile").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) handleResumeFile(e.target.files[0]);
    });
    $("#applyRecognizeBtn").addEventListener("click", doApplyRecognize);
    $("#copyScanBtn").addEventListener("click", () => {
      const out = $("#scanOut");
      navigator.clipboard.writeText(out.value).then(() => {
        showStatus("字段清单已复制，直接粘贴给我即可", true);
      });
    });
    $("#autoFill").addEventListener("change", (e) => {
      chrome.storage.local.set({ settings: { autoFill: e.target.checked } });
    });
    $("#exportBtn").addEventListener("click", exportData);
    $("#importBtn").addEventListener("click", () => $("#fileInput").click());
    $("#fileInput").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
    });
    $("#resetBtn").addEventListener("click", () => {
      if (!confirm("确定恢复默认简历数据？当前修改将被覆盖。")) return;
      chrome.runtime.sendMessage({ type: "RESET_DEFAULTS" }, (resp) => {
        if (resp && resp.ok) {
          resumeData = mergeData(DEFAULTS.resumeData, null);
          renderForm();
          showStatus("已恢复默认数据", true);
        }
      });
    });

    refreshSiteHint();
  }

  init();
})();
