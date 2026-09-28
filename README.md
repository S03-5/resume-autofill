# 简历助手

一款 Chrome / Edge 浏览器扩展（Manifest V3）：在校招 / 招聘网站上**一键填完在线简历表单**，并顺手把**投递本身记成一笔可追踪的账**。

写这个插件的起因很具体：秋招期间一天要投十几家，每家都要在网页表单里重敲一遍姓名、电话、学历、四段经历、期望职位，投完还记不清投了谁、到哪一步了。所以它不只是「自动填表」——**填得准、教得会、记得住**三件事都做了。

> 当前版本 **2.4.1**（2026-09-16）。完整改动见 [`更新日志.md`](更新日志.md)，2026-09 五步优化总览见 [`优化报告.html`](优化报告.html)。

---

## 目录

- [它能解决什么](#它能解决什么)
- [功能特性](#功能特性)
- [安装](#安装)
- [快速上手](#快速上手)
- [界面说明](#界面说明)
- [快捷键与开关](#快捷键与开关)
- [支持的站点](#支持的站点)
- [数据与隐私](#数据与隐私)
- [常见问题](#常见问题)
- [开发与测试](#开发与测试)
- [新增站点适配](#新增站点适配)
- [项目结构](#项目结构)
- [许可证](#许可证)
- [English](#english)

---

## 它能解决什么

| 你遇到的麻烦 | 插件的做法 |
|---|---|
| 校招站点的下拉框点了没反应、日期框点不动、省市区只填到第一级 | 适配组件型控件：模拟真实点击逐级打开面板，不依赖原生 `<select>` |
| 一家公司要填四段经历，页面只有一行，得手动点 4 次「＋ 添加」 | 自动数出行数差额，先补行再逐行填入 |
| 填完不知道哪些填上了、哪些没填上，还得挨个肉眼找 | 弹「填写战报」，列出已填 / 失败原因 / 没认出来的框，点条目直接跳过去 |
| 手滑覆盖了页面上已经写好的内容 | 默认「只填空白框」，另有一键撤销可还原到填写前 |
| 插件认不出某个网站的框，只能等作者改代码 | 你自己在页面上点两下教会它，记一次永久生效 |
| 一份简历投所有岗位，投 Java 岗却填着「机械结构工程师」 | 从岗位页标题自动推断期望职位与城市 |
| 机械岗和硬件岗该用不同简历，但改来改去容易搞混 | 维护多套简历方案，字段 / 经历块 / 附件成套切换 |
| 投了几十家，投完就忘，复盘时全靠脑子 | 投递台账：自动识别成功页 + 手动补录，统计 + CSV 导出 |

---

## 功能特性

### 1. 一键填写（含组件型表单）

打开招聘网站的简历页或投递页，点「⚡ 立即填写当前页面」，几十个字段自动填好并绿色高亮。

不是简单地把 `value` 塞进去——校招站点大量使用 antd / Element 等组件库渲染的「假表单」，原生思路在这些页面上完全失效，所以单独做了一层适配：

- **下拉选项智能匹配**：见下面第 2 节，同一个值在任何控件里结果一致
- **非原生下拉**：模拟 mousedown 打开面板，在面板里用同一套匹配规则选选项后点击
- **日期选择器**：先尝试直接赋值，失败则打开面板按「年 → 月 → 日」逐级点选，兼容年月与完整日期两种选择器
- **省市区三级级联**：把「吉林省长春市南关区」拆成三级逐列点击，支持自治区、自治州、直辖市、单列市
- **重复经历块**：教育 / 实习 / 项目 / 工作经历，行数不够时自动点「＋ 添加」补足
- **家庭情况**：成员姓名 / 关系 / 工作单位 / 年龄 / 联系电话。页面上**没有「添加」按钮**（只有一组写死的固定表单）也能定位；整块标记为「独占」，成员的姓名、电话不会被你自己的姓名、手机号抢填
- **字段识别会放宽**：标成「英语水平 / 英语能力 / 外语水平 / 语言能力」的栏目，一律按英语等级处理——即使该栏在页面上是个纯文本框而不是下拉，也能填上四六级
- **防误填**：密码框、验证码框、搜索框一律跳过
- **智能兜底**：站点没单独适配时，也会根据 placeholder、标签文字、`name`、`aria-label` 自动识别

### 2. 下拉选项智能匹配（认不出来就留空，绝不瞎选）

简历写「CET-6」，页面上写「英语六级」；简历写「汉」，页面上写「汉族」——这些以前都填不上。
更糟的是字面能匹配但语义相反的情况：简历写「本科」时，`非全日制本科` 因为**字面上包含了「本科」**，
是有可能被选中的。这类错误肉眼看不出来，等你发现的时候简历已经投出去了。

现在所有下拉、单选组、省市区级联都走同一个匹配器（原生下拉 / antd 下拉 / Element 下拉 / 单选组，
四处算法合并成一份），按下面这些层级打分，**低于 55 分一律不填**：

| 判定 | 例子 |
|---|---|
| 完全相同 | `本科` = `本科` |
| 同义写法（词表） | `CET-6` → `英语六级`；`汉` → `汉族`；`共青团员` → `团员` |
| 长短写法（词表） | `全日制` → `全国普通高等院校全日制`；`学士` → `学士学位` |
| 括号别名 | `英语四级（CET-4）` → `CET-4` |
| 去掉修饰词后相同 | `本科` → `本科及以上` |
| 地名后缀不同 | `北京` → `北京市` |
| 日期同一天 | `2005-05` → `2005年5月` |
| 数值 / 区间命中 | `175` → `170-175cm` |
| 包含匹配（长度比 ≥ 0.6） | `本科` → `全日制本科` |
| **含否定词，语义相反 → 0 分** | **`本科` ✗ `非全日制本科`**；`中共党员` ✗ `非党员` |

**核心原则：宁可不填，不能选错。** 空着的框 HR 会略过，填错的政治面貌是减分项。

长短写法那一层值得单说：页面把选项写成「全国普通高等院校全日制」（11 字）时，
简历里存「全日制」（3 字）的**字面长度比只有 0.27**，低于包含匹配要求的 0.6，
靠算法永远够不到 —— 这类只能靠词表认成同义（`content/lexicon.js` 里的 `study_mode`）。

匹配不上时，战报里会把这个下拉**实际有哪些选项**摊开给你看，你一眼就知道该手动选哪个；
实在想教它，用「🎯 点选生成适配器」记一次，下次就自动认了。

想加词只改 `content/lexicon.js`（纯数据，14 个高频枚举字段的同义词表），改完跑 `node test/matcher.js` 看有没有变差。

> 学位和学历是两个独立字段：`degree` 答「本科」，`degree_name` 答「学士」。
> 学位下拉的第一项常常就是「无」，它在「不变否定词」的前提下得 0 分，永远不会被误选。

### 3. 悬浮球 · 一键撤销 · 填写战报

表单页右下角会出现一个可拖拽的悬浮球（用 Shadow DOM 隔离，不会被站点样式搞乱）：

- 点一下展开菜单：**填写当前页面 / 撤销上次填写 / 点选生成适配器 / 记一笔投递**
- 拖动可换位置，位置会记住
- 只在「已适配站点」或「页面上确实有 ≥3 个可填控件」时出现，不会在所有网页上乱飘

**填写战报**：填完后浮出一张小卡片，告诉你到底填成了什么：

- 顶部汇总 `已填 12 · 待手填 3`
- 分三组列出：**插件没填上的**（带具体原因，如「选项里没有『共青团员』」）、**页面里没认出来的空白框**、**插件认识但简历里没内容**
- **点任意一条，页面自动滚动过去并高亮那个框**，不用肉眼找
- 15 秒后自动收起，鼠标停在上面则保留

**一键撤销**：填写前把每个控件的原值存成快照，撤销时逐个还原并清掉绿色高亮。
四个入口：悬浮球菜单 / 战报里的「↩ 撤销这次填写」/ 弹窗按钮 / 快捷键 `Ctrl+Shift+Z`。
重复撤销会明确提示「没有可撤销的填写记录」，不会静默失败。

### 4. 字段记忆 + 点选生成适配器

插件认不出来的框，你可以在页面上直接教会它，**记一次就够了**。

- **从战报里补**：战报里「没认出来的空白框」每行右侧有「记住」按钮 → 弹出字段选择面板（带搜索）→ 选中 → 插件立刻记住，并**当场按新映射填一次**
- **主动点选（推荐首次遇到新站点时用）**：悬浮球 →「🎯 点选生成适配器」→ 鼠标划过输入框会蓝色描边 → 点要记录的框 → 选字段 → 绿色描边表示已收集。面板上可「继续点选 / 复制代码 / 完成」，`Esc` 退出

**记下来的东西能扛住改版**：同时存「精确选择器」和「指纹」（tag + name / placeholder / 标签文字），选择器失效时按指纹兜底；选择器在全页不唯一时**宁可不认**，也不会把值填到错的框上。

**命中优先级：字段记忆 > 站点适配器 > 智能识别。** 你手动确认过的东西，永远排在机器猜测前面。

点选完可以「复制代码」，生成一段能直接粘进 [`content/sites.js`](content/sites.js) 的适配器片段，把当天的临时教学固化成正式适配。

### 5. 多套简历方案

一份简历投所有岗位是浪费。弹窗顶部是方案条：下拉切换，`＋` 新建、`⧉` 复制、`✎` 重命名、`🗑` 删除。

- 一套方案 = **字段数据 + 经历块 + 简历附件**，切换时三者一起换
- **切换是手动的**，不会因为你今天看了个新岗位就偷偷把简历换掉
- 附件按内容去重，复制方案时只存一份引用，不会因为方案变多把存储撑爆
- 从旧版本升级时，已有简历会原样包成一套「默认方案」，不丢数据

### 6. 期望职位与城市自动推断

校招站点的标题几乎都带岗位名（示例：`字节跳动-后端开发工程师-校招`）。填写前插件会读标题推断岗位与城市，**推断值覆盖简历里写死的值**，并在战报里单独提示「岗位已按当前页面调整为 XXX」，所以你随时知道填的和写的不一样。

推断是打分制的：标题按分隔符切段，含岗位词加 10 分、含公司词扣 12 分、含站点词扣 20 分，取最高分那段；没有任何岗位词的段落一律不要，**宁可留空也不乱填**。斜杠只有两侧带空格时才当分隔符，所以「C/C++开发工程师」不会被切成两段。

不想要这个行为，可在弹窗里关掉。

### 7. 自动投递台账

把投递变成可追踪的数据。一条记录包含：公司、岗位、城市、链接、来源站点、状态、备注、时间。

**状态机**：`已投递 → 笔试 → 面试中 → 已通过 / 已拒·无回应`

**三种记账方式：**

1. **投递成功后自动提示**——提交后插件隔 2.6 秒看一眼当前页是不是「投递成功」页，是的话弹卡确认。**绝不自动记账**：误记比漏记更难清理
2. **悬浮球菜单 →「📝 记一笔投递」**——不想等检测时用
3. **弹窗 → 投递台账 →「✎ 手动加一条」**——补录官网投的、内推的

**弹窗里能做的**：今天 / 本周投了几家、还在等几家；按状态筛选、按关键词搜索（公司 / 岗位 / 备注）；改状态、编辑备注、删除、清空；导出 CSV（带 UTF-8 BOM，Excel 双击不乱码）。

同一个岗位重复记会按链接去重合并，不会堆成两行。

### 8. 其他

- **简历识别**：粘贴简历全文，或导入 `.txt` / `.docx` / `.pdf`，自动识别姓名、电话、学历、经历等字段。
  导入时按**文件头**判格式、按 **BOM / UTF-16 特征 / 严格 UTF-8 / GBK 候选打分**嗅探编码 ——
  中文 Windows 导出的 ANSI(GBK) txt 不会再读成乱码。读不出可靠文字（扫描版 PDF、旧版 `.doc`、
  子集字体 PDF）会**明确报错而不是把乱码填进去**
- **自定义字段**：遇到网站特有的字段，自己添加「字段名 + 内容」，填写时自动匹配
- **简历附件自动上传**：弹窗里传一次，填写时自动塞进页面的附件框（先走 `DataTransfer`，被拒时降级派发 `drop` 事件）

---

## 安装

1. 下载或克隆本仓库
2. 打开扩展管理页：Edge → `edge://extensions/`；Chrome → `chrome://extensions/`
3. 打开右上角「开发人员模式」
4. 点「加载已解压的扩展程序」，选择本仓库文件夹
5. 工具栏出现 📋 图标即可使用（建议固定到工具栏）

**更新已有安装**：在扩展管理页的卡片上点 🔄「重新加载」。改了 manifest 或新增内容脚本后不重载不会生效。

> Firefox 用户：仓库里有 `manifest.firefox.json` 与 `build-firefox.ps1`，运行脚本会生成 `dist-firefox/`，可在 `about:debugging` → 临时载入附加组件中加载。

---

## 快速上手

**第一次用（约 5 分钟）：**

1. 点工具栏 📋 图标打开弹窗
2. 展开「📥 简历识别」，粘贴简历全文或导入文件 → 点「🔍 识别简历」→ 再点「✓ 应用到简历数据」
   （也可以跳过这步，直接手动逐项填写，改动会自动保存）
3. 展开「📎 简历附件」，选一份简历 PDF —— 之后填写时插件会自动帮你上传
4. 关掉弹窗，打开一个招聘网站的简历页或投递页

**以后每次投递：**

1. 悬浮球点「⚡ 填写当前页面」，或按 `Ctrl+Shift+F`，或右键菜单「用简历数据填写本页表单」
2. 看右下角战报：绿色高亮是已填；点条目跳到对应框；没认出来的框点「记住」教会它
3. 填错了按 `Ctrl+Shift+Z` 撤销
4. 提交后，成功页会弹卡 → 点「记一笔」
5. 定期打开弹窗「📝 投递台账」，看统计、把该改状态的改掉、需要时导出 CSV

**投多个方向时：**

- 弹窗方案条 `＋` 新建「机械岗」，再 `⧉` 复制一份改成「硬件岗」，各自编辑字段与附件
- 投递前先在下拉里切一下方案
- 首次遇到新站点，先用悬浮球的「🎯 点选生成适配器」把插件没认出来的框点一遍

---

## 界面说明

### 弹窗

弹窗总高被浏览器限制在 600px，空间优先给「简历编辑」——上方只保留每次都要看的几行，
五个配置面板统一收进「⚙️ 更多设置」折叠区，收起时只占一行。

| 区块 | 作用 |
|---|---|
| 顶部按钮 | 「⚡ 立即填写当前页面」、`↩` 撤销、`⧉` 独立窗口、`✕` 关闭 |
| 站点提示 | 当前页面识别到的站点、已记住的映射条数、推断出的岗位名。**默认压成一行**，点一下展开全文，鼠标悬停也能看全 |
| 简历方案 | 下拉切换 + `＋` `⧉` `✎` `🗑`；下面一行小字是当前方案的字段数 / 经历数 / 附件，同样点击展开 |
| ⚙️ 更多设置 | 折叠区。里面装下面这 5 项，点开才展开（展开区自带滚动上限，不会把字段区挤没） |
| └ 📥 简历识别 | 粘贴全文或导入 txt / docx / pdf（自动认编码与格式），识别后填入空白字段 |
| └ 📎 简历附件 | 上传简历文件，填写时自动塞进页面附件框（跟着方案走） |
| └ ⚙️ 填写选项 | 8 个开关 + 快捷键选择 |
| └ 🧠 字段记忆 | 按站点查看已记住的映射，单条删除 / 清空本站 / 清空全部 / 复制本站适配器代码 |
| └ 📝 投递台账 | 统计、筛选、搜索、加一条、改状态、导出 CSV、清空 |
| 🔍 扫描本页字段 | 列出页面上所有可填字段（标签 / placeholder / 控件类型 / 匹配到的插件字段），用于诊断「为什么这个框没被认出来」 |
| 简历编辑 | 按分组编辑：基本信息 / 教育信息 / 求职意向 / 经历与介绍，改动自动保存 |
| 经历块 | 教育 / 实习 / 项目 / 工作 / 家庭情况，可增删条目、逐字段编辑（用于校招站点的多行经历表单） |
| 自定义字段 | 添加网站特有字段的「名称 + 内容」，填写时自动匹配 |
| 导入导出 | 导出 JSON / 导入 JSON（含全部方案），用于备份或换机；另有恢复默认数据 |

### 悬浮球（表单页右下角）

菜单四项：「⚡ 填写当前页面」「↩ 撤销上次填写」「🎯 点选生成适配器」「📝 记一笔投递」。
可在「⚙️ 填写选项」里关掉它。

### 右键菜单

- 用简历数据填写本页表单
- 撤销上次填写（恢复原值）

---

## 快捷键与开关

| 操作 | 默认快捷键 |
|---|---|
| 填写当前页面 | `Ctrl+Shift+F` |
| 撤销上次填写 | `Ctrl+Shift+Z` |
| 退出点选模式 | `Esc` |

填写键可换成 `Alt+Shift+F` / `Alt+Q` / `Ctrl+Shift+U`，或直接关闭（撤销键固定）。

**⚙️ 填写选项里的 8 个开关：**

| 开关 | 默认 | 什么时候关掉它 |
|---|---|---|
| 只填空白框（不覆盖页面上已有内容） | 开 | 想用简历数据强制覆盖页面上写过的内容时 |
| 深度填充组件型控件 | 开 | 站点组件行为异常、填写卡住时，先关掉排查 |
| 自动上传简历附件 | 开 | 不想每投一家都传一遍附件时 |
| 在表单页显示悬浮球 | 开 | 页面右下角的站点按钮被挡住时 |
| 进入已适配网站时自动填写 | 关 | 想全自动填表时打开（默认关是为了避免误触发） |
| 优先使用字段记忆 | 开 | 想对比纯智能识别的效果时 |
| 按当前岗位自动调整期望职位 / 城市 | 开 | 简历里的期望职位是精心写的、不想被覆盖时 |
| 投递成功后提示记账 | 开 | 嫌提示卡吵时 |

---

## 支持的站点

**招聘平台（6）**
BOSS直聘 · 智联招聘 · 前程无忧 · 拉勾 · 猎聘 · 实习僧

**ATS 招聘系统（2）**
Moka 招聘系统 · 北森招聘系统

**企业校招（7）**
牛客网校招 · 快手校招 · 字节跳动招聘 · 美团招聘 · 华为招聘 · 腾讯招聘 · 阿里巴巴招聘

**未列出的站点也能用**：会走智能识别兜底（按 placeholder、标签、`name`、`aria-label` 匹配）。
识别不准的框，用「🎯 点选生成适配器」教它一次即可，不必等作者加适配。

---

## 数据与隐私

**所有数据只存在你自己浏览器里**（`chrome.storage.local`），插件不收集、不上传任何信息，没有后端、没有统计埋点。

- `defaults.js` 是纯空模板，不含任何个人信息
- 仓库里只放 `user-defaults.example.js`（空模板，可安全入库）。真实简历数据放在 `user-defaults.js`，
  该文件已加入 `.gitignore`，不会随开源仓库泄露身份证号、手机号、邮箱
- 该文件缺失时插件仍能正常运行（退化成空模板）；需要预填时，把 `user-defaults.example.js`
  复制一份为 `user-defaults.js` 再填入自己的信息，**并且不要提交它**
- `build-firefox.ps1` 的排除名单里也写了 `user-defaults.js`，避免打包时把个人档案一起打进 zip
- 台账、字段记忆、方案数据同样只在本机

**备份建议**：弹窗底部「导出 JSON」可以导出全部方案，换电脑或重装时导入即可。

---

## 常见问题

**Q：点了填写，但某个框没反应？**
先看战报里那一组的分类。「插件没填上的」会带具体原因（如选项里没有这个值）；「没认出来的空白框」说明插件不认识这个字段——点它右侧的「记住」教一次即可。

**Q：会不会覆盖我已经填好的内容？**
默认不会，「只填空白框」是默认开启的。想强制覆盖，把它关掉。

**Q：填错了怎么恢复？**
按 `Ctrl+Shift+Z`，或点悬浮球菜单里的「↩ 撤销上次填写」。页面刷新后快照失效，会提示需要重新填写（这是刻意的，比悄悄恢复到错误状态安全）。

**Q：为什么某个下拉没填，明明页面上有这个选项？**
因为插件没找到**安全的**匹配。它宁可留空也不猜——猜错的政治面貌/学历是减分项，空着的 HR 会略过。
战报里会把这个下拉实际有哪些选项列出来，你一眼就能手动选。
如果经常遇到，说明这个词该加进 `content/lexicon.js`，跑一遍 `node test/matcher.js` 就能确认没改坏别的。

**Q：为什么「非全日制本科」明明包含「本科」，却没被选中？**
这是刻意拦掉的。`非全日制本科` 和 `全日制本科` 字面上高度重合但语义相反，
匹配器会把这类「去掉否定词后核心相同」的选项直接判 0 分。同理还有 `非党员`、`没有` 这类写法。
这条规则没有开关，也不会因为字段敏不敏感而放宽。

**Q：为什么插件把期望职位改成了别的？**
这是第 6 条功能，从岗位页标题推断出来的，并在战报里提示了。不想用就在「⚙️ 填写选项」里关掉「按当前岗位自动调整期望职位 / 城市」。

**Q：悬浮球不见了？**
只在「已适配站点」或页面上有 ≥3 个可填控件时才出现。另外检查「在表单页显示悬浮球」开关是否被关掉。

**Q：升级后我的简历数据还在吗？**
在。升级时会自动把原有数据包成一套「默认方案」，不丢内容、不改内容。

**Q：投递成功页没弹提示卡？**
成功页检测是启发式的，遇到没见过的文案可能识别不到。用悬浮球的「📝 记一笔投递」兜底即可。

**Q：台账能存多少条？**
最多 500 条，超出丢最旧的。建议定期导出 CSV 留档。

---

## 开发与测试

无需构建步骤，改完源码在扩展管理页点「重新加载」即可。

**静态检查与纯逻辑单测（秒级）：**

```bash
node test/check.js    # 引用完整性、id 存在性、开关接线、注入顺序、manifest 一致性
node test/logic.js    # 省市区拆分、日期解析、字段归一化、组件类型判定、匹配器、经历块迁移（46 项）
```

**跑完整测试页（真在无头浏览器里跑一遍）：**

```bash
node test/run-page.js v5-step5.html
```

**跑弹窗布局验证（量「字段编辑区拿到了多少高度」）：**

```bash
node test/run-popup.js          # 把 popup.html 当普通网页打开，注入 chrome 替身，量各区块实际尺寸
node test/run-popup.js --shot   # 额外存两张渲染截图（收起态 / 展开态）便于肉眼核对
```

**或者起本地服务器用浏览器看可视化结果：**

```bash
node test/serve.js
# 第一步 http://localhost:8791/test/v2-step1.html
# 第二步 http://localhost:8791/test/v2-step2.html
# 第三步 http://localhost:8791/test/v3-step3.html
# 第四步 http://localhost:8791/test/v4-step4.html
# 第五步 http://localhost:8791/test/v5-step5.html
# 显隐回归 http://localhost:8791/test/v6-hud-visible.html
# 下拉匹配端到端 http://localhost:8791/test/v7-match.html
# 学位 / 学习形式端到端 http://localhost:8791/test/v8-degree-mode.html
# 导入文件编码与乱码 http://localhost:8791/test/v9-file-import.html
# 家庭情况 / 紧急联系人 http://localhost:8791/test/v10-family.html
```

**测试覆盖：**

| 测试 | 断言数 | 覆盖内容 |
|---|---|---|
| `test/v2-step1.html` | 11 | 非原生下拉、日期、省市区级联、经历块增行、附件上传、防误填 |
| `test/v2-step2.html` | 26 | 只填空白框、战报计数、点条目高亮、撤销四入口、快捷键 |
| `test/v3-step3.html` | 43 | 选择器生成、指纹兜底、记忆优先级与回退、战报「记住」、点选全流程 |
| `test/v4-step4.html` | 53 | 方案迁移、镜像同步、附件去重、增删改复制、导入导出、推断 19 用例 |
| `test/v5-step5.html` | 50 | 台账存储与去重、状态流转、统计口径、CSV 转义、成功页判别、确认卡 |
| `test/v6-hud-visible.html` | 41 | 全部 7 个浮层的显隐：初始隐藏、关闭按钮、模态互斥、战报选项行 |
| `test/v7-match.html` | 22 | 选项匹配端到端：同义写法、否定词红线、匹配不上留空、战报列选项、撤销、**标签写成「英语水平/英语能力/语言能力」也能识别并选中「四级」短选项** |
| `test/v8-degree-mode.html` | 14 | 学位与学习形式端到端：长写法选项、学历学位不串味、绝不选中「无」、撤销 |
| `test/v9-file-import.html` | 24 | 导入文件：GBK / UTF-8 / UTF-16 编码识别、魔数判格式、旧 .doc 与二进制拦截、docx（压缩/未压缩）、PDF（字面量 / 十六进制 / FlateDecode / 子集字体）、换行保留、双层体检 |
| `test/v10-family.html` | 28 | 家庭情况端到端：没有「添加」按钮也能定位、成员姓名/电话不与被本人的串、紧急联系人、页面上存在「添加」提示文字时的抗干扰、块里没数据时宁可留空 |
| `test/matcher.js` | 91 | 选项匹配用例集（正确率 100%、错选 0） |
| `test/logic.js` | 46 | 纯函数单测（省市区拆分、日期解析、控件判定、匹配器、经历块迁移） |
| `test/run-popup.js` | 26 | 弹窗布局：5 个面板收在折叠区内、字段编辑区 ≥ 350px 且占弹窗一半以上、两处提示单行折叠与点击展开、展开设置时字段区让位但不溢出弹窗 |

合计 **312 项页面断言 + 26 项弹窗布局检查 + 91 组匹配用例 + 46 项纯函数单测**（另加 `test/check.js` 静态检查），当前全部通过。

单独跑匹配用例（最快，不启动浏览器）：

```bash
node test/matcher.js        # 91 组「简历值 × 页面选项集」，含否定词对抗用例
node test/logic.js          # 纯函数单测
node test/check.js          # 静态检查：加载顺序、接线、[hidden] 兜底
```

**四个已知的测试环境注意事项：**

1. `node test/run-page.js ... | head` 之类的管道会因 SIGPIPE 导致输出为空（进程其实已跑完）。
   要抓结果请重定向到文件再读：`node test/run-page.js v7-match.html > out.log 2>&1`
2. 弹窗不是标签页，`run-page.js` 跑不了它 —— 用 `node test/run-popup.js`。
   它靠 `addInitScript` 注入 `chrome` 替身，所以弹窗那条链路上不能出现替身没覆盖的 API；
   新增 `chrome.*` 调用时要同步补进 `test/run-popup.js` 里的替身。
3. 要自动化加载扩展实测真实站点，换 **Chrome for Testing**（或 Chromium）：`--load-extension`
   的封禁只作用于 Google 品牌 Chrome，这两个照常工作。测试页本身是普通网页（mock 了 `chrome`
   API），验证的是**逻辑**；扩展在真实网站上的表现仍需手动实测。
4. 无头 Chrome 偶尔会卡住不退出，日志里已经写好了结果但进程挂着。
   `run-page.js` 里已装了两层自保，正常情况下**不用再手动加 `timeout`**：
   - 结果读到后立刻装 8 秒强制退出定时器（注意它必须装在读结果之后、任何诊断读取之前，
     挂在函数末尾等于没有 —— 页面一卡死就永远走不到那一步）；
   - 全局看门狗 75 秒，覆盖「启动浏览器 → 打开页面 → 等测试跑完」全流程，超时以
     **退出码 2** 退出，用来和「断言失败(1)」区分开：
     `exit=2` 说明是无头浏览器卡住，不是你的代码有问题，重跑一次即可。
   真机实测：单页约 11 秒；以前连续跑 10 页会有 6 页被外层 `timeout` 杀掉、拿到
   `exit=124` 这种「明明全过却不是 0」的假失败。
   仍然卡死时用 PowerShell `Stop-Process -Name chrome -Force` 清进程。

> **写测试时注意**：断言浮层显隐请用 `vis(el)`（看 `getComputedStyle` 的实际渲染结果），
> **不要只看 `el.hidden` 属性** —— 面板样式里声明 `display` 时，`hidden` 会被静默覆盖，
> 只看属性会得到「假通过」。`v2-step2` / `v3-step3` / `v5-step5` 里的相关断言都已按这个原则改过。

> **写弹窗样式时注意**：`body` 是 flex 列布局、高度又锁在 600px，上方每个区块多占 1px，
> 字段区就少 1px；更麻烦的是空间不够时浏览器会**按比例压扁**上方的 flex item
> （两处折叠提示曾被压成 1px 高的一条线，`hidden` 属性看不出任何异常）。
> 新增区块记得加 `flex: 0 0 auto`，改完跑一遍 `node test/run-popup.js` 核账目。

---

## 新增站点适配

在 [`content/sites.js`](content/sites.js) 的 `JIANLI_SITE_ADAPTERS` 中追加一条即可：

```js
{
  id: "mokahr",
  name: "Moka 招聘系统",
  hosts: ["mokahr.com", "app.mokahr.com"],
  fields: {
    name: ['input[name="candidateName"]'],
    position: ['#expectPosition'],
    school: ["input.school", "#eduSchool"],
  },
}
```

更快的办法：用悬浮球的「🎯 点选生成适配器」，点完直接「复制代码」，粘进来即可。

欢迎通过 Issue 反馈网站改版导致的适配问题——附上站点域名和填不上的字段名最有用。

---

## 项目结构

```
.
├── manifest.json              # Chrome / Edge MV3 清单
├── manifest.firefox.json      # Firefox 清单
├── build-firefox.ps1          # 打包 Firefox 版本的脚本
├── background.js              # Service Worker：右键菜单、消息路由、自动填写调度
├── defaults.js                # 默认设置与空模板（不含任何个人信息）
├── user-defaults.example.js   # 简历数据模板（可安全入库）
├── user-defaults.js           # 真实简历数据（可选，自行复制 example 后填写；已 gitignore）
├── profiles.js                # 多套简历方案存储层
├── content/                   # 内容脚本，按以下顺序注入（顺序不可乱）
│   ├── lexicon.js             #   选项同义词词表（纯数据，想加词改这里）
│   ├── matcher.js             #   统一选项匹配器（归一化 + 打分 + 阈值，纯函数）
│   ├── sites.js               #   站点适配器、字段分组、识别规则
│   ├── widgets.js             #   组件型控件适配：下拉 / 日期 / 级联
│   ├── blocks.js              #   重复经历块增行、附件上传
│   ├── memory.js              #   字段映射记忆（选择器 + 指纹）
│   ├── infer.js               #   岗位 / 城市 / 公司名推断
│   ├── ledger.js              #   投递台账存储与成功页判别
│   ├── hud.js                 #   悬浮球、战报浮层、点选面板、确认卡
│   └── content.js             #   主控：填写引擎、消息处理、入口编排
├── popup/                     # 弹窗界面（html / css / js）
├── icons/                     # 图标
├── test/                      # 测试工具与测试页
└── 更新日志.md / 优化报告.html  # 改动记录
```

> ⚠️ `content_scripts` 的注入顺序必须是 `lexicon → matcher → sites → widgets → blocks → memory → infer → ledger → hud → content`。
> 后面的模块依赖前面挂在 `window` 上的全局对象。`test/check.js` 会强制校验这个顺序、
> `background.js` 的注入清单与 manifest 是否一致，以及四个匹配调用点是否都接上了 `matcher.js`。

---

## 许可证

[MIT](LICENSE)

---

## English

> **Resume Autofill Assistant** (简历助手) — a Manifest V3 browser extension for **Chrome / Edge** that fills out online resume and job-application forms on Chinese job boards in one click, and keeps a record of every application you submit.

**Why I built this.** During campus-recruiting season you may apply to a dozen companies a day, and every single one asks you to retype your name, phone number, education and four experience blocks by hand. After submitting you can't even remember who you applied to or where each application stands. So this is more than "auto-fill" — it does three things well: **fill accurately, learn from you, and remember everything.**

> Current version **2.4.1** (2026-09-16). Full changelog in [`更新日志.md`](更新日志.md); a summary of the September 2026 optimization pass is in [`优化报告.html`](优化报告.html).

### What it solves

| The pain | What the extension does |
|---|---|
| Dropdowns that don't respond to clicks, date pickers that won't open, region selectors that only fill the first level | Drives component-based widgets (antd / Element) with simulated real clicks, level by level — not relying on native `<select>` |
| A company wants four experience blocks but the page only shows one row | Counts the gap and clicks "＋ Add" until there are enough rows, then fills each |
| After filling you don't know what got filled and what didn't | Shows a **fill report** listing filled / failed (with reasons) / unrecognized fields; click an item to jump straight to it |
| You accidentally overwrite content already on the page | Fills **blank fields only** by default, with one-click undo to revert |
| The extension can't recognize a field, so you wait for the author to patch it | Teach it yourself with two clicks on the page — remembered permanently |
| One resume for every job, so you apply to a Java role with "Mechanical Structure Engineer" | Infers the target position and city from the job-page title |
| Mechanical vs hardware roles need different resumes, easily mixed up | Maintains multiple resume profiles that switch fields / experience blocks / attachments together |
| Applied to dozens of companies and forgot them all | An application ledger: auto-detects success pages + manual entry, with stats and CSV export |

### Features

#### 1. One-click fill (including component-based forms)
Open a job board's resume or application page and click **⚡ Fill Current Page** — dozens of fields fill in and highlight green.

It doesn't just set `value`: campus-recruiting sites render "fake forms" with component libraries like antd / Element, where the native approach completely fails. So there's a dedicated adaptation layer:

- **Smart dropdown matching** (see §2) — consistent results everywhere
- **Non-native dropdowns** — simulate `mousedown` to open the panel, pick with the same matcher, then click
- **Date pickers** — try direct assignment first; if that fails, open the panel and click year → month → day; supports both year-month and full-date pickers
- **Cascading province / city / district** — splits "Jilin Changchun Nanguan" and clicks each level; supports autonomous regions, prefectures, municipalities, and separate-list cities
- **Repeatable experience blocks** — education / internship / project / work; auto-clicks "＋ Add" when there aren't enough rows
- **Family info** — member name / relation / employer / age / phone. Locatable even when there is **no "Add" button** (just a fixed form); the whole block is isolated (marked "exclusive") so members' names / phones aren't grabbed by your own placeholders
- **Safe-by-default** — skips password, captcha and search boxes
- **Heuristic fallback** — when a site isn't specifically adapted, still recognizes fields by placeholder, label text, `name`, and `aria-label`

#### 2. Smart dropdown matching (leave blank rather than guess wrong)
Your resume says "CET-6" but the page says "英语六级" (CET-6); your resume says "汉" (Han) but the page says "汉族" (Han). These used to fail.
Worse are cases where the literal text matches but the meaning is opposite: when your resume says "本科" (bachelor's), `非全日制本科` (part-time bachelor's) **contains "本科" literally** and could have been selected. You wouldn't notice until the resume was already sent.

Now all dropdowns, radio groups and region cascades go through one matcher (native / antd / Element / radio — four algorithms merged into one), scored by these tiers, and **anything below 55 is left blank**:

| Judgment | Example |
|---|---|
| Exact match | `本科` = `本科` |
| Synonym (lexicon) | `CET-6` → `英语六级`; `汉` → `汉族`; `共青团员` → `团员` |
| Long/short form (lexicon) | `全日制` → `全国普通高等院校全日制`; `学士` → `学士学位` |
| Parenthesized alias | `英语四级（CET-4）` → `CET-4` |
| Same after stripping modifiers | `本科` → `本科及以上` |
| Different place-name suffix | `北京` → `北京市` |
| Same calendar day | `2005-05` → `2005年5月` |
| Numeric / range hit | `175` → `170-175cm` |
| Substring match (length ratio ≥ 0.6) | `本科` → `全日制本科` |
| **Negation word, opposite meaning → 0** | **`本科` ✗ `非全日制本科`; `中共党员` ✗ `非党员`** |

**Core rule: better blank than wrong.** HR skips an empty box; a wrong political status is a minus.
The long/short-form tier deserves a note: when the page writes "全国普通高等院校全日制" (11 chars) but your resume stores "全日制" (3 chars), the literal length ratio is only **0.27**, below the 0.6 substring threshold — the algorithm can never reach it. These must be recognized as synonyms via the lexicon (`study_mode` in `content/lexicon.js`).

When matching fails, the report shows you **every option the dropdown actually has**, so you can pick manually at a glance. If you really want to teach it, use **🎯 Click-to-adapt** once and it's recognized next time.

To add a synonym, edit only `content/lexicon.js` (pure data — a synonym table for 14 high-frequency enum fields), then run `node test/matcher.js` to confirm nothing regressed.

> `degree` and `degree_name` are two separate fields: `degree` answers "本科" (bachelor's), `degree_name` answers "学士" (Bachelor). The first option of a degree dropdown is often "无" (none), which scores 0 under the no-negation-word rule and is never mis-selected.

#### 3. Floating ball · one-click undo · fill report
A draggable floating ball appears at the bottom-right of form pages (isolated by Shadow DOM, so site styles can't break it):

- Tap to expand the menu: **Fill current page / Undo last fill / Click-to-adapt / Log an application**
- Drag to reposition; position is remembered
- Only appears on "adapted sites" or pages with ≥3 fillable controls, so it won't float everywhere

**Fill report**: a small card floats up after filling, telling you exactly what happened:

- Top summary `Filled 12 · To fill manually 3`
- Three groups: **what the extension didn't fill** (with reasons, e.g. "no '共青团员' in options"), **blank fields it couldn't recognize**, and **fields it knows but your resume left empty**
- **Click any item and the page scrolls to and highlights that field** — no more hunting by eye
- Auto-collapses after 15s; stays if you hover

**One-click undo**: snapshots every control's original value before filling; undo restores each and clears the green highlights. Four entry points: floating-ball menu / "↩ Undo this fill" in the report / popup button / shortcut `Ctrl+Shift+Z`. Repeated undo clearly says "no fill record to undo" instead of failing silently.

#### 4. Field memory + click-to-adapt
For fields the extension can't recognize, teach it right on the page — **once is enough**.

- **From the report**: each "unrecognized blank field" row has a "Remember" button → a field picker (with search) → select → the extension remembers immediately and **fills once with the new mapping on the spot**
- **Active clicking (recommended for a new site)**: floating ball → "🎯 Click-to-adapt" → inputs outline blue on hover → click the field to record → pick the field → green outline means collected. The panel lets you "keep clicking / copy code / done"; `Esc` to exit

**What you teach survives redesigns**: it stores both a "precise selector" and a "fingerprint" (tag + name / placeholder / label text). If the selector breaks, it falls back to the fingerprint; if the selector isn't unique on the page it **refuses to recognize rather than fill the wrong box**.

**Hit priority: field memory > site adapter > heuristic recognition.** What you manually confirmed always beats machine guessing.

After clicking you can "copy code" to generate an adapter snippet that drops straight into [`content/sites.js`](content/sites.js), turning that day's temporary teaching into a permanent adaptation.

#### 5. Multiple resume profiles
One resume for every job is wasteful. The popup top has a profile bar: dropdown to switch, `＋` new, `⧉` duplicate, `✎` rename, `🗑` delete.

- One profile = **field data + experience blocks + attachments**, all three switch together
- **Switching is manual** — it won't silently swap your resume just because you viewed a new posting today
- Attachments are deduplicated by content; duplicating a profile stores one reference, so storage doesn't blow up
- Upgrading from an old version wraps your existing resume into a "default profile" automatically — no data loss

#### 6. Auto-inferred target position & city
Job-board titles almost always carry the role (e.g. `字节跳动-后端开发工程师-校招`). Before filling, the extension reads the title to infer role and city; **the inferred value overrides what's hardcoded in your resume**, and the report calls it out separately ("position adjusted to XXX for this page"), so you always know when filled ≠ written.

Inference is scored: split the title by delimiters, +10 for a role word, −12 for a company word, −20 for a site word, take the highest segment; any segment without a role word is dropped — **better blank than wrong**. A slash only counts as a delimiter when both sides have spaces, so "C/C++开发工程师" isn't split.

Don't want this? Turn it off in the popup.

#### 7. Automatic application ledger
Turn applications into trackable data. One record holds: company, role, city, link, source site, status, note, time.

**State machine**: `Applied → Exam → Interviewing → Offer / Rejected·No response`

**Three ways to log:**

1. **Auto-prompt after success** — 2.6s after submitting, the extension checks if the current page is an "application submitted" page and prompts to confirm. **Never logs automatically**: a wrong log is harder to clean up than a missed one
2. **Floating-ball menu → "📝 Log an application"** — when you don't want to wait for detection
3. **Popup → Ledger → "✎ Add manually"** — for applications submitted via the official site or referral

**In the popup you can**: see how many you applied to today / this week and how many are still pending; filter by status, search by keyword (company / role / note); change status, edit notes, delete, clear; export CSV (with UTF-8 BOM so Excel opens it cleanly).

The same role logged twice is de-duplicated by link and merged — no duplicate rows.

#### 8. Misc
- **Resume recognition**: paste full resume text or import `.txt` / `.docx` / `.pdf`; auto-detects name, phone, education, experience, etc. On import it sniffs the format by **file header** and the encoding by **BOM / UTF-16 signature / strict UTF-8 / GBK candidate scoring** — ANSI(GBK) txt exported by Chinese Windows no longer comes out garbled. When it can't extract reliable text (scanned PDF, legacy `.doc`, subset-font PDF) it **errors out explicitly rather than filling garbage**
- **Custom fields**: for site-specific fields, add "field name + content" yourself and it matches automatically when filling
- **Auto-upload resume attachment**: upload once in the popup; on fill it's dropped into the page's attachment box (via `DataTransfer`, falling back to dispatching a `drop` event if rejected)

### Install

1. Download or clone this repository
2. Open the extensions page: Edge → `edge://extensions/`; Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked** and select this repository folder
5. The 📋 icon appears in your toolbar — pin it for easy access

**Update an existing install**: click 🔄 **Reload** on the card in the extensions page. After changing the manifest or adding a content script, a reload is required for changes to take effect.

> Firefox users: the repo ships `manifest.firefox.json` and `build-firefox.ps1`. Run the script to generate `dist-firefox/`, then load it via `about:debugging` → This Firefox → Load Temporary Add-on.

### Quick start

**First time (about 5 minutes):**

1. Click the 📋 icon to open the popup
2. Expand **📥 Resume recognition**, paste your resume text or import a file → click **🔍 Recognize** → then **✓ Apply to resume data**
   (you can also skip this and fill fields by hand; changes save automatically)
3. Expand **📎 Resume attachment** and pick a resume PDF — it'll be uploaded automatically on fill
4. Close the popup and open a job board's resume or application page

**Every time you apply:**

1. Floating ball → **⚡ Fill Current Page**, or press `Ctrl+Shift+F`, or right-click → "Fill this page with resume data"
2. Check the report at the bottom-right: green = filled; click an item to jump to that field; click "Remember" on unrecognized fields to teach it
3. Filled something wrong? Press `Ctrl+Shift+Z` to undo
4. After submitting, the success page prompts a card → click "Log it"
5. Periodically open the popup's **📝 Ledger** to review stats, update statuses, and export CSV when needed

**Applying to multiple directions:**

- In the popup profile bar, `＋` new "Mechanical", then `⧉` duplicate into "Hardware", edit fields and attachments each
- Switch profiles from the dropdown before applying
- On first encounter with a new site, use the floating ball's "🎯 Click-to-adapt" to teach the unrecognized fields once

### UI walkthrough

#### Popup
The popup's total height is capped at 600px by the browser, so space goes to "resume editing" — only the few lines you need every time stay on top, and the five config panels collapse into a single "⚙️ More settings" row.

| Block | Purpose |
|---|---|
| Top buttons | **⚡ Fill Current Page**, `↩` undo, `⧉` standalone window, `✕` close |
| Site hint | The detected site, number of remembered mappings, inferred role. **Collapsed to one line by default**; click to expand, or hover to see all |
| Resume profile | Dropdown + `＋` `⧉` `✎` `🗑`; a sub-line shows the current profile's field / experience / attachment counts, also expandable |
| ⚙️ More settings | Collapsed area holding the 5 panels below (its own scroll limit so it never pushes the field area out) |
| └ 📥 Resume recognition | Paste text or import txt / docx / pdf (auto-detects encoding & format), fills blank fields after recognition |
| └ 📎 Resume attachment | Upload a resume file, auto-attached on fill (follows the profile) |
| └ ⚙️ Fill options | 8 toggles + shortcut choice |
| └ 🧠 Field memory | View remembered mappings per site; delete one / clear this site / clear all / copy this site's adapter code |
| └ 📝 Ledger | Stats, filter, search, add, change status, export CSV, clear |
| 🔍 Scan this page's fields | Lists every fillable field on the page (label / placeholder / control type / matched plugin field) — for diagnosing "why wasn't this box recognized" |
| Resume editing | Grouped: basics / education / job intent / experience & intro; auto-saved |
| Experience blocks | Education / internship / project / work / family; add/remove entries, edit field by field (for multi-row experience forms) |
| Custom fields | Add site-specific "name + content" that matches automatically on fill |
| Import / Export | Export JSON / Import JSON (all profiles) for backup or moving machines; plus restore defaults |

#### Floating ball (bottom-right of form pages)
Four menu items: **⚡ Fill Current Page**, **↩ Undo last fill**, **🎯 Click-to-adapt**, **📝 Log an application**. Can be turned off in **⚙️ Fill options**.

#### Right-click menu
- Fill this page with resume data
- Undo last fill (restore original values)

### Shortcuts & toggles

| Action | Default shortcut |
|---|---|
| Fill current page | `Ctrl+Shift+F` |
| Undo last fill | `Ctrl+Shift+Z` |
| Exit picking mode | `Esc` |

The fill key can be changed to `Alt+Shift+F` / `Alt+Q` / `Ctrl+Shift+U`, or turned off entirely (undo key is fixed).

**The 8 toggles in ⚙️ Fill options:**

| Toggle | Default | When to turn it off |
|---|---|---|
| Fill blank fields only (don't overwrite existing content) | On | When you want resume data to force-overwrite what's on the page |
| Deep-fill component widgets | On | When a site's widgets misbehave and filling stalls — turn off to troubleshoot |
| Auto-upload resume attachment | On | When you don't want to re-upload the attachment for every application |
| Show floating ball on form pages | On | When the site's bottom-right button is obscured |
| Auto-fill on entering an adapted site | Off | Turn on for full auto-fill (off by default to avoid misfires) |
| Prefer field memory | On | When you want to compare pure heuristic recognition |
| Auto-adjust expected position / city by current role | On | When your resume's expected position is carefully written and you don't want it overridden |
| Prompt to log after success | On | When the prompt card feels noisy |

### Supported sites

**Job platforms (6)**
BOSS直聘 · 智联招聘 · 前程无忧 · 拉勾 · 猎聘 · 实习僧

**ATS systems (2)**
Moka · 北森

**Corporate campus recruiting (7)**
牛客网校招 · 快手校招 · 字节跳动招聘 · 美团招聘 · 华为招聘 · 腾讯招聘 · 阿里巴巴招聘

**Unlisted sites still work**: they fall back to heuristic matching (placeholder / label / `name` / `aria-label`). For inaccurately recognized fields, teach it once with "🎯 Click-to-adapt" — no need to wait for the author.

### Data & privacy

**All data lives only in your own browser** (`chrome.storage.local`). The extension collects and uploads nothing — no backend, no analytics.

- `defaults.js` is a pure empty template with no personal information
- The repo only ships `user-defaults.example.js` (empty template, safe to commit). Your real resume data lives in `user-defaults.js`, which is in `.gitignore` and never leaks your ID number, phone, or email through the open-source repo
- The extension still runs fine without that file (degrades to the empty template); to pre-fill, copy `user-defaults.example.js` to `user-defaults.js` and fill in your info — **and don't commit it**
- `build-firefox.ps1`'s exclude list also names `user-defaults.js`, so packaging never bundles your profile into the zip
- The ledger, field memory, and profile data are likewise local only

**Backup tip**: the popup's bottom "Export JSON" exports all profiles — import on a new machine or after a reinstall.

### FAQ

**Q: I clicked fill but a box didn't respond?**
Check the group in the report. "Not filled by the extension" carries a reason (e.g. "no such value in options"); "unrecognized blank field" means the extension doesn't know the field — click "Remember" next to it to teach it once.

**Q: Will it overwrite what I already filled?**
Not by default — "fill blank fields only" is on. Turn it off to force-overwrite.

**Q: How do I undo a mistake?**
Press `Ctrl+Shift+Z`, or the floating-ball menu's "↩ Undo last fill". After a page reload the snapshot is gone and it'll tell you to refill (deliberate — safer than silently restoring a wrong state).

**Q: Why wasn't a dropdown filled when the option is right there on the page?**
Because the extension found no *safe* match. It prefers blank over guessing — a wrong political status or education is a minus, an empty box HR skips. The report lists the dropdown's actual options so you can pick manually at a glance. If it happens often, the word belongs in `content/lexicon.js`; run `node test/matcher.js` to confirm nothing else broke.

**Q: Why wasn't `非全日制本科` selected even though it contains `本科`?**
Deliberately blocked. `非全日制本科` and `全日制本科` overlap heavily in text but mean opposite things; the matcher scores such "core-same-after-stripping-negation" options as 0. Same for `非党员`, `没有`, etc. This rule has no toggle and isn't relaxed for sensitive fields.

**Q: Why did the extension change my expected position?**
That's feature §6, inferred from the job-page title, and flagged in the report. Don't want it? Turn off "Auto-adjust expected position / city by current role" in ⚙️ Fill options.

**Q: The floating ball disappeared?**
It only shows on adapted sites or pages with ≥3 fillable controls. Also check whether "Show floating ball on form pages" is off.

**Q: Is my resume data still there after an upgrade?**
Yes. Upgrade wraps your existing data into a "default profile" automatically — nothing lost or changed.

**Q: No prompt card on the success page?**
Success-page detection is heuristic and may miss unseen wording. Use the floating ball's "📝 Log an application" as a fallback.

**Q: How many ledger entries can it hold?**
Up to 500; oldest are dropped beyond that. Export CSV periodically for the record.

### Development & testing

No build step — edit source and click "Reload" in the extensions page.

**Static checks & pure-logic unit tests (seconds):**

```bash
node test/check.js    # reference integrity, id existence, toggle wiring, injection order, manifest consistency
node test/logic.js    # region split, date parsing, field normalization, widget-type judgment, matcher, block migration (46 cases)
```

**Run a full test page (really runs in a headless browser):**

```bash
node test/run-page.js v5-step5.html
```

**Run popup-layout verification (measures how much height the field area actually got):**

```bash
node test/run-popup.js          # opens popup.html as a normal page, injects a chrome stub, measures real block sizes
node test/run-popup.js --shot   # also saves two render screenshots (collapsed / expanded) for eyeballing
```

**Or serve locally and view visual results in a browser:**

```bash
node test/serve.js
# step 1  http://localhost:8791/test/v2-step1.html
# step 2  http://localhost:8791/test/v2-step2.html
# step 3  http://localhost:8791/test/v3-step3.html
# step 4  http://localhost:8791/test/v4-step4.html
# step 5  http://localhost:8791/test/v5-step5.html
# show/hide regression  http://localhost:8791/test/v6-hud-visible.html
# dropdown matching E2E  http://localhost:8791/test/v7-match.html
# degree / study-mode E2E  http://localhost:8791/test/v8-degree-mode.html
# import encoding & garbage  http://localhost:8791/test/v9-file-import.html
# family / emergency contact  http://localhost:8791/test/v10-family.html
```

**Test coverage:**

| Test | Assertions | Covers |
|---|---|---|
| `test/v2-step1.html` | 11 | non-native dropdown, date, region cascade, experience-block row add, attachment upload, anti-misfill |
| `test/v2-step2.html` | 26 | blank-only fill, report counting, item-click highlight, 4 undo entries, shortcuts |
| `test/v3-step3.html` | 43 | selector generation, fingerprint fallback, memory priority & fallback, report "remember", full click flow |
| `test/v4-step4.html` | 53 | profile migration, mirror sync, attachment dedup, add/edit/delete/duplicate, import/export, 19 inference cases |
| `test/v5-step5.html` | 50 | ledger storage & dedup, status flow, statistics, CSV escaping, success-page judgment, confirm card |
| `test/v6-hud-visible.html` | 41 | all 7 overlays' show/hide: initial hidden, close button, modal mutual-exclusion, report option rows |
| `test/v7-match.html` | 22 | dropdown matching E2E: synonyms, negation red line, blank-on-miss, report lists options, undo, **labels written as "英语水平/英语能力/语言能力" still recognized and select the "四级" short option** |
| `test/v8-degree-mode.html` | 14 | degree & study-mode E2E: long-form options, degree/study-mode don't bleed, never select "无", undo |
| `test/v9-file-import.html` | 24 | file import: GBK / UTF-8 / UTF-16 detection, magic-number format, legacy .doc & binary rejection, docx (compressed/raw), PDF (literal / hex / FlateDecode / subset-font), newline preservation, two-layer check |
| `test/v10-family.html` | 28 | family E2E: locatable with no "Add" button, member name/phone not grabbed by yours, emergency contact, anti-interference when an "Add" prompt string exists on the page, prefers blank when the block has no data |
| `test/matcher.js` | 91 | option-matching case set (100% correct, 0 wrong selections) |
| `test/logic.js` | 46 | pure-function unit tests (region split, date parse, control judgment, matcher, block migration) |
| `test/run-popup.js` | 26 | popup layout: 5 panels inside the collapsed area, field area ≥ 350px and over half the popup, two hints single-line collapsed + click-to-expand, field area yields but doesn't overflow when settings expand |

Total **312 page assertions + 26 popup-layout checks + 91 matcher cases + 46 pure-function unit tests** (plus the `test/check.js` static check) — all passing currently.

Run matcher cases alone (fastest, no browser):

```bash
node test/matcher.js        # 91 "resume value × page option set" cases, including negation adversarial cases
node test/logic.js          # pure-function unit tests
node test/check.js          # static check: load order, wiring, [hidden] fallback
```

**Four known test-environment caveats:**

1. Pipes like `node test/run-page.js ... | head` swallow output via SIGPIPE (the process actually finished). Redirect to a file instead: `node test/run-page.js v7-match.html > out.log 2>&1`
2. The popup isn't a tab, so `run-page.js` can't run it — use `node test/run-popup.js`. It injects a `chrome` stub via `addInitScript`, so no stub-uncovered API may appear on that path; when adding a `chrome.*` call, also add it to the stub in `test/run-popup.js`.
3. To automate loading the extension against real sites, use **Chrome for Testing** (or Chromium): the `--load-extension` ban applies only to Google-branded Chrome; these two work. The test pages are plain web pages (mocking `chrome` APIs) verifying **logic**; the extension's behavior on real sites still needs manual testing.
4. Headless Chrome occasionally hangs and won't exit — the log already has the result but the process is stuck. `run-page.js` has two layers of self-protection, so normally **don't add `timeout` manually**:
   - a forced-exit timer is armed 8s after results are read (note it must be armed *after* reading results and *before* any diagnostic read — at the function's end it's as good as nothing, since a hang never reaches it);
   - a global 75s watchdog covering "launch browser → open page → wait for tests", exiting with **code 2** to distinguish from "assertion failed (1)": `exit=2` means headless Chrome hung, not your code — just rerun.
   On a real machine a single page takes ~11s; previously running all 10 pages consecutively got 6 killed by the outer `timeout`, yielding fake `exit=124` "all passed but not 0" failures. If still hung, `Stop-Process -Name chrome -Force` to clear.

> **When writing tests**: assert overlay show/hide with `vis(el)` (the actual rendered result from `getComputedStyle`), **not just the `el.hidden` attribute** — when a panel's style declares `display`, `hidden` is silently overridden and checking the attribute gives a false pass. The relevant assertions in `v2-step2` / `v3-step3` / `v5-step5` were already fixed to this principle.

> **When touching popup CSS**: `body` is a flex column capped at 600px, so every extra pixel above the field list is a pixel taken from it, and on overflow the browser **squeezes the upper flex items proportionally** (two collapsed hints were once squeezed to a 1px line, invisible via the `hidden` attribute). Add `flex: 0 0 auto` to new blocks, and re-run `node test/run-popup.js` to verify.

### Adding a site adapter

Append one entry to `JIANLI_SITE_ADAPTERS` in [`content/sites.js`](content/sites.js):

```js
{
  id: "mokahr",
  name: "Moka 招聘系统",
  hosts: ["mokahr.com", "app.mokahr.com"],
  fields: {
    name: ['input[name="candidateName"]'],
    position: ['#expectPosition'],
    school: ["input.school", "#eduSchool"],
  },
}
```

Faster: use the floating ball's "🎯 Click-to-adapt", click through, then "Copy code" and paste it in.

Issues reporting adaptation breakage from site redesigns are welcome — a site domain plus the un-fillable field name is the most useful.

### Project structure

```
.
├── manifest.json              # Chrome / Edge MV3 manifest
├── manifest.firefox.json      # Firefox manifest
├── build-firefox.ps1          # script to package the Firefox build
├── background.js              # Service Worker: context menu, message routing, auto-fill scheduling
├── defaults.js                # default settings & empty template (no personal info)
├── user-defaults.example.js   # resume data template (safe to commit)
├── user-defaults.js           # your real resume data (optional; copy from example and fill in; gitignored)
├── profiles.js                # multi-profile storage layer
├── content/                   # content scripts, injected in this order (order matters)
│   ├── lexicon.js             #   option synonym table (pure data; edit here to add words)
│   ├── matcher.js             #   unified option matcher (normalize + score + threshold, pure functions)
│   ├── sites.js               #   site adapters, field groups, recognition rules
│   ├── widgets.js             #   component-widget adaptation: dropdown / date / cascade
│   ├── blocks.js              #   repeatable experience-block row add, attachment upload
│   ├── memory.js              #   field-mapping memory (selector + fingerprint)
│   ├── infer.js               #   role / city / company inference
│   ├── ledger.js              #   application ledger storage & success-page detection
│   ├── hud.js                 #   floating ball, report overlay, click panel, confirm card
│   └── content.js             #   main: fill engine, message handling, entry orchestration
├── popup/                     # popup UI (html / css / js)
├── icons/                     # icons
├── test/                      # test tooling and test pages
└── 更新日志.md / 优化报告.html  # changelog
```

> ⚠️ The `content_scripts` injection order **must** be `lexicon → matcher → sites → widgets → blocks → memory → infer → ledger → hud → content`.
> Later modules depend on the `window` globals from earlier ones. `test/check.js` enforces this order, checks `background.js`'s injection list against the manifest, and verifies all four matcher call sites are wired to `matcher.js`.

### License

[MIT](LICENSE)
