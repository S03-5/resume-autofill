// ============================================================
// 文件解析模块：从 Word(.docx) / PDF / txt 简历中提取纯文本
// 依赖浏览器原生 DecompressionStream（Edge/Chrome 80+）
// ============================================================
(function () {
  const F = {};

  async function inflate(bytes, format) {
    const ds = new DecompressionStream(format);
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // 解析 docx：ZIP 格式，取出 word/document.xml 并转为纯文本
  async function parseDocx(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
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
      const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
      if (name === "word/document.xml") {
        const dataStart = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
        target = { method, data: bytes.subarray(dataStart, dataStart + compSize) };
        break;
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    if (!target) return "";

    let xmlBytes = target.data;
    if (target.method === 8) xmlBytes = await inflate(target.data, "deflate-raw");
    const xml = new TextDecoder().decode(xmlBytes);
    let text = xml.replace(/<w:p[ >]/g, "\n").replace(/<[^>]+>/g, "");
    text = text
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
    return text.replace(/\n{2,}/g, "\n").trim();
  }

  // 解析 PDF：提取文本流并解析 Tj/TJ 文本操作符
  async function parsePdf(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder();
    const src = decoder.decode(bytes);
    let collected = "";

    const streamRe = /stream\r?\n([\s\S]*?)\r?\n?endstream/g;
    let m;
    const chunks = [];
    while ((m = streamRe.exec(src)) !== null) {
      chunks.push({ idx: m.index + m[0].indexOf(m[1]), len: m[1].length });
    }
    for (const c of chunks) {
      const chunk = bytes.subarray(c.idx, c.idx + c.len);
      if (chunk.length < 2) continue;
      if (chunk[0] === 0x78 && (chunk[1] === 0x01 || chunk[1] === 0x9c || chunk[1] === 0xda)) {
        try { collected += decoder.decode(await inflate(chunk, "deflate")); } catch (e) { /* 跳过无法解压的流 */ }
      } else {
        collected += decoder.decode(chunk);
      }
    }

    const out = [];
    const re = /\(((?:[^()\\]|\\.)*)\)/g;
    let op;
    while ((op = re.exec(collected)) !== null) {
      let s = op[1]
        .replace(/\\([nrtbf])/g, (a, ch) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[ch]))
        .replace(/\\([0-7]{1,3})/g, (a, o) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\([()\\])/g, "$1");
      out.push(s);
    }
    return out.join(" ");
  }

  // 归一化：合并 PDF 提取时被拆散的中文与数字
  function normalize(text) {
    return text
      .replace(/[\u00a0\s]+/g, " ")
      .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
      .replace(/(\d)\s+(?=\d)/g, "$1")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  F.parseDocx = parseDocx;
  F.parsePdf = parsePdf;
  F.normalize = normalize;
  window.JIANLI_FILEPARSE = F;
})();
