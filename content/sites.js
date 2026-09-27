// ============================================================
// 字段定义 + 各招聘网站适配器
// 招聘网站改版后，只需调整下方 SITE_ADAPTERS 里的选择器，
// 保存后回到扩展管理页点“刷新”即可生效。
// 智能识别引擎（content.js）会自动兜底，即使没有适配器也能填。
// ============================================================
(function () {
  if (window.__JIANLI_SITES__) return;
  window.__JIANLI_SITES__ = true;

  window.JIANLI_FIELD_DEFS = {
    // 基本信息
    name:        { label: "姓名",     type: "text",     options: [], keywords: ["姓名", "名字", "真实姓名", "您的姓名", "name"] },
    gender:      { label: "性别",     type: "select",   options: ["男", "女"], keywords: ["性别", "sex", "gender"] },
    phone:       { label: "手机号",   type: "text",     options: [], keywords: ["手机号", "手机号码", "联系电话", "电话号码", "手机", "电话", "mobile", "phone", "tel", "mob"] },
    email:       { label: "邮箱",     type: "text",     options: [], keywords: ["邮箱", "电子邮件", "电子邮箱", "email", "e-mail", "mail"] },
    birth:       { label: "出生年月", type: "text",     options: [], keywords: ["出生年月", "出生日期", "出生年份", "生日", "出生", "birth", "bday"] },
    height:      { label: "身高",     type: "text",     options: [], keywords: ["身高", "height"] },
    weight:      { label: "体重",     type: "text",     options: [], keywords: ["体重", "weight"] },
    hometown:        { label: "籍贯",     type: "text",   options: [], keywords: ["籍贯", "户籍所在地", "生源地", "籍贯所在地", "户籍", "hometown", "native place"] },
    graduate_status: { label: "应届/往届", type: "select", options: ["应届", "往届"], keywords: ["应届往届", "应届或往届", "是否应届", "应届毕业生", "毕业生类型", "届别", "应届", "往届"] },
    english_level:   { label: "英语等级", type: "select", options: ["英语四级（CET-4）", "英语六级（CET-6）", "无"], keywords: ["英语等级", "英语级别", "外语等级", "英语水平等级", "英语能力", "英语水平", "外语水平", "语言能力", "语言水平", "外语能力", "英语等级证书", "英语四级", "英语六级", "四六级", "cet", "英语证书", "english level", "english proficiency", "cet-4", "cet-6"] },
    student_cadre:   { label: "学生干部任职类别", type: "text", options: [], keywords: ["学生干部任职类别", "学生干部", "任职类别", "干部类别", "学生干部职务"] },
    id_number:   { label: "身份证号", type: "text",     options: [], keywords: ["身份证号", "身份证号码", "身份证", "证件号码", "证件号", "id card", "idcard", "identity card", "id number", "idno"] },
    political:   { label: "政治面貌", type: "select",   options: ["群众", "共青团员", "中共党员", "中共预备党员", "预备党员", "民主党派", "无党派人士"], keywords: ["政治面貌", "政治", "political"] },
    nationality: { label: "民族",     type: "select",   options: ["汉族", "汉", "满族", "回族", "藏族", "壮族", "苗族", "维吾尔族", "蒙古族", "朝鲜族", "其他"], keywords: ["民族", "ethnic", "nationality"] },
    country:     { label: "国家",     type: "select",   options: ["中国", "其他"], keywords: ["国家", "国籍", "所在国家", "country", "nation"] },
    current_residence: { label: "现居地", type: "text", options: [], keywords: ["现居地", "现居住地", "现居城市", "居住地", "常住地", "当前城市", "current residence", "current city", "residence"] },
    recruit_source:    { label: "招聘信息来源", type: "text", options: [], keywords: ["招聘信息来源", "信息来源", "招聘渠道", "获知渠道", "求职来源", "recruit source", "source"] },
    emergency_contact: { label: "紧急联系人", type: "text", options: [], keywords: ["紧急联系人", "紧急联系", "emergency contact", "emergency"] },
    emergency_phone:   { label: "紧急联系人电话", type: "text", options: [], keywords: ["紧急联系人电话", "紧急联系人手机", "紧急联系电话", "紧急电话", "emergency phone", "emergency tel"] },

    // 教育信息
    school:        { label: "毕业院校", type: "text",   options: [], keywords: ["毕业院校", "毕业学校", "学校名称", "院校名称", "所在学校", "学校", "院校", "university", "college", "school"] },
    degree:        { label: "最高学历", type: "select", options: ["高中", "中专", "大专", "本科", "硕士", "博士", "MBA", "EMBA"], keywords: ["最高学历", "学历", "degree", "education"] },
    // 学位和上一条的学历是两个独立字段：学历答「本科」，学位答「学士」。
    // 关键词只认「学位」二字，不要写「学历」，否则会和上面那条抢框。
    // 放在 degree 之后是有意的：遇到「学历/学位」这种合并标签时，两条得分相同，
    // 先定义的那条胜出（elementFieldScore 用严格大于比较），此时按学历填更合理。
    degree_name:   { label: "学位",     type: "select", options: ["无", "学士", "硕士", "博士"], keywords: ["学位类型", "所获学位", "授予学位", "学位名称", "最高学位", "学位", "degree name", "academic degree"] },
    study_mode:    { label: "学习形式", type: "select", options: ["全日制", "非全日制"], keywords: ["学习形式", "培养方式", "学习方式", "就学形式", "学习性质", "全日制/非全日制", "study mode", "study form"] },
    major:         { label: "专业",     type: "text",   options: [], keywords: ["所学专业", "主修专业", "专业名称", "专业", "major"] },
    major_category:  { label: "专业类别", type: "select", options: ["工学", "理学", "管理学", "文学", "经济学", "法学", "其他"], keywords: ["专业类别", "学科门类", "专业大类", "学科类别"] },
    graduate_year: { label: "毕业时间", type: "text",   options: [], keywords: ["毕业时间", "毕业日期", "毕业年份", "毕业届", "毕业", "graduation"] },
    college:           { label: "学院",       type: "text", options: [], keywords: ["所属学院", "学院名称", "院系名称", "学院", "院系", "college", "department", "faculty", "institute"] },
    education_period:  { label: "就读起止时间", type: "text", options: [], keywords: ["起止时间", "就读时间", "在校时间", "学习时间", "学习经历时间", "study period"] },
    grade_ranking:     { label: "成绩排名",   type: "select", options: ["前5%", "前10%", "前20%", "前25%", "前30%", "前50%", "其他"], keywords: ["成绩排名", "专业排名", "年级排名", "成绩", "排名", "grade ranking", "rank"] },
    gpa:               { label: "成绩GPA",   type: "text", options: [], keywords: ["GPA", "绩点", "平均绩点", "学分绩点", "成绩绩点", "grade point average"] },
    thesis_title:      { label: "毕业论文题目", type: "text", options: [], keywords: ["毕业论文题目", "毕业论文", "毕业设计题目", "论文题目", "毕业设计", "thesis", "dissertation"] },
    research_topic:    { label: "课题研究",   type: "textarea", options: [], keywords: ["课题研究", "研究课题", "科研课题", "研究方向", "课题"] },
    lab:               { label: "实验室",     type: "text", options: [], keywords: ["实验室", "实验", "lab", "laboratory"] },
    advisor:           { label: "导师姓名",   type: "text", options: [], keywords: ["导师姓名", "指导教师", "指导老师", "导师", "advisor", "supervisor", "mentor"] },
    education:     { label: "教育经历 / 教育信息", type: "textarea", options: [], keywords: ["教育经历", "教育信息", "教育背景", "学习经历", "education"] },

    // 求职意向
    city:     { label: "期望城市", type: "text", options: [], keywords: ["期望城市", "工作城市", "意向城市", "所在城市", "目标城市", "城市", "city"] },
    position: { label: "期望职位", type: "text", options: [], keywords: ["期望职位", "求职职位", "意向职位", "应聘职位", "目标职位", "职位名称", "职位", "position", "job title", "job"] },
    salary:   { label: "期望薪资", type: "text", options: [], keywords: ["期望薪资", "期望月薪", "期望年薪", "薪资要求", "月薪要求", "薪资", "salary"] },
    job_type: { label: "求职类型", type: "select", options: ["全职", "兼职", "实习", "校园招聘", "社招"], keywords: ["求职类型", "工作性质", "工作类型", "job type"] },

    // 经历与介绍
    intro:      { label: "自我评价", type: "textarea", options: [], keywords: ["自我评价", "个人简介", "自我介绍", "个人优势", "个人描述", "自我描述", "个人总结", "简介", "about", "summary", "introduction"] },
    internship_position: { label: "实习职位", type: "text", options: [], keywords: ["实习职务", "实习职位", "实习岗位", "实习职位名称", "internship position"] },
    campus_position: { label: "在校职务", type: "text", options: [], keywords: ["在校职务", "职务名称", "学生职务", "担任职务", "校园职务", "学生工作"] },
    skills:     { label: "专业技能", type: "textarea", options: [], keywords: ["专业技能", "技能特长", "掌握技能", "技能", "skill", "skills"] },
    awards:     { label: "获奖经历", type: "textarea", options: [], keywords: ["获奖经历", "荣誉奖项", "所获荣誉", "获得荣誉", "奖项荣誉", "获奖", "荣誉", "award", "honor", "honour"] },
    internship: { label: "实习经历", type: "textarea", options: [], keywords: ["实习经历", "实习经验", "实习情况", "实习", "internship", "intern"] },
    work:       { label: "工作经历", type: "textarea", options: [], keywords: ["工作经历", "工作经验", "从业经历", "工作履历", "work experience", "experience"] },
    project:    { label: "项目经历", type: "textarea", options: [], keywords: ["项目经历", "项目经验", "科研项目", "项目", "project"] },
    patent:     { label: "专利成果", type: "textarea", options: [], keywords: ["专利成果", "专利", "已授权专利", "patent"] },
    paper:      { label: "论文",     type: "textarea", options: [], keywords: ["发表论文", "学术论文", "论文", "出版物", "著作", "paper", "publication", "journal"] },
    monograph:  { label: "学术专著", type: "textarea", options: [], keywords: ["学术专著", "专著", "出版著作", "monograph"] },
    language:   { label: "语言能力", type: "textarea", options: [], keywords: ["外语", "语言", "语种", "language", "languages", "languages spoken"] },
    english_score: { label: "英语成绩", type: "text", options: [], keywords: ["英语成绩", "英语等级成绩", "四六级得分", "四六级分数", "四六级成绩", "英语分数", "四级成绩", "六级成绩", "四级得分", "六级得分", "四级分数", "六级分数", "四级", "六级", "CET", "english score"] },
    certificate: { label: "技能证书", type: "textarea", options: [], keywords: ["技能证书", "资格证书", "职业资格", "证书", "certificate", "certification", "credentials"] },
    portfolio:  { label: "作品信息", type: "textarea", options: [], keywords: ["作品信息", "作品集", "个人作品", "作品", "portfolio", "works"] },
    hobby:      { label: "兴趣爱好", type: "textarea", options: [], keywords: ["兴趣爱好", "个人爱好", "爱好", "兴趣", "hobby", "hobbies", "interest"] }
  };

  // 各网站适配器：fields 里的每一项都是“该字段可能使用的 CSS 选择器列表”，
  // 命中优先级高于智能识别。写不出准确选择器时留空即可，智能识别会自动兜底。
  window.JIANLI_SITE_ADAPTERS = [
    {
      id: "zhipin",
      name: "BOSS直聘",
      hosts: ["zhipin.com", "www.zhipin.com", "boss.zhipin.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        birth: ['input[placeholder*="出生"]'],
        school: ['input[placeholder*="学校"]'],
        major: ['input[placeholder*="专业"]'],
        position: ['input[placeholder*="职位"]', 'input[placeholder*="岗位"]'],
        city: ['input[placeholder*="城市"]']
      }
    },
    {
      id: "zhaopin",
      name: "智联招聘",
      hosts: ["zhaopin.com", "www.zhaopin.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]'],
        position: ['input[placeholder*="职位"]']
      }
    },
    {
      id: "51job",
      name: "前程无忧",
      hosts: ["51job.com", "www.51job.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "lagou",
      name: "拉勾",
      hosts: ["lagou.com", "www.lagou.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "liepin",
      name: "猎聘",
      hosts: ["liepin.com", "www.liepin.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "shixiseng",
      name: "实习僧",
      hosts: ["shixiseng.com", "www.shixiseng.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },

    // ---------- 以下为校招系统 / 大厂自建投递系统 ----------
    // 这些站点大量使用组件库自绘控件，选择器只作「优先命中」用，
    // 真正的识别靠 content.js 的智能匹配，控件操作靠 content/widgets.js。

    {
      id: "mokahr",
      name: "Moka 招聘系统",
      hosts: ["mokahr.com", "app.mokahr.com", "campus.mokahr.com"],
      fields: {
        name:  ['input[placeholder*="请输入姓名"]', 'input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机号"]', 'input[placeholder*="请输入手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        id_number: ['input[placeholder*="证件"]', 'input[placeholder*="身份证"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]'],
        degree: ['input[placeholder*="学历"]']
      }
    },
    {
      id: "beisen",
      name: "北森招聘系统",
      hosts: ["beisen.com", "www.beisen.com", "dayee.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        id_number: ['input[placeholder*="证件"]', 'input[placeholder*="身份证"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "nowcoder",
      name: "牛客网校招",
      hosts: ["nowcoder.com", "www.nowcoder.com", "ac.nowcoder.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "kuaishou",
      name: "快手校招",
      hosts: ["kuaishou.com", "www.kuaishou.com", "campus.kuaishou.com", "zhaopin.kuaishou.cn"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        id_number: ['input[placeholder*="证件"]', 'input[placeholder*="身份证"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]'],
        degree: ['input[placeholder*="学历"]'],
        graduate_year: ['input[placeholder*="毕业"]']
      }
    },
    {
      id: "bytedance",
      name: "字节跳动招聘",
      hosts: ["jobs.bytedance.com", "bytedance.com", "job.bytedance.com", "campus.bytedance.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "meituan",
      name: "美团招聘",
      hosts: ["meituan.com", "zhaopin.meituan.com", "campus.meituan.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "huawei",
      name: "华为招聘",
      hosts: ["huawei.com", "career.huawei.com", "recruit.huawei.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "tencent",
      name: "腾讯招聘",
      hosts: ["qq.com", "join.qq.com", "careers.tencent.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]']
      }
    },
    {
      id: "alibaba",
      name: "阿里巴巴招聘",
      hosts: ["alibaba.com", "talent.alibaba.com", "campus.alibaba.com"],
      fields: {
        name:  ['input[placeholder*="姓名"]', 'input[autocomplete="name"]'],
        phone: ['input[placeholder*="手机"]', 'input[autocomplete="tel"]'],
        email: ['input[placeholder*="邮箱"]', 'input[type="email"]'],
        school: ['input[placeholder*="学校"]', 'input[placeholder*="院校"]'],
        major: ['input[placeholder*="专业"]']
      }
    }
  ];

  // ============================================================
  // 字段分组：弹窗里的简历编辑表单、页面里的「这个框是什么字段」选择面板
  // 共用同一份，避免两边字段顺序/归属不一致。
  // ============================================================
  window.JIANLI_FIELD_GROUPS = [
    { title: "基本信息", keys: ["name", "gender", "birth", "height", "weight", "hometown", "nationality", "country", "current_residence", "id_number", "phone", "email", "political", "graduate_status", "english_level", "english_score", "recruit_source", "emergency_contact", "emergency_phone", "student_cadre"] },
    { title: "教育信息", keys: ["school", "study_mode", "degree", "degree_name", "major", "major_category", "college", "graduate_year", "education_period", "grade_ranking", "gpa", "thesis_title", "research_topic", "lab", "advisor", "education"] },
    { title: "求职意向", keys: ["city", "position", "salary", "job_type"] },
    { title: "经历与介绍", keys: ["intro", "internship_position", "campus_position", "internship", "work", "project", "patent", "monograph", "skills", "awards", "paper", "language", "certificate", "portfolio", "hobby"] }
  ];

  // ============================================================
  // 经历块定义：校招站点把「教育 / 实习 / 项目 / 工作经历」做成可增删的重复表单。
  // content/blocks.js 用它驱动「自动增行 + 逐行填充」，插件弹窗用它渲染编辑界面。
  // 两处共用同一份定义，避免字段不一致。
  // ============================================================
  window.JIANLI_BLOCK_DEFS = {
    education: {
      label: "教育经历",
      sectionWords: ["教育经历", "教育信息", "教育背景", "学习经历", "学历信息"],
      keyWord: "教育",
      minControls: 2,
      fields: [
        { key: "school",  label: "学校名称", type: "text",     keywords: ["学校名称", "毕业院校", "院校名称", "学校", "院校", "school"] },
        { key: "study_mode", label: "学习形式", type: "text",  keywords: ["学习形式", "培养方式", "学习方式", "就学形式", "学习性质"] },
        { key: "major",   label: "专业",     type: "text",     keywords: ["所学专业", "专业名称", "专业", "major"] },
        // 学历只认「学历」二字，学位交给下面那条。
        // 以前这里把「学位」也算成学历，块里同时出现「学历」「学位」两个框时两个都会被填成「本科」。
        { key: "degree",  label: "学历",     type: "text",     keywords: ["最高学历", "学历", "degree"] },
        { key: "degree_name", label: "学位",  type: "text",    keywords: ["学位类型", "所获学位", "授予学位", "最高学位", "学位"] },
        { key: "college", label: "学院",     type: "text",     keywords: ["所属学院", "学院", "院系", "college"] },
        { key: "start",   label: "开始时间", type: "text",     keywords: ["开始时间", "起始时间", "入学时间", "起始年月", "开始日期"] },
        { key: "end",     label: "结束时间", type: "text",     keywords: ["结束时间", "毕业时间", "截止时间", "结束日期"] },
        { key: "gpa",     label: "GPA",      type: "text",     keywords: ["gpa", "绩点", "平均绩点"] },
        { key: "ranking", label: "成绩排名", type: "text",     keywords: ["成绩排名", "专业排名", "年级排名", "排名"] }
      ]
    },
    internship: {
      label: "实习经历",
      sectionWords: ["实习经历", "实习经验", "实习情况", "实践经历"],
      keyWord: "实习",
      minControls: 2,
      fields: [
        { key: "company",  label: "公司名称", type: "text",     keywords: ["公司名称", "单位名称", "公司", "单位", "企业名称"] },
        { key: "position", label: "实习职位", type: "text",     keywords: ["实习职位", "实习岗位", "职位名称", "职务", "岗位", "职位"] },
        { key: "start",    label: "开始时间", type: "text",     keywords: ["开始时间", "起始时间", "入职时间", "开始日期"] },
        { key: "end",      label: "结束时间", type: "text",     keywords: ["结束时间", "离职时间", "截止时间", "结束日期"] },
        { key: "desc",     label: "工作内容", type: "textarea", keywords: ["工作内容", "工作描述", "实习内容", "职责", "业绩", "描述", "详情"] }
      ]
    },
    project: {
      label: "项目经历",
      sectionWords: ["项目经历", "项目经验", "科研项目", "项目信息"],
      keyWord: "项目",
      minControls: 2,
      fields: [
        { key: "name",  label: "项目名称", type: "text",     keywords: ["项目名称", "项目", "课题名称"] },
        { key: "role",  label: "担任角色", type: "text",     keywords: ["担任角色", "项目角色", "角色", "承担角色", "职责"] },
        { key: "start", label: "开始时间", type: "text",     keywords: ["开始时间", "起始时间", "开始日期"] },
        { key: "end",   label: "结束时间", type: "text",     keywords: ["结束时间", "截止时间", "结束日期"] },
        { key: "desc",  label: "项目描述", type: "textarea", keywords: ["项目描述", "项目内容", "项目职责", "工作内容", "描述", "详情"] }
      ]
    },
    work: {
      label: "工作经历",
      sectionWords: ["工作经历", "工作经验", "从业经历", "工作履历"],
      keyWord: "工作",
      minControls: 2,
      fields: [
        { key: "company",  label: "公司名称", type: "text",     keywords: ["公司名称", "单位名称", "公司", "单位"] },
        { key: "position", label: "职位名称", type: "text",     keywords: ["职位名称", "岗位名称", "职务", "职位", "岗位"] },
        { key: "start",    label: "开始时间", type: "text",     keywords: ["开始时间", "起始时间", "入职时间"] },
        { key: "end",      label: "结束时间", type: "text",     keywords: ["结束时间", "离职时间"] },
        { key: "desc",     label: "工作内容", type: "textarea", keywords: ["工作内容", "工作描述", "职责", "业绩", "描述"] }
      ]
    },
    family: {
      label: "家庭情况",
      // 区块标题的候选写法（findArea 定位容器用；findAreaBySection 拿它精确匹配标题文字）
      sectionWords: ["家庭情况", "家庭成员", "家庭信息", "家庭关系", "家属信息", "主要家庭成员", "家庭成员情况"],
      keyWord: "家庭",
      minControls: 2,
      // ⚠ 独占标记：这一块的字段名与「本人」的同名（姓名、电话），
      // 若交给主表单的全页关键词匹配，你父亲的姓名框会被填成你自己的名字、
      // 电话框会被填成你的手机号（主表单先填，经历块再填时已被占住还改不了）。
      // 标记后 content.js 的 buildPlan 会跳过整个区块，只由经历块机制按成员逐行填。
      exclusive: true,
      fields: [
        { key: "name",     label: "姓名",       type: "text", keywords: ["成员姓名", "家属姓名", "家庭成员姓名", "姓名"] },
        { key: "relation", label: "与本人关系", type: "text", keywords: ["与本人关系", "与本人的关系", "亲属关系", "成员关系", "称谓", "关系"] },
        { key: "company",  label: "工作单位",   type: "text", keywords: ["工作单位及职务", "工作单位名称", "工作单位", "所在单位", "单位名称"] },
        { key: "age",      label: "年龄",       type: "text", keywords: ["年龄"] },
        { key: "phone",    label: "联系电话",   type: "text", keywords: ["成员联系电话", "联系电话", "联系号码", "联系方式", "手机号码", "手机号", "电话"] }
      ]
    }
  };
})();
