// ============================================================
// 后台服务工作线程：负责注入脚本、触发填表、右键菜单与快捷键
// ============================================================
// Chrome/Edge：Service Worker 需要 importScripts；
// Firefox：由 manifest 的 background.scripts 直接加载 defaults.js，此处会自动跳过。
if (typeof importScripts === "function") {
  importScripts("defaults.js");
}

(function () {
  const G = (typeof window !== "undefined") ? window : self;
  const DEFAULTS = G.JIANLI_DEFAULTS;

  // 安装/更新时：初始化默认数据 + 创建右键菜单
  chrome.runtime.onInstalled.addListener(() => {
    try {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: "fill-resume",
          title: "用简历数据填写本页表单",
          contexts: ["page", "editable"]
        });
      });
    } catch (e) { /* 菜单创建失败不影响核心功能 */ }

    chrome.storage.local.get("resumeData", (res) => {
      if (!res.resumeData) {
        chrome.storage.local.set({
          resumeData: DEFAULTS.resumeData,
          settings: DEFAULTS.settings
        });
      }
    });
  });

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

  // 先注入内容脚本（幂等，重复注入不会报错），再发送填写指令
  async function fillTab(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/sites.js", "content/content.js"]
      });
    } catch (e) {
      return { ok: false, reason: "无法在此页面注入脚本，请检查页面地址" };
    }

    const stored = await chrome.storage.local.get(["resumeData", "customFields"]);
    // 合并默认值与已保存数据：新增字段能取到默认值（如英语成绩 462、应届、工学等）
    const data = Object.assign({}, DEFAULTS.resumeData, stored.resumeData || {});
    // 自定义字段：用户自己添加的新字段也参与填写
    const customFields = (stored.customFields || []).filter(cf => cf && cf.label && cf.value);
    for (const cf of customFields) {
      data["custom_" + cf.id] = cf.value;
    }
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: "FILL_PAGE",
        data,
        mode: "manual",
        customFields
      });
      return resp || { ok: false, reason: "页面没有响应，请刷新后重试" };
    } catch (e) {
      return { ok: false, reason: "页面没有响应，请刷新后重试" };
    }
  }

  // 弹窗点击“立即填写”时的入口
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "FILL_TAB") {
      fillActiveTab().then(sendResponse);
      return true; // 异步响应
    }
    if (msg && msg.type === "RESET_DEFAULTS") {
      chrome.storage.local.set(
        { resumeData: DEFAULTS.resumeData, settings: DEFAULTS.settings },
        () => sendResponse({ ok: true })
      );
      return true;
    }
  });

  // 右键菜单
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "fill-resume" && tab && tab.id) {
      fillTab(tab.id);
    }
  });

  // 快捷键 Ctrl+Shift+F
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "fill-current-page") {
      await fillActiveTab();
    }
  });
})();
