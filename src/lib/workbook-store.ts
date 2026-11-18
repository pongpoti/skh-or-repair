import "server-only";
import type { Pool, PoolClient } from "pg";
import type { DeptCode } from "./allocation";
import { withTx } from "./db";
import { normalizeHn } from "./hn";
import type { CaseStatus, Shift } from "./schedule";

type Q = Pool | PoolClient;

/**
 * The HOSxP workbook uploads and their cases: tables `workbook_uploads` and `workbook_cases` (db/schema.sql). The
 * upload page reads the file (lib/xlsx.ts, lib/workbook.ts), places each kept case (lib/placement.ts) and saves the
 * result here; the board shows the latest upload of its cycle (lib/board-day.ts). Only what the board needs is
 * stored: of the patient, the HN and the name (Pong, 16 Nov 2026), never the age, AN, diagnosis, illnesses or costs,
 * and nothing here is ever logged.
 */

/**
 * An upload older than this is deleted with its cases when a new upload is saved, unless it is the latest list of its
 * day: every past day keeps its list, so the board's calendar can show it (Pong, 19 Nov 2026, the Jan-Oct lists).
 */
export const KEEP_UPLOAD_DAYS = 30;

/** One kept case of an upload, as the upload page hands it over (placed by lib/placement.ts). */
export type PlacedCase = {
  /** The export's ID column (the case id), unique within an upload. */
  caseId: string;
  /** The patient's HN as the file has it; saveUpload stores it normalised (lib/hn.ts). */
  hn: string;
  /** The operation's name (ชื่อการผ่าตัด). */
  operation: string;
  /** Title and name of the surgeon, e.g. "นพ. ชื่อ นามสกุล". */
  surgeon: string;
  dept: DeptCode | null;
  /**
   * The surgeon's team for the SCOPE rule (lib/workbook.ts WorkbookRow.team). Kept so the board can place the case
   * again under the repair's dates in force when it is read (lib/board-rows.ts).
   */
  team: string | null;
  /**
   * The room placement chose at upload, or null when the case was not placed. Only a record: the board places the case
   * again when it is read, so an admin's later change of the repair's dates moves it too.
   */
  roomId: string | null;
  shift: Shift | null;
  status: CaseStatus;
  /** The urgency label as the file has it (Elective, Urgency…), or null when blank. */
  urgency: string | null;
  /** The booked time (สั่งผ่าตัดเวลา) as HH:MM, or null when blank. */
  bookedTime: string | null;
  /** Order in the file, from 1. */
  position: number;
  /** The patient's name as the file has it (ชื่อ), or null when the file has no such column or the cell is blank. */
  patientName: string | null;
};

/** A saved case, as read back. */
export type StoredCase = PlacedCase & { id: string; uploadId: string };

export type UploadInput = {
  /** The workday the file lists, YYYY-MM-DD. */
  targetDate: string;
  /** The Bangkok date of the upload, YYYY-MM-DD. */
  cycleDay: string;
  /** When the upload was made (lib/clock.ts now()); uploads 30 days older than this are deleted. */
  uploadedAt: Date;
  /** The uploader's LINE sub. */
  uploadedBy: string;
  uploaderName: string | null;
  fileName: string | null;
  /** Rows read from the file. */
  totalRows: number;
  /** Rows kept by the filter. */
  kept: number;
  /** Kept cases placed in a room. */
  placed: number;
  /** Counts only (dropped by reason, placed per room, unplaced by reason), never a row, an HN or a name. */
  summary: unknown;
  cases: readonly PlacedCase[];
};

/** One past day's list of an import (lib/past-lists.ts): the day, the counts and the cases, as an upload has them. */
export type PastList = Pick<UploadInput, "targetDate" | "totalRows" | "kept" | "placed" | "summary" | "cases">;

/** An admin's import of past days' lists from one HOSxP export of many days (/admin). */
export type PastListsInput = Pick<UploadInput, "cycleDay" | "uploadedAt" | "uploadedBy" | "uploaderName" | "fileName"> & {
  lists: readonly PastList[];
};

/** What an import saved: the days given a list, and the days left alone because MX uploaded a list for them. */
export type PastListsSaved = { saved: string[]; mxDays: string[] };

/** The past days that hold an imported list (the admin page's line), or zero days. */
export type PastListSpan = { days: number; first: string | null; last: string | null };

export type Upload = {
  id: string;
  targetDate: string;
  cycleDay: string;
  uploadedAt: Date;
  uploadedBy: string;
  uploaderName: string | null;
  fileName: string | null;
  totalRows: number | null;
  kept: number | null;
  placed: number | null;
  summary: unknown;
  /** A past day's list an admin imported (savePastLists), not one MX uploaded. */
  pastImport: boolean;
};

interface UploadRow {
  id: string;
  target_date: string;
  cycle_day: string;
  uploaded_at: Date;
  uploaded_by: string;
  uploader_name: string | null;
  file_name: string | null;
  total_rows: number | null;
  kept: number | null;
  placed: number | null;
  summary: unknown;
  past_import: boolean;
}

interface CaseRow {
  id: string;
  upload_id: string;
  case_id: string;
  hn: string;
  operation: string;
  surgeon: string;
  dept: DeptCode | null;
  team: string | null;
  room_id: string | null;
  shift: Shift | null;
  status: CaseStatus;
  urgency: string | null;
  booked_time: string | null;
  position: number;
  patient_name: string | null;
}

const UPLOAD_COLUMNS =
  "id::text AS id, to_char(target_date, 'YYYY-MM-DD') AS target_date, to_char(cycle_day, 'YYYY-MM-DD') AS cycle_day, " +
  "uploaded_at, uploaded_by, uploader_name, file_name, total_rows, kept, placed, summary, past_import";

const CASE_COLUMNS =
  "id::text AS id, upload_id::text AS upload_id, case_id, hn, operation, surgeon, dept, team, room_id, shift, status, " +
  "urgency, booked_time, position, patient_name";

function toUpload(r: UploadRow): Upload {
  return {
    id: r.id,
    targetDate: r.target_date,
    cycleDay: r.cycle_day,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
    uploaderName: r.uploader_name,
    fileName: r.file_name,
    totalRows: r.total_rows,
    kept: r.kept,
    placed: r.placed,
    summary: r.summary,
    pastImport: r.past_import,
  };
}

function toCase(r: CaseRow): StoredCase {
  return {
    id: r.id,
    uploadId: r.upload_id,
    caseId: r.case_id,
    hn: r.hn,
    operation: r.operation,
    surgeon: r.surgeon,
    dept: r.dept,
    team: r.team,
    roomId: r.room_id,
    shift: r.shift,
    status: r.status,
    urgency: r.urgency,
    bookedTime: r.booked_time,
    position: r.position,
    patientName: r.patient_name,
  };
}

/** The cases as stored: a case id seen twice keeps its first row. */
function firstOfEachId(cases: readonly PlacedCase[]): PlacedCase[] {
  const seen = new Set<string>();
  return cases.filter((item) => {
    if (seen.has(item.caseId)) return false;
    seen.add(item.caseId);
    return true;
  });
}

/** Inserts cases of one or more uploads in one statement (each column goes as one array), every HN normalised. */
async function insertCases(c: PoolClient, items: readonly { uploadId: string; item: PlacedCase }[]): Promise<void> {
  if (items.length === 0) return;
  const column = <T>(pick: (item: PlacedCase) => T) => items.map(({ item }) => pick(item));
  await c.query(
    `INSERT INTO workbook_cases (upload_id, case_id, hn, operation, surgeon, dept, team, room_id, shift, status, urgency, booked_time, position, patient_name)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
       $10::text[], $11::text[], $12::text[], $13::int[], $14::text[])`,
    [
      items.map(({ uploadId }) => uploadId),
      column((item) => item.caseId),
      column((item) => normalizeHn(item.hn)),
      column((item) => item.operation),
      column((item) => item.surgeon),
      column((item) => item.dept),
      column((item) => item.team),
      column((item) => item.roomId),
      column((item) => item.shift),
      column((item) => item.status),
      column((item) => item.urgency),
      column((item) => item.bookedTime),
      column((item) => item.position),
      column((item) => item.patientName),
    ],
  );
}

/**
 * Saves an upload and its cases in one transaction, so the board never sees half a file. The same transaction deletes
 * the uploads made more than 30 days before this one (their cases go with them) that a later upload for the same day
 * has replaced, so patient numbers are not kept longer than the board needs them; the latest list of each day stays
 * for the board's calendar. Every HN is stored normalised; a case id seen twice keeps its first row.
 */
export async function saveUpload(pool: Pool, input: UploadInput): Promise<Upload> {
  const cases = firstOfEachId(input.cases);
  return withTx(pool, async (c) => {
    const { rows } = await c.query<UploadRow>(
      `INSERT INTO workbook_uploads (target_date, cycle_day, uploaded_at, uploaded_by, uploader_name, file_name, total_rows, kept, placed, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${UPLOAD_COLUMNS}`,
      [
        input.targetDate,
        input.cycleDay,
        input.uploadedAt,
        input.uploadedBy,
        input.uploaderName,
        input.fileName,
        input.totalRows,
        input.kept,
        input.placed,
        JSON.stringify(input.summary ?? null),
      ],
    );
    const upload = toUpload(rows[0]);
    await insertCases(
      c,
      cases.map((item) => ({ uploadId: upload.id, item })),
    );
    // After the insert, so an old list this upload replaces goes now.
    await c.query(
      `DELETE FROM workbook_uploads u WHERE u.uploaded_at < $1::timestamptz - make_interval(days => $2)
       AND EXISTS (SELECT 1 FROM workbook_uploads n WHERE n.target_date = u.target_date AND (n.uploaded_at, n.id) > (u.uploaded_at, u.id))`,
      [input.uploadedAt, KEEP_UPLOAD_DAYS],
    );
    return upload;
  });
}

/**
 * Saves an import's past days' lists in one transaction (Pong, 19 Nov 2026: the Jan-Oct lists on the board's calendar).
 * A day MX uploaded a list for is left alone: MX's list is the real one. A day an earlier import gave a list gets this
 * one instead, so importing a file again does not stack copies. Each list is an upload marked past_import, read by the
 * board like any other; a case id seen twice in a day keeps its first row.
 */
export async function savePastLists(pool: Pool, input: PastListsInput): Promise<PastListsSaved> {
  const byDay = new Map<string, PastList>();
  for (const list of input.lists) if (!byDay.has(list.targetDate)) byDay.set(list.targetDate, list);
  return withTx(pool, async (c) => {
    // Two imports at once would each delete the other's lists before saving their own.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('orskh:past-lists'))");
    const { rows: mx } = await c.query<{ day: string }>(
      `SELECT DISTINCT to_char(target_date, 'YYYY-MM-DD') AS day FROM workbook_uploads
       WHERE NOT past_import AND target_date = ANY($1::date[])`,
      [[...byDay.keys()]],
    );
    const mxDays = mx.map((row) => row.day).sort();
    for (const day of mxDays) byDay.delete(day);
    const lists = [...byDay.values()].sort((a, b) => (a.targetDate < b.targetDate ? -1 : 1));
    if (lists.length === 0) return { saved: [], mxDays };
    await c.query("DELETE FROM workbook_uploads WHERE past_import AND target_date = ANY($1::date[])", [lists.map((list) => list.targetDate)]);
    const { rows } = await c.query<{ id: string; day: string }>(
      `INSERT INTO workbook_uploads (target_date, cycle_day, uploaded_at, uploaded_by, uploader_name, file_name, total_rows, kept, placed, summary, past_import)
       SELECT day, $2::date, $3::timestamptz, $4, $5, $6, total_rows, kept, placed, summary, true
       FROM unnest($1::date[], $7::int[], $8::int[], $9::int[], $10::jsonb[]) AS list(day, total_rows, kept, placed, summary)
       RETURNING id::text AS id, to_char(target_date, 'YYYY-MM-DD') AS day`,
      [
        lists.map((list) => list.targetDate),
        input.cycleDay,
        input.uploadedAt,
        input.uploadedBy,
        input.uploaderName,
        input.fileName,
        lists.map((list) => list.totalRows),
        lists.map((list) => list.kept),
        lists.map((list) => list.placed),
        lists.map((list) => JSON.stringify(list.summary ?? null)),
      ],
    );
    const idOf = new Map(rows.map((row) => [row.day, row.id]));
    await insertCases(
      c,
      lists.flatMap((list) => firstOfEachId(list.cases).map((item) => ({ uploadId: idOf.get(list.targetDate) as string, item }))),
    );
    return { saved: lists.map((list) => list.targetDate), mxDays };
  });
}

/** How many past days hold an imported list, and the first and last of them. */
export async function pastListSpan(pool: Q): Promise<PastListSpan> {
  const { rows } = await pool.query<{ days: number; first: string | null; last: string | null }>(
    `SELECT count(DISTINCT target_date)::int AS days, to_char(min(target_date), 'YYYY-MM-DD') AS first,
       to_char(max(target_date), 'YYYY-MM-DD') AS last FROM workbook_uploads WHERE past_import`,
  );
  return rows[0] ?? { days: 0, first: null, last: null };
}

/** The latest upload made on `cycleDay` for `targetDate` (the one the board shows), or null. */
export async function latestUpload(pool: Q, cycleDay: string, targetDate: string): Promise<Upload | null> {
  const { rows } = await pool.query<UploadRow>(
    `SELECT ${UPLOAD_COLUMNS} FROM workbook_uploads WHERE cycle_day = $1 AND target_date = $2
     ORDER BY uploaded_at DESC, id DESC LIMIT 1`,
    [cycleDay, targetDate],
  );
  return rows.length ? toUpload(rows[0]) : null;
}

/** The latest upload for `targetDate`, whichever day it was made (for the upload page's history). */
export async function latestUploadForTarget(pool: Q, targetDate: string): Promise<Upload | null> {
  const { rows } = await pool.query<UploadRow>(
    `SELECT ${UPLOAD_COLUMNS} FROM workbook_uploads WHERE target_date = $1 ORDER BY uploaded_at DESC, id DESC LIMIT 1`,
    [targetDate],
  );
  return rows.length ? toUpload(rows[0]) : null;
}

/** An upload's cases in file order. */
export async function casesOf(pool: Q, uploadId: string): Promise<StoredCase[]> {
  const { rows } = await pool.query<CaseRow>(
    `SELECT ${CASE_COLUMNS} FROM workbook_cases WHERE upload_id = $1 ORDER BY position, id`,
    [uploadId],
  );
  return rows.map(toCase);
}

/**
 * The workbook of a day picked on the board: the latest upload for that day, whichever cycle made it, with its cases,
 * or null when there is none (a day further ahead than the coming one, or one MX never uploaded).
 */
export async function workbookForDay(pool: Q, targetDate: string): Promise<{ upload: Upload; cases: StoredCase[] } | null> {
  const upload = await latestUploadForTarget(pool, targetDate);
  return upload ? { upload, cases: await casesOf(pool, upload.id) } : null;
}

/** The board's workbook: the latest upload of the cycle with its cases, or null when MX has not uploaded yet. */
export async function workbookFor(pool: Q, cycleDay: string, targetDate: string): Promise<{ upload: Upload; cases: StoredCase[] } | null> {
  const upload = await latestUpload(pool, cycleDay, targetDate);
  return upload ? { upload, cases: await casesOf(pool, upload.id) } : null;
}
