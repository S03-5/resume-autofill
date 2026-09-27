// ============================================================
// 重复经历块 + 简历附件上传
// 校招站点把「教育 / 实习 / 项目 / 工作经历」做成可增删的重复表单：
// 需要先点「+ 添加」补出行数，再逐行填入不同内容。
// 附件上传则需要把弹窗里存好的简历文件塞进 type=file 的输入框。
// ============================================================
(function () {
  if (window.__JIANLI_BLOCKS__) return;
  window.__JIANLI_BLOCKS__ = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- 块定义 ----------
  // 统一取自 content/sites.js 的 JIANLI_BLOCK_DEFS（与插件弹窗的编辑界面共用同一份定义）
  const BLOCK_DEFS = window.JIANLI_BLOCK_DEFS || {};

  // ---------- 通用工具 ----------

  function textOf(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").trim();
  }

  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function realClick(el) {
    if (!el) return;
    const o = { bubbles: true, cancelable: true, view: window, composed: true };
    try {
      el.dispatchEvent(new MouseEvent("mousedown", o));
      el.dispatchEvent(new MouseEvent("mouseup", o));
      el.dispatchEvent(new MouseEvent("click", o));
    } catch (e) { /* ignore */ }
  }

  const CONTROL_SEL = 'input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]):not([type="submit"]):not([type="button"]), textarea, select';

  function controlCount(el) {
    try { return el.querySelectorAll(CONTROL_SEL).length; } catch (e) { return 0; }
  }

  // ---------- 定位「添加」按钮与区块容器 ----------

  const ADD_TEXT_RE = /(添加|新增|继续添加|再加一条|加一条|新增一条|\+)/;

  function findAddButton(def) {
    const kw = new RegExp(def.keyWord);
    const strong = new RegExp(def.sectionWords.join("|"));
    const cands = [];
    for (const el of document.querySelectorAll("button, a, [role='button'], span, div, i")) {
      const t = textOf(el);
      if (!t || t.length > 24) continue;
      if (!ADD_TEXT_RE.test(t)) continue;
      if (el.querySelector("input, textarea, select")) continue;
      const isStrong = strong.test(t) || kw.test(t);
      cands.push({ el, score: isStrong ? 2 : 1 });
    }
    cands.sort((a, b) => b.score - a.score);
    return cands.length ? cands[0].el : null;
  }

  function findArea(btn, def) {
    const strong = new RegExp(def.sectionWords.join("|"));
    let node = btn.parentElement, depth = 0, fallback = null;
    while (node && depth < 8) {
      if (controlCount(node) >= def.minControls) {
        if (!fallback) fallback = node;
        const t = textOf(node);
        if (t.length < 4000 && strong.test(t)) return node;
      }
      node = node.parentElement;
      depth++;
    }
    return fallback;
  }

  // 没有「添加」按钮时的区块定位。
  // 「家庭情况」这类区块只有一组固定表单、页面不存在增行按钮，原先会整个块放弃填充。
  // 改按区块标题反查容器：
  //   1. 找文字恰好等于区块标题的短元素（h3 / legend / span / div…）
  //   2. 它的下一个兄弟就是表单容器 → 直接用（最常见）
  //   3. 否则向上找「控件数最少且达标」的祖先，而不是最外层 ——
  //      一路吃到 body 的话 findRows 会把别的区块的行也挑进来
  // 注意这里不能用 textOf()：它优先取 innerText，遍历上千个元素会反复触发重排。
  const SECTION_TITLE_SEL = "h1,h2,h3,h4,h5,h6,legend,label,span,div,p,td,th,strong,b,dt,em";

  function rawText(el) {
    return el ? (el.textContent || "").trim() : "";
  }

  function findAreaBySection(def) {
    if (!document.body) return null;
    // 快速短路：整页文字里连关键词都没有就不必逐个元素扫
    if (!new RegExp(def.keyWord).test(document.body.textContent || "")) return null;

    const exact = new RegExp("^[\\s*＊]*(" + def.sectionWords.join("|") + ")[\\s:：]*$");
    let best = null, bestCount = Infinity;

    for (const el of document.querySelectorAll(SECTION_TITLE_SEL)) {
      const t = rawText(el);
      if (!t || t.length > 14) continue;
      if (!exact.test(t)) continue;

      const sib = el.nextElementSibling;
      if (sib) {
        const c = controlCount(sib);
        if (c >= def.minControls && c < bestCount) { best = sib; bestCount = c; continue; }
      }

      let node = el.parentElement, depth = 0;
      while (node && depth < 8) {
        const c = controlCount(node);
        if (c >= def.minControls) {
          if (c < bestCount) { best = node; bestCount = c; }
          break;
        }
        node = node.parentElement;
        depth++;
      }
    }
    return best;
  }

  // 定位一个块的「填写区」。返回 { area, btn }，area 为 null 表示没找着。
  // 先按「添加」按钮找，找不到或按钮不可信时按区块标题找。
  //
  // ⚠ 为什么必须验证按钮：findAddButton 的判定是「文字含『添加』且够短」，
  // 页面上常见的提示语（「如需添加更多成员请联系 HR」）完全符合，
  // 而顺着这种假按钮向上找容器会一路吃到整个表单甚至 body ——
  // 于是整页的框都变成「这个块的」，主表单反倒什么都填不上。
  function locateArea(def) {
    let btn = findAddButton(def);
    const bySection = findAreaBySection(def);

    // 独占块（家庭情况）只认标题定位：页面上根本没有这一栏时（绝大多数表单都是如此）
    // 直接判定为「没有」，不走按钮兜底。
    // 兜底的后果是实测出来的：findAddButton 会把页面上任意含「添加」的短文本当成按钮，
    // 而 findArea 从它向上找容器时，因为页面上没有「家庭情况」字样会一路返回 body ——
    // 于是整页的框都成了「家庭成员的」，别人的姓名框被填成家人的姓名，
    // 主表单的候选还被反过来全部排除掉（填了 0 个）。
    if (def.exclusive && !bySection) return { area: null, btn: null };

    if (btn && bySection) {
      // exclusive 的块要求更严：按钮必须就在区块容器内部。
      // 放宽到「父级里也算」的话，同一张表单里别处的提示文字
      //（如「如需添加更多成员请联系 HR」）就会被当成按钮。
      const near = def.exclusive
        ? bySection.contains(btn)
        : (bySection.contains(btn) || (bySection.parentElement && bySection.parentElement.contains(btn)));
      if (!near) btn = null;
    }
    // 独占块的填写区就取标题容器本身；其余块保持「按钮优先」，行为不变
    const area = def.exclusive
      ? bySection
      : ((btn ? findArea(btn, def) : null) || bySection);
    return { area, btn };
  }

  // 标记了 exclusive 的经历块区域。content.js 会把这些区域内的控件从主表单识别里排除，
  // 避免同名标签串味：家庭情况里的「姓名」若参与主表单匹配，会被填成你自己的名字。
  // 只处理 exclusive 的块 —— 教育/实习/项目/工作区的学校、专业等历史上也由主表单填，
  // 一并排除会退化（用户只填了主表单、没填经历块时那些框就空了）。
  function exclusiveAreas() {
    const out = [];
    const total = document.querySelectorAll(CONTROL_SEL).length;
    for (const key of Object.keys(BLOCK_DEFS)) {
      const def = BLOCK_DEFS[key];
      if (!def || !def.exclusive) continue;
      const located = locateArea(def);
      const area = located.area;
      if (!area) continue;
      // 两道自保：定位到了根元素，或圈住了页面上绝大多数控件，都说明没找准。
      // 此时宁可放弃排除、退回旧行为，也不能让主表单大面积失效（整页一个框都填不上）。
      // 注意不能给 total 设下限 —— 只有 5 个框的小页面恰恰最容易被整页吞掉。
      if (area === document.body || area === document.documentElement) continue;
      if (total > 0 && controlCount(area) >= total * 0.7) continue;
      out.push(area);
    }
    return out;
  }

  function depthOf(el) {
    let d = 0, n = el;
    while (n && n !== document.documentElement) { n = n.parentElement; d++; }
    return d;
  }

  // 从区块里找出「一行」的容器：含 ≥2 个控件、类名像条目、且有同构兄弟
  function findRows(area) {
    if (!area) return [];
    const buckets = new Map();
    for (const el of area.querySelectorAll("*")) {
      if (controlCount(el) < 2) continue;
      const cls = typeof el.className === "string" ? el.className : "";
      if (!/item|row|card|block|record|list|panel|group|section|entry/i.test(cls)) continue;
      const p = el.parentElement;
      if (!p) continue;
      if (!buckets.has(p)) buckets.set(p, []);
      buckets.get(p).push(el);
    }

    // 选「同父兄弟最多」的那一组；同分时取层级更深的，避免把外层容器当成行
    let best = [];
    let bestDepth = -1;
    for (const [parent, arr] of buckets) {
      const d = depthOf(parent);
      if (arr.length > best.length || (arr.length === best.length && d > bestDepth)) {
        best = arr;
        bestDepth = d;
      }
    }

    if (best.length) {
      return best.filter(a => !best.some(b => b !== a && b.contains(a)));
    }
    // 兜底：直接子级里含 ≥2 个控件的
    const kids = Array.from(area.children).filter(c => controlCount(c) >= 2);
    return kids;
  }

  // ---------- 主流程 ----------

  // blocksData: { education: [...], internship: [...], project: [...], work: [...] }
  // api: { matchIn(rootEl, keywords) -> element|null, fill(el, value) -> {ok, reason} }
  async function fillBlocks(blocksData, api, options) {
    const results = [];
    if (!blocksData || !api) return results;

    for (const key of Object.keys(BLOCK_DEFS)) {
      const list = blocksData[key];
      if (!Array.isArray(list) || !list.length) continue;
      const def = BLOCK_DEFS[key];

      const located = locateArea(def);
      const btn = located.btn;
      const area = located.area;
      if (!area) {
        // 独占块（家庭情况）在页面上找不到这一栏时静默跳过：
        // 绝大多数表单根本没有家庭情况，报一条「没找到」只会给战报添噪音
        if (!def.exclusive) {
          results.push({ block: key, label: def.label, ok: false, reason: "页面上没找到该经历的填写区" });
        }
        continue;
      }

      // 1. 补足行数
      let rows = findRows(area);
      let guard = 0;
      while (rows.length < list.length && btn && guard < 6) {
        const before = rows.length;
        realClick(btn);
        await sleep(320);
        const next = findRows(area);
        if (next.length <= before) break;   // 点了没长出新行，停止避免死循环
        rows = next;
        guard++;
      }

      // 单成员区块（家庭情况）的字段是平铺的，不存在「一行 = 一组控件」的结构，
      // findRows 会返回空。只填一条时整块当成一行，靠块内关键词逐个定位。
      // 只对独占块放开：这类区块的容器是按标题精确定位的，范围可信；
      // 其余块 rows 为空多半是定位不准，宁可报「没解析出条目行」也不能乱填。
      if (!rows.length && list.length === 1 && def.exclusive) rows = [area];

      if (!rows.length) {
        results.push({ block: key, label: def.label, ok: false, reason: "识别到了填写区但没解析出条目行" });
        continue;
      }

      // 2. 逐行填充
      let filledRows = 0, filledFields = 0;
      const used = new Set();
      for (let i = 0; i < Math.min(list.length, rows.length); i++) {
        const row = rows[i];
        if (!row) continue;
        const item = list[i] || {};
        let rowOk = false;
        for (const f of def.fields) {
          const value = item[f.key];
          if (!value) continue;
          const el = api.matchIn(row, f.keywords, used);
          if (!el) continue;
          used.add(el);
          const r = await api.fill(el, value, f.key);
          if (r && r.ok) { rowOk = true; filledFields++; }
        }
        if (rowOk) filledRows++;
      }

      // 3. 多余的行降级：把长文本（desc）整段塞进第一个大文本框，保住信息不丢
      const rest = list.slice(rows.length);
      if (rest.length) {
        results.push({
          block: key, label: def.label, ok: filledRows > 0,
          reason: `页面上只有 ${rows.length} 行，第 ${rows.length + 1} 条起未填写`,
          filledRows, filledFields
        });
        continue;
      }

      results.push({
        block: key, label: def.label,
        ok: filledRows > 0 && filledFields > 0,
        reason: filledRows > 0 ? "" : "该区块没有匹配上任何字段",
        filledRows, filledFields
      });
    }
    return results;
  }

  // ---------- 简历附件上传 ----------

  function dataUrlToFile(att) {
    const dataUrl = att.dataUrl || "";
    const comma = dataUrl.indexOf(",");
    if (comma < 0) throw new Error("附件数据格式不对");
    const head = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const mime = (head.match(/:(.*?);/) || [])[1] || att.type || "application/octet-stream";
    const bin = atob(body);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], att.name || "resume.pdf", { type: mime });
  }

  function findFileInputs() {
    const out = [];
    let all;
    try { all = document.querySelectorAll('input[type="file"]'); } catch (e) { return out; }
    for (const input of all) {
      let near = "";
      try {
        const scope = input.closest("div,li,section,form") || input.parentElement;
        near = scope ? textOf(scope).slice(0, 200) : "";
      } catch (e) { near = ""; }
      const accept = (input.getAttribute("accept") || "").toLowerCase();
      const acceptResume = /pdf|doc|docx|word|msword|application\/pdf/.test(accept);
      const textResume = /简历|附件|上传|投递|resume|attachment/.test(near);
      let score = 0;
      if (acceptResume) score += 2;
      if (textResume) score += 1;
      if (!accept) score += 0.5;          // 没写 accept 的多半是通用上传框
      out.push({ input, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.map(o => o.input);
  }

  async function attachResume(attachment) {
    if (!attachment || !attachment.dataUrl) {
      return { ok: false, reason: "还没在插件里上传过简历附件" };
    }
    const inputs = findFileInputs();
    if (!inputs.length) return { ok: false, reason: "当前页面没有找到附件上传框" };

    let file;
    try { file = dataUrlToFile(attachment); }
    catch (e) { return { ok: false, reason: "附件解析失败：" + e.message }; }

    const tried = [];
    for (const input of inputs.slice(0, 3)) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(150);
        if (input.files && input.files.length) {
          return { ok: true, via: "input.files", name: file.name };
        }
        tried.push("input.files 已赋值但被页面清空");
      } catch (e) {
        tried.push(e.message);
      }
      // 兜底：对上传区域派发 drop 事件
      try {
        const zone = input.closest("div,section,form") || input.parentElement;
        if (zone) {
          const dt = new DataTransfer();
          dt.items.add(file);
          const o = { bubbles: true, cancelable: true, composed: true };
          zone.dispatchEvent(new DragEvent("dragenter", o));
          zone.dispatchEvent(new DragEvent("dragover", o));
          zone.dispatchEvent(new DragEvent("drop", Object.assign({ dataTransfer: dt }, o)));
          await sleep(200);
          if (input.files && input.files.length) return { ok: true, via: "drop", name: file.name };
        }
      } catch (e) { tried.push("drop 失败：" + e.message); }
    }
    return { ok: false, reason: "上传框拒绝了文件（" + (tried[0] || "未知原因") + "）" };
  }

  window.JIANLI_BLOCKS = {
    BLOCK_DEFS,
    fillBlocks,
    attachResume,
    findFileInputs,
    exclusiveAreas,
    util: { textOf, norm, realClick, findRows, findArea, findAddButton, findAreaBySection }
  };
})();
