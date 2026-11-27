import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { readXlsx, XLSX_LIMITS, type XlsxCell, type XlsxResult } from "./xlsx.ts";

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

// ---------------------------------------------------------------------------------------------------------------
// .xls (Excel 97–2003) and Excel 2003 XML (Pong, 27 Nov 2026: "accept xls")

const fixture = (name: string) => readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));

/** Both reads, cell for cell (numbers to within rounding). */
function assertSameRows(a: XlsxResult, b: XlsxResult) {
  assert.ok(a.ok && b.ok);
  assert.equal(b.sheetName, a.sheetName);
  assert.equal(b.date1904, a.date1904);
  assert.equal(b.rows.length, a.rows.length);
  a.rows.forEach((row, r) => {
    const other = b.rows[r];
    assert.equal(other.length, row.length, `row ${r + 1} length`);
    row.forEach((cell, c) => {
      if (typeof cell === "number" && typeof other[c] === "number") assert.ok(Math.abs(cell - (other[c] as number)) < 1e-9, `row ${r + 1} col ${c + 1}`);
      else assert.equal(other[c], cell, `row ${r + 1} col ${c + 1}`);
    });
  });
}

test("an .xls saved from the made-up exports reads the same as the .xlsx", () => {
  // Made with LibreOffice from the .xlsx fixtures (tests/e2e/make-xls.py).
  for (const name of ["sample-or-export", "e2e-or-export"]) {
    assertSameRows(readXlsx(fixture(`${name}.xlsx`)), readXlsx(fixture(`${name}.xls`)));
  }
});

test("an .xls with long shared strings, numbers, dates, booleans and formulas", () => {
  const result = readXlsx(fixture("xls-long-strings.xls"));
  assert.ok(result.ok);
  // The second sheet is the one named operation.
  assert.equal(result.sheetName, "operation");
  assert.equal(result.rows.length, 401);
  assert.deepEqual(result.rows[0], ["ข้อความ", "รหัส", "จำนวน", "วันที่", "ใช่", "สูตรข้อความ", "สูตรเลข", "สูตรจริงเท็จ"]);
  const day0 = Date.UTC(1899, 11, 30);
  for (let i = 1; i <= 400; i += 1) {
    const row: XlsxCell[] = result.rows[i];
    const amount = i % 2 ? i * 1.25 : i;
    const serial = (Date.UTC(2026, 10, 1 + (i % 28)) - day0) / 86_400_000 + ((8 + (i % 9)) * 60 + ((i * 7) % 60)) / 1440;
    assert.equal(row[0], `ทดสอบข้อความยาว ${i} ` + "ข".repeat(i % 50), `row ${i} text`);
    assert.equal(row[1], `case-${i}`);
    assert.equal(row[2], amount);
    assert.ok(Math.abs((row[3] as number) - serial) < 1e-6, `row ${i} date`);
    assert.equal(row[4], i % 2 === 0);
    assert.equal(row[5], `case-${i}-x`);
    assert.equal(row[6], amount * 2);
    assert.equal(row[7], amount > 100);
  }
});

/** A compound file with 512-byte sectors: one FAT sector, one directory sector, then each stream (4 KB or more, or empty). */
function compound(streams: { name: string; data: Uint8Array }[]): Buffer {
  const sector = 512;
  const sizes = streams.map((stream) => Math.ceil(stream.data.length / sector));
  const total = 2 + sizes.reduce((sum, n) => sum + n, 0);
  assert.ok(total <= 128);
  const header = Buffer.alloc(sector, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c); // FAT sectors
  header.writeUInt32LE(1, 0x30); // directory start
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(0xfffffffe, 0x3c); // no mini FAT
  header.writeUInt32LE(0xfffffffe, 0x44); // no DIFAT
  for (let n = 0; n < 109; n += 1) header.writeUInt32LE(n === 0 ? 0 : 0xffffffff, 0x4c + n * 4);
  const fat = Buffer.alloc(sector, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(0xfffffffe, 4);
  const directory = Buffer.alloc(sector, 0);
  const entry = (index: number, name: string, type: number, start: number, size: number, child = 0xffffffff, right = 0xffffffff) => {
    const at = index * 128;
    const encoded = Buffer.from(`${name}\0`, "utf16le");
    encoded.copy(directory, at);
    directory.writeUInt16LE(encoded.length, at + 0x40);
    directory[at + 0x42] = type;
    directory.writeUInt32LE(0xffffffff, at + 0x44);
    directory.writeUInt32LE(right, at + 0x48);
    directory.writeUInt32LE(child, at + 0x4c);
    directory.writeUInt32LE(start, at + 0x74);
    directory.writeUInt32LE(size, at + 0x78);
  };
  entry(0, "Root Entry", 5, 0xfffffffe, 0, streams.length ? 1 : 0xffffffff);
  const bodies: Buffer[] = [];
  let next = 2;
  streams.forEach((stream, index) => {
    const count = sizes[index];
    entry(index + 1, stream.name, 2, count ? next : 0xfffffffe, stream.data.length, 0xffffffff, index + 1 < streams.length ? index + 2 : 0xffffffff);
    for (let n = 0; n < count; n += 1) fat.writeUInt32LE(n === count - 1 ? 0xfffffffe : next + n + 1, (next + n) * 4);
    const body = Buffer.alloc(count * sector, 0);
    Buffer.from(stream.data).copy(body);
    bodies.push(body);
    next += count;
  });
  return Buffer.concat([header, fat, directory, ...bodies]);
}

/** A BIFF record: type, length, data. */
const record = (type: number, data: number[] | Buffer = []) => {
  const body = Buffer.from(data);
  const head = Buffer.alloc(4);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(body.length, 2);
  return Buffer.concat([head, body]);
};
const padded = (...records: Buffer[]) => {
  const data = Buffer.concat(records);
  return Buffer.concat([data, Buffer.alloc(Math.max(0, 4096 - data.length))]);
};
const bof = (version: number) => record(0x0809, [version & 0xff, version >> 8, 0x05, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test("refuses an Excel 95 .xls, a password-protected .xls or .xlsx, and other compound files", () => {
  const empty = new Uint8Array(0);
  // Excel 5 to 95 keep the workbook in a "Book" stream.
  const old = failure(readXlsx(compound([{ name: "Book", data: empty }])));
  assert.equal(old.error, "old-xls");
  assert.match(old.message, /\.xlsx/);
  // A BIFF5 workbook under the new name.
  assert.equal(failure(readXlsx(compound([{ name: "Workbook", data: padded(bof(0x0500), record(0x000a)) }]))).error, "old-xls");
  // A password on an .xls: FILEPASS in the globals.
  const locked = failure(readXlsx(compound([{ name: "Workbook", data: padded(bof(0x0600), record(0x002f, [1, 0, 1, 0]), record(0x000a)) }])));
  assert.equal(locked.error, "encrypted");
  assert.match(locked.message, /รหัสผ่าน/);
  // A password on an .xlsx: the package is encrypted inside a compound file.
  assert.equal(failure(readXlsx(compound([{ name: "EncryptionInfo", data: empty }, { name: "EncryptedPackage", data: empty }]))).error, "encrypted");
  // A Word 97 document, say.
  assert.equal(failure(readXlsx(compound([{ name: "WordDocument", data: empty }]))).error, "not-xlsx");
  // The signature alone.
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
  assert.equal(failure(readXlsx(ole)).error, "corrupt");
  // A workbook with no sheet.
  assert.equal(failure(readXlsx(compound([{ name: "Workbook", data: padded(bof(0x0600), record(0x000a)) }]))).error, "no-sheet");
});

test("a damaged .xls is refused, never a crash", () => {
  const good = fixture("e2e-or-export.xls");
  assert.equal(failure(readXlsx(good.subarray(0, 600))).error, "corrupt");
  assert.equal(failure(readXlsx(good.subarray(0, Math.floor(good.length / 2)))).error, "corrupt");
  // A FAT chain that loops on itself.
  const looped = compound([{ name: "Workbook", data: padded(bof(0x0600), record(0x000a)) }]);
  looped.writeUInt32LE(2, 512 + 2 * 4);
  assert.equal(failure(readXlsx(looped)).error, "corrupt");
  // Flipped bytes anywhere past the header: whatever comes back is a result, not a throw.
  for (let at = 512; at < good.length; at += 397) {
    const damaged = Buffer.from(good);
    damaged[at] ^= 0xff;
    const result = readXlsx(damaged);
    assert.equal(typeof result.ok, "boolean");
  }
});

test("an .xls is held to the same row and column caps", () => {
  assert.equal(failure(readXlsx(fixture("xls-long-strings.xls"), { maxRows: 100 })).error, "too-many-rows");
  assert.equal(failure(readXlsx(fixture("xls-long-strings.xls"), { maxColumns: 5 })).error, "too-many-columns");
  assert.equal(failure(readXlsx(fixture("xls-long-strings.xls"), { maxFileBytes: 1000 })).error, "too-large");
});

test("an Excel 2003 XML workbook saved as .xls", () => {
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="อื่น"><Table><Row><Cell><Data ss:Type="String">no</Data></Cell></Row></Table></Worksheet>
 <Worksheet ss:Name="operation">
  <Table>
   <Row><Cell><Data ss:Type="String">ID</Data></Cell><Cell><Data ss:Type="String">HN</Data></Cell><Cell ss:Index="4"><Data ss:Type="String">วันที่</Data></Cell></Row>
   <Row ss:Index="3">
    <Cell ss:MergeAcross="1"><Data ss:Type="String">A &amp; B</Data></Cell>
    <Cell><Data ss:Type="Number">0012</Data></Cell>
    <Cell><Data ss:Type="DateTime">2026-11-30T09:30:00.000</Data></Cell>
    <Cell><Data ss:Type="DateTime">1899-12-31T13:15:00.000</Data></Cell>
    <Cell><Data ss:Type="Boolean">1</Data></Cell>
    <Cell><Data ss:Type="Error">#N/A</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell ss:Index="10"><Data ss:Type="String">ข_x000D_ค</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;
  const result = readXlsx(Buffer.from(xml, "utf8"));
  assert.ok(result.ok);
  assert.equal(result.sheetName, "operation");
  assert.equal(result.date1904, false);
  assert.deepEqual(result.rows[0], ["ID", "HN", null, "วันที่"]);
  assert.deepEqual(result.rows[1], []);
  const row = result.rows[2];
  assert.equal(row[0], "A & B");
  assert.equal(row[1], null);
  assert.equal(row[2], 12);
  // 30 Nov 2026 is serial 46356 in Excel's 1900 system; a time alone sits on 31 Dec 1899, day 0.
  assert.ok(Math.abs((row[3] as number) - (46356 + 9.5 / 24)) < 1e-9);
  assert.ok(Math.abs((row[4] as number) - 13.25 / 24) < 1e-9);
  assert.equal(row[5], true);
  assert.equal(row[6], null);
  assert.equal(row[9], "ข\rค");
  assert.equal(row.length, 10);
});

test("a web page or plain text saved as .xls is refused with its own message", () => {
  const html = failure(readXlsx(Buffer.from("<html><body><table><tr><td>HN</td></tr></table></body></html>")));
  assert.equal(html.error, "html");
  assert.match(html.message, /หน้าเว็บ/);
  assert.equal(failure(readXlsx(Buffer.from("\uFEFF<!DOCTYPE html>\n<html>"))).error, "html");
  assert.equal(failure(readXlsx(Buffer.from("ID\tHN\n1\t2\n"))).error, "not-xlsx");
  assert.equal(failure(readXlsx(Buffer.from("<?xml version=\"1.0\"?><root/>"))).error, "not-xlsx");
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

test("refuses what is not an Excel file, and never throws", () => {
  assert.equal(failure(readXlsx(Buffer.from("<html><table><tr><td>ID</td></tr></table></html>"))).error, "html");
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
