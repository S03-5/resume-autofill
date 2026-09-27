// ============================================================
// 简历数据模板（可安全入库：不含任何真实个人信息）
// 用法：复制本文件为同目录下的 user-defaults.js，再填自己的信息。
// 不复制也能正常运行 —— 插件会退化成全空模板，可在弹窗里逐步填写。
// ⚠️ 填完后不要把 user-defaults.js 提交到 git（里面有身份证号等敏感信息）。
// 首次安装时的数据会写入 chrome.storage.local，之后可在插件弹窗中随意修改。
// 如果这个文件被删掉，插件仍可正常运行（会退化成全空模板）。
// ============================================================
(function () {
  const G = (typeof window !== "undefined") ? window : self;

  G.JIANLI_USER_DEFAULTS = {
    resumeData: {
      // 基本信息
      name: "",
      gender: "",
      phone: "",
      email: "",
      birth: "",
      height: "",
      weight: "",
      hometown: "",
      graduate_status: "",
      english_level: "",
      student_cadre: "",
      id_number: "",
      political: "",
      nationality: "",
      country: "",
      current_residence: "",
      recruit_source: "",
      // 多数网申表单都要填这一栏，值取家庭情况里的父亲
      emergency_contact: "",
      emergency_phone: "",

      // 教育信息
      school: "",
      degree: "",
      // 学位和学历是两项：学历=本科，学位=学士。学位下拉常写作「无/学士/硕士/博士」
      degree_name: "",
      // 学习形式存短写法「全日制」，长写法（全国普通高等院校全日制 / 普通全日制…）
      // 交给 content/lexicon.js 的同义词表认，长短两种选项都能命中
      study_mode: "",
      major: "",
      major_category: "",
      graduate_year: "",
      college: "",
      education_period: "",
      grade_ranking: "",
      gpa: "",
      thesis_title: "",
      research_topic: "",
      lab: "",
      advisor: "",
      education: "",

      // 求职意向（默认留空，插件可从岗位页面自动推断，也可手动填写）
      city: "",
      position: "",
      salary: "",
      job_type: "",

      // 经历与介绍
      intro: "",
      internship_position: "",
      campus_position: "",
      skills: "",
      awards: "",
      internship: "",
      work: "",
      project: "",
      patent: "",
      paper: "",
      monograph: "",
      language: "",
      english_score: "",
      certificate: "",
      portfolio: "",
      hobby: ""
    },

    // 结构化经历块（校招站点「教育/实习/项目经历」可增删表单的填充源）
    blocks: {
      education: [
        {
          school: "",
          major: "",
          degree: "",
          degree_name: "",
          study_mode: "",
          college: "",
          start: "",
          end: "",
          gpa: "",
          ranking: ""
        }
      ],
      internship: [
        {
          company: "",
          position: "",
          start: "",
          end: "",
          desc: ""
        }
      ],
      project: [
        {
          name: "",
          role: "",
          start: "",
          end: "",
          desc: ""
        },
        {
          name: "",
          role: "",
          start: "",
          end: "",
          desc: ""
        }
      ],
      work: [],

      // 家庭情况。页面上通常只有一组固定表单、没有「添加」按钮，
      // 所以字段名虽然与本人的「姓名」「电话」同名，也整块交给经历块机制按成员填
      // （见 content/sites.js 里 family 块的 exclusive 标记）。
      family: [
        {
          name: "",
          relation: "",
          company: "",
          age: "",
          phone: ""
        }
      ]
    },

    // 简历附件：在插件弹窗里上传一次，之后自动填到招聘网站的附件框
    attachment: null
  };
})();
