// ============================================================
// 纯逻辑单测：把不需要真实 DOM 的算法抽出来跑断言。
// 目前覆盖：省市区拆分、日期解析、组件类型判定（含识别用的归一化）。
// 用法：node test/logic.js
// ============================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

// 用沙箱加载 content/lexicon.js + matcher.js + content/widgets.js，
// 只提供它们加载期需要的全局对象。widgets.js 的选项匹配委托给 matcher，
// 所以必须把前两个也一起加载，否则匹配相关的断言会全部落空。
function loadWidgets() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    body: { dispatchEvent() {} },
    documentElement: {}
  };
  sandbox.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  sandbox.MouseEvent = function MouseEvent() {};
  sandbox.HTMLInputElement = function () {};
  sandbox.HTMLTextAreaElement = function () {};
  sandbox.HTMLSelectElement = function () {};
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.console = console;
  sandbox.Date = Date;
  vm.createContext(sandbox);
  for (const f of ["content/lexicon.js", "content/matcher.js", "content/widgets.js", "defaults.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox;
}

const SANDBOX = loadWidgets();
const W = SANDBOX.JIANLI_WIDGETS;
const MATCH = SANDBOX.JIANLI_MATCHER;
MATCH.setNowYear(2026);

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望 ${e}\n      实际 ${a}`); }
}

console.log("=== 省市区拆分 splitRegion ===");
eq("常规三级", W.splitRegion("吉林省长春市南关区"), ["吉林省", "长春市", "南关区"]);
eq("直辖市两级", W.splitRegion("北京市朝阳区"), ["北京市", "朝阳区"]);
eq("自治区", W.splitRegion("内蒙古自治区呼和浩特市新城区"), ["内蒙古自治区", "呼和浩特市", "新城区"]);
eq("自治州", W.splitRegion("吉林省延边朝鲜族自治州延吉市"), ["吉林省", "延边朝鲜族自治州", "延吉市"]);
eq("带空格", W.splitRegion("广东省 深圳市 南山区"), ["广东省", "深圳市", "南山区"]);
eq("只到市", W.splitRegion("广东省深圳市"), ["广东省", "深圳市"]);
eq("只有市名", W.splitRegion("长春市南关区"), ["长春市", "南关区"]);
eq("无后缀兜底", W.splitRegion("上海"), ["上海"]);
eq("全角括号去掉", W.splitRegion("吉林省长春市（南关区）"), ["吉林省", "长春市"]);
eq("空值", W.splitRegion(""), []);

console.log("\n=== 日期解析 parseDateParts ===");
eq("年月短横线", W.parseDateParts("2005-05"), { y: "2005", m: "5", d: "" });
eq("年月日", W.parseDateParts("2005-05-03"), { y: "2005", m: "5", d: "3" });
eq("中文年月", W.parseDateParts("2005年5月"), { y: "2005", m: "5", d: "" });
eq("只有年", W.parseDateParts("2005"), { y: "2005", m: "", d: "" });
eq("非法输入", W.parseDateParts("明年"), null);

console.log("\n=== 归一化 norm（控件识别靠它）===");
const norm = W.util.norm;
eq("去空白", norm("  本科  "), "本科");
eq("全角转半角", norm("ＣＥＴ－４"), "cet-4");
eq("去括号内容", norm("本科（学士）"), "本科");
eq("大小写", norm("Bachelor"), "bachelor");
eq("英文括号", norm("硕士(学术型)"), "硕士");

console.log("\n=== 组件类型判定 classify ===");
// 构造假元素：依赖 closest / className / readonly
function fakeEl({ tagName = "INPUT", type = "text", readOnly = false, cls = "", rootCls = "", role = "" }) {
  const root = { className: rootCls, getAttribute: () => role, nodeType: 1 };
  return {
    nodeType: 1, tagName, type, readOnly,
    className: cls,
    getAttribute: (k) => (k === "role" ? role : ""),
    closest: (sel) => {
      // 只模拟两类查找：命中组件根 / 向上逐层
      if (rootCls && sel.includes("." + rootCls.split(" ")[0])) return root;
      return null;
    },
    parentElement: root
  };
}
eq("原生 select", W.classify({ nodeType: 1, tagName: "SELECT" }), "native");
eq("原生 date", W.classify({ nodeType: 1, tagName: "INPUT", type: "date" }), "native");
eq("富文本", W.classify({ nodeType: 1, tagName: "DIV", isContentEditable: true }), "native");
eq("antd 下拉", W.classify(fakeEl({ readOnly: true, rootCls: "ant-select", role: "combobox" })), "dropdown");
eq("antd 日期", W.classify(fakeEl({ readOnly: true, rootCls: "ant-picker" })), "date");
eq("antd 级联", W.classify(fakeEl({ readOnly: true, rootCls: "ant-cascader" })), "cascade");

console.log("\n=== 统一匹配器（完整用例集见 test/matcher.js）===");
eq("匹配：男 → 男性", MATCH.pick("男", ["男性", "女性"], "gender").text, "男性");
eq("匹配：本科 不会被非全日制本科带偏", MATCH.pick("本科", ["非全日制本科"], "degree"), null);
eq("匹配：CET-6 → 英语六级", MATCH.pick("CET-6", ["英语六级"], "english_level").text, "英语六级");
eq("匹配：请选择 不参与", MATCH.pick("本科", ["请选择", "不限"], "degree"), null);
eq("匹配：选项为空就留空", MATCH.pick("男", [], "gender"), null);
eq("匹配器阈值", MATCH.MIN_SCORE, 55);
// widgets.js 的选项匹配必须走匹配器（同一个值在原生下拉和组件下拉里结果一致）
eq("widgets 与 matcher 用了同一套判定", typeof W.util.findBestOption, "function");

console.log("\n=== 经历块数据迁移（老用户升级时不丢新字段）===");
// 背景：经历块存在 chrome.storage 里，老用户的那份没有后来新增的字段（学位 / 学习形式）。
// 如果合并时整体替换数组，新字段永远补不上 —— 表现为「弹窗里看不到这一项，页面上也填不进去」。
const MB = SANDBOX.JIANLI_mergeBlocks;
eq("mergeBlocks 已导出", typeof MB, "function");

const tpl = {
  education: [{ school: "", degree: "", degree_name: "学士", study_mode: "全日制", college: "" }]
};
const merged = MB(tpl, { education: [{ school: "示例大学", degree: "本科", college: "计算机学院" }] });
eq("老数据里缺的新字段被补上", merged.education[0].degree_name, "学士");
eq("学习形式也一起补上", merged.education[0].study_mode, "全日制");
eq("用户自己填过的值不被模板覆盖", merged.education[0].school, "示例大学");

// 用户自己加的第二段经历（比如硕士那段）不能被模板第 1 行的值串上 —— 那比空着更糟
const twoRows = MB(tpl, {
  education: [{ school: "A 大学", degree: "本科" }, { school: "B 大学", degree: "硕士" }]
});
eq("多出来的行不串模板第 1 行的值", twoRows.education[1].degree_name, undefined);

// 家庭情况走同一套迁移：模板里是空数组，成员数据来自 user-defaults
const fam = MB(
  { family: [{ name: "李四", relation: "父子", company: "无", age: "50", phone: "13900000001" }] },
  { education: [] }   // 老用户 storage 里还没有 family 这一项
);
eq("storage 里没有 family 时，从默认值补出成员", fam.family[0].name, "李四");
eq("成员电话也一并补上", fam.family[0].phone, "13900000001");

// 以后加了母亲那段，不能被第 1 位成员的值串上（那比空着更糟）
const twoMembers = MB(
  { family: [{ name: "李四", relation: "父子" }] },
  { family: [{ name: "李四" }, { name: "李秀兰", relation: "母子" }] }
);
eq("用户自己加的第二位成员原样保留", twoMembers.family[1].name, "李秀兰");
eq("第二位成员不会被第 1 位的值串上", twoMembers.family[1].relation, "母子");
eq("多出来的行保留自己的值", twoRows.education[1].school, "B 大学");

// 用户主动清空了经历块，要尊重这个清空，不能又拿模板把它填回来
eq("用户清空后保持为空", MB(tpl, { education: [] }).education.length, 0);
// storage 里压根没有这一块时，用模板打底
eq("storage 里没有这块时用模板", MB(tpl, {}).education[0].degree_name, "学士");
// 模板里没有、用户自己加的块类型也要留着
eq("用户自定义的块类型不丢", MB(tpl, { education: [], volunteer: [{ org: "青协" }] }).volunteer.length, 1);

console.log("\n" + (fail ? `✗ 失败 ${fail} 项 / 通过 ${pass} 项` : `✓ 全部通过（${pass} 项）`));
process.exit(fail ? 1 : 0);
