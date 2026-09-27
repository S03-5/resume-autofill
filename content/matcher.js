// ============================================================
// 统一选项匹配器（纯函数，零 DOM 依赖）
//
// 解决的三个问题：
//   1. 同义不同形    简历「CET-6」 vs 页面「英语六级」
//   2. 否定词陷阱    简历「全日制本科」 vs 页面「非全日制本科」← 最危险，会静默选错
//   3. 各控件各算各的 原生下拉 / 组件下拉 / 单选组 / 级联 四份算法合并成这一份
//
// 核心原则：**宁可不填，不能选错。**
// 低于阈值的候选一律返回 null，调用方留空并在战报里说明原因。
//
// 对外接口：
//   MATCHER.pick(值, 选项数组, 字段key, 取文本函数)  → 选中项 | null
//   MATCHER.score(值, 选项文本, 字段key)             → { score, layer, reason } | null
//   MATCHER.normalize(字符串)                        → 归一化后的字符串
//   MATCHER.explain(值, 选项数组, 字段key, 取文本函数) → 全部候选的评分明细（给战报用）
// ============================================================
(function () {
  if (window.__JIANLI_MATCHER__) return;
  window.__JIANLI_MATCHER__ = true;

  const LEX = window.JIANLI_LEXICON || {
    negations: [], placeholders: [], decorators: [], general: [], fields: {}
  };

  // 低于这个分数就不填。60 = 包含匹配的下限，40 = 弱包含，被这条线挡在外面。
  const MIN_SCORE = 55;

  // 只看「省/市」后缀的字段：这些字段的词表不用穷举城市名
  const REGION_FIELDS = ["city", "hometown", "current_residence"];

  // ---------- 归一化 ----------

  const PUNCT_MAP = {
    "\u3002": ".", "\u3001": ",", "\u300a": "<", "\u300b": ">",
    "\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'",
    "\u2014": "-", "\u2013": "-", "\u2026": "..."
  };

  // 全角转半角 + 去空白 + 去首尾装饰符号 + 小写
  function normalize(s) {
    if (s == null) return "";
    let t = String(s);
    // 全角 → 半角（含全角括号、全角斜杠、全角减号）
    t = t.replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    // 全角空格 / 不换行空格 / em space 等统一成普通空格
    t = t.replace(/[\u3000\u00a0\u2000-\u200d\u202f\u205f\ufeff]/g, " ");
    t = t.replace(/[\u3002\u3001\u300a\u300b\u201c\u201d\u2018\u2019\u2014\u2013\u2026]/g, m => PUNCT_MAP[m] || m);
    t = t.replace(/\s+/g, "");
    t = t.replace(/^[-_*=+~]+|[-_*=+~]+$/g, "");
    return t.toLowerCase();
  }

  // 日期归一：2005年5月 / 2005/05 / 2005-5-1 → 2005-5 / 2005-5-1
  function canonDate(s) {
    const t = String(s || "").replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, "");
    const m = t.match(/^(\d{4})-?(\d{1,2})?-?(\d{1,2})?$/);
    if (!m) return "";
    let out = m[1];
    if (m[2]) out += "-" + Number(m[2]);
    if (m[3]) out += "-" + Number(m[3]);
    return out;
  }

  function stripBrackets(s) {
    return String(s == null ? "" : s).replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "");
  }

  function bracketInner(s) {
    const out = [];
    const re = /[（(【\[]([^）)】\]]*)[）)】\]]/g;
    let m;
    while ((m = re.exec(String(s == null ? "" : s)))) {
      if (m[1] && m[1].trim()) out.push(m[1]);
    }
    return out;
  }

  // 一个字符串的多种「可比较形态」：本体、去括号、括号内容、日期归一形态。
  // 「英语六级（CET-6）」→ [英语六级(cet-6), 英语六级, cet-6]
  function variants(s) {
    const out = [];
    const push = v => { if (v && out.indexOf(v) < 0) out.push(v); };
    push(normalize(s));
    push(normalize(stripBrackets(s)));
    bracketInner(s).forEach(x => push(normalize(x)));
    const d = canonDate(normalize(s));
    if (d) push(d);
    return out;
  }

  // ---------- 否定词 ----------

  const NEG = (LEX.negations || []).slice().sort((a, b) => b.length - a.length);

  // 去掉否定词；返回原串表示没否定词
  function stripNeg(s) {
    for (const n of NEG) {
      if (s.length > n.length && s.indexOf(n) === 0) return s.slice(n.length);
    }
    return s;
  }

  // 去掉否定词后核心仍相同 → 语义相反
  function negConflict(v, o) {
    const vc = stripNeg(v), oc = stripNeg(o);
    const vh = vc !== v, oh = oc !== o;
    if (vh === oh) return false;             // 两边都有 / 都没有否定词，不算冲突
    if (!vc || !oc) return false;
    if (vc === oc) return true;
    if (vc.length >= 2 && oc.length >= 2 && (vc.indexOf(oc) >= 0 || oc.indexOf(vc) >= 0)) return true;
    return false;
  }

  // ---------- 占位符 ----------

  const PLACEHOLDERS = (LEX.placeholders || []).map(normalize);

  function isPlaceholder(o) {
    if (!o) return true;
    if (PLACEHOLDERS.indexOf(o) >= 0) return true;
    // 「请选择」「请选择你的学历」这类前缀
    if (/^请选择|^请输入|^--请选择/.test(o)) return true;
    return false;
  }

  // ---------- 修饰词 / 单位 / 地名后缀 ----------

  const DECORATORS = LEX.decorators || [];

  function simplify(s) {
    let t = s;
    for (const d of DECORATORS) t = t.split(d).join("");
    // 只在数字后面剥单位，避免把「评分」「分析」这类词拆坏
    t = t.replace(/(\d)(cm|厘米|kg|千克|公斤|周岁|岁|元|天|小时|分钟|个月|分|次|名|人|月|年|日)$/, "$1");
    return t;
  }

  function stripRegion(s) {
    const t = s.replace(/(省|特别行政区|自治区|自治州|市|地区|盟|县|区)$/, "");
    return t.length >= 2 ? t : s;
  }

  // ---------- 数值 / 区间 ----------

  const RANGE_RE = /(\d+(?:\.\d+)?)\s*[-~至到]\s*(\d+(?:\.\d+)?)/;

  function numsOf(s) {
    const out = [];
    const re = /\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(s))) out.push(Number(m[0]));
    return out;
  }

  function numericHit(v, o) {
    const rv = v.match(RANGE_RE);
    const ro = o.match(RANGE_RE);
    const nv = numsOf(v), no = numsOf(o);
    if (!nv.length || !no.length) return false;
    if (!rv && ro && nv.length === 1) return nv[0] >= Number(ro[1]) && nv[0] <= Number(ro[2]);
    if (rv && !ro && no.length === 1) return no[0] >= Number(rv[1]) && no[0] <= Number(rv[2]);
    if (nv.length === 1 && no.length === 1) return nv[0] === no[0];
    return false;
  }

  // ---------- 同义词组索引 ----------

  const idxCache = Object.create(null);

  function indexFor(fieldKey) {
    const key = fieldKey || "";
    if (idxCache[key]) return idxCache[key];
    const idx = Object.create(null);
    const add = (groups, prefix) => {
      (groups || []).forEach((g, gi) => {
        (g || []).forEach(word => {
          const k = normalize(word);
          if (k && !(k in idx)) idx[k] = prefix + "#" + gi;
        });
      });
    };
    add(LEX.general, "g");
    add((LEX.fields || {})[key], key);
    idxCache[key] = idx;
    return idx;
  }

  function groupsOf(vars, idx) {
    const set = [];
    for (const v of vars) {
      const g = idx[v];
      if (g && set.indexOf(g) < 0) set.push(g);
    }
    return set;
  }

  // ---------- 打分 ----------

  // 年份口径：应届生指的是「还没毕业的下一届」。
  // 2026 年秋招时，2027届 = 应届，2026届 = 往届。
  let NOW_YEAR = new Date().getFullYear();
  function setNowYear(y) { NOW_YEAR = Number(y) || NOW_YEAR; }

  function hit(score, layer, reason) { return { score: score, layer: layer, reason: reason }; }

  function score(value, optionText, fieldKey) {
    const oRaw = String(optionText == null ? "" : optionText);
    const O = variants(oRaw);
    if (!O.length) return null;
    const ob = O[0];
    if (!ob || ob.length > 40) return null;      // 过长的多半是容器文本，不是选项
    if (isPlaceholder(ob)) return null;

    const V = variants(value);
    if (!V.length) return null;
    const vb = V[0];
    if (!vb) return null;

    // 1. 完全相同
    if (vb === ob) return hit(100, "exact", "完全相同");

    // 2. 否定词冲突 —— 直接判死，不参与竞争
    if (negConflict(vb, ob)) return hit(0, "negation", "含否定词，语义相反");

    // 3. 同义词表
    const idx = indexFor(fieldKey);
    const vg = groupsOf(V, idx), og = groupsOf(O, idx);
    for (const g of vg) if (og.indexOf(g) >= 0) return hit(90, "synonym", "同义写法");

    // 4. 别名（括号内写法）：英语四级（CET-4） ↔ CET-4
    for (const a of V) {
      for (const b of O) {
        if (a === b) return hit(88, "alias", "别名写法一致");
      }
    }

    // 5. 剥掉修饰词后相同：本科及以上 ↔ 本科
    const vs = simplify(vb), os = simplify(ob);
    if (vs && os && vs === os) return hit(80, "stripped", "去掉修饰词后一致");

    // 5.5 地名去掉「省/市」后缀后相同：北京 ↔ 北京市
    if (REGION_FIELDS.indexOf(fieldKey) >= 0) {
      const vr = stripRegion(vs), or = stripRegion(os);
      if (vr && or && vr === or) return hit(80, "region", "地名后缀不同，实为同一地");
    }

    // 6. 日期同一天：2005-05 ↔ 2005年5月
    const vd = canonDate(vb), od = canonDate(ob);
    if (vd && od && vd === od) return hit(78, "date", "日期写法不同但同一天");

    // 7. 数值 / 区间命中：175 ↔ 170-175cm
    if (numericHit(vs, os)) return hit(75, "numeric", "数值或区间命中");

    // 8. 毕业年份判定应届/往届：简历「应届」 ↔ 选项「2027届」
    if (fieldKey === "graduate_status") {
      const ym = ob.match(/^(\d{4})届(?:毕业生|生)?$/);
      if (ym) {
        const y = Number(ym[1]);
        const isFresh = y >= NOW_YEAR + 1;
        if (isFresh && /应届|在校/.test(vb)) return hit(72, "grade-year", "按毕业年份判定为应届");
        if (!isFresh && /往届|已毕业|非应届/.test(vb)) return hit(72, "grade-year", "按毕业年份判定为往届");
      }
    }

    // 9. 年份前缀：简历「2027」 ↔ 选项「2027年6月」
    if (/^\d{4}$/.test(vs) && os.length > vs.length && os.indexOf(vs) === 0) {
      return hit(70, "year-prefix", "年份前缀一致");
    }

    // 10. 包含匹配。单字值不做包含（「是」会被「所有」误中）
    if (vb.length >= 2) {
      if (ob.indexOf(vb) >= 0) {
        const r = vb.length / ob.length;
        return r >= 0.6 ? hit(60, "contain", "选项包含简历值")
          : hit(40, "contain-weak", "包含关系太弱（选项比简历值长太多）");
      }
      if (vb.indexOf(ob) >= 0) {
        const r = ob.length / vb.length;
        return r >= 0.6 ? hit(60, "contain", "简历值包含选项")
          : hit(40, "contain-weak", "包含关系太弱（简历值比选项长太多）");
      }
    }

    return null;
  }

  // ---------- 选项文本提取 ----------

  // 取文本函数可以返回字符串，也可以返回字符串数组（一个元素有多个候选文本时取最高分）
  function textsOf(item, textOf) {
    if (!textOf) {
      if (typeof item === "string") return [item];
      if (item && typeof item.text === "string") return [item.text];
      if (item == null) return [];
      return [String(item)];
    }
    let t;
    try { t = textOf(item); } catch (e) { return []; }
    if (Array.isArray(t)) return t.filter(x => x != null).map(String);
    return t == null ? [] : [String(t)];
  }

  function scoreItem(value, item, fieldKey, textOf) {
    let best = null;
    for (const t of textsOf(item, textOf)) {
      const r = score(value, t, fieldKey);
      if (!r) continue;
      if (!best || r.score > best.score) best = Object.assign({ text: t }, r);
    }
    return best;
  }

  // 从候选里挑一个。返回 null 表示「没有能安全填的选项」。
  function pick(value, options, fieldKey, textOf) {
    const list = Array.from(options || []);
    if (value == null || String(value).trim() === "" || !list.length) return null;

    let best = null;
    list.forEach((item, index) => {
      const r = scoreItem(value, item, fieldKey, textOf);
      if (!r || r.score < MIN_SCORE) return;
      const len = normalize(r.text).length;
      // 同分取更短的选项：更短的一般更精确（「本科」优于「全日制本科（含专升本）」）
      if (!best || r.score > best.score || (r.score === best.score && len < best.len)) {
        best = { item: item, text: r.text, index: index, score: r.score, layer: r.layer, reason: r.reason, len: len };
      }
    });
    if (!best) return null;
    delete best.len;
    return best;
  }

  // 给战报用：列出每个选项的评分明细，让用户看得见「为什么不填」
  function explain(value, options, fieldKey, textOf) {
    return Array.from(options || []).map((item, index) => {
      const r = scoreItem(value, item, fieldKey, textOf);
      return {
        index: index,
        item: item,
        text: r ? r.text : textsOf(item, textOf)[0] || "",
        score: r ? r.score : 0,
        layer: r ? r.layer : "none",
        reason: r ? r.reason : "对不上",
        usable: !!r && r.score >= MIN_SCORE
      };
    });
  }

  // 把选项列表拼成一行给战报显示
  function describeOptions(options, textOf, limit) {
    const max = limit || 12;
    const list = Array.from(options || []).map(x => (textsOf(x, textOf)[0] || "").trim()).filter(Boolean);
    const uniq = [];
    for (const t of list) if (uniq.indexOf(t) < 0) uniq.push(t);
    if (!uniq.length) return "";
    if (uniq.length <= max) return uniq.join(" / ");
    return uniq.slice(0, max).join(" / ") + " 等 " + uniq.length + " 项";
  }

  window.JIANLI_MATCHER = {
    MIN_SCORE: MIN_SCORE,
    normalize: normalize,
    variants: variants,
    canonDate: canonDate,
    simplify: simplify,
    score: score,
    pick: pick,
    explain: explain,
    describeOptions: describeOptions,
    setNowYear: setNowYear,
    _internal: { negConflict, stripNeg, numericHit, stripRegion, indexFor }
  };
})();
