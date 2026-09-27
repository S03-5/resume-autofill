// ============================================================
// 字段空模板 + 默认设置（开源仓库只含结构，不含任何个人数据）
// 个人真实数据放在同目录的 user-defaults.js（已在 .gitignore 中排除）
// 加载顺序：defaults.js → user-defaults.js → 使用方调用 JIANLI_getDefaults()
// ============================================================
(function () {
  const G = (typeof window !== "undefined") ? window : self;

  // 55 个字段的空模板。键名与 content/sites.js 的 JIANLI_FIELD_DEFS 一一对应。
  G.JIANLI_TEMPLATE = {
    resumeData: {
      // 基本信息
      name: "", gender: "", phone: "", email: "", birth: "",
      height: "", weight: "", hometown: "", graduate_status: "",
      english_level: "", student_cadre: "", id_number: "", political: "",
      nationality: "", country: "", current_residence: "", recruit_source: "",
      emergency_contact: "", emergency_phone: "",
      // 教育信息
      school: "", degree: "", degree_name: "", study_mode: "",
      major: "", major_category: "", graduate_year: "",
      college: "", education_period: "", grade_ranking: "", gpa: "",
      thesis_title: "", research_topic: "", lab: "", advisor: "", education: "",
      // 求职意向
      city: "", position: "", salary: "", job_type: "",
      // 经历与介绍
      intro: "", internship_position: "", campus_position: "", skills: "",
      awards: "", internship: "", work: "", project: "", patent: "", paper: "",
      monograph: "", language: "", english_score: "", certificate: "",
      portfolio: "", hobby: ""
    },

    // 结构化经历块：用于校招站点「教育经历 / 实习经历 / 项目经历」这类可增删的重复表单
    blocks: {
      education: [],
      internship: [],
      project: [],
      work: [],
      // 家庭情况（字段名与本人的「姓名」「电话」同名，见 sites.js 的 exclusive 标记）
      family: []
    },

    // 简历附件（用于自动上传到招聘网站的附件框）
    attachment: null,

    settings: {
      autoFill: false,        // 进入已适配站点自动填写
      skipFilled: true,       // 只填空白框，不覆盖页面上已有内容
      showHud: true,          // 在表单页显示右下角悬浮球（含战报浮层与撤销入口）
      useMemory: true,        // 优先使用字段记忆（手动纠正过的框），命中优先级高于站点适配器
      inferPosition: true,    // 从当前岗位页面自动推断期望职位/城市
      ledgerPrompt: true,     // 检测到投递成功页时弹一句，问要不要记进投递台账
      deepFill: true,         // 深度填充：非原生下拉、日期、省市区级联
      autoAttach: true,       // 自动上传简历附件
      navAutoFill: false,     // 单页应用路由切换后自动补填
      // 填写快捷键：
      //   command       = 浏览器级 Ctrl+Shift+F（默认，不占用页面按键）
      //   alt+shift+f / alt+q / ctrl+shift+u = 页面内监听的自定义键
      //   off           = 关闭快捷键
      hotkey: "command"
    }
  };

  // 深合并：只用于 blocks / settings 这类固定形状的嵌套对象
  function deepMerge(base, override) {
    if (!override) return JSON.parse(JSON.stringify(base));
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(override)) {
      const bv = base ? base[k] : undefined;
      const ov = override[k];
      if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
        out[k] = deepMerge(bv, ov);
      } else if (ov !== undefined) {
        out[k] = ov;
      }
    }
    return out;
  }

  // 合并模板与个人数据，返回完整默认值。user-defaults.js 缺失时安全降级为纯模板。
  G.JIANLI_getDefaults = function () {
    const user = G.JIANLI_USER_DEFAULTS || {};
    return {
      resumeData: Object.assign({}, G.JIANLI_TEMPLATE.resumeData, user.resumeData || {}),
      blocks: deepMerge(G.JIANLI_TEMPLATE.blocks, user.blocks),
      attachment: user.attachment || null,
      settings: deepMerge(G.JIANLI_TEMPLATE.settings, user.settings)
    };
  };

  G.JIANLI_deepMerge = deepMerge;

  // 经历块合并：老用户升级上来时，storage 里存着的经历块没有新加的字段，
  // 而 Object.assign 对数组是整体替换，新字段会被悄悄丢掉（表现为「弹窗里根本看不到这一项」）。
  // 这里改成按「行索引」逐行补齐：
  //   第 1 行 = 模板第 1 行打底 + 用户已有的值覆盖 → 新字段立刻有值
  //   用户自己加的第 2、3 行 = 原样保留 → 不会被模板第 1 行的值串上
  //   （不做这一步的话，多行经历会全被填成第 1 行的学历，那比空着更糟）
  G.JIANLI_mergeBlocks = function (base, saved) {
    const b = base || {}, s = saved || {};
    const out = {};
    for (const type of Object.keys(b)) {
      const bArr = Array.isArray(b[type]) ? b[type] : [];
      const sArr = Array.isArray(s[type]) ? s[type] : null;
      if (!sArr) { out[type] = JSON.parse(JSON.stringify(bArr)); continue; }
      out[type] = sArr.map((row, i) => Object.assign({}, bArr[i] || {}, row || {}));
    }
    // 用户自己加过、模板里没有的块类型也保留下来
    for (const type of Object.keys(s)) if (!(type in out)) out[type] = s[type];
    return out;
  };

  // 供旧的调用点直接使用（此时 user-defaults.js 已加载完毕则包含个人数据）
  G.JIANLI_DEFAULTS = G.JIANLI_getDefaults();
})();
