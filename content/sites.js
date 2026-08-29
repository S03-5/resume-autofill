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
    english_level:   { label: "英语等级", type: "select", options: ["英语四级（CET-4）", "英语六级（CET-6）", "无"], keywords: ["英语等级", "英语级别", "外语等级", "英语水平等级"] },
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
    language:   { label: "语言能力", type: "textarea", options: [], keywords: ["语言能力", "语言水平", "外语水平", "英语水平", "外语", "language", "languages", "english level"] },
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
    }
  ];
})();
