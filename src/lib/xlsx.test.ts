import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { readXlsx, XLS_MESSAGE, XLSX_LIMITS, type XlsxResult } from "./xlsx.ts";

const FIXTURE = readFileSync(new URL("../../tests/fixtures/sample-or-export.xlsx", import.meta.url));

type Part = { name: string; data: string | Uint8Array; store?: boolean; declaredSize?: number };

/** A minimal zip writer, so each test can build the exact package it needs. */
function zip(parts: Part[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const data = typeof part.data === "string" ? Buffer.from(part.data, "utf8") : Buffer.from(part.data);
    const body = part.store ? data : deflateRawSync(data);
    const name = Buffer.from(part.name, "utf8");
    const header = (size: number, signature: number) => {
      const out = Buffer.alloc(size);
      out.writeUInt32LE(signature, 0);
      return out;
    };
    const local = header(30, 0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(part.store ? 0 : 8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(part.declaredSize ?? data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = header(46, 0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(part.store ? 0 : 8, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(part.declaredSize ?? data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A workbook with a decoy first sheet and the `operation` sheet second, shared strings and a prefixed namespace. */
function sharedStringsBook(options: { store?: boolean; date1904?: boolean; sheet?: string } = {}): Buffer {
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${MAIN} ${REL}>` +
    `<workbookPr${options.date1904 ? ' date1904="1"' : ""}/>` +
    `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name=" Operation " sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${TYPE}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${TYPE}/worksheet" Target="./worksheets/../worksheets/sheet2.xml"/>` +
    `<Relationship Id="rId3" Type="${TYPE}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const strings =
    `<sst ${MAIN} count="4" uniqueCount="4">` +
    `<si><t>ID</t></si>` +
    // Rich text runs are one string; the phonetic hint is not part of it.
    `<si><r><rPr><b/></rPr><t>ตัวอย่าง </t></r><r><t xml:space="preserve">ศัลย์ทั่วไป (น.พ.)</t></r><rPh sb="0" eb="1"><t>hint</t></rPh></si>` +
    `<si><t>a &amp; b &lt;c&gt; &#3627;&#x0E19;</t></si>` +
    `<si><t>line_x000D_break</t></si></sst>`;
  const sheet =
    options.sheet ??
    `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>` +
    `<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c>` +
    `<x:c r="C1" t="inlineStr"><x:is><x:r><x:t>HN </x:t></x:r><x:r><x:t>0012</x:t></x:r></x:is></x:c>` +
    `<x:c r="D1" t="b"><x:v>1</x:v></x:c><x:c r="E1" t="e"><x:v>#N/A</x:v></x:c>` +
    `<x:c r="F1" t="str"><x:f>A1&amp;"x"</x:f><x:v>IDx</x:v></x:c><x:c r="G1"><x:v>46331.375</x:v></x:c>` +
    `<x:c r="Z1" s="3"/></x:row>\n` +
    `  <x:row r="3">\n    <x:c t="s"><x:v>2</x:v></x:c>\n    <x:c t="s"><x:v>3</x:v></x:c>\n    <x:c r="E3"><x:v>7</x:v></x:c>\n  </x:row>` +
    `</x:sheetData></x:worksheet>`;
  return zip([
    { name: "[Content_Types].xml", data: "<Types/>", store: options.store },
    {
      name: "_rels/.rels",
      data: `<Relationships><Relationship Id="rId1" Type="${TYPE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      store: options.store,
    },
    { name: "xl/workbook.xml", data: workbook, store: options.store },
    { name: "xl/_rels/workbook.xml.rels", data: rels, store: options.store },
    { name: "xl/sharedStrings.xml", data: strings, store: options.store },
    { name: "xl/worksheets/sheet1.xml", data: `<worksheet ${MAIN}><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>` },
    { name: "xl/worksheets/sheet2.xml", data: sheet, store: options.store },
  ]);
}

const EXPECTED_ROWS = [
  ["ID", "ตัวอย่าง ศัลย์ทั่วไป (น.พ.)", "HN 0012", true, null, "IDx", 46331.375],
  [],
  ["a & b <c> หน", "line\rbreak", null, null, 7],
];

function failure(result: XlsxResult) {
  assert.equal(result.ok, false);
  return result as Extract<XlsxResult, { ok: false }>;
}

test("reads the sample export: sheet operation, raw values, both เวลา columns", () => {
  const result = readXlsx(FIXTURE);
  assert.ok(result.ok);
  assert.equal(result.sheetName, "operation");
  assert.equal(result.date1904, false);
  assert.equal(result.rows.length, 29);
  const [header, first, second] = result.rows;
  assert.equal(header.length, 39);
  assert.equal(header[1], "ID");
  assert.equal(header[17], "เวลา");
  assert.equal(header[31], "เวลา");
  assert.equal(header[38], "การวินิจฉัยเบื้องต้น");
  assert.equal(first[1], 900001);
  assert.equal(first[7], "99000001"); // HN as text
  assert.equal(first[13], "ตัวอย่าง ศัลย์ทั่วไป (นพ.)");
  assert.equal(first[16], 46329); // a date stays an Excel serial
  assert.equal(first[22], 46331);
  assert.equal(first[23], 0.375);
  assert.equal(second[23], null); // blank booked time
  // Trailing empty cells are not padded: the last value of row 2 is the room (AI).
  assert.equal(first.length, 35);
  assert.equal(first[34], "ห้องผ่าตัด 5");
});

test("reads shared strings with rich text runs, inline strings, booleans, errors and cached formula values", () => {
  const result = readXlsx(sharedStringsBook());
  assert.ok(result.ok);
  assert.equal(result.sheetName, " Operation "); // found by name, though it is the second sheet
  assert.equal(result.date1904, false);
  assert.deepEqual(result.rows, EXPECTED_ROWS);
});

test("a shared-string cell with no value is empty, not the first shared string", () => {
  // Some writers other than Excel leave a blank string cell as <c t="s"/> or with an empty <v>; Number() of either is
  // 0, which would read as the first shared string (in a real export a header such as ลำดับ).
  const sheet =
    `<worksheet ${MAIN}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"/><c r="C1" t="s"><v></v></c>` +
    `<c r="D1" t="s"><v> </v></c><c r="E1" t="s"><v>2</v></c></row></sheetData></worksheet>`;
  const result = readXlsx(sharedStringsBook({ sheet }));
  assert.ok(result.ok);
  assert.deepEqual(result.rows, [["ID", null, null, null, "a & b <c> หน"]]);
});

test("exposes the 1904 date system flag", () => {
  const result = readXlsx(sharedStringsBook({ date1904: true }));
  assert.ok(result.ok);
  assert.equal(result.date1904, true);
});

test("reads stored (uncompressed) entries", () => {
  const result = readXlsx(sharedStringsBook({ store: true }));
  assert.ok(result.ok);
  assert.deepEqual(result.rows, EXPECTED_ROWS);
});

test("falls back to the first sheet when none is named operation", () => {
  const book = zip([
    { name: "xl/workbook.xml", data: `<workbook ${MAIN} ${REL}><sheets><sheet name="รายงาน" sheetId="1" r:id="rId9"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId9" Type="${TYPE}/worksheet" Target="/xl/worksheets/a.xml"/></Relationships>` },
    { name: "xl/worksheets/a.xml", data: `<worksheet><sheetData><row><c><v>1</v></c><c><v>2</v></c></row></sheetData></worksheet>` },
  ]);
  const result = readXlsx(book);
  assert.ok(result.ok);
  assert.equal(result.sheetName, "รายงาน");
  assert.deepEqual(result.rows, [[1, 2]]);
});

test("refuses an old .xls or a password-protected file, asking for .xlsx", () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
  const result = failure(readXlsx(ole));
  assert.equal(result.error, "xls");
  assert.equal(result.message, XLS_MESSAGE);
  assert.match(result.message, /\.xlsx/);
});

test("refuses a truncated or damaged file", () => {
  assert.equal(failure(readXlsx(FIXTURE.subarray(0, Math.floor(FIXTURE.length / 2)))).error, "corrupt");
  assert.equal(failure(readXlsx(FIXTURE.subarray(0, 10))).error, "corrupt");
  // One flipped byte inside the sheet's compressed data: the inflate or the CRC catches it.
  const damaged = Buffer.from(FIXTURE);
  const sheetAt = damaged.indexOf("xl/worksheets/sheet1.xml") + 40;
  damaged[sheetAt] ^= 0xff;
  assert.equal(failure(readXlsx(damaged)).error, "corrupt");
  // A stored entry whose bytes no longer match its CRC.
  const stored = sharedStringsBook({ store: true });
  stored[stored.indexOf("ID</t>")] = "X".charCodeAt(0);
  assert.equal(failure(readXlsx(stored)).error, "corrupt");
});

test("refuses a zip bomb, an honest one and one that lies about its size", () => {
  const zeros = Buffer.alloc(XLSX_LIMITS.maxTotalBytes + 1024 * 1024);
  const honest = zip([{ name: "xl/worksheets/sheet1.xml", data: zeros }]);
  assert.ok(honest.length < 100_000);
  assert.equal(failure(readXlsx(honest)).error, "too-large");

  const book = sharedStringsBook();
  const liar = zip([
    { name: "_rels/.rels", data: `<Relationships><Relationship Id="r" Type="${TYPE}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: zeros, declaredSize: 100 },
  ]);
  assert.equal(failure(readXlsx(liar)).error, "too-large");

  assert.equal(failure(readXlsx(book, { maxEntries: 3 })).error, "too-large");
  assert.equal(failure(readXlsx(book, { maxFileBytes: 100 })).error, "too-large");
});

test("caps rows and columns that hold a value", () => {
  const sheet = (cells: string) => sharedStringsBook({ sheet: `<worksheet><sheetData>${cells}</sheetData></worksheet>` });
  assert.equal(failure(readXlsx(sheet(`<row r="6"><c r="A6"><v>1</v></c></row>`), { maxRows: 5 })).error, "too-many-rows");
  assert.equal(failure(readXlsx(sheet(`<row r="1"><c r="F1"><v>1</v></c></row>`), { maxColumns: 5 })).error, "too-many-columns");
  // Empty styled cells far away count for nothing.
  const far = readXlsx(sheet(`<row r="1"><c r="A1"><v>1</v></c><c r="XFD1" s="1"/></row><row r="1048576"><c r="A1048576" s="1"/></row>`));
  assert.ok(far.ok);
  assert.deepEqual(far.rows, [[1]]);
  assert.equal(failure(readXlsx(sheet(`<row r="5001"><c r="A5001"><v>1</v></c></row>`))).message, "ไฟล์มีเกิน 5,000 แถว");
});

test("hostile XML stays linear: a long unclosed tag, a long attribute run", () => {
  const started = Date.now();
  const sheet = (xml: string) => sharedStringsBook({ sheet: xml });
  const run = "a".repeat(1_000_000);
  assert.equal(failure(readXlsx(sheet(`<worksheet><sheetData><row><${run}`))).error, "corrupt");
  assert.equal(failure(readXlsx(sheet(`<worksheet><sheetData><row><c ${run}`))).error, "corrupt");
  const long = readXlsx(sheet(`<worksheet><sheetData><row r="1" ${run}><c r="A1" x${run}><v>1</v></c></row></sheetData></worksheet>`));
  assert.ok(long.ok);
  assert.deepEqual(long.rows, [[1]]);
  // Quadratic scanning would take minutes on these inputs.
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test("refuses what is not an .xlsx, and never throws", () => {
  assert.equal(failure(readXlsx(Buffer.from("<html><table><tr><td>ID</td></tr></table></html>"))).error, "not-xlsx");
  assert.equal(failure(readXlsx(new Uint8Array(0))).error, "not-xlsx");
  assert.equal(failure(readXlsx(new ArrayBuffer(3))).error, "not-xlsx");
  // A zip that is not a workbook (a .docx, a plain archive).
  assert.equal(failure(readXlsx(zip([{ name: "word/document.xml", data: "<w:document/>" }]))).error, "not-xlsx");
  // A workbook whose sheet part is missing.
  const noSheet = zip([
    { name: "xl/workbook.xml", data: `<workbook ${REL}><sheets><sheet name="operation" r:id="rId1"/></sheets></workbook>` },
  ]);
  assert.equal(failure(readXlsx(noSheet)).error, "no-sheet");
  // Garbage behind a zip signature, and broken XML inside a good zip.
  const junk = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from(Array.from({ length: 300 }, (_, index) => (index * 37) % 256))]);
  assert.equal(readXlsx(junk).ok, false);
  const broken = sharedStringsBook({ sheet: `<worksheet><sheetData><row><c r="A1"><v>1</v></c><c r="B1" t="s` });
  assert.equal(failure(readXlsx(broken)).error, "corrupt");
  for (const result of [readXlsx(junk), readXlsx(broken)]) assert.equal(typeof (result as { message?: string }).message, "string");
});
