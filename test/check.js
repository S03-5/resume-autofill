// ============================================================
// 静态引用检查：抓出「JS 引用了 HTML 里不存在的 id / 选择器」这类静默错误。
// 用法：node test/check.js
// ============================================================
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let problems = 0;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function idsInHtml(html) {
  const ids = new Set();
  const re = /\sid\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  return ids;
}

// 收集 JS 里所有 getElementById("x") / $("#x") / querySelector("#x") 的引用
function idRefsInJs(js) {
  const refs = [];
  const patterns = [
    /getElementById\(\s*["']([^"']+)["']\s*\)/g,
    /\$\(\s*["']#([^"'\s]+)["']\s*\)/g,
    /querySelector\(\s*["']#([^"'\s]+)["']\s*\)/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(js))) refs.push(m[1]);
  }
  return refs;
}

// 由脚本在运行时动态创建的元素 id，静态 HTML 里当然找不到，属于正常情况
const RUNTIME_IDS = new Set([
  "jianli-hud-host"   // 悬浮球宿主节点，由 content/hud.js 在页面里动态插入
]);

function checkPair(label, htmlRel, jsRels) {
  const html = read(htmlRel);
  const ids = idsInHtml(html);
  const missing = [];
  for (const rel of jsRels) {
    let js;
    try { js = read(rel); } catch (e) { console.log(`  ! 读不到 ${rel}`); continue; }
    for (const ref of idRefsInJs(js)) {
      if (RUNTIME_IDS.has(ref)) continue;
      if (!ids.has(ref)) missing.push(`${rel}  →  #${ref}`);
    }
  }
  const uniq = Array.from(new Set(missing));
  if (uniq.length) {
    problems += uniq.length;
    console.log(`✗ ${label}：发现 ${uniq.length} 个引用了不存在的 id`);
    uniq.forEach(x => console.log("    " + x));
  } else {
    console.log(`✓ ${label}：id 引用全部存在`);
  }
}

// 单文件（测试页：HTML 与内联 JS 在同一个文件里）
function checkSelfContained(label, htmlRel) {
  const html = read(htmlRel);
  const ids = idsInHtml(html);
  const body = html.replace(/<script[\s\S]*?<\/script>/g, m => m); // 保留脚本内容一起扫
  const refs = idRefsInJs(body);
  const missing = Array.from(new Set(refs.filter(r => !ids.has(r) && !RUNTIME_IDS.has(r))));
  if (missing.length) {
    problems += missing.length;
    console.log(`✗ ${label}：发现 ${missing.length} 个引用了不存在的 id`);
    missing.forEach(x => console.log("    #" + x));
  } else {
    console.log(`✓ ${label}：id 引用全部存在`);
  }
}

// 检查 JS 里引用的本地脚本/样式文件是否真实存在
// user-defaults.js 是「可选的个人数据文件」：仓库里只放模板 user-defaults.example.js，
// 因为里面要写真实身份证号/手机号，绝不能入库。缺失不影响运行 ——
// background.js 用 importScripts 包了 try/catch，popup.html 的 <script src> 404 也会被浏览器静默忽略。
// 这里是刻意放宽，不是漏检：只要 example 模板在，就认为用户照 README 复制一份即可。
function optionalFileOk(fileRel) {
  const base = path.basename(String(fileRel).replace(/\\/g, "/"));
  if (base !== "user-defaults.js") return false;
  return fs.existsSync(path.join(ROOT, "user-defaults.example.js"));
}

function checkAssets(label, htmlRel) {
  const html = read(htmlRel);
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  let m;
  const missing = [];
  while ((m = re.exec(html))) {
    const url = m[1];
    if (/^(https?:|data:|#|mailto:)/.test(url)) continue;
    const p = path.resolve(path.join(ROOT, path.dirname(htmlRel)), url);
    if (!fs.existsSync(p) && !optionalFileOk(p)) missing.push(url);
  }
  if (missing.length) {
    problems += missing.length;
    console.log(`✗ ${label}：引用的文件不存在`);
    missing.forEach(x => console.log("    " + x));
  } else {
    console.log(`✓ ${label}：引用的本地文件都存在`);
  }
}

console.log("\n=== 弹窗 ===");
checkPair("popup.html ↔ popup.js", "popup/popup.html", ["popup/popup.js"]);
checkAssets("popup.html 资源", "popup/popup.html");

// 设置开关必须真的接上了事件。第三步就漏过一个「优先使用字段记忆」：
// 界面上能勾，settings 却没更新，光看代码很难发现，只能靠这种检查兜住。
{
  const html = read("popup/popup.html");
  const js = read("popup/popup.js");
  const ids = [];
  let m;
  const reA = /<input[^>]*type=["']checkbox["'][^>]*id=["']([^"']+)["']/g;
  while ((m = reA.exec(html))) ids.push(m[1]);
  const reB = /<input[^>]*id=["']([^"']+)["'][^>]*type=["']checkbox["']/g;
  while ((m = reB.exec(html))) if (!ids.includes(m[1])) ids.push(m[1]);

  const unbound = ids.filter(id => {
    const byBind = new RegExp("bind\\(\\s*\"#" + id + "\"").test(js);
    const byListener = new RegExp("\\$\\(\"#" + id + "\"\\)\\s*\\.addEventListener").test(js);
    return !byBind && !byListener;
  });
  if (unbound.length) {
    problems += unbound.length;
    console.log("✗ 这些开关在 popup.html 里能点，但 popup.js 里没接事件：" + unbound.join(", "));
  } else {
    console.log("✓ 弹窗里的 " + ids.length + " 个开关都接上了事件");
  }
}

// 5 个配置面板必须真的收在「更多设置」折叠区里面。
// 防回归：它们原先各占一行标题、常驻在字段区上方合计约 185px，把字段区挤到只剩 170px。
// 一旦被挪出来，弹窗立刻回到「字段区只够看两个半字段」的老样子，而这在代码上看不出来。
{
  const html = read("popup/popup.html");
  const innerIds = ["importBox", "attachBox", "settingsBox", "memoryBox", "ledgerBox"];
  const mo = /<details\b[^>]*id=["']moreBox["'][^>]*>/.exec(html);

  let end = -1;
  if (mo) {
    const tagRe = /<details\b|<\/details>/g;
    tagRe.lastIndex = mo.index;
    let depth = 0, t;
    while ((t = tagRe.exec(html))) {
      if (t[0].charAt(1) === "/") { depth--; if (depth === 0) { end = t.index; break; } }
      else depth++;
    }
  }

  const outside = mo && end > 0
    ? innerIds.filter(id => {
        const p = new RegExp("id=[\"']" + id + "[\"']").exec(html);
        return !p || p.index < mo.index || p.index > end;
      })
    : innerIds;

  if (!mo) {
    problems++;
    console.log("✗ popup.html 里找不到「更多设置」折叠区（<details id=\"moreBox\">），配置面板会堆回字段区上方");
  } else if (end < 0) {
    problems++;
    console.log("✗ popup.html 的 <details id=\"moreBox\"> 标签没有正常闭合");
  } else if (outside.length) {
    problems++;
    console.log("✗ 这些面板没有被收进「更多设置」，会重新占掉字段区上方的空间：" + outside.join(", "));
  } else {
    console.log("✓ 5 个配置面板都收在「更多设置」折叠区内");
  }
}

console.log("\n=== 内容脚本接线 ===");
{
  const content = read("content/content.js");
  const before = problems;
  if (!/function\s+checkAppliedPage\s*\(/.test(content) || !/checkAppliedPage\(\)/.test(content)) {
    problems++;
    console.log("✗ content.js 没有接入投递成功页检测（checkAppliedPage 定义了却没被调用？）");
  }
  if (!/id:\s*"ledger"/.test(content)) {
    problems++;
    console.log("✗ content.js 没有给悬浮球注册「记一笔投递」");
  }
  if (problems === before) console.log("✓ 投递台账已接入内容脚本（悬浮球入口 + 成功页检测）");
}

// ledger.js 和 profiles.js 一样是弹窗与内容脚本共用的模块，两边都必须加载
{
  const popupHtml = read("popup/popup.html");
  const m = JSON.parse(read("manifest.json"));
  const js = (m.content_scripts && m.content_scripts[0] && m.content_scripts[0].js) || [];
  const before = problems;
  if (!/<script[^>]+src=["'][^"']*content\/ledger\.js["']/.test(popupHtml)) {
    problems++;
    console.log("✗ popup.html 没有加载 content/ledger.js，弹窗里的台账会读不到数据");
  }
  if (!js.includes("content/ledger.js")) {
    problems++;
    console.log("✗ manifest 的 content_scripts 缺少 content/ledger.js");
  }
  if (problems === before) console.log("✓ ledger.js 在弹窗与内容脚本两边都已加载");
}

// HUD 的 Shadow DOM 样式里必须有 [hidden] 兜底。
// 踩过的坑：.report / .modal / .pick-bar 都声明了 display:flex，而浏览器默认的
// [hidden]{display:none} 属于 UA 样式表，会被作者样式无条件覆盖 —— 于是
// el.hidden = true 完全失效，表现为「点右上角的叉关不掉」「点选面板弹出来收不回去」。
// 这类问题只看 JS 是发现不了的，静态检查在这里拦一道。
{
  const hud = read("content/hud.js");
  const before = problems;
  if (!/\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(hud)) {
    problems++;
    console.log("✗ content/hud.js 的样式里没有 [hidden]{display:none} 兜底。" +
      "只要有任何面板声明了 display，它的 el.hidden = true 就会静默失效（关不掉的浮层）");
  }
  // 统计有多少个元素靠 .hidden 控制显隐，改动时可据此判断影响面
  const controlled = new Set();
  const re = /([A-Za-z_$][\w$]*)\s*\.\s*hidden\s*=/g;
  let mm;
  while ((mm = re.exec(hud))) controlled.add(mm[1]);
  if (problems === before) {
    console.log("✓ HUD 有 [hidden] 兜底（" + controlled.size + " 个元素靠 hidden 控制显隐，不会静默失效）");
  }
}

// 简历导入通路的两条硬约束。
// 踩过的坑：按扩展名分派 → 非 .docx/.pdf 一律 reader.readAsText()。readAsText 不带
// 编码参数时按 UTF-8 读，而 Windows 中文环境导出的 txt 多是 ANSI(GBK)，于是整篇
// 变成「一屏方块 + 零星怪符号」，而且无论读出什么都会照样塞进输入框。
// 分支层面看不出问题，静态检查在这里拦一道。
{
  const js = read("popup/popup.js");
  const fp = read("popup/fileparse.js");
  const before = problems;

  if (!/JIANLI_FILEPARSE\s*\.\s*extract\s*\(/.test(js)) {
    problems++;
    console.log("✗ popup.js 的文件导入没有走 JIANLI_FILEPARSE.extract()。" +
      "按扩展名分派 + readAsText() 会把 GBK 编码的 txt 读成乱码");
  }
  if (!/readAsArrayBuffer\s*\(/.test(js)) {
    problems++;
    console.log("✗ popup.js 的文件导入没有用 readAsArrayBuffer() —— 拿不到原始字节就没法嗅探编码");
  }
  if (/#resumeText"\)\s*\.value\s*=\s*reader\.result/.test(js)) {
    problems++;
    console.log("✗ popup.js 把 FileReader 的原始结果直接写进了简历文本框，绕过了乱码体检");
  }
  for (const fn of ["extract", "textHealth", "decodeText", "sniffKind"]) {
    if (!new RegExp("function\\s+" + fn + "\\s*\\(").test(fp)) {
      problems++;
      console.log(`✗ popup/fileparse.js 缺少 ${fn}()，导入链路会退化成「读啥用啥」`);
    }
  }
  if (!/textHealth\s*\(\s*text\s*\)/.test(fp)) {
    problems++;
    console.log("✗ popup/fileparse.js 的 extract() 没有对解析结果做乱码体检");
  }
  if (problems === before) {
    console.log("✓ 简历导入走「魔数判格式 + 编码嗅探 + 乱码体检」（不会再把 txt 读成乱码后直接填进去）");
  }
}

// 家庭情况块的硬约束。
// 踩过的坑：家庭成员的「姓名」「电话」与本人的标签一模一样。主表单的识别是
// 全页扫关键词 + 按标签打分，只要这些框参与匹配，父亲的姓名框就会被填成你自己的名字，
// 而且主表单先填、经历块填在后，被占住的框再也改不回来。
// 解法是给整块打 exclusive 标记，把它从主表单的候选里摘出去。
{
  const sites = read("content/sites.js");
  const blocks = read("content/blocks.js");
  const content = read("content/content.js");
  const defs = read("defaults.js");
  const before = problems;

  const famBlock = sites.match(/family\s*:\s*\{[\s\S]*?\n    \}/);
  if (!famBlock) {
    problems++;
    console.log("✗ content/sites.js 里没有 family 块定义，家庭情况永远不会被填");
  } else {
    if (!/exclusive\s*:\s*true/.test(famBlock[0])) {
      problems++;
      console.log("✗ content/sites.js 的 family 块没有 exclusive 标记。" +
        "家庭成员的「姓名」「电话」会被主表单抢填成你自己的（父亲姓名变成张三）");
    }
    for (const k of ["name", "relation", "company", "age", "phone"]) {
      if (!new RegExp("key\\s*:\\s*\"" + k + "\"").test(famBlock[0])) {
        problems++;
        console.log(`✗ family 块缺少 ${k} 字段（弹窗里编辑不到，页面上也填不了）`);
      }
    }
  }
  if (!/family\s*:\s*\[\s*\]/.test(defs)) {
    problems++;
    console.log("✗ defaults.js 的 blocks 里没有 family: []，新装用户会缺这一块");
  }
  if (!/function\s+exclusiveAreas\s*\(/.test(blocks) || !/\bexclusiveAreas\s*,/.test(blocks)) {
    problems++;
    console.log("✗ content/blocks.js 没有导出 exclusiveAreas()，主表单不会避开家庭情况区");
  }
  // 这条防的是「提示文字被当成添加按钮」：findAddButton 只看「文字含添加 + 够短」，
  // 而「如需添加更多成员请联系 HR」完全符合。不校验按钮位置的话，
  // 顺着它向上找到的容器会涨到整张表单，反过来把主表单的框全部排除。
  if (!/bySection\.contains\(btn\)/.test(blocks)) {
    problems++;
    console.log("✗ content/blocks.js 的 locateArea() 不再校验「添加」按钮的位置。" +
      "页面上的提示文字会被当成增行按钮，把整张表单都当成该区块");
  }
  if (!/BLOCKS\s*&&\s*BLOCKS\.exclusiveAreas/.test(content)) {
    problems++;
    console.log("✗ content/content.js 没有读 blocks.js 的 exclusiveAreas()，独占区形同虚设");
  }
  if (!/exclusiveAreas\s*\(\s*\)[\s\S]{0,400}?candidates\s*=\s*candidates\.filter/.test(content)) {
    problems++;
    console.log("✗ content/content.js 的 buildPlan() 没有把独占区从候选里过滤掉");
  }
  if (problems === before) {
    console.log("✓ 家庭情况整块独占（成员姓名/电话不会被本人的抢填，字段齐全）");
  }
}

console.log("\n=== 测试页 ===");
for (const f of fs.readdirSync(path.join(ROOT, "test")).filter(x => x.endsWith(".html"))) {
  const rel = "test/" + f;
  checkSelfContained(f, rel);
  checkAssets(f, rel);
}

console.log("\n=== manifest 声明的文件是否存在 ===");
for (const mf of ["manifest.json", "manifest.firefox.json"]) {
  const mfPath = path.join(ROOT, mf);
  if (!fs.existsSync(mfPath)) { console.log(`  ! 缺少 ${mf}`); continue; }
  const m = JSON.parse(fs.readFileSync(mfPath, "utf8"));
  const files = [];
  if (m.background && m.background.service_worker) files.push(m.background.service_worker);
  if (m.background && m.background.scripts) files.push(...m.background.scripts);
  if (m.action && m.action.default_popup) files.push(m.action.default_popup);
  (m.content_scripts || []).forEach(cs => files.push(...(cs.js || [])));
  if (m.icons) files.push(...Object.values(m.icons));
  const missing = files.filter(f => !f.startsWith("*") && !fs.existsSync(path.join(ROOT, f)) && !optionalFileOk(f));
  if (missing.length) { problems += missing.length; console.log(`✗ ${mf}：声明了不存在的文件`); missing.forEach(x => console.log("    " + x)); }
  else console.log(`✓ ${mf}：声明的 ${files.length} 个文件全部存在` + (files.some(f => optionalFileOk(f)) ? "（user-defaults.js 为可选的个人数据文件，已略过）" : ""));
}

// 检查 manifest 声明的 content_scripts 顺序
// （lexicon → matcher → sites → widgets → blocks → memory → infer → ledger → hud → content）
// 每个模块都依赖前一个模块挂在 window 上的全局对象，顺序错了会直接 undefined
{
  const m = JSON.parse(read("manifest.json"));
  const js = (m.content_scripts && m.content_scripts[0] && m.content_scripts[0].js) || [];
  const need = ["content/lexicon.js", "content/matcher.js", "content/sites.js", "content/widgets.js", "content/blocks.js", "content/memory.js", "content/infer.js", "content/ledger.js", "content/hud.js", "content/content.js"];
  const idx = need.map(n => js.indexOf(n));
  const okOrder = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
  const extra = js.filter(f => !need.includes(f));
  if (okOrder && !extra.length) {
    console.log("✓ content_scripts 加载顺序正确（lexicon → matcher → sites → widgets → blocks → memory → infer → ledger → hud → content）");
  } else {
    problems++;
    console.log("✗ content_scripts 加载顺序不对：" + JSON.stringify(js) + (extra.length ? "（未登记的文件：" + extra.join(", ") + "）" : ""));
  }

  // background.js 里注入用的文件清单必须和 manifest 一致，否则弹窗触发注入时会缺模块
  const bg = read("background.js");
  const cm = bg.match(/const CONTENT_FILES\s*=\s*\[([\s\S]*?)\]/);
  const bgFiles = cm ? (cm[1].match(/"[^"]+"/g) || []).map(x => x.slice(1, -1)) : [];
  if (JSON.stringify(bgFiles) === JSON.stringify(js)) {
    console.log("✓ background.js 的 CONTENT_FILES 与 manifest 一致");
  } else {
    problems++;
    console.log("✗ background.js 的 CONTENT_FILES 与 manifest 不一致：" + JSON.stringify(bgFiles));
  }

  // 两份 manifest 的 content_scripts 必须一致，否则 Firefox 构建会缺模块
  const fm = JSON.parse(read("manifest.firefox.json"));
  const fjs = (fm.content_scripts && fm.content_scripts[0] && fm.content_scripts[0].js) || [];
  if (JSON.stringify(js) === JSON.stringify(fjs)) console.log("✓ manifest.json 与 manifest.firefox.json 的 content_scripts 一致");
  else { problems++; console.log("✗ 两份 manifest 的 content_scripts 不一致：" + JSON.stringify(fjs)); }
}

// profiles.js 是弹窗与背景页共用的方案模块，两个入口都必须加载它，
// 否则一边写方案、另一边读不到，切换方案会表现成「改了没生效」
{
  const popupHtml = read("popup/popup.html");
  const fm = JSON.parse(read("manifest.firefox.json"));
  const chromeBg = read("background.js");
  const problemsBefore = problems;

  if (!/<script[^>]+src=["'][^"']*profiles\.js["']/.test(popupHtml)) {
    problems++;
    console.log("✗ popup.html 没有加载 profiles.js，弹窗里的方案管理会失效");
  }
  if (!(fm.background && fm.background.scripts || []).includes("profiles.js")) {
    problems++;
    console.log("✗ manifest.firefox.json 的 background.scripts 缺少 profiles.js");
  }
  if (!/importScripts\(\s*["']profiles\.js["']\s*\)/.test(chromeBg)) {
    problems++;
    console.log("✗ background.js 没有 importScripts(\"profiles.js\")");
  }
  if (problems === problemsBefore) console.log("✓ profiles.js 在弹窗与背景页两边都已加载");
}

// 选项匹配必须统一走 content/matcher.js。
// 四处调用点（原生下拉 / 单选组 / 组件下拉 / 级联）只要漏掉一处，
// 就会出现「词表加了词，但某个控件还是按老算法匹配」这种半生效状态 —— 很难发现。
{
  const before = problems;
  const contentJs = read("content/content.js");
  const widgetsJs = read("content/widgets.js");
  const matcherJs = read("content/matcher.js");

  if (contentJs.indexOf("JIANLI_MATCHER") < 0) {
    problems++;
    console.log("✗ content.js 没有引用 JIANLI_MATCHER，原生下拉和单选组会用不上同义词表");
  }
  if (widgetsJs.indexOf("JIANLI_MATCHER") < 0) {
    problems++;
    console.log("✗ widgets.js 没有引用 JIANLI_MATCHER，组件型下拉会绕过统一匹配");
  }
  if (!/fillSelect\s*\([^)]*\)[\s\S]{0,600}MATCHER\.pick/.test(contentJs)) {
    problems++;
    console.log("✗ content.js 的 fillSelect 没有走 MATCHER.pick");
  }
  if (!/fillRadioGroup\s*\([^)]*\)[\s\S]{0,800}MATCHER\.pick/.test(contentJs)) {
    problems++;
    console.log("✗ content.js 的 fillRadioGroup 没有走 MATCHER.pick");
  }
  if (!/findBestOption\s*\([^)]*\)[\s\S]{0,600}MATCHER\.pick/.test(widgetsJs)) {
    problems++;
    console.log("✗ widgets.js 的 findBestOption 没有走 MATCHER.pick");
  }
  // 阈值必须存在，否则弱包含（40 分）也会被采用，等于没有「宁可空着」的保护
  if (!/MIN_SCORE\s*=\s*\d+/.test(matcherJs)) {
    problems++;
    console.log("✗ matcher.js 里找不到 MIN_SCORE 阈值");
  }
  if (!/negations/.test(read("content/lexicon.js"))) {
    problems++;
    console.log("✗ lexicon.js 里找不到否定词表（非全日制那类陷阱靠它拦住）");
  }
  if (problems === before) console.log("✓ 选项匹配的四个调用点已统一走 matcher.js（含阈值与否定词保护）");
}

console.log("\n" + (problems ? `发现 ${problems} 个问题` : "全部检查通过，没有发现问题"));
process.exit(problems ? 1 : 0);
