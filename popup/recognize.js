// ============================================================
// 简历识别模块：从简历文本中自动提取字段，让新用户无需逐项填写
// 支持：粘贴全文 / 导入 .txt 文件
// ============================================================
(function () {
  const R = {};

  function pick(patterns, text) {
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    }
    return "";
  }

  // 段落识别：按常见标题切分长文本字段
  const SECTION_HEADS = [
    { key: "education",  heads: ["教育背景", "教育经历", "教育信息"] },
    { key: "internship", heads: ["实习经历", "实习经验", "实习情况"] },
    { key: "project",    heads: ["项目经历", "项目经验", "科研项目"] },
    { key: "work",       heads: ["工作经历", "工作经验"] },
    { key: "skills",     heads: ["专业技能", "技能特长"] },
    { key: "awards",     heads: ["竞赛获奖", "获奖经历", "所获荣誉", "荣誉奖项"] },
    { key: "intro",      heads: ["自我评价", "个人简介", "自我介绍"] }
  ];

  function extractSections(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const marks = [];
    lines.forEach((line, i) => {
      if (!line) return;
      for (const sec of SECTION_HEADS) {
        for (const h of sec.heads) {
          if (line === h || line.startsWith(h)) {
            marks.push({ i, key: sec.key });
            break;
          }
        }
      }
    });
    marks.sort((a, b) => a.i - b.i);
    const result = {};
    for (let k = 0; k < marks.length; k++) {
      const start = marks[k].i + 1;
      const end = k + 1 < marks.length ? marks[k + 1].i : lines.length;
      const content = lines.slice(start, end).filter(l => l).join("\n");
      if (content) result[marks[k].key] = content;
    }
    return result;
  }

  R.parseResume = function parseResume(text) {
    if (!text || !text.trim()) return {};
    const t = text.replace(/\r/g, "");
    const out = {};
    const sections = extractSections(t);

    // 基本信息
    out.name        = pick([/(?:姓名|名字)\s*[:：]?\s*([^\s,，]{1,20})/], t);
    out.gender      = pick([/(?:性别)\s*[:：]?\s*(男|女)/], t);
    out.phone       = pick([/(?:手机号|手机号码|联系电话|手机|电话)\s*[:：]?[^\d]*(\d{11})/], t);
    out.email       = pick([/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/], t);
    out.id_number   = pick([/(?:身份证(?:号码|号)?)\s*[:：]?\s*(\d{17}[\dXx])/], t);
    out.birth       = pick([/(?:出生(?:年月|日期)?)\s*[:：]?\s*(\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2})?)/], t);
    out.political   = pick([/(?:政治面貌)\s*[:：]?\s*(群众|共青团员|中共党员|中共预备党员|预备党员|民主党派|无党派人士)/], t);
    out.nationality = pick([/(?:民族)\s*[:：]?\s*([^\s,，]{1,4})/], t);
    out.hometown    = pick([/(?:籍贯)\s*[:：]?\s*([^\s,，]{1,20})/], t);
    out.height      = pick([/(?:身高)[^\d]{0,6}(\d{2,3})/], t);
    out.weight      = pick([/(?:体重)[^\d]{0,6}(\d{2,3})/], t);

    // 教育
    out.school       = pick([/(?:毕业院校|毕业学校|学校名称|院校名称|学校)\s*[:：]?\s*([^\s,，|]{2,30})/], t);
    out.degree       = pick([/(?:最高学历|学历)\s*[:：]?\s*(博士|硕士|本科|大专|专科|中专|高中)/], t);
    out.major        = pick([/(?:专业名称|所学专业|主修专业|专业)\s*[:：]?\s*([^\s,，|]{2,30})/], t);
    out.graduate_year = pick([/(?:毕业(?:时间|年份)?)\s*[:：]?\s*(\d{4})/], t);
    out.gpa          = pick([/(?:GPA|绩点)[^\d]{0,6}(\d(?:\.\d{1,2})?)/i], t);

    // 英语
    out.english_level = pick([/(?:英语等级|英语级别)\s*[:：]?\s*(英语四级|CET-4|英语六级|CET-6|四级|六级)/i], t);
    out.english_score = pick([/(?:四六级(?:得分|成绩|分数)|英语等级成绩|英语成绩|CET[-－]?[46]|四级|六级)[^0-9]{0,12}(\d{2,3})/i], t);

    // 求职意向
    out.position = pick([/(?:求职意向|意向岗位|应聘职位|期望职位|目标职位)\s*[:：]?\s*([^\s,，]{2,30})/], t);
    out.city     = pick([/(?:期望城市|意向城市|工作城市|所在城市)\s*[:：]?\s*([^\s,，]{1,20})/], t);
    out.salary   = pick([/(?:期望薪资|期望月薪|薪资要求)\s*[:：]?\s*([^\s,，]{1,20})/], t);

    // 长文本段落
    out.education  = sections.education || "";
    out.internship = sections.internship || "";
    out.project    = sections.project || "";
    out.work       = sections.work || "";
    out.skills     = sections.skills || "";
    out.awards     = sections.awards || "";
    out.intro      = sections.intro || "";

    const cleaned = {};
    for (const k in out) { if (out[k]) cleaned[k] = out[k]; }
    return cleaned;
  };

  window.JIANLI_RECOGNIZE = R;
})();
