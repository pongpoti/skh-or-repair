import { inflateRawSync } from "node:zlib";
import { readXlsBook } from "./xls.ts";

/**
 * A small Excel reader with no dependencies, for the HOSxP OR export that MX uploads: .xlsx here, the old binary .xls
 * (Excel 97–2003) in lib/xls.ts, and the Excel 2003 XML workbook that some programs save under an .xls name.
 *
 * Why not a library: the official SheetJS build is only on its own CDN (unreachable here) and the npm `xlsx` 0.18.5
 * has known CVEs. An .xlsx is a zip of XML parts, and the export is one sheet of text, numbers and dates, so the zip's
 * central directory, `inflateRawSync` and a few string scans are enough. Cell styles are not read: whether a number is
 * a date is decided by the column it sits in (lib/workbook.ts), not by its format.
 *
 * It never throws on a bad file. Every failure comes back as a typed error with a short Thai message for the upload
 * page, and nothing from the file is logged (it holds patient identifiers).
 */

export type XlsxCell = string | number | boolean | null;

export type XlsxLimits = {
  /** Size of the uploaded file itself. */
  maxFileBytes: number;
  /** Entries in the zip. */
  maxEntries: number;
  /** Uncompressed bytes, checked against the sizes the zip declares and again against what is actually inflated. */
  maxTotalBytes: number;
  /** Sheet rows holding a value, the header included. */
  maxRows: number;
  /** Columns holding a value. The export has 39. */
  maxColumns: number;
};

/**
 * A day's list is about 50 rows; these leave room for any real export and stop a zip bomb or a runaway sheet. The file
 * stays under Vercel's 4.5 MB cap on a function's request body (next.config.ts), so a file the page accepts always
 * reaches the action and gets its answer.
 */
export const XLSX_LIMITS: XlsxLimits = {
  maxFileBytes: 4 * 1024 * 1024,
  maxEntries: 1000,
  maxTotalBytes: 30 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 200,
};

export type XlsxError =
  /** An .xls from Excel 95 or before (BIFF5 and older), which keeps its text in old code pages. */
  | "old-xls"
  /** A web page saved under an .xls name, as some programs export. */
  | "html"
  | "encrypted"
  | "not-xlsx"
  | "corrupt"
  | "too-large"
  | "too-many-rows"
  | "too-many-columns"
  | "no-sheet";

export type XlsxResult =
  | { ok: true; sheetName: string; rows: XlsxCell[][]; date1904: boolean }
  | { ok: false; error: XlsxError; message: string };

function messageFor(error: XlsxError, limits: XlsxLimits): string {
  switch (error) {
    case "old-xls":
      return "ไฟล์ .xls รุ่นเก่าเกินไป เปิดใน Excel แล้วบันทึกเป็น .xlsx";
    case "html":
      return "ไฟล์นี้เป็นหน้าเว็บ ไม่ใช่ไฟล์ Excel เปิดใน Excel แล้วบันทึกเป็น .xlsx";
    case "encrypted":
      return "ไฟล์มีรหัสผ่าน เปิดใน Excel แล้วบันทึกแบบไม่มีรหัสผ่าน";
    case "not-xlsx":
      return "ไฟล์นี้ไม่ใช่ไฟล์ Excel เปิดใน Excel แล้วบันทึกเป็น .xlsx";
    case "corrupt":
      return "เปิดไฟล์ไม่ได้ ไฟล์อาจเสีย บันทึกเป็น .xlsx ใหม่แล้วลองอีกครั้ง";
    case "too-large":
      return "ไฟล์ใหญ่เกินไป";
    case "too-many-rows":
      return `ไฟล์มีเกิน ${limits.maxRows.toLocaleString("en-US")} แถว`;
    case "too-many-columns":
      return `ไฟล์มีเกิน ${limits.maxColumns} คอลัมน์`;
    case "no-sheet":
      return "ไม่พบข้อมูลในไฟล์";
  }
}

/** Thrown inside the reader only; `readXlsx` turns it into a result. */
class XlsxFail extends Error {
  constructor(readonly code: XlsxError) {
    super(code);
  }
}

/**
 * Read the sheet named `operation` (or the first sheet) of an Excel file: .xlsx, .xls (Excel 97–2003) or an Excel
 * 2003 XML workbook, told apart by their first bytes, not their name. Values are raw: dates stay Excel serials.
 */
export function readXlsx(data: Uint8Array | ArrayBuffer, options: Partial<XlsxLimits> = {}): XlsxResult {
  const limits = { ...XLSX_LIMITS, ...options };
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length > limits.maxFileBytes) throw new XlsxFail("too-large");
    if (startsWith(bytes, OLE_MAGIC)) {
      const read = readXlsBook(bytes, limits);
      if (!read.ok) throw new XlsxFail(read.error);
      return { ok: true, ...read.book };
    }
    if (!startsWith(bytes, [0x50, 0x4b])) return { ok: true, ...readXmlBook(bytes, limits) };
    return { ok: true, ...readBook(bytes, limits) };
  } catch (error) {
    // Anything unexpected is a file we cannot read, never a crash of the upload.
    const code = error instanceof XlsxFail ? error.code : "corrupt";
    return { ok: false, error: code, message: messageFor(code, limits) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Zip

type ZipEntry = { method: number; crc: number; compressedSize: number; size: number; offset: number };
type Zip = { bytes: Uint8Array; view: DataView; entries: Map<string, ZipEntry>; budget: { left: number } };

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

const startsWith = (bytes: Uint8Array, magic: readonly number[]) => magic.every((byte, index) => bytes[index] === byte);

/** Part names are case-insensitive in an Office package; some writers also use backslashes or a leading slash. */
const partKey = (name: string) => name.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();

function openZip(bytes: Uint8Array, limits: XlsxLimits): Zip {
  if (bytes.length > limits.maxFileBytes) throw new XlsxFail("too-large");
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && !startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    throw new XlsxFail("not-xlsx");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-directory record sits in the last 22 bytes plus a comment of up to 64 KB. A cut-off upload loses it.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new XlsxFail("corrupt");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryStart = view.getUint32(end + 16, true);
  // Zip64 markers: a 4 MB export never needs them, so they only show up in a crafted or broken file.
  if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff) throw new XlsxFail("corrupt");
  if (count > limits.maxEntries) throw new XlsxFail("too-large");
  const directoryEnd = directoryStart + directorySize;
  if (directoryEnd > end) throw new XlsxFail("corrupt");

  const entries = new Map<string, ZipEntry>();
  const names = new TextDecoder("utf-8");
  let declared = 0;
  let at = directoryStart;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > directoryEnd || view.getUint32(at, true) !== CENTRAL_HEADER) throw new XlsxFail("corrupt");
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > directoryEnd) throw new XlsxFail("corrupt");
    if (flags & 1) throw new XlsxFail("encrypted");
    const entry: ZipEntry = {
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    };
    // Declared sizes can lie (checked again while inflating), but an honest bomb is refused before any work.
    declared += entry.size;
    if (declared > limits.maxTotalBytes) throw new XlsxFail("too-large");
    entries.set(partKey(names.decode(bytes.subarray(at + 46, at + 46 + nameLength))), entry);
    at = next;
  }
  return { bytes, view, entries, budget: { left: limits.maxTotalBytes } };
}

function readEntry(zip: Zip, name: string): Uint8Array | null {
  const entry = zip.entries.get(partKey(name));
  if (!entry) return null;
  const { bytes, view } = zip;
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== LOCAL_HEADER) {
    throw new XlsxFail("corrupt");
  }
  // The local header's own name and extra lengths place the data; the sizes come from the central directory, since
  // a local header followed by a data descriptor carries zeros.
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new XlsxFail("corrupt");
  const raw = bytes.subarray(start, end);
  if (entry.size > zip.budget.left) throw new XlsxFail("too-large");

  let data: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw new XlsxFail("corrupt");
    data = raw;
  } else if (entry.method === 8) {
    try {
      // The cap holds whatever size the entry declares, so a lying zip bomb stops at the budget.
      data = inflateRawSync(raw, { maxOutputLength: Math.max(1, zip.budget.left) });
    } catch (error) {
      throw new XlsxFail(error instanceof RangeError ? "too-large" : "corrupt");
    }
  } else {
    throw new XlsxFail("corrupt");
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw new XlsxFail("corrupt");
  zip.budget.left -= data.length;
  return data;
}

let crcTable: Int32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let index = 0; index < data.length; index += 1) crc = crcTable[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function decodeText(data: Uint8Array): string {
  try {
    if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.subarray(2));
    if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data.subarray(2));
    return new TextDecoder("utf-8").decode(data);
  } catch {
    throw new XlsxFail("corrupt");
  }
}

// ---------------------------------------------------------------------------------------------------------------
// XML: just enough for the parts an .xlsx needs. No DTDs and no custom entities, so nothing can expand.

type XmlVisitor = {
  /** `name` without its namespace prefix. A self-closing tag gets `open` then `close`. */
  open?(name: string, attrs: string): void;
  close?(name: string): void;
  text?(text: string): void;
};

// The lookahead ends the name where it must end, so a long unclosed tag fails in linear time instead of trying every
// split between name and attributes (the file is untrusted).
const TAG = /<(\/?)([^\s/>]+)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/y;
const localName = (name: string) => name.slice(name.indexOf(":") + 1);

function walkXml(xml: string, visitor: XmlVisitor): void {
  let at = 0;
  while (at < xml.length) {
    const lt = xml.indexOf("<", at);
    const textEnd = lt < 0 ? xml.length : lt;
    if (textEnd > at && visitor.text) visitor.text(decodeXml(xml.slice(at, textEnd)));
    if (lt < 0) return;
    if (xml.startsWith("<![CDATA[", lt)) {
      const close = xml.indexOf("]]>", lt + 9);
      if (close < 0) throw new XlsxFail("corrupt");
      if (visitor.text) visitor.text(xml.slice(lt + 9, close));
      at = close + 3;
      continue;
    }
    if (xml.startsWith("<!--", lt) || xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const marker = xml.startsWith("<!--", lt) ? "-->" : xml.startsWith("<?", lt) ? "?>" : ">";
      const close = xml.indexOf(marker, lt + 2);
      if (close < 0) throw new XlsxFail("corrupt");
      at = close + marker.length;
      continue;
    }
    TAG.lastIndex = lt;
    const tag = TAG.exec(xml);
    if (!tag) throw new XlsxFail("corrupt");
    const name = localName(tag[2]);
    if (tag[1]) {
      visitor.close?.(name);
    } else {
      visitor.open?.(name, tag[3]);
      if (tag[4]) visitor.close?.(name);
    }
    at = TAG.lastIndex;
  }
}

// Anchored on the space before each name, so a long run without "=" is scanned once, not from every character.
const ATTR = /(?:^|\s)([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Attributes by their name as written (`r:id` keeps its prefix). */
function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of text.matchAll(ATTR)) out[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  return out;
}

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body] ?? whole;
    const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** Office escapes characters XML cannot hold as `_xHHHH_` (a carriage return is `_x000D_`). */
const decodeOfficeEscapes = (text: string) =>
  text.includes("_x") ? text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : text;

// ---------------------------------------------------------------------------------------------------------------
// Workbook parts

type Relationship = { type: string; target: string };

function readRelationships(zip: Zip, path: string): Map<string, Relationship> {
  const out = new Map<string, Relationship>();
  const data = readEntry(zip, path);
  if (!data) return out;
  walkXml(decodeText(data), {
    open(name, attrs) {
      if (name !== "Relationship") return;
      const values = attributes(attrs);
      if (values.Id && values.Target && values.TargetMode !== "External") {
        out.set(values.Id, { type: values.Type ?? "", target: values.Target });
      }
    },
  });
  return out;
}

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/** A relationship target is relative to the part's folder unless it starts with a slash. */
function resolvePart(base: string, target: string): string {
  const parts = (target.startsWith("/") ? target : directoryOf(base) + target).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

const relsPathOf = (part: string) => `${directoryOf(part)}_rels/${part.slice(part.lastIndexOf("/") + 1)}.rels`;

type SheetRef = { name: string; id: string; hidden: boolean };

function readWorkbookPart(xml: string): { sheets: SheetRef[]; date1904: boolean } {
  const sheets: SheetRef[] = [];
  let date1904 = false;
  walkXml(xml, {
    open(name, attrs) {
      if (name === "workbookPr") {
        const flag = attributes(attrs).date1904;
        date1904 = flag === "1" || flag === "true";
      } else if (name === "sheet") {
        const values = attributes(attrs);
        // The relationship id is `r:id`, whatever prefix the writer gave that namespace.
        const idKey = Object.keys(values).find((key) => key.endsWith(":id"));
        sheets.push({ name: values.name ?? "", id: idKey ? values[idKey] : "", hidden: !!values.state && values.state !== "visible" });
      }
    },
  });
  return { sheets, date1904 };
}

/** Each `<si>` is one string: plain `<t>`, or rich text runs concatenated. Phonetic hints (`<rPh>`) are not text. */
function readSharedStrings(xml: string): string[] {
  const out: string[] = [];
  let current: string[] | null = null;
  let inText = false;
  let phonetic = 0;
  walkXml(xml, {
    open(name) {
      if (name === "si") current = [];
      else if (name === "rPh") phonetic += 1;
      else if (name === "t" && phonetic === 0) inText = true;
    },
    close(name) {
      if (name === "si" && current) {
        out.push(decodeOfficeEscapes(current.join("")));
        current = null;
      } else if (name === "rPh") phonetic -= 1;
      else if (name === "t") inText = false;
    },
    text(text) {
      if (inText && current) current.push(text);
    },
  });
  return out;
}

/** "AB12" → 27 (0-based column), or -1. */
function columnOf(ref: string): number {
  const letters = /^([A-Za-z]{1,3})\d*$/.exec(ref)?.[1];
  if (!letters) return -1;
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function readSheet(xml: string, shared: readonly string[], limits: XlsxLimits): XlsxCell[][] {
  const grid: XlsxCell[][] = [];
  let inData = false;
  let row = -1;
  let column = -1;
  let type = "";
  let value: string[] | null = null;
  let inline: string[] | null = null;
  let inValue = false;
  let inText = false;
  let phonetic = 0;

  const store = (cell: XlsxCell) => {
    // Empty cells (only a style) are skipped, so far-off formatting neither counts against the caps nor pads the rows.
    if (cell === null || cell === "") return;
    if (row + 1 > limits.maxRows) throw new XlsxFail("too-many-rows");
    if (column + 1 > limits.maxColumns) throw new XlsxFail("too-many-columns");
    (grid[row] ??= [])[column] = cell;
  };

  walkXml(xml, {
    open(name, attrs) {
      if (name === "sheetData") inData = true;
      if (!inData) return;
      if (name === "row") {
        const r = Number(attributes(attrs).r);
        row = Number.isInteger(r) && r > 0 ? r - 1 : row + 1;
        column = -1;
      } else if (name === "c") {
        const values = attributes(attrs);
        const at = values.r ? columnOf(values.r) : -1;
        column = at >= 0 ? at : column + 1;
        type = values.t ?? "";
        value = null;
        inline = null;
      } else if (name === "v") {
        value = [];
        inValue = true;
      } else if (name === "is") inline = [];
      else if (name === "rPh") phonetic += 1;
      else if (name === "t" && inline && phonetic === 0) inText = true;
    },
    close(name) {
      if (name === "sheetData") inData = false;
      if (!inData) return;
      if (name === "c") {
        store(cellValue(type, value?.join("") ?? null, inline?.join("") ?? null, shared));
        value = null;
        inline = null;
      } else if (name === "v") inValue = false;
      else if (name === "rPh") phonetic -= 1;
      else if (name === "t") inText = false;
    },
    text(text) {
      // Only text inside <v> or an inline string's <t> is a value: not a formula, not indentation between tags.
      if (inText && inline) inline.push(text);
      else if (inValue && value) value.push(text);
    },
  });

  // Dense rows: rows[i] is sheet row i + 1, missing rows and cells are empty.
  return Array.from(grid, (cells) => (cells ? Array.from(cells, (cell) => cell ?? null) : []));
}

function cellValue(type: string, value: string | null, inline: string | null, shared: readonly string[]): XlsxCell {
  switch (type) {
    case "s": {
      // A blank cell some writers leave as <c t="s"/> or an empty <v>: Number() of that is 0, the first shared string.
      if (value === null || value.trim() === "") return null;
      const index = Number(value);
      return Number.isInteger(index) && index >= 0 && index < shared.length ? shared[index] : null;
    }
    case "inlineStr":
      return inline === null ? null : decodeOfficeEscapes(inline);
    case "str":
      return value === null ? null : decodeOfficeEscapes(value);
    case "b":
      return value === null ? null : value.trim() === "1" || value.trim() === "true";
    case "e":
      return null;
    case "d":
      // An ISO date written as text (strict files); lib/workbook.ts reads it like any text date.
      return value;
    default: {
      if (value === null || value.trim() === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }
  }
}

function readBook(bytes: Uint8Array, limits: XlsxLimits): { sheetName: string; rows: XlsxCell[][]; date1904: boolean } {
  const zip = openZip(bytes, limits);

  // The package's own relationships name the workbook part; xl/workbook.xml is where every writer puts it.
  const root = [...readRelationships(zip, "_rels/.rels").values()].find((rel) => rel.type.endsWith("/officeDocument"));
  const workbookPath = root ? resolvePart("", root.target) : "xl/workbook.xml";
  const workbookData = readEntry(zip, workbookPath);
  // A zip without a workbook part is another kind of file (a .docx, a plain archive).
  if (!workbookData) throw new XlsxFail("not-xlsx");
  const { sheets, date1904 } = readWorkbookPart(decodeText(workbookData));
  const rels = readRelationships(zip, relsPathOf(workbookPath));

  const wanted =
    sheets.find((sheet) => sheet.name.trim().toLowerCase() === "operation") ??
    sheets.find((sheet) => !sheet.hidden) ??
    sheets[0];
  const target = wanted && rels.get(wanted.id);
  if (!wanted || !target) throw new XlsxFail("no-sheet");

  const sharedRel = [...rels.values()].find((rel) => rel.type.endsWith("/sharedStrings"));
  const sharedData = readEntry(zip, sharedRel ? resolvePart(workbookPath, sharedRel.target) : "xl/sharedStrings.xml");
  const shared = sharedData ? readSharedStrings(decodeText(sharedData)) : [];

  const sheetData = readEntry(zip, resolvePart(workbookPath, target.target));
  if (!sheetData) throw new XlsxFail("no-sheet");
  return { sheetName: wanted.name, rows: readSheet(decodeText(sheetData), shared, limits), date1904 };
}

// ---------------------------------------------------------------------------------------------------------------
// Excel 2003 XML ("XML Spreadsheet"), which some programs save under an .xls name

/**
 * A file that is neither a zip nor a compound file: an Excel 2003 XML workbook is read, a web page saved as .xls gets
 * its own message, and anything else is not an Excel file.
 */
function readXmlBook(bytes: Uint8Array, limits: XlsxLimits): { sheetName: string; rows: XlsxCell[][]; date1904: boolean } {
  let xml: string;
  try {
    xml = decodeText(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new XlsxFail("not-xlsx");
  }
  const head = xml.slice(0, 8192).trimStart().toLowerCase();
  if (/^<(!doctype html|html|table|meta|head|body)[\s>]/.test(head) || /<html[\s>]/.test(head)) throw new XlsxFail("html");
  if (!head.startsWith("<") || !head.includes("urn:schemas-microsoft-com:office:spreadsheet")) throw new XlsxFail("not-xlsx");

  type XmlSheet = { name: string; grid: XlsxCell[][] };
  const sheets: XmlSheet[] = [];
  let sheet: XmlSheet | null = null;
  let inTable = false;
  let row = -1;
  let column = -1;
  // The cell being read: its column (a merged cell keeps its value in its first column), its type and its text.
  let cell: { at: number; type: string; text: string; inData: boolean } | null = null;
  const store = (at: number, value: XlsxCell) => {
    if (!sheet || value === null || value === "") return;
    if (row + 1 > limits.maxRows) throw new XlsxFail("too-many-rows");
    if (at + 1 > limits.maxColumns) throw new XlsxFail("too-many-columns");
    (sheet.grid[row] ??= [])[at] = value;
  };
  /** ss:Index and friends, 1-based; null when missing or not a whole number. */
  const indexOf = (found: Record<string, string>, name: string) => {
    const value = Number(found[`ss:${name}`] ?? found[name]);
    return Number.isInteger(value) && value > 0 ? value : null;
  };
  walkXml(xml, {
    open(name, attrs) {
      if (name === "Worksheet") {
        const found = attributes(attrs);
        sheet = { name: found["ss:Name"] ?? found.Name ?? "", grid: [] };
        sheets.push(sheet);
      } else if (name === "Table" && sheet) {
        inTable = true;
        row = -1;
      } else if (name === "Row" && inTable) {
        const index = indexOf(attributes(attrs), "Index");
        row = index ? index - 1 : row + 1;
        column = -1;
      } else if (name === "Cell" && inTable) {
        const found = attributes(attrs);
        const index = indexOf(found, "Index");
        column = index ? index - 1 : column + 1;
        cell = { at: column, type: "", text: "", inData: false };
        // The next cell starts after a merge.
        column += indexOf(found, "MergeAcross") ?? 0;
      } else if (name === "Data" && cell) {
        const found = attributes(attrs);
        cell.type = found["ss:Type"] ?? found.Type ?? "String";
        cell.inData = true;
      }
    },
    text(text) {
      if (cell?.inData) cell.text += text;
    },
    close(name) {
      if (name === "Data" && cell) cell.inData = false;
      else if (name === "Cell" && cell) {
        if (cell.type) store(cell.at, xmlCellValue(cell.type, cell.text));
        cell = null;
      } else if (name === "Table") inTable = false;
      else if (name === "Worksheet") sheet = null;
    },
  });

  const wanted = sheets.find((item) => item.name.trim().toLowerCase() === "operation") ?? sheets[0];
  if (!wanted) throw new XlsxFail("no-sheet");
  return {
    sheetName: wanted.name,
    rows: Array.from(wanted.grid, (cells) => (cells ? Array.from(cells, (value) => value ?? null) : [])),
    // DateTime cells are written as dates, and turned into 1900-system serials here whatever the workbook's setting.
    date1904: false,
  };
}

/** Days from 30 Dec 1899, Excel's 1900 date system (which counts a 29 Feb 1900 that never was). */
function serialOf(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/.exec(iso.trim());
  if (!match) return null;
  const [year, month, day, hh, mm, ss] = match.slice(1).map((part) => Number(part ?? 0));
  const days = Date.UTC(year, month - 1, day) / 86400000 - Date.UTC(1899, 11, 30) / 86400000;
  if (!Number.isFinite(days)) return null;
  // 1899-12-31 is day 1 in Excel's own count, but Date.UTC counts it as 1 from 30 Dec; dates before 1 Mar 1900 sit
  // one day lower in Excel because of its leap-year bug.
  const fixed = days < 61 ? days - 1 : days;
  return fixed + (hh * 3600 + mm * 60 + ss) / 86400;
}

function xmlCellValue(type: string, text: string): XlsxCell {
  switch (type) {
    case "Number": {
      if (text.trim() === "") return null;
      const number = Number(text);
      return Number.isFinite(number) ? number : null;
    }
    case "DateTime":
      return serialOf(text);
    case "Boolean":
      return text.trim() === "1" || text.trim().toLowerCase() === "true";
    case "Error":
      return null;
    default:
      return decodeOfficeEscapes(text);
  }
}
