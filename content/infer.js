// ============================================================
// 岗位与城市推断
// ------------------------------------------------------------
// 你从「BOSS直聘 - 嵌入式软件工程师 - 某某科技」这种页面点进来时，标题里其实
// 已经写清楚了这个岗位叫什么。这个模块负责把它挑出来，用于填写「期望职位」。
//
// 做法是按分隔符把标题切成几段，逐段打分：
//   命中岗位词（工程师 / 算法 / 运营…）加分，
//   命中公司词（有限公司 / 集团 / 科技…）或站点名（BOSS直聘 / 智联…）减分，
// 得分最高的那一段就是岗位名。挑不出来时返回空，宁可不填也不填错。
//
// 城市走两条路：先在标题 / 页面地点元素里找中文城市名，
// 再从 URL 里找城市拼音（/beijing/ ?city=shenzhen）。
// ============================================================
(function () {
  const G = (typeof window !== "undefined") ? window : self;

  // ---------- 词表 ----------

  // 站点名：出现在标题里一律不是岗位名
  const SITE_WORDS = [
    "boss直聘", "boss", "智联招聘", "前程无忧", "51job", "无忧工作网", "拉勾",
    "猎聘", "实习僧", "牛客", "应届生求职网", "大街网", "看准网", "脉脉",
    "moka", "北森", "beisen", "dayee", "dingtalk", "钉钉", "飞书招聘",
    "拉钩", "中华英才网", "58同城", "赶集网", "智联", "linkedin", "领英",
    "校园招聘", "社会招聘", "应届生招聘", "招聘官网", "招聘网站", "官方招聘"
  ];

  // 岗位词：命中加分
  const JOB_WORDS = [
    "工程师", "开发", "研发", "算法", "前端", "后端", "全栈", "测试", "运维",
    "数据", "产品", "运营", "设计", "视觉", "交互", "分析师", "研究员", "经理",
    "主管", "专员", "助理", "顾问", "管培生", "实习生", "见习", "技术员", "技师",
    "架构师", "科学家", "销售", "市场", "策划", "编辑", "记者", "教师", "讲师",
    "会计", "财务", "审计", "人事", "法务", "采购", "供应链", "质量管理", "工艺",
    "结构", "硬件", "嵌入式", "电气", "机械", "自动化", "单片机", "模拟", "射频",
    "通信", "网络", "安全", "解决方案", "售前", "售后", "客户", "客服", "商务",
    "投资", "风控", "合规", "临床", "医药", "生物", "化学", "材料", "质检",
    "专员", "总工", "厂长", "店长", "储备干部", "培训生", "工程", "技术",
    "b端", "c端", "hrbp", "ui", "ue", "seo", "sem", "golang", "java", "python",
    "c++", "vue", "react", "node", "android", "ios", "ai", "nlp", "cv", "llm"
  ];

  // 短英文词单独拎出来按单词边界匹配，避免 "ic" 命中 "public"、"it" 命中 "digital"
  const SHORT_WORDS = ["hr", "dba", "ic", "fpga", "soc", "pcb", "emc", "ae", "fa", "it", "qa", "qc", "pe", "ie", "me", "ee"];
  const SHORT_RES = SHORT_WORDS.map(w => new RegExp("(^|[^a-z0-9])" + w + "([^a-z0-9]|$)", "i"));

  // 公司词：命中减分（判断岗位名时）／命中加分（找公司名时）
  const COMPANY_WORDS = [
    "有限公司", "有限责任公司", "股份", "集团", "控股", "研究院", "研究所",
    "信息技术", "网络科技", "电子科技", "软件科技", "通信技术", "智能科技",
    "科技", "银行", "保险", "证券", "基金", "事务所", "大学", "学院", "医院",
    "分公司", "子公司", "总部", "事业部", "人力资源部"
  ];

  // 营销词：出现在括号里就整段丢掉
  const MKT_WORDS = [
    "急聘", "急招", "高薪", "诚聘", "热招", "招聘中", "招人", "双休", "五险一金",
    "包住", "包吃", "周末双休", "福利好", "长期招聘", "兼职", "全职", "校招",
    "社招", "内推", "加急", "new", "hot", "推荐", "精选", "热门"
  ];

  // 栏目名：整段里只要出现就基本不是岗位名
  const GENERIC_PHRASES = [
    "找工作", "求职", "招聘信息", "职位搜索", "搜索结果", "招聘首页", "职位列表",
    "岗位列表", "人才招聘", "校园招聘", "社会招聘", "招聘专区", "热招职位",
    "最新职位", "全部职位", "登录", "注册"
  ];

  // 以这些字结尾的大概率是站点名或栏目名，不是岗位
  const SITE_TAIL = /(网|网站|平台|首页|官网|专区|频道|门户|论坛|社区|系统|中心|首页|地图)$/;

  // 城市词典：标题里直接出现的城市名
  const CITIES = [
    "北京", "上海", "天津", "重庆", "石家庄", "唐山", "保定", "廊坊", "太原", "大同",
    "呼和浩特", "包头", "沈阳", "大连", "鞍山", "长春", "吉林", "哈尔滨", "大庆",
    "南京", "苏州", "无锡", "常州", "南通", "徐州", "扬州", "镇江", "盐城", "泰州",
    "连云港", "淮安", "宿迁", "杭州", "宁波", "温州", "嘉兴", "绍兴", "金华", "台州",
    "湖州", "丽水", "衢州", "舟山", "合肥", "芜湖", "蚌埠", "马鞍山", "福州", "厦门",
    "泉州", "漳州", "莆田", "三明", "南昌", "赣州", "九江", "济南", "青岛", "烟台",
    "潍坊", "威海", "淄博", "临沂", "济宁", "泰安", "日照", "东营", "郑州", "洛阳",
    "新乡", "许昌", "南阳", "开封", "武汉", "宜昌", "襄阳", "黄石", "长沙", "株洲",
    "湘潭", "衡阳", "岳阳", "常德", "广州", "深圳", "珠海", "佛山", "东莞", "中山",
    "惠州", "汕头", "江门", "湛江", "肇庆", "茂名", "揭阳", "南宁", "柳州", "桂林",
    "海口", "三亚", "儋州", "成都", "绵阳", "德阳", "宜宾", "泸州", "南充", "自贡",
    "贵阳", "遵义", "六盘水", "昆明", "曲靖", "玉溪", "大理", "拉萨", "西安", "咸阳",
    "宝鸡", "渭南", "榆林", "兰州", "天水", "西宁", "银川", "乌鲁木齐", "克拉玛依",
    "香港", "澳门", "台北", "新竹", "台中", "高雄", "嘉兴", "慈溪", "义乌", "昆山",
    "常熟", "张家港", "江阴", "宜兴", "晋江", "龙岩", "顺德", "东莞松山湖"
  ];

  // URL 里的城市拼音
  const CITY_PINYIN = {
    beijing: "北京", shanghai: "上海", tianjin: "天津", chongqing: "重庆",
    shijiazhuang: "石家庄", taiyuan: "太原", huhehaote: "呼和浩特", hohhot: "呼和浩特",
    shenyang: "沈阳", dalian: "大连", changchun: "长春", haerbin: "哈尔滨", harbin: "哈尔滨",
    nanjing: "南京", suzhou: "苏州", wuxi: "无锡", changzhou: "常州", nantong: "南通",
    xuzhou: "徐州", yangzhou: "扬州", hangzhou: "杭州", ningbo: "宁波", wenzhou: "温州",
    jiaxing: "嘉兴", shaoxing: "绍兴", jinhua: "金华", taizhou: "台州", hefei: "合肥",
    fuzhou: "福州", xiamen: "厦门", quanzhou: "泉州", nanchang: "南昌", jinan: "济南",
    qingdao: "青岛", yantai: "烟台", weifang: "潍坊", weihai: "威海", zhengzhou: "郑州",
    luoyang: "洛阳", wuhan: "武汉", changsha: "长沙", zhuzhou: "株洲", guangzhou: "广州",
    shenzhen: "深圳", zhuhai: "珠海", foshan: "佛山", dongguan: "东莞", zhongshan: "中山",
    huizhou: "惠州", shantou: "汕头", jiangmen: "江门", nanning: "南宁", guilin: "桂林",
    haikou: "海口", sanya: "三亚", chengdu: "成都", mianyang: "绵阳", guiyang: "贵阳",
    kunming: "昆明", lasa: "拉萨", lhasa: "拉萨", xian: "西安", xianyang: "咸阳",
    lanzhou: "兰州", xining: "西宁", yinchuan: "银川", wulumuqi: "乌鲁木齐", urumqi: "乌鲁木齐",
    hongkong: "香港", macau: "澳门", taipei: "台北"
  };

  // 页面里可能写着「工作地点」的元素
  const LOC_SEL = [
    '[class*="job-address"]', '[class*="jobAddress"]', '[class*="job-location"]',
    '[class*="jobLocation"]', '[class*="work-address"]', '[class*="workAddress"]',
    '[class*="job-area"]', '[class*="jobArea"]', '[class*="work-place"]',
    '[class*="workplace"]', '[class*="location-name"]', '[data-testid*="job-address"]'
  ];

  // 页面里可能写着岗位名的元素
  const TITLE_SEL = [
    '[class*="job-title"]', '[class*="jobTitle"]', '[class*="job-name"]',
    '[class*="jobName"]', '[class*="position-name"]', '[class*="positionName"]',
    '[class*="position-title"]', '[class*="positionTitle"]', '[class*="job-name"]',
    '[data-testid*="job-title"]', '[data-testid*="position"]', 'h1'
  ];

  // 页面里可能写着公司名的元素（投递台账要用）
  const COMPANY_SEL = [
    '[class*="company-name"]', '[class*="companyName"]', '[class*="company-title"]',
    '[class*="companyTitle"]', '[class*="com-name"]', '[class*="comName"]',
    '[class*="corp-name"]', '[class*="corpName"]', '[class*="enterprise-name"]',
    '[data-testid*="company"]'
  ];

  // ---------- 文本清洗 ----------

  function isMktWord(s) {
    const t = String(s || "").trim().toLowerCase();
    if (!t) return true;
    return MKT_WORDS.some(w => t === w || t.includes(w));
  }

  // 去掉括号：营销词的括号整段丢，其余用分隔符围起来变成独立段。
  // 独立段会参与打分，像「（北京）」「（音视频方向）」这种不会盖过岗位名本身。
  function stripBrackets(text) {
    return String(text || "")
      .replace(/[【\[（(「『]([^】\]）)」』]*)[】\]）)」』]/g, (m, inner) => (isMktWord(inner) ? " " : " | " + inner + " | "))
      .replace(/[\u3000]/g, " ")
      .trim();
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^[-|·—–_/｜\s]+|[-|·—–_/｜\s]+$/g, "")
      .trim();
  }

  function hasSiteWord(seg) {
    const low = seg.toLowerCase();
    return SITE_WORDS.some(w => low.includes(w));
  }

  function hasJobWord(seg) {
    const low = seg.toLowerCase();
    if (JOB_WORDS.some(w => low.includes(w))) return true;
    return SHORT_RES.some(re => re.test(low));
  }

  function hasCompanyWord(seg) {
    return COMPANY_WORDS.some(w => seg.includes(w));
  }

  // ---------- 岗位名推断 ----------

  // 给标题里的一段打分：越像岗位名分越高
  function scoreSegment(seg) {
    const t = normalizeText(seg);
    if (!t) return -100;
    let score = 0;

    if (hasJobWord(t)) score += 10;
    if (hasCompanyWord(t)) score -= 12;
    if (hasSiteWord(t)) score -= 20;

    // 栏目名：「找工作」「搜索结果」这类整段就不是岗位
    if (GENERIC_PHRASES.some(p => t.includes(p))) score -= 15;
    // 站点名 / 栏目名常见的结尾
    if (SITE_TAIL.test(t)) score -= 8;

    // 纯泛词（只写了「招聘」「职位」）不算岗位
    if (/^(招聘|职位|岗位|工作|机会|详情|首页)$/.test(t)) score -= 15;
    // 纯数字 / 日期 / 薪资 不算
    if (/^[\d\s\-年月日kK万\.]+$/.test(t)) score -= 15;
    if (/\d+\s*[-~]\s*\d+\s*[kK万]/.test(t)) score -= 10;
    // 太长的大概率是一句话而不是岗位名
    if (t.length > 24) score -= 8;
    if (t.length > 40) score -= 12;
    // 长度适中加分
    if (t.length >= 3 && t.length <= 18) score += 3;
    // 以「招聘」结尾的多半是公司招聘条目
    if (/招聘$/.test(t)) score -= 6;

    return score;
  }

  // 把标题切成候选项，按得分从高到低返回
  function candidateSegments(title) {
    const cleaned = normalizeText(stripBrackets(title));
    if (!cleaned) return [];
    const parts = cleaned
      // 分隔符：破折号 / 竖线 / 圆点 / 下划线，以及「 / 」这种带空格的斜杠。
      // 不带空格的斜杠不当分隔符 —— 「C/C++开发工程师」不能被切开。
      .split(/\s*[-–—_|｜·•]\s*|\s+\/\s*|\s*\/\s+|\s{2,}/)
      .map(normalizeText)
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    // 标题没写分隔符时，整条也要作为候选项（打分自然会权衡）
    if (out.length === 1 && out[0] !== cleaned) out.push(cleaned);
    return out.map(t => ({ text: t, score: scoreSegment(t) }))
      .sort((a, b) => b.score - a.score);
  }

  // 得分门槛：只有长度合适、但一个岗位词都没命中的段（+3）够不着这个线。
  // 宁可漏判（保持用户自己填的意向）也不要错填 —— 猜错一个岗位名比不填更烦人。
  const MIN_SCORE = 6;

  // 纯函数：从一段标题文本里推断岗位名（测试主要打这个）
  function inferPositionFromTitle(title) {
    const cands = candidateSegments(title);
    if (!cands.length) return "";
    const best = cands[0];
    if (best.score < MIN_SCORE) return "";
    // 标题里常写成「嵌入式软件工程师招聘」，尾巴这两个字去掉更像岗位名。
    // 「招聘专员」「招聘经理」这类真岗位名结尾不是「招聘」，不受影响。
    const trimmed = best.text.replace(/[（(]?招聘[）)]?$/, "").trim();
    if (trimmed && scoreSegment(trimmed) >= MIN_SCORE) return trimmed;
    return best.text;
  }

  // ---------- 城市推断 ----------

  // 返回文本里第一个命中的城市（长名字优先，避免「吉林市」被「吉林」截断）
  function findCity(text) {
    const t = String(text || "");
    if (!t) return "";
    let best = "";
    for (const c of CITIES) {
      if (t.includes(c) && c.length > best.length) best = c;
    }
    return best;
  }

  function cityFromUrl(url) {
    const s = String(url || "").toLowerCase();
    if (!s) return "";
    for (const py of Object.keys(CITY_PINYIN)) {
      const re = new RegExp("[/=._-]" + py + "([/=&?_.#-]|$)");
      if (re.test(s)) return CITY_PINYIN[py];
    }
    return "";
  }

  // ---------- 公司名推断 ----------

  // 「某某科技有限公司招聘」→「某某科技有限公司」
  function stripCompanySuffix(t) {
    return normalizeText(String(t || "")
      .replace(/[（(]?招聘[）)]?$/, "")
      .replace(/^(公司|企业|单位)[:：]?/, "")
      .replace(/[（(]?(公司主页|企业主页|查看公司|公司详情)[）)]?/g, ""));
  }

  // 从标题里挑公司名：标题一般写成「岗位 - 公司 - 站点」，取带公司词的那一段
  function inferCompanyFromTitle(title) {
    const parts = candidateSegments(title).map(c => c.text);
    if (!parts.length) return "";
    for (const t of parts) {
      if (hasSiteWord(t)) continue;
      if (COMPANY_WORDS.some(w => t.includes(w))) return stripCompanySuffix(t);
    }
    // 没有典型公司词时退一步：把站点名和岗位名都排掉，剩下那段多半是公司
    const rest = parts.filter(t => !hasSiteWord(t) && !hasJobWord(t) && t.length >= 2);
    return rest.length ? stripCompanySuffix(rest[0]) : "";
  }

  // ---------- 页面级推断 ----------

  function textOf(el) {
    if (!el) return "";
    const t = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
    return normalizeText(t).slice(0, 80);
  }

  function firstBySelectors(selectors) {
    for (const sel of selectors) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const n of nodes) {
        const t = textOf(n);
        if (t && t.length >= 2 && t.length <= 60) return t;
      }
    }
    return "";
  }

  // 汇总所有来源，按可信度挑一个岗位名
  function inferPage() {
    const out = { position: "", city: "", company: "", raw: "", sourcePos: "", sourceCity: "", sourceCompany: "" };
    if (typeof document === "undefined") return out;

    const title = (document.title || "").trim();
    const ogEl = document.querySelector('meta[property="og:title"], meta[name="og:title"]');
    const ogTitle = ogEl ? (ogEl.getAttribute("content") || "").trim() : "";
    const jobElText = firstBySelectors(TITLE_SEL);
    const companyElText = firstBySelectors(COMPANY_SEL);
    let url = "";
    try { url = location.href; } catch (e) { url = ""; }

    out.raw = title || ogTitle || jobElText;

    // 岗位名：页面元素 > og:title > 标题
    const sources = [
      { text: jobElText, tag: "job-el" },
      { text: ogTitle, tag: "og" },
      { text: title, tag: "title" }
    ];
    for (const s of sources) {
      if (!s.text) continue;
      const p = inferPositionFromTitle(s.text);
      if (p) { out.position = p; out.sourcePos = s.tag; break; }
    }

    // 公司名：页面元素 > 标题（投递台账要用它）
    out.company = stripCompanySuffix(companyElText)
      || inferCompanyFromTitle(title)
      || inferCompanyFromTitle(ogTitle)
      || "";
    out.sourceCompany = companyElText ? "company-el" : (out.company ? "title" : "");

    // 城市：标题 / 岗位元素 / 地点元素 / URL
    const locText = firstBySelectors(LOC_SEL);
    const city =
      findCity(out.position) ||
      findCity(jobElText) ||
      findCity(title) ||
      findCity(locText) ||
      cityFromUrl(url);
    if (city) {
      out.city = city;
      out.sourceCity = findCity(title) ? "title" : (findCity(locText) ? "location-el" : "url");
    }

    return out;
  }

  // 从任意一组信号推断（测试友好，不碰 DOM）
  function inferFromSignals(sig) {
    const s = sig || {};
    const out = { position: "", city: "", company: "", raw: s.title || s.ogTitle || s.jobElText || "", sourcePos: "", sourceCity: "", sourceCompany: "" };
    const sources = [
      { text: s.jobElText, tag: "job-el" },
      { text: s.ogTitle, tag: "og" },
      { text: s.title, tag: "title" }
    ];
    for (const src of sources) {
      if (!src.text) continue;
      const p = inferPositionFromTitle(src.text);
      if (p) { out.position = p; out.sourcePos = src.tag; break; }
    }
    out.company = stripCompanySuffix(s.companyElText)
      || inferCompanyFromTitle(s.title)
      || inferCompanyFromTitle(s.ogTitle)
      || "";
    out.sourceCompany = s.companyElText ? "company-el" : (out.company ? "title" : "");
    const city =
      findCity(out.position) ||
      findCity(s.jobElText) ||
      findCity(s.title) ||
      findCity(s.locationText) ||
      cityFromUrl(s.url);
    if (city) {
      out.city = city;
      out.sourceCity = findCity(s.title) ? "title" : (findCity(s.locationText) ? "location-el" : "url");
    }
    return out;
  }

  G.JIANLI_INFER = {
    inferPage,
    inferFromSignals,
    inferPositionFromTitle,
    inferCompanyFromTitle,
    stripCompanySuffix,
    candidateSegments,
    scoreSegment,
    findCity,
    cityFromUrl,
    stripBrackets,
    _words: { SITE_WORDS, JOB_WORDS, COMPANY_WORDS, CITIES, CITY_PINYIN }
  };
})();
