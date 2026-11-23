import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

// Precompute CRC-32 lookup table for standard ZIP archives
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a standard ZIP buffer from { name: string, data: Buffer | string } entries.
 */
export function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
  const dosDate = (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const compressedBuf = zlib.deflateRawSync(rawBuf);
    const useStore = compressedBuf.length >= rawBuf.length;
    const payload = useStore ? rawBuf : compressedBuf;
    const method = useStore ? 0 : 8;
    const crc = crc32(rawBuf);
    const gpFlag = 0x0800; // UTF-8 filename encoding

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(gpFlag, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(gpFlag, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripXmlControlChars(str) {
  // XML 1.0 forbids control characters below 0x20 except \t, \n, \r
  return String(str).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function renderInlineRuns(text) {
  const clean = stripXmlControlChars(text);
  // Split by **bold** or *italic* segments while keeping literal text intact
  const parts = clean.split(/(\*\*[^*]+\*\*)/g);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        const inner = escapeXml(part.slice(2, -2));
        return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${inner}</w:t></w:r>`;
      }
      return `<w:r><w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`;
    })
    .join("");
}

function makeParagraphXml(text, styleId = null) {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : "";
  return `<w:p>${pPr}${renderInlineRuns(text)}</w:p>`;
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line);
}

function parseMarkdownTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function makeTableXml(rows) {
  if (!rows.length) return "";
  const colCount = Math.max(...rows.map((r) => r.length));
  const tblBorders =
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>` +
    `</w:tblBorders>`;
  const tblPr = `<w:tblPr><w:tblW w:w="5000" w:type="pct"/>${tblBorders}</w:tblPr>`;

  const trXml = rows
    .map((row, rIdx) => {
      const cells = [];
      for (let c = 0; c < colCount; c++) {
        const val = row[c] ?? "";
        const shd = rIdx === 0 ? `<w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/>` : "";
        const tcPr = `<w:tcPr><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>${shd}</w:tcPr>`;
        const content = rIdx === 0 ? `**${val.replace(/\*\*/g, "")}**` : val;
        cells.push(`<w:tc>${tcPr}<w:p>${renderInlineRuns(content)}</w:p></w:tc>`);
      }
      return `<w:tr>${cells.join("")}</w:tr>`;
    })
    .join("");

  return `<w:tbl>${tblPr}${trXml}</w:tbl>`;
}

/**
 * Convert markdown + optional title into a clean WordprocessingML (.docx) Buffer.
 */
export function markdownToDocxBuffer({ title = "", content = "" }) {
  const bodyBlocks = [];
  if (title && title.trim()) {
    bodyBlocks.push(makeParagraphXml(title.trim(), "Title"));
  }

  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Markdown table block
    if (trimmed.includes("|") && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
      const tableRows = [parseMarkdownTableRow(trimmed)];
      i += 2; // skip header & separator
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim().length > 0) {
        tableRows.push(parseMarkdownTableRow(lines[i]));
        i++;
      }
      bodyBlocks.push(makeTableXml(tableRows));
      continue;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      bodyBlocks.push(makeParagraphXml(trimmed.slice(4), "Heading3"));
    } else if (trimmed.startsWith("## ")) {
      bodyBlocks.push(makeParagraphXml(trimmed.slice(3), "Heading2"));
    } else if (trimmed.startsWith("# ")) {
      bodyBlocks.push(makeParagraphXml(trimmed.slice(2), "Heading1"));
    } else if (/^[-*]\s+/.test(trimmed)) {
      bodyBlocks.push(makeParagraphXml(`•  ${trimmed.replace(/^[-*]\s+/, "")}`, "ListIndent"));
    } else if (/^\d+\.\s+/.test(trimmed)) {
      bodyBlocks.push(makeParagraphXml(trimmed, "ListIndent"));
    } else if (/^---+$/.test(trimmed)) {
      bodyBlocks.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr></w:pPr></w:p>`);
    } else {
      bodyBlocks.push(makeParagraphXml(trimmed, "Normal"));
    }
    i++;
  }

  if (bodyBlocks.length === 0) {
    bodyBlocks.push(makeParagraphXml("", "Normal"));
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="1E293B"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="334155"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="140" w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="475569"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListIndent"><w:name w:val="List Indent"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="80"/></w:pPr></w:style>` +
    `</w:styles>`;

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${bodyBlocks.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>` +
    `</w:document>`;

  return buildZipBuffer([
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: rootRelsXml },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: docRelsXml },
    { name: "word/styles.xml", data: stylesXml },
  ]);
}

function escapeCsvCell(val) {
  const s = String(val ?? "");
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Convert rows (string[][]) or first markdown table found in content into UTF-8 BOM CSV text.
 */
export function buildCsvContent({ rows, content = "" }) {
  let tableRows = Array.isArray(rows) && rows.length > 0 ? rows : null;
  if (!tableRows && content) {
    const lines = String(content).replace(/\r\n/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("|") && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
        const parsed = [parseMarkdownTableRow(lines[i])];
        let j = i + 2;
        while (j < lines.length && lines[j].trim().includes("|") && lines[j].trim().length > 0) {
          parsed.push(parseMarkdownTableRow(lines[j]));
          j++;
        }
        tableRows = parsed;
        break;
      }
    }
    if (!tableRows) {
      tableRows = lines.filter((l) => l.trim().length > 0).map((l) => [l]);
    }
  }
  const csvLines = (tableRows || []).map((row) => row.map(escapeCsvCell).join(","));
  return "\uFEFF" + csvLines.join("\r\n") + "\r\n";
}

const __docxDir = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_ROOT = path.resolve(
  process.env.JARVIS_SANDBOX_DIR ||
    (fs.existsSync("C:\\AI-Sandbox") ? "C:\\AI-Sandbox" : path.resolve(__docxDir, "..", "sandbox"))
);

/**
 * Safely read a UTF-8 markdown/text/csv source file inside C:\AI-Sandbox.
 */
function readSandboxSourceFile(sourcePath) {
  if (!sourcePath || typeof sourcePath !== "string") {
    throw new Error("source_path must be a non-empty string.");
  }
  const trimmed = sourcePath.trim();
  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(SANDBOX_ROOT, trimmed.replace(/^[\\/]+/, ""));

  const rootPrefix = SANDBOX_ROOT.toLowerCase() + path.sep;
  if (!resolved.toLowerCase().startsWith(rootPrefix)) {
    throw new Error(`Security policy blocked reading source_path outside ${SANDBOX_ROOT}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (![".md", ".txt", ".csv"].includes(ext)) {
    throw new Error(`Unsupported source_path extension "${ext}". Allowed: .md, .txt, .csv`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`source_path file not found: ${resolved}`);
  }
  return {
    resolvedPath: resolved,
    text: fs.readFileSync(resolved, "utf8"),
  };
}

/**
 * Safely write a document (.docx, .csv, .md, .txt) inside C:\AI-Sandbox\exports (or relative path inside C:\AI-Sandbox).
 */
export function exportDocumentFile({ filename, title = "", content = "", rows = null, format = "", source_path = "" }) {
  if (!filename || typeof filename !== "string") {
    throw new Error("filename is required.");
  }

  let effectiveContent = String(content || "");
  let loadedSourcePath = null;
  if (typeof source_path === "string" && source_path.trim().length > 0) {
    const src = readSandboxSourceFile(source_path);
    effectiveContent = src.text;
    loadedSourcePath = src.resolvedPath;
  }

  let ext = format ? `.${String(format).replace(/^\./, "").toLowerCase()}` : path.extname(filename).toLowerCase();
  if (!ext) {
    ext = ".docx";
    filename = `${filename}${ext}`;
  }
  if (![".docx", ".csv", ".md", ".txt"].includes(ext)) {
    throw new Error(`Unsupported document format "${ext}". Allowed: .docx, .csv, .md, .txt`);
  }

  const sanitizedRel = filename.replace(/^[\\/]+/, "");
  const defaultBase = sanitizedRel.includes("\\") || sanitizedRel.includes("/") ? SANDBOX_ROOT : path.join(SANDBOX_ROOT, "exports");
  const resolved = path.resolve(defaultBase, sanitizedRel);

  const rootPrefix = SANDBOX_ROOT.toLowerCase() + path.sep;
  if (!resolved.toLowerCase().startsWith(rootPrefix)) {
    throw new Error(`Security policy blocked writing outside ${SANDBOX_ROOT}`);
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  let bytesWritten = 0;
  if (ext === ".docx") {
    const buf = markdownToDocxBuffer({ title, content: effectiveContent });
    fs.writeFileSync(resolved, buf);
    bytesWritten = buf.length;
  } else if (ext === ".csv") {
    const csvText = buildCsvContent({ rows, content: effectiveContent });
    const buf = Buffer.from(csvText, "utf8");
    fs.writeFileSync(resolved, buf);
    bytesWritten = buf.length;
  } else {
    const header = title && title.trim() && ext === ".md" ? `# ${title.trim()}\n\n` : title && title.trim() ? `${title.trim()}\n${"=".repeat(title.trim().length)}\n\n` : "";
    const text = `${header}${effectiveContent}`;
    const buf = Buffer.from(text, "utf8");
    fs.writeFileSync(resolved, buf);
    bytesWritten = buf.length;
  }

  return {
    path: resolved,
    format: ext.slice(1),
    bytes: bytesWritten,
    source_path: loadedSourcePath,
  };
}
