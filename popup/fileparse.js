// ============================================================
// 文件解析模块：从 Word(.docx) / PDF / txt 简历中提取纯文本
// 依赖浏览器原生 DecompressionStream / TextDecoder
//
// 这个模块只有一件事做错了就会让用户看到一屏乱码，所以三条底线必须守住：
//
// 1) 编码不能猜「UTF-8 就算了」
//    Windows 中文环境里「记事本 / Word 另存为 txt」默认存的是 ANSI，也就
//    是 GBK。按 UTF-8 去读，一个汉字会变成一两个 \uFFFD 替换字符，夹杂
//    几个「ΰ」「ѧ」这样的怪字 —— 就是用户截图里那一屏乱码。
//
// 2) 扩展名不能信，二进制不能当文本读
//    旧版 .doc 是 OLE 二进制、.rtf 是带控制字的标记语言。凭扩展名分派，
//    一旦用户改了名或导出成别的格式，就会走进「按文本读」的死路。
//    所以一律先看文件头的魔数字节。
//
// 3) 兜底：宁可不填，不能填错
//    任何解析结果都要过一遍乱码体检（textHealth）。不合格就明确报错，
//    绝不把可疑文本塞进「简历全文」框 —— 因为下一步就是「应用到简历数据」，
//    乱码一旦被识别并应用，污染的是整份简历，比留空严重得多。
// ============================================================
(function () {
  const F = {};

  // ---------- 字节级工具 ----------

  // windows-1252 编码表对全部 256 个字节都有定义，永远不会产出替换字符，
  // 所以「1 字节 = 1 字符」，字符串下标可以直接当字节偏移用。
  // 这是唯一能安全地在二进制文件里做结构扫描的姿势：用 UTF-8 解码成字符串后
  // 再拿字符串下标去切字节数组，偏移量必然错位（非法字节被折叠成一个替换字符），
  // 切出来的「压缩流」也就必然是错的。
  let latin1 = null;
  try { latin1 = new TextDecoder("windows-1252"); } catch (e) { latin1 = null; }

  function decodeBytes(bytes) {
    if (latin1) {
      try { return latin1.decode(bytes); } catch (e) { /* 落到下面手工转 */ }
    }
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  // 入参可能是 ArrayBuffer 也可能是 Uint8Array（测试里直接传字节数组更方便），统一一下
  function toBytes(v) {
    return v instanceof Uint8Array ? v : new Uint8Array(v);
  }

  function startsWith(bytes, sig, offset) {
    offset = offset || 0;
    if (bytes.length < offset + sig.length) return false;
    for (let i = 0; i < sig.length; i++) {
      if (bytes[offset + i] !== sig[i]) return false;
    }
    return true;
  }

  async function inflate(bytes, format) {
    const ds = new DecompressionStream(format);
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // PDF 里 zlib 包法和裸 deflate 都存在，两种都试一遍
  async function tryInflate(bytes) {
    for (const fmt of ["deflate", "deflate-raw"]) {
      try { return await inflate(bytes, fmt); } catch (e) { /* 换一种再试 */ }
    }
    return null;
  }

  function encoder(label) {
    try { return new TextDecoder(label); } catch (e) { return null; }
  }
  const UTF8 = encoder("utf-8") || new TextDecoder();
  const UTF8_STRICT = (function () {
    try { return new TextDecoder("utf-8", { fatal: true }); } catch (e) { return null; }
  })();
  const GB18030 = encoder("gb18030") || encoder("gbk");
  const UTF16LE = encoder("utf-16le");
  const UTF16BE = encoder("utf-16be");

  // ---------- 文本体检（乱码防火墙）----------

  // 逐字符分类。可读 = 中日韩汉字 / 半角可见字符 / 中西文标点。
  function scanText(text) {
    const m = { total: text.length, cjk: 0, readable: 0, fffd: 0, nul: 0, ctrl: 0, pua: 0 };
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 0xFFFD) { m.fffd++; continue; }
      if (c === 0) { m.nul++; continue; }
      if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) { m.ctrl++; continue; }
      if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) { m.cjk++; m.readable++; continue; }
      if (c >= 0xe000 && c <= 0xf8ff) { m.pua++; continue; }   // 私有使用区
      if (c >= 0x20 && c <= 0x7e) { m.readable++; continue; }   // 半角可见
      if (c === 0x00a0) { m.readable++; continue; }
      if (c >= 0x2000 && c <= 0x206f) { m.readable++; continue; } // 通用标点
      if (c >= 0x3000 && c <= 0x303f) { m.readable++; continue; } // 中文标点
      if (c >= 0xff00 && c <= 0xffef) { m.readable++; continue; } // 全角
    }
    m.bad = m.fffd + m.nul + m.ctrl + m.pua;
    m.ratio = m.total ? m.readable / m.total : 0;
    return m;
  }

  // 返回 { ok, verdict, reason, metrics }。verdict：ok / warn / garbage
  // opts.lenient：用户自己粘贴的文本用宽松档 —— 只对「确定是乱码」的硬信号判死
  // （替换字符 / NUL / 控制字符），不用「可读比例」这条：手打或从各种奇怪来源
  // 复制来的文本里出现冷门符号很正常，误拦用户比漏放更烦人。
  function textHealth(text, opts) {
    const lenient = !!(opts && opts.lenient);
    if (!text || !text.trim()) {
      return { ok: false, verdict: "garbage", reason: "文件里没有可读文本", metrics: scanText(text || "") };
    }
    const m = scanText(text);
    const pct = Math.round(m.ratio * 100);

    let verdict = "ok";
    if (m.fffd >= 3 || m.nul > 0 || m.ctrl > 0 || m.pua >= 3) verdict = "garbage";
    else if (!lenient && m.total >= 40 && m.ratio < 0.5) verdict = "garbage";
    else if (m.fffd > 0 || (!lenient && m.total >= 40 && m.ratio < 0.8)) verdict = "warn";

    let reason = "";
    if (verdict === "garbage") {
      reason = (m.fffd || m.nul || m.ctrl)
        ? "检测到 " + m.bad + " 个无法解码的字符（文件编码不是 UTF-8，或这根本不是文本文件）"
        : "可读字符只占 " + pct + "%，这不像一份纯文本简历";
    }
    return { ok: verdict !== "garbage", verdict, reason, metrics: m, ratio: m.ratio, badChars: m.bad };
  }

  // ---------- 编码嗅探 ----------

  // 只在「不是合法 UTF-8」时才需要它：候选编码各解一遍，谁解出来的文本更像人话用谁。
  // 打分为「可读字符 + 汉字加权 − 异常字符重罚」，最后归一化。
  function scoreCandidate(text) {
    const m = scanText(text);
    if (!m.total) return -1;
    return (m.readable + m.cjk * 0.5 - m.bad * 5) / m.total;
  }

  function decodeText(arrayBuffer) {
    const bytes = toBytes(arrayBuffer);

    // 1) BOM 最可靠，直接按它读
    if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
      return { text: UTF8.decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
    }
    if (startsWith(bytes, [0xff, 0xfe])) {
      return { text: UTF16LE.decode(bytes.subarray(2)), encoding: "UTF-16LE (BOM)" };
    }
    if (startsWith(bytes, [0xfe, 0xff])) {
      return { text: UTF16BE.decode(bytes.subarray(2)), encoding: "UTF-16BE (BOM)" };
    }

    // 2) 没有 BOM 的 UTF-16：ASCII 字符会呈现「字符 + 0x00」的间隔特征
    const probe = bytes.subarray(0, Math.min(bytes.length, 2048));
    let evenZero = 0, oddZero = 0;
    for (let i = 0; i < probe.length; i++) {
      if (probe[i] === 0) { if (i % 2 === 0) evenZero++; else oddZero++; }
    }
    if (oddZero >= 4 && evenZero === 0) {
      return { text: UTF16LE.decode(bytes), encoding: "UTF-16LE（无 BOM）" };
    }
    if (evenZero >= 4 && oddZero === 0) {
      return { text: UTF16BE.decode(bytes), encoding: "UTF-16BE（无 BOM）" };
    }

    // 3) 严格 UTF-8。UTF-8 自带校验，解得通基本就是它，不用再纠结。
    if (UTF8_STRICT) {
      try {
        return { text: UTF8_STRICT.decode(bytes), encoding: "UTF-8" };
      } catch (e) { /* 解不通，说明是别的编码 */ }
    }

    // 4) 剩下的候选：中文 Windows 的 ANSI 就是 GBK/GB18030 的超集，排第一位。
    //    这里刻意不把 Big5 放进来：GBK 字节被 Big5 解码同样是一堆「像中文」的
    //    字，打分分不出来，加进来只会让简体文件有概率被解成繁体乱码。
    const cands = [];
    if (GB18030) cands.push({ enc: "GBK/GB18030", text: GB18030.decode(bytes) });
    if (UTF16LE) cands.push({ enc: "UTF-16LE（无 BOM）", text: UTF16LE.decode(bytes) });
    if (UTF16BE) cands.push({ enc: "UTF-16BE（无 BOM）", text: UTF16BE.decode(bytes) });

    let best = null, bestScore = -Infinity;
    for (const c of cands) {
      const s = scoreCandidate(c.text);
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (best) return { text: best.text, encoding: best.enc };

    // 兜底：宽容 UTF-8，交给乱码体检去拦
    return { text: UTF8.decode(bytes), encoding: "未知（已按 UTF-8 尝试）" };
  }

  function looksBinary(bytes) {
    const n = Math.min(bytes.length, 4096);
    let nul = 0, ctrl = 0;
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (b === 0) nul++;
      else if (b < 0x20 && b !== 9 && b !== 10 && b !== 13) ctrl++;
    }
    if (nul > 0) return true;
    return ctrl > Math.max(4, n * 0.05);
  }

  // ---------- 格式嗅探（看魔数，不看扩展名）----------

  function sniffKind(bytes) {
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
        startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])) return "zip";
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";                      // %PDF
    if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
    if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return "rtf";                // {\rtf
    const head = decodeBytes(bytes.subarray(0, 512)).toLowerCase();
    if (/^\s*<(html|!doctype\s+html)/.test(head)) return "html";
    if (/^\s*\{\s*"|^\s*\[/.test(head) && /json/.test(head.slice(0, 200))) return "json";
    return "text";
  }

  // ---------- docx ----------

  async function parseDocx(arrayBuffer) {
    const bytes = toBytes(arrayBuffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return "";

    const count = dv.getUint16(eocd + 10, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    let off = cdOffset;
    let target = null;

    for (let k = 0; k < count; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = decodeBytes(bytes.subarray(off + 46, off + 46 + nameLen));
      if (name === "word/document.xml") {
        const dataStart = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
        target = { method, data: bytes.subarray(dataStart, dataStart + compSize) };
        break;
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    if (!target) return "";

    let xmlBytes = target.data;
    if (target.method === 8) {
      const out = await tryInflate(target.data);
      if (!out) return "";
      xmlBytes = out;
    }
    const xml = UTF8.decode(xmlBytes);
    let text = xml.replace(/<w:p[ >]/g, "\n").replace(/<[^>]+>/g, "");
    text = text
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
    return text.replace(/\n{2,}/g, "\n").trim();
  }

  // ---------- PDF ----------

  // PDF 的字符串里装的是「字节」而不是字符，得自己判断这些字节该怎么读。
  function pdfStringToText(byteStr) {
    const b = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) b[i] = byteStr.charCodeAt(i) & 0xff;
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return UTF16BE.decode(b.subarray(2));
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return UTF16LE.decode(b.subarray(2));
    if (UTF8_STRICT) {
      try { return UTF8_STRICT.decode(b); } catch (e) { /* 继续猜 */ }
    }
    if (GB18030) {
      const t = GB18030.decode(b);
      if (t.indexOf("\uFFFD") < 0) return t;
    }
    return decodeBytes(b);
  }

  function unescapePdfString(s) {
    return s
      .replace(/\\([nrtbf])/g, (a, ch) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[ch]))
      .replace(/\\([0-7]{1,3})/g, (a, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\([()\\])/g, "$1");
  }

  function hexToByteString(hex) {
    const clean = hex.replace(/\s+/g, "");
    let s = "";
    for (let i = 0; i + 1 < clean.length; i += 2) {
      s += String.fromCharCode(parseInt(clean.substr(i, 2), 16));
    }
    return s;
  }

  async function parsePdf(arrayBuffer) {
    const bytes = toBytes(arrayBuffer);
    const src = decodeBytes(bytes);   // 下标即字节偏移，见文件头注释
    const parts = [];

    const streamRe = /stream\r?\n?/g;
    let m;
    while ((m = streamRe.exec(src)) !== null) {
      const dataStart = m.index + m[0].length;

      // 优先用字典里的 /Length 精确定位流长度：压缩流里完全可能恰好出现
      // "stream" 这几个 ASCII 字节，只靠找 endstream 会被截断。
      let dataEnd = -1;
      const dictHead = src.slice(Math.max(0, m.index - 400), m.index);
      const lenHits = dictHead.match(/\/Length\s+(\d+)/g);
      if (lenHits) {
        const n = parseInt(lenHits[lenHits.length - 1].replace(/[^\d]/g, ""), 10);
        if (n > 0 && dataStart + n <= bytes.length &&
            /^[\r\n]{0,2}endstream/.test(src.slice(dataStart + n, dataStart + n + 16))) {
          dataEnd = dataStart + n;
        }
      }
      if (dataEnd < 0) {
        const end = src.indexOf("endstream", dataStart);
        if (end < 0) continue;
        dataEnd = end;
        while (dataEnd > dataStart && (bytes[dataEnd - 1] === 0x0a || bytes[dataEnd - 1] === 0x0d)) dataEnd--;
      }

      const raw = bytes.subarray(dataStart, dataEnd);
      if (raw.length < 2) continue;

      // FlateDecode 的流以 zlib 头开头（0x78 + 0x01/0x9c/0xda/0x5e…）
      let dec = null;
      if (raw[0] === 0x78) dec = await tryInflate(raw);

      if (dec) {
        parts.push(decodeBytes(dec));
      } else if (looksBinary(raw)) {
        // 解不开的压缩流（图片、对象流…）：绝对不能当文本塞进去，
        // 否则就是用户看到的那一屏乱码。
        continue;
      } else {
        parts.push(decodeBytes(raw));
      }
    }

    const all = parts.join(" ");
    const out = [];
    // 同时收 `(...)` 字面量串和 `<...>` 十六进制串 —— 中文 PDF 用后者的更多
    const re = /\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f\s]{2,})>/g;
    let op;
    while ((op = re.exec(all)) !== null) {
      let s;
      if (op[1] !== undefined) s = unescapePdfString(op[1]);
      else s = hexToByteString(op[2]);
      s = pdfStringToText(s);
      if (s) out.push(s);
    }
    return out.join(" ");
  }

  // ---------- 归一化 ----------

  // 只压空格、不动换行。换行必须留：recognize.js 是按行切分段落标题的，
  // 把所有换行都替换成空格，等于让「教育背景 / 实习经历」这些段落整段失效。
  function normalize(text) {
    return text
      .replace(/\r\n?/g, "\n")
      // 上一步只把「横向空白」压成单空格，换行原样保留
      .replace(/[\u00a0\u3000\t ]+/g, " ")
      // 下面两条合并规则只能吃空格，绝不能吃换行 ——
      // 用 \s 的话「教育背景\n示例大学」会被粘成一行（实测踩过）。
      .replace(/([\u4e00-\u9fff]) +([\u4e00-\u9fff])/g, "$1$2")
      .replace(/(\d) +(?=\d)/g, "$1")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ---------- 统一入口 ----------

  const PASTE_HINT = "最省事的办法：在 Word 里打开简历，Ctrl+A 全选、Ctrl+C 复制，直接粘贴到上面的框里。";

  // 返回 { ok, kind, text, encoding, message, note }
  // ok 为 false 时 message 是给用户看的一句话，调用方直接显示即可。
  async function extract(arrayBuffer, fileName) {
    const bytes = toBytes(arrayBuffer);
    if (!bytes.length) return { ok: false, kind: "empty", message: "这个文件是空的。" };

    const kind = sniffKind(bytes);
    const name = (fileName || "").toLowerCase();

    if (kind === "ole") {
      return { ok: false, kind, message:
        "这是旧版 Word（.doc）的二进制格式，插件读不了里面的文字。请在 Word 里「另存为 → Word 文档(*.docx)」再导入。" + PASTE_HINT };
    }
    if (kind === "rtf") {
      return { ok: false, kind, message:
        "这是 RTF 格式（.rtf，WPS 有时会存成这种）。请另存为 .docx 或 .txt 再导入。" + PASTE_HINT };
    }
    if (kind === "html") {
      return { ok: false, kind, message:
        "这看起来是网页文件（.html），直接读会把标签一起读进来。请把简历内容复制成纯文本再粘贴。" };
    }

    if (kind === "pdf") {
      let text = "";
      try { text = await parsePdf(arrayBuffer); } catch (e) { text = ""; }
      text = normalize(text);
      const h = textHealth(text);
      if (text.length < 30 || !h.ok) {
        return { ok: false, kind, message:
          "没能从这份 PDF 里读出可用的文字。" +
          "常见原因：① 扫描版 / 图片版 PDF（整页是图片，没有文字层）；" +
          "② PDF 用了嵌入式子集字体，文字被存成了字形编号而不是真正的字。" +
          PASTE_HINT + "，或者另存为 .docx 再导入。" };
      }
      return { ok: true, kind, text, encoding: "PDF 内嵌文本",
        note: h.verdict === "warn" ? "PDF 提取的文字可能有少量粘连，应用前建议核对一遍" : "" };
    }

    if (kind === "zip") {
      let text = "";
      try { text = await parseDocx(arrayBuffer); } catch (e) { text = ""; }
      text = normalize(text);
      if (text.length < 10) {
        return { ok: false, kind, message:
          "这个文件是压缩包格式，但里面没有 Word 正文（可能不是 .docx，而是 .xlsx / .pptx）。" + PASTE_HINT };
      }
      const h = textHealth(text);
      if (!h.ok) {
        return { ok: false, kind, message: "从 Word 文档里读出的文字不正常（" + h.reason + "）。" + PASTE_HINT };
      }
      return { ok: true, kind, text, encoding: "DOCX 内嵌文本" };
    }

    if (kind === "json") {
      return { ok: false, kind, message: "这是数据文件（.json），不是简历文本。导入简历数据请用页面下方的「导入 JSON」。" };
    }

    // 其余一律先当纯文本。二进制要先挡掉，否则 decodeText 会给出一屏乱码。
    const hasUtf16Hint = (function () {
      const probe = bytes.subarray(0, Math.min(bytes.length, 2048));
      let evenZero = 0, oddZero = 0;
      for (let i = 0; i < probe.length; i++) {
        if (probe[i] === 0) { if (i % 2 === 0) evenZero++; else oddZero++; }
      }
      return (evenZero === 0 && oddZero >= 4) || (oddZero === 0 && evenZero >= 4);
    })();

    if (!hasUtf16Hint && looksBinary(bytes)) {
      return { ok: false, kind: "binary", message:
        "这个文件不是纯文本（可能是旧版 Office 文档、压缩包或其它二进制格式）。" + PASTE_HINT };
    }

    const { text, encoding } = decodeText(arrayBuffer);
    const h = textHealth(text);
    if (!h.ok) {
      return { ok: false, kind: "text", encoding, message:
        "这个文件读出来是乱码（" + h.reason + "）。" +
        "常见原因是编码对不上：Windows 记事本存的「ANSI」其实是 GBK。" + PASTE_HINT +
        "（或者用记事本打开后「另存为 → 编码选 UTF-8」再导入。）" };
    }
    return { ok: true, kind: "text", text: normalize(text), encoding,
      note: h.verdict === "warn" ? "文字里有个别可疑字符，应用前建议核对一遍" : "" };
  }

  F.parseDocx = parseDocx;
  F.parsePdf = parsePdf;
  F.normalize = normalize;
  F.decodeText = decodeText;
  F.textHealth = textHealth;
  F.sniffKind = sniffKind;
  F.extract = extract;
  window.JIANLI_FILEPARSE = F;
})();
