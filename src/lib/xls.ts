import type { XlsxCell, XlsxError, XlsxLimits } from "./xlsx.ts";

/**
 * A small reader for the old binary Excel file (.xls, Excel 97–2003, BIFF8), with no dependencies, so MX can upload
 * HOSxP's export as it comes (Pong, 27 Nov 2026: "For upload excel : accept xls"). lib/xlsx.ts hands it every file
 * that starts with the OLE signature and turns what it returns into the same result as an .xlsx's.
 *
 * An .xls is an OLE compound file (a small FAT file system in one file) holding a stream named "Workbook": a run of
 * BIFF records. Only what the export needs is read: the sheet list, the date system, the shared strings and the cell
 * records (text, numbers, a formula's cached value, booleans). Styles are not: whether a number is a date is decided by
 * the column it sits in (lib/workbook.ts), as for an .xlsx. Older BIFF versions (Excel 95 and before, "Book" stream)
 * and password-protected files are refused with their own message.
 *
 * It never throws: every failure comes back as one of lib/xlsx.ts's error codes. Nothing from the file is logged.
 */

export type XlsBook = { sheetName: string; rows: XlsxCell[][]; date1904: boolean };

class XlsFail extends Error {
  constructor(readonly code: XlsxError) {
    super(code);
  }
}

export function readXlsBook(bytes: Uint8Array, limits: XlsxLimits): { ok: true; book: XlsBook } | { ok: false; error: XlsxError } {
  try {
    return { ok: true, book: readBook(bytes, limits) };
  } catch (error) {
    return { ok: false, error: error instanceof XlsFail ? error.code : "corrupt" };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The compound file

const FREE = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;
const DIFAT_SECTOR = 0xfffffffc;
const NO_STREAM = 0xffffffff;

type Entry = { name: string; type: number; start: number; size: number; left: number; right: number; child: number };

type Compound = {
  bytes: Uint8Array;
  view: DataView;
  sectorSize: number;
  fat: Uint32Array;
  entries: Entry[];
  miniFat: Uint32Array;
  miniStream: Uint8Array;
  cutoff: number;
};

function openCompound(bytes: Uint8Array): Compound {
  if (bytes.length < 512) throw new XlsFail("corrupt");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0x1c, true) !== 0xfffe) throw new XlsFail("corrupt");
  const shift = view.getUint16(0x1e, true);
  if (shift !== 9 && shift !== 12) throw new XlsFail("corrupt");
  const sectorSize = 1 << shift;
  const sectorCount = Math.floor((bytes.length - sectorSize) / sectorSize) + (bytes.length % sectorSize ? 1 : 0);
  const sectorAt = (sector: number) => {
    if (sector >= sectorCount) throw new XlsFail("corrupt");
    return (sector + 1) * sectorSize;
  };
  const perSector = sectorSize / 4;

  // The FAT's own sectors: 109 in the header, then a chain of DIFAT sectors for a bigger file.
  const fatSectors: number[] = [];
  for (let index = 0; index < 109; index += 1) {
    const sector = view.getUint32(0x4c + index * 4, true);
    if (sector !== FREE) fatSectors.push(sector);
  }
  let difat = view.getUint32(0x44, true);
  for (let steps = 0; difat !== END_OF_CHAIN && difat !== FREE; steps += 1) {
    if (steps > sectorCount) throw new XlsFail("corrupt");
    const at = sectorAt(difat);
    for (let index = 0; index < perSector - 1; index += 1) {
      const sector = view.getUint32(at + index * 4, true);
      if (sector !== FREE) fatSectors.push(sector);
    }
    difat = view.getUint32(at + (perSector - 1) * 4, true);
  }
  if (fatSectors.length === 0 || fatSectors.length > sectorCount) throw new XlsFail("corrupt");
  const fat = new Uint32Array(fatSectors.length * perSector);
  fatSectors.forEach((sector, index) => {
    const at = sectorAt(sector);
    for (let n = 0; n < perSector; n += 1) fat[index * perSector + n] = view.getUint32(at + n * 4, true);
  });

  /** A chain of sectors, each visited once (a loop in a crafted file is refused). */
  const chain = (start: number, table: Uint32Array): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let sector = start; sector !== END_OF_CHAIN; sector = table[sector]) {
      if (sector >= table.length || sector === FREE || sector === FAT_SECTOR || sector === DIFAT_SECTOR || seen.has(sector)) {
        throw new XlsFail("corrupt");
      }
      seen.add(sector);
      out.push(sector);
    }
    return out;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let filled = 0;
    for (const sector of chain(start, fat)) {
      if (filled >= size) break;
      const at = sectorAt(sector);
      const piece = bytes.subarray(at, Math.min(at + sectorSize, bytes.length, at + size - filled));
      out.set(piece, filled);
      filled += piece.length;
    }
    if (filled < size) throw new XlsFail("corrupt");
    return out;
  };

  // The directory: 128-byte entries, the first one the root (which also holds the mini stream).
  const directoryStart = view.getUint32(0x30, true);
  const directorySectors = chain(directoryStart, fat);
  const directory = readChain(directoryStart, directorySectors.length * sectorSize);
  const dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: Entry[] = [];
  const names = new TextDecoder("utf-16le");
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const nameBytes = Math.min(dirView.getUint16(at + 0x40, true), 64);
    entries.push({
      name: names.decode(directory.subarray(at, at + Math.max(0, nameBytes - 2))),
      type: directory[at + 0x42],
      left: dirView.getUint32(at + 0x44, true),
      right: dirView.getUint32(at + 0x48, true),
      child: dirView.getUint32(at + 0x4c, true),
      start: dirView.getUint32(at + 0x74, true),
      // A version 3 file keeps only the low 32 bits; the export is far below 4 GB either way.
      size: dirView.getUint32(at + 0x78, true),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new XlsFail("corrupt");
  if (root.size > bytes.length || entries.some((entry) => entry.type === 2 && entry.size > bytes.length)) throw new XlsFail("corrupt");

  const cutoff = view.getUint32(0x38, true) || 4096;
  const miniFatStart = view.getUint32(0x3c, true);
  let miniFat = new Uint32Array(0);
  if (miniFatStart !== END_OF_CHAIN && miniFatStart !== FREE) {
    const sectors = chain(miniFatStart, fat);
    const raw = readChain(miniFatStart, sectors.length * sectorSize);
    const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    miniFat = new Uint32Array(raw.length / 4);
    for (let n = 0; n < miniFat.length; n += 1) miniFat[n] = rawView.getUint32(n * 4, true);
  }
  const miniStream = root.size > 0 && root.start !== END_OF_CHAIN ? readChain(root.start, root.size) : new Uint8Array(0);

  return { bytes, view, sectorSize, fat, entries, miniFat, miniStream, cutoff };
}

/** A stream's bytes: from the big sectors, or from the mini stream when it is small. */
function streamOf(file: Compound, entry: Entry): Uint8Array {
  if (entry.size === 0) return new Uint8Array(0);
  const mini = entry.size < file.cutoff;
  const table = mini ? file.miniFat : file.fat;
  const unit = mini ? 64 : file.sectorSize;
  const out = new Uint8Array(entry.size);
  let filled = 0;
  // Each sector once: a chain that comes back on itself is a crafted or broken file.
  const seen = new Set<number>();
  for (let sector = entry.start; filled < entry.size; sector = table[sector]) {
    if (sector === END_OF_CHAIN || sector >= table.length || seen.has(sector)) throw new XlsFail("corrupt");
    seen.add(sector);
    const source = mini ? file.miniStream : file.bytes;
    const at = mini ? sector * 64 : (sector + 1) * file.sectorSize;
    if (at >= source.length) throw new XlsFail("corrupt");
    const piece = source.subarray(at, Math.min(at + unit, source.length, at + entry.size - filled));
    out.set(piece, filled);
    filled += piece.length;
  }
  return out;
}

/** The root storage's streams by name, case as Excel writes them ignored. */
function topStream(file: Compound, name: string): Entry | null {
  const wanted = name.toLowerCase();
  // The directory is a tree; a stream at the top level sits in the root's subtree, but a flat look is enough for a
  // workbook (its streams all live at the top) and cannot be sent round a loop.
  return file.entries.find((entry) => entry.type === 2 && entry.name.toLowerCase() === wanted && entry.start !== NO_STREAM) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// BIFF8

const BOF = 0x0809;
const EOF = 0x000a;
const FILEPASS = 0x002f;
const DATEMODE = 0x0022;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const RSTRING = 0x00d6;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;
const BOOLERR = 0x0205;
const SHRFMLA = 0x04bc;
const ARRAY = 0x0221;
const TABLE = 0x0236;

type Record = { type: number; data: Uint8Array; at: number };

/** Records from `start` on, each `[type, length, data]`; stops at the stream's end. */
function* records(stream: Uint8Array, start: number): Generator<Record> {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  let at = start;
  while (at + 4 <= stream.length) {
    const type = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (at + 4 + length > stream.length) throw new XlsFail("corrupt");
    yield { type, data: stream.subarray(at + 4, at + 4 + length), at };
    at += 4 + length;
  }
}

const u16 = (data: Uint8Array, at: number) => {
  if (at + 2 > data.length) throw new XlsFail("corrupt");
  return data[at] | (data[at + 1] << 8);
};
const u32 = (data: Uint8Array, at: number) => {
  if (at + 4 > data.length) throw new XlsFail("corrupt");
  return (data[at] | (data[at + 1] << 8) | (data[at + 2] << 16) | (data[at + 3] << 24)) >>> 0;
};
const f64 = (data: Uint8Array, at: number) => {
  if (at + 8 > data.length) throw new XlsFail("corrupt");
  return new DataView(data.buffer, data.byteOffset + at, 8).getFloat64(0, true);
};

/** Characters of a BIFF8 string: one byte each (the low byte of the code) when compressed, else UTF-16LE. */
function chars(data: Uint8Array, at: number, count: number, wide: boolean): string {
  const length = wide ? count * 2 : count;
  if (at + length > data.length) throw new XlsFail("corrupt");
  if (wide) return new TextDecoder("utf-16le").decode(data.subarray(at, at + length));
  let out = "";
  for (let index = 0; index < count; index += 1) out += String.fromCharCode(data[at + index]);
  return out;
}

/**
 * A string in one record (LABEL, RSTRING, STRING, a sheet name): its length (`lengthBytes` 1 or 2), the option flags,
 * then the characters; rich-text runs and phonetic data after them are skipped.
 */
function unicodeString(data: Uint8Array, at: number, lengthBytes: 1 | 2): string {
  const count = lengthBytes === 1 ? data[at] : u16(data, at);
  let cursor = at + lengthBytes;
  const flags = data[cursor];
  cursor += 1;
  if (flags & 0x08) cursor += 2;
  if (flags & 0x04) cursor += 4;
  return chars(data, cursor, count, (flags & 0x01) !== 0);
}

/**
 * The shared strings: the SST record and the CONTINUE records after it, read as one run. A string's characters may
 * break across a CONTINUE, which then starts with a new flags byte saying whether the rest is compressed; anything
 * else (lengths, rich-text runs, phonetic data) simply carries on into the next record.
 */
function sharedStrings(parts: readonly Uint8Array[], limit: number): string[] {
  let part = 0;
  let at = 0;
  const left = () => parts[part].length - at;
  const next = () => {
    part += 1;
    at = 0;
    if (part >= parts.length) throw new XlsFail("corrupt");
  };
  const byte = () => {
    while (left() <= 0) next();
    return parts[part][at++];
  };
  const word = () => byte() | (byte() << 8);
  const dword = () => (word() | (word() << 16)) >>> 0;
  const skip = (count: number) => {
    let rest = count;
    while (rest > 0) {
      while (left() <= 0) next();
      const step = Math.min(rest, left());
      at += step;
      rest -= step;
    }
  };

  const first = parts[0];
  if (first.length < 8) throw new XlsFail("corrupt");
  const unique = u32(first, 4);
  at = 8;
  if (unique > limit) throw new XlsFail("too-large");
  const out: string[] = [];
  for (let index = 0; index < unique; index += 1) {
    const count = word();
    const flags = byte();
    let wide = (flags & 0x01) !== 0;
    const runs = flags & 0x08 ? word() : 0;
    const extra = flags & 0x04 ? dword() : 0;
    let text = "";
    let rest = count;
    while (rest > 0) {
      if (left() <= 0) {
        next();
        // A string broken here starts the next record with its flags again.
        wide = (parts[part][at++] & 0x01) !== 0;
        continue;
      }
      const take = Math.min(rest, Math.floor(left() / (wide ? 2 : 1)));
      if (take === 0) throw new XlsFail("corrupt");
      text += chars(parts[part], at, take, wide);
      at += take * (wide ? 2 : 1);
      rest -= take;
    }
    skip(runs * 4 + extra);
    out.push(text);
  }
  return out;
}

/** An RK number: a 30-bit integer or the top of a double, maybe divided by 100. */
function rkValue(rk: number): number {
  let value: number;
  if (rk & 0x02) {
    value = rk >> 2;
  } else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(4, rk & 0xfffffffc, true);
    buffer.setUint32(0, 0, true);
    value = buffer.getFloat64(0, true);
  }
  return rk & 0x01 ? value / 100 : value;
}

type SheetRef = { name: string; offset: number; hidden: boolean; worksheet: boolean };

function readBook(bytes: Uint8Array, limits: XlsxLimits): XlsBook {
  const file = openCompound(bytes);
  // A password-protected .xlsx is a compound file too, holding the encrypted package.
  if (topStream(file, "EncryptedPackage") || topStream(file, "EncryptionInfo")) throw new XlsFail("encrypted");
  const workbook = topStream(file, "Workbook");
  if (!workbook) throw new XlsFail(topStream(file, "Book") ? "old-xls" : "not-xlsx");
  const stream = streamOf(file, workbook);

  // The workbook globals: the first substream, up to its EOF.
  const sheets: SheetRef[] = [];
  let date1904 = false;
  let shared: string[] = [];
  let sstParts: Uint8Array[] | null = null;
  let first = true;
  for (const record of records(stream, 0)) {
    if (first) {
      if (record.type !== BOF) throw new XlsFail(record.type === 0x0409 || record.type === 0x0209 || record.type === 0x0009 ? "old-xls" : "corrupt");
      // BIFF8 says 0x0600; BIFF5 and 7 (Excel 5 to 95) say 0x0500 and keep text in the old code pages.
      if (u16(record.data, 0) !== 0x0600) throw new XlsFail("old-xls");
      first = false;
      continue;
    }
    if (sstParts && record.type === CONTINUE) {
      sstParts.push(record.data);
      continue;
    }
    if (sstParts) {
      shared = sharedStrings(sstParts, limits.maxRows * limits.maxColumns);
      sstParts = null;
    }
    if (record.type === EOF) break;
    if (record.type === FILEPASS) throw new XlsFail("encrypted");
    if (record.type === DATEMODE) date1904 = u16(record.data, 0) === 1;
    else if (record.type === SST) sstParts = [record.data];
    else if (record.type === BOUNDSHEET) {
      sheets.push({
        offset: u32(record.data, 0),
        hidden: (record.data[4] & 0x03) !== 0,
        worksheet: record.data[5] === 0,
        name: unicodeString(record.data, 6, 1),
      });
    }
  }
  if (sstParts) shared = sharedStrings(sstParts, limits.maxRows * limits.maxColumns);

  const worksheets = sheets.filter((sheet) => sheet.worksheet);
  const wanted =
    worksheets.find((sheet) => sheet.name.trim().toLowerCase() === "operation") ??
    worksheets.find((sheet) => !sheet.hidden) ??
    worksheets[0];
  if (!wanted || wanted.offset >= stream.length) throw new XlsFail("no-sheet");
  return { sheetName: wanted.name, rows: readSheet(stream, wanted.offset, shared, limits), date1904 };
}

function readSheet(stream: Uint8Array, offset: number, shared: readonly string[], limits: XlsxLimits): XlsxCell[][] {
  const grid: XlsxCell[][] = [];
  const store = (row: number, column: number, cell: XlsxCell) => {
    // Empty cells are skipped, as in an .xlsx, so far-off formatting neither counts against the caps nor pads the rows.
    if (cell === null || cell === "") return;
    if (row + 1 > limits.maxRows) throw new XlsFail("too-many-rows");
    if (column + 1 > limits.maxColumns) throw new XlsFail("too-many-columns");
    (grid[row] ??= [])[column] = cell;
  };

  let started = false;
  // A FORMULA whose value is text says so, and the STRING record right after it holds the text.
  let pendingString: { row: number; column: number } | null = null;
  for (const { type, data } of records(stream, offset)) {
    if (!started) {
      if (type !== BOF) throw new XlsFail("corrupt");
      started = true;
      continue;
    }
    if (type === EOF) break;
    if (type === STRING) {
      if (pendingString) store(pendingString.row, pendingString.column, unicodeString(data, 0, 2));
      pendingString = null;
      continue;
    }
    // A shared or array formula's own record may sit between the FORMULA and its STRING.
    if (type === SHRFMLA || type === ARRAY || type === TABLE) continue;
    pendingString = null;
    switch (type) {
      case LABELSST: {
        const index = u32(data, 6);
        store(u16(data, 0), u16(data, 2), index < shared.length ? shared[index] : null);
        break;
      }
      case LABEL:
      case RSTRING:
        store(u16(data, 0), u16(data, 2), unicodeString(data, 6, 2));
        break;
      case NUMBER: {
        const value = f64(data, 6);
        store(u16(data, 0), u16(data, 2), Number.isFinite(value) ? value : null);
        break;
      }
      case RK:
        store(u16(data, 0), u16(data, 2), rkValue(u32(data, 6)));
        break;
      case MULRK: {
        const row = u16(data, 0);
        const firstColumn = u16(data, 2);
        const count = Math.floor((data.length - 6) / 6);
        for (let index = 0; index < count; index += 1) store(row, firstColumn + index, rkValue(u32(data, 4 + index * 6 + 2)));
        break;
      }
      case FORMULA: {
        const row = u16(data, 0);
        const column = u16(data, 2);
        if (data.length < 14) throw new XlsFail("corrupt");
        if (data[12] === 0xff && data[13] === 0xff) {
          // A value that is not a number: text (in the STRING record next), a boolean, an error or an empty string.
          if (data[6] === 0) pendingString = { row, column };
          else if (data[6] === 1) store(row, column, data[8] !== 0);
        } else {
          const value = f64(data, 6);
          store(row, column, Number.isFinite(value) ? value : null);
        }
        break;
      }
      case BOOLERR:
        // An error value is no value, as in an .xlsx.
        if (data.length >= 8 && data[7] === 0) store(u16(data, 0), u16(data, 2), data[6] !== 0);
        break;
      default:
        break;
    }
  }
  if (!started) throw new XlsFail("no-sheet");
  // Dense rows: rows[i] is sheet row i + 1, missing rows and cells are empty.
  return Array.from(grid, (cells) => (cells ? Array.from(cells, (cell) => cell ?? null) : []));
}
