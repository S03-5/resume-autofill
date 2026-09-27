// ============================================================
// 后台服务工作线程：负责注入脚本、触发填表、右键菜单与快捷键
// ============================================================
// Chrome/Edge：Service Worker 需要 importScripts；
// Firefox：由 manifest 的 background.scripts 直接加载，此处会自动跳过。
// user-defaults.js 是个人数据文件，缺失时不影响运行（退化成空模板）。
if (typeof importScripts === "function") {
  try { importScripts("user-defaults.js"); } catch (e) { /* 个人数据文件不存在时静默跳过 */ }
  importScripts("defaults.js");
  importScripts("profiles.js");
}

(function () {
  const G = (typeof window !== "undefined") ? window : self;

  function collectDefaults() {
    return (typeof G.JIANLI_getDefaults === "function")
      ? G.JIANLI_getDefaults()
      : { resumeData: {}, blocks: {}, attachment: null, settings: {} };
  }

  // 安装/更新时：初始化默认数据 + 创建右键菜单
  chrome.runtime.onInstalled.addListener(() => {
    try {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: "fill-resume",
          title: "用简历数据填写本页表单",
          contexts: ["page", "editable"]
        });
        chrome.contextMenus.create({
          id: "undo-fill",
          title: "撤销上次填写（恢复原值）",
          contexts: ["page", "editable"]
        });
      });
    } catch (e) { /* 菜单创建失败不影响核心功能 */ }

    const d = collectDefaults();
    // 老版本升级上来时，新增的 blocks / attachment / 设置项需要补齐
    chrome.storage.local.get(["resumeData", "settings", "blocks", "attachment"], (res) => {
      const patch = {};
      if (!res.resumeData) patch.resumeData = d.resumeData;
      if (!res.blocks) patch.blocks = d.blocks;
      if (res.attachment === undefined) patch.attachment = d.attachment;
      // 已有设置也要与新默认值合并，保证新开关有初始值
      patch.settings = Object.assign({}, d.settings, res.settings || {});
      chrome.storage.local.set(patch, () => {
        // 多套方案的存储在这里首次就位：它会把上面这一份数据原样包成「默认方案」，
        // 老用户升级后不会丢任何内容
        const P = G.JIANLI_PROFILES;
        if (P) {
          try { Promise.resolve(P.ensureLoaded()).catch(() => { /* ignore */ }); } catch (e) { /* ignore */ }
        }
      });
    });
  });

  const CONTENT_FILES = [
    "content/lexicon.js",
    "content/matcher.js",
    "content/sites.js",
    "content/widgets.js",
    "content/blocks.js",
    "content/memory.js",
    "content/infer.js",
    "content/ledger.js",
    "content/hud.js",
    "content/content.js"
  ];

  // 先注入内容脚本（幂等，重复注入不会报错）
  async function ensureContent(tabId) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "无法在此页面注入脚本，请检查页面地址" };
    }
  }

  // 在当前活动标签页执行填表
  async function fillActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return { ok: false, reason: "没有找到当前标签页" };
    if (!tab.url || !/^(https?|file):/i.test(tab.url)) {
      return { ok: false, reason: "此页面无法注入脚本（浏览器内置页面等）" };
    }
    return fillTab(tab.id);
  }

  // 进入页面内的「点选生成适配器」模式
  async function pickActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return { ok: false, reason: "没有找到当前标签页" };
    if (!tab.url || !/^(https?|file):/i.test(tab.url)) {
      return { ok: false, reason: "此页面无法注入脚本（浏览器内置页面等）" };
    }
    const inj = await ensureContent(tab.id);
    if (!inj.ok) return inj;
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "START_PICK" });
      return resp || { ok: true };
    } catch (e) {
      return { ok: false, reason: "页面没有响应，请刷新后重试" };
    }
  }

  // 先注入内容脚本，再发送填写指令
  async function fillTab(tabId) {
    const inj = await ensureContent(tabId);
    if (!inj.ok) return inj;
    const d = collectDefaults();
    const stored = await chrome.storage.local.get(
      ["resumeData", "customFields", "blocks", "attachment", "settings"]
    );

    // 合并默认值与已保存数据：新增字段能取到默认值
    const data = Object.assign({}, d.resumeData, stored.resumeData || {});
    // 自定义字段：用户自己添加的新字段也参与填写
    const customFields = (stored.customFields || []).filter(cf => cf && cf.label && cf.value);
    for (const cf of customFields) {
      data["custom_" + cf.id] = cf.value;
    }

    const options = Object.assign({}, d.settings, stored.settings || {});
    // 经历块按行补齐，不整体替换：老用户 storage 里的块没有后来新增的字段
    // （学位、学习形式），直接替换会让新字段永远填不上
    const blocks = (typeof G.JIANLI_mergeBlocks === "function")
      ? G.JIANLI_mergeBlocks(d.blocks, stored.blocks)
      : (stored.blocks || d.blocks);
    const attachment = (stored.attachment === undefined) ? d.attachment : stored.attachment;

    // 优先走页面内通路（会带出悬浮球战报浮层）；页面脚本没准备好时降级为直接填写
    try {
      const hudResp = await chrome.tabs.sendMessage(tabId, { type: "HUD_FILL" });
      if (hudResp && hudResp.ok) return hudResp;
    } catch (e) { /* 降级到下面的 FILL_PAGE */ }

    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: "FILL_PAGE",
        data,
        mode: "manual",
        customFields,
        blocks,
        attachment,
        options
      });
      return resp || { ok: false, reason: "页面没有响应，请刷新后重试" };
    } catch (e) {
      return { ok: false, reason: "页面没有响应，请刷新后重试" };
    }
  }

  // 撤销上一次填写：把页面上被填过的控件的值恢复成原样
  async function undoActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return { ok: false, reason: "没有找到当前标签页" };
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "UNDO_FILL" });
      return resp || { ok: false, reason: "页面没有响应" };
    } catch (e) {
      return { ok: false, reason: "页面没有响应（刷新页面后需要重新填写才能撤销）" };
    }
  }

  // 弹窗点击“立即填写”时的入口
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "FILL_TAB") {
      fillActiveTab().then(sendResponse);
      return true; // 异步响应
    }
    if (msg && msg.type === "UNDO_TAB") {
      undoActiveTab().then(sendResponse);
      return true;
    }
    if (msg && msg.type === "PICK_TAB") {
      pickActiveTab().then(sendResponse);
      return true;
    }
    if (msg && msg.type === "RESET_DEFAULTS") {
      const d = collectDefaults();
      chrome.storage.local.set(
        {
          resumeData: d.resumeData,
          settings: d.settings,
          blocks: d.blocks,
          attachment: d.attachment
        },
        () => sendResponse({ ok: true })
      );
      return true;
    }
    if (msg && msg.type === "FILL_TAB_BY_ID") {
      fillTab(msg.tabId).then(sendResponse);
      return true;
    }
  });

  // 右键菜单
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || !tab.id) return;
    if (info.menuItemId === "fill-resume") {
      fillTab(tab.id);
    } else if (info.menuItemId === "undo-fill") {
      chrome.tabs.sendMessage(tab.id, { type: "UNDO_FILL" }).catch(() => { /* 未注入时忽略 */ });
    }
  });

  // 快捷键：Ctrl+Shift+F 填写、Ctrl+Shift+Z 撤销
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "fill-current-page") {
      await fillActiveTab();
    } else if (command === "undo-fill") {
      await undoActiveTab();
    }
  });
})();
