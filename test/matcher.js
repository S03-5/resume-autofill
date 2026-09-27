// ============================================================
// 选项匹配用例集
//
// 这是 P0 的核心交付物：词表怎么加、算法怎么改，跑一遍就知道有没有退化。
//
// 用法：node test/matcher.js
//
// 两个指标：
//   正确率  挑中的选项和期望一致的比例（要求 ≥ 90%）
//   错选率  挑中了「本该留空」的选项的比例（要求 = 0，这是硬红线）
//
// 用例里的简历值取自 user-defaults.js 的真实数据（男 / 共青团员 / 汉 / 本科 / 工学 …）。
// ============================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadMatcher() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.Date = Date;
  vm.createContext(sandbox);
  for (const f of ["content/lexicon.js", "content/matcher.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox.JIANLI_MATCHER;
}

const M = loadMatcher();
// 固定「今年」为 2026，让毕业年份相关的用例可复现
M.setNowYear(2026);

let pass = 0, fail = 0;
const failures = [];
// 错选：期望留空(null)，却选了一个
let wrongPick = 0;

// 期望挑中的选项文本；期望留空写 null
function t(name, field, value, options, expect) {
  const r = M.pick(value, options, field);
  const got = r ? r.text : null;
  const ok = got === expect;
  const detail = r ? `score=${r.score} ${r.layer}` : "留空";
  if (ok) { pass++; console.log(`  ✓ ${name}　→ ${got === null ? "留空" : got}（${detail}）`); }
  else {
    fail++;
    if (expect === null && got !== null) wrongPick++;
    failures.push(name);
    console.log(`  ✗ ${name}\n      期望 ${expect === null ? "留空" : expect}\n      实际 ${got === null ? "留空" : got + "（" + detail + "）"}`);
  }
}

console.log("=== 一、字段识别：把简历值填进真实的选项集 ===\n");

console.log("-- 性别 --");
t("性别：男 → 男/女", "gender", "男", ["男", "女"], "男");
t("性别：男 → 男性/女性（同义写法）", "gender", "男", ["男性", "女性"], "男性");
t("性别：男 → 只有女，应当留空", "gender", "男", ["女"], null);

console.log("\n-- 政治面貌 --");
t("政治面貌：共青团员 → 共青团员", "political", "共青团员", ["中共党员", "共青团员", "群众"], "共青团员");
t("政治面貌：共青团员 → 团员（同义）", "political", "共青团员", ["党员", "团员", "群众"], "团员");
t("政治面貌：共青团员 → 只有党员/群众，留空", "political", "共青团员", ["中共党员", "群众"], null);
t("政治面貌：中共党员 → 中国共产党党员（同义）", "political", "中共党员", ["中国共产党党员"], "中国共产党党员");
t("政治面貌：群众 → 无党派人士 不应被误选", "political", "群众", ["无党派人士", "民主党派"], null);

console.log("\n-- 民族 / 国家 --");
t("民族：汉 → 汉族", "nationality", "汉", ["汉族", "回族"], "汉族");
t("民族：汉 → 只有回族，留空", "nationality", "汉", ["回族"], null);
t("国家：中国 → 中国大陆", "country", "中国", ["中国大陆", "海外"], "中国大陆");
t("国家：中国 → 中国香港 不应被当成本人国家", "country", "中国", ["中国香港"], null);

console.log("\n-- 学历（含否定词陷阱）--");
t("学历：本科 → 本科", "degree", "本科", ["高中", "大专", "本科", "硕士", "博士"], "本科");
t("学历：本科 → 全日制本科（不应选非全日制）", "degree", "本科", ["全日制本科", "非全日制本科"], "全日制本科");
t("学历：本科 → 只有非全日制本科，必须留空", "degree", "本科", ["非全日制本科"], null);
t("学历：本科 → 成人本科 不应被误选", "degree", "本科", ["成人本科"], null);
t("学历：本科 → 专科/硕士/博士都留空", "degree", "本科", ["专科", "硕士研究生", "博士研究生"], null);
t("学历：硕士 → 硕士研究生", "degree", "硕士", ["本科", "硕士研究生"], "硕士研究生");
t("学历：本科 → 全日制本科（含专升本）括号写法", "degree", "本科", ["全日制本科（含专升本）"], "全日制本科（含专升本）");
t("学历：本科 → 本科 与 本科及以上 同时存在，选更精确的", "degree", "本科", ["本科", "本科及以上"], "本科");
t("学历：全日制本科 → 全日制本科 不被自己否定", "degree", "全日制本科", ["非全日制本科", "全日制本科"], "全日制本科");
// 学历下拉里混进学位写法时，仍然优先挑「本科」这个精确项，不会被「学士」抢走
t("学历：本科 → 选项里混着学士，仍选本科", "degree", "本科", ["无", "学士", "本科", "硕士"], "本科");

console.log("\n-- 学位（和学历是两个字段，不能互相串）--");
t("学位：学士 → 无/学士/硕士/博士", "degree_name", "学士", ["无", "学士", "硕士", "博士"], "学士");
t("学位：学士 → 学士学位（同义）", "degree_name", "学士", ["学士学位", "硕士学位"], "学士学位");
// 红线：学位下拉的第一项常常就是「无」，绝不能因为字面短就把它选上
t("学位：学士 → 只有 无/硕士/博士，必须留空", "degree_name", "学士", ["无", "硕士", "博士"], null);
t("学位：学士 → 无学位 不能被选中", "degree_name", "学士", ["无学位", "硕士学位"], null);
t("学位：硕士 → 硕士", "degree_name", "硕士", ["无", "学士", "硕士", "博士"], "硕士");
t("学位：学士 → 只有博士，留空", "degree_name", "学士", ["博士"], null);
// 有的站点把学位下拉写成「本科/硕士」，语义对得上但字面对不上 → 宁可空着
t("学位：学士 → 页面写成「本科」，留空不猜", "degree_name", "学士", ["本科"], null);

console.log("\n-- 学习形式（选项长短写法差异最大的一项）--");
// 实测遇到的场景：页面选项是「全国普通高等院校全日制」，简历存的是短写法「全日制」，
// 字面长度比只有 3/11，靠包含匹配根本够不到 —— 必须靠词表认成同义
t("学习形式：全日制 → 全国普通高等院校全日制（长写法）", "study_mode", "全日制", ["全国普通高等院校全日制", "非全日制"], "全国普通高等院校全日制");
t("学习形式：全日制 → 全国普通高等学校全日制（学校 / 院校两种写法都认）", "study_mode", "全日制", ["全国普通高等学校全日制"], "全国普通高等学校全日制");
t("学习形式：全日制 → 全日制", "study_mode", "全日制", ["全日制", "非全日制"], "全日制");
t("学习形式：全日制 → 只有非全日制，必须留空", "study_mode", "全日制", ["非全日制"], null);
t("学习形式：全日制 → 普通全日制（同义）", "study_mode", "全日制", ["普通全日制", "成人教育", "自学考试"], "普通全日制");
t("学习形式：全日制 → 成人教育 / 自学考试 不应被误选", "study_mode", "全日制", ["成人教育", "自学考试"], null);
t("学习形式：非全日制 → 非全日制", "study_mode", "非全日制", ["全日制", "非全日制"], "非全日制");

console.log("\n-- 专业类别 --");
t("专业类别：工学 → 工学", "major_category", "工学", ["工学", "理学"], "工学");
t("专业类别：工学 → 工科（同义）", "major_category", "工学", ["工科", "理科"], "工科");
t("专业类别：工学 → 只有理科/文科，留空", "major_category", "工学", ["理科", "文科"], null);

console.log("\n-- 成绩排名 --");
t("排名：前25% → 前25%", "grade_ranking", "前25%", ["前5%", "前10%", "前20%", "前25%", "前50%"], "前25%");
t("排名：前25% → 25%（同义）", "grade_ranking", "前25%", ["25%", "50%"], "25%");
t("排名：前25% → 只有前5%/前10%，留空", "grade_ranking", "前25%", ["前5%", "前10%"], null);

console.log("\n-- 应届/往届（按毕业年份判断）--");
t("应届：应届 → 应届", "graduate_status", "应届", ["应届", "往届"], "应届");
t("应届：应届 → 2027届（今年 2026，属应届）", "graduate_status", "应届", ["2027届", "2026届", "2025届"], "2027届");
t("往届：往届 → 2025届（今年 2026，属往届）", "graduate_status", "往届", ["2027届", "2025届"], "2025届");
t("往届：往届 → 只有应届，留空", "graduate_status", "往届", ["应届"], null);

console.log("\n-- 英语等级 --");
t("英语：英语四级（CET-4） → 英语四级", "english_level", "英语四级（CET-4）", ["英语四级", "英语六级"], "英语四级");
t("英语：英语四级（CET-4） → CET-4（括号写法）", "english_level", "英语四级（CET-4）", ["CET-4", "CET-6"], "CET-4");
t("英语：英语四级（CET-4） → 只有六级，留空", "english_level", "英语四级（CET-4）", ["英语六级", "CET6"], null);
t("英语：CET-6 → 英语六级", "english_level", "CET-6", ["英语六级", "英语四级"], "英语六级");
t("英语：英语四级（CET-4） → 四级（2 字短选项）", "english_level", "英语四级（CET-4）", ["四级", "六级", "无"], "四级");
t("英语：英语四级（CET-4） → 六级不匹配，留空", "english_level", "英语四级（CET-4）", ["六级", "专四"], null);
t("英语：CET-4 → 4级（数字写法）", "english_level", "CET-4", ["4级", "6级", "无"], "4级");
t("英语：英语六级（CET-6） → 只有四级，留空", "english_level", "英语六级（CET-6）", ["四级", "无"], null);
t("英语：CET-4 → 专四不匹配，留空", "english_level", "CET-4", ["专四", "专八"], null);

console.log("\n-- 求职类型 / 学生干部 --");
t("求职类型：全职 → 全职", "job_type", "全职", ["全职", "兼职", "实习"], "全职");
t("求职类型：全职 → 只有校招/社招，留空", "job_type", "全职", ["校园招聘", "社会招聘"], null);
t("学生干部：是 → 是", "student_cadre", "是", ["是", "否"], "是");
t("学生干部：有 → 是（同义）", "student_cadre", "有", ["是", "否"], "是");
t("学生干部：是 → 只有否，留空", "student_cadre", "是", ["否"], null);

console.log("\n=== 二、数值 / 单位 / 日期 ===\n");
t("身高：175 → 170-175cm（区间命中）", "height", "175", ["170-175cm", "176-180cm"], "170-175cm");
t("身高：175 → 175cm（单位剥离）", "height", "175", ["175cm"], "175cm");
t("身高：160 → 170-175cm 不命中", "height", "160", ["170-175cm"], null);
t("出生：2005-05 → 2005年5月", "birth", "2005-05", ["2005年5月", "2006年5月"], "2005年5月");
t("毕业年：2027 → 2027届", "graduate_year", "2027", ["2027届", "2026届"], "2027届");
t("毕业年：2027 → 2027年6月（年份前缀）", "graduate_year", "2027", ["2027年6月"], "2027年6月");
t("GPA：3.5 → 85 不换算，留空", "gpa", "3.5", ["85", "90"], null);

console.log("\n=== 三、否定词对抗（红线：一条都不能选错）===\n");
t("对抗：全日制本科 → 只有非全日制，留空", "degree", "全日制本科", ["非全日制本科"], null);
t("对抗：中共党员 → 非党员 绝不能被选中", "political", "中共党员", ["非党员", "群众"], null);
t("对抗：本科 → 非全日制本科 与 全日制本科 并存", "degree", "本科", ["非全日制本科", "全日制本科"], "全日制本科");
t("对抗：有 → 没有 不能被选中", "student_cadre", "有", ["没有", "有"], "有");

console.log("\n=== 四、地名后缀 ===\n");
t("城市：北京 → 北京市", "city", "北京", ["北京市", "上海市"], "北京市");
t("城市：长春 → 长春市", "city", "长春", ["吉林省", "长春市"], "长春市");
t("城市：北京 → 上海市 不命中", "city", "北京", ["上海市", "广州市"], null);

console.log("\n=== 五、边界与占位 ===\n");
t("占位：跳过「请选择」「不限」", "degree", "本科", ["请选择", "不限", "本科"], "本科");
t("占位：只有占位项时留空", "degree", "本科", ["请选择", "不限"], null);
t("空值：简历没填就留空", "degree", "", ["本科", "硕士"], null);
t("空选项：没有选项就留空", "degree", "本科", [], null);
t("未知字段：词表不覆盖时仍能精确匹配", "some_unknown_key", "测试", ["测试", "其他"], "测试");
t("未知字段：无同义词时不做猜测", "some_unknown_key", "机械工程师", ["软件工程师"], null);

console.log("\n=== 六、单选组多候选文本（label + value）===\n");
{
  const items = [{ id: "a", t: ["男", "male", "1"] }, { id: "b", t: ["女", "female", "2"] }];
  const r = M.pick("男", items, "gender", x => x.t);
  const ok1 = r && r.item.id === "a";
  console.log(ok1 ? `  ✓ 多候选文本里取最高分（命中「男」）` : `  ✗ 多候选文本匹配失败：${JSON.stringify(r)}`);
  ok1 ? pass++ : (fail++, failures.push("多候选文本"), wrongPick += 0);

  const r2 = M.pick("男", items, "gender", x => [x.t[1]]);   // 只有英文候选
  const ok2 = r2 && r2.text === "male";
  console.log(ok2 ? `  ✓ 只给英文候选时按同义词表命中 male` : `  ✗ 英文候选匹配失败：${JSON.stringify(r2)}`);
  ok2 ? pass++ : (fail++, failures.push("英文候选"));
}

console.log("\n=== 七、接口自检 ===\n");
{
  const checks = [
    ["MIN_SCORE 是 55", M.MIN_SCORE === 55],
    ["归一化：全角转半角", M.normalize("ＣＥＴ－４") === "cet-4"],
    ["归一化：去空格与首尾破折号", M.normalize(" -- 请选择 -- ") === "请选择"],
    ["变体：英语六级（CET-6）能拆出三种写法", M.variants("英语六级（CET-6）").length === 3],
    ["日期归一：2005年5月 → 2005-5", M.canonDate("2005年5月") === "2005-5"],
    ["日期归一：2005-05 → 2005-5", M.canonDate("2005-05") === "2005-5"],
    ["explain 能列出全部候选", M.explain("本科", ["高中", "本科"], "degree").length === 2],
    ["describeOptions 能拼成一行", M.describeOptions(["甲", "乙"]) === "甲 / 乙"],
    ["pick 对 null 值返回 null", M.pick(null, ["甲"], "degree") === null]
  ];
  for (const [name, ok] of checks) {
    if (ok) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; failures.push(name); console.log(`  ✗ ${name}`); }
  }
}

const total = pass + fail;
const accuracy = pass / total;

console.log("\n============================================================");
console.log(`用例总数 ${total}　通过 ${pass}　失败 ${fail}`);
console.log(`正确率 ${(accuracy * 100).toFixed(1)}%（要求 ≥ 90%）`);
console.log(`错选数 ${wrongPick}（要求 = 0：只能「没填」，不能「填错」）`);
if (failures.length) console.log("失败项：" + failures.join("、"));
console.log("============================================================");

const ok = fail === 0 && wrongPick === 0;
process.exit(ok ? 0 : 1);
