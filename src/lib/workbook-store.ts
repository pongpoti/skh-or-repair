import "server-only";
import type { Pool, PoolClient } from "pg";
import type { DeptCode } from "./allocation";
import { bangkokParts } from "./days";
import { withTx } from "./db";
import { normalizeHn } from "./hn";
import type { PlaceId } from "./places";
import { surgeonDeptOf } from "./workbook";
import type { CaseStatus, Shift } from "./schedule";

type Q = Pool | PoolClient;

/**
 * The HOSxP workbook uploads and their cases: tables `workbook_uploads` and `workbook_cases` (db/schema.sql). The
 * upload page reads the file (lib/xlsx.ts, lib/workbook.ts), places each kept case (lib/placement.ts, and
 * lib/tha-chalom-schedule.ts for รพ.ท่าฉลอม's) and saves the result here; each hospital's board shows its cases of the
 * latest upload of its cycle (lib/board-day.ts). Only what the board needs is
 * stored: of the patient, the HN and the name (Pong, 16 Nov 2026), never the age, AN, diagnosis, illnesses or costs,
 * and nothing here is ever logged.
 */

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
  /** The surgeon's team in the physician list, else the department (lib/workbook.ts WorkbookRow.team). No rule uses it. */
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
  /**
   * The hospital, รพ.สมุทรสาคร when left out (Pong, 27 Nov 2026: "Excel file include both place on one sheet"). Not read
   * back: casesOf reads one hospital's cases.
   */
  place?: PlaceId;
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
  /** It kept รพ.ท่าฉลอม's cases: one saved before 27 Nov 2026 cut them, so it has no list for that hospital. */
  thaChalom: boolean;
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
  tha_chalom: boolean;
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
  "uploaded_at, uploaded_by, uploader_name, file_name, total_rows, kept, placed, summary, past_import, tha_chalom";

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
    thaChalom: r.tha_chalom,
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
    // The surgeon's own department decides the room, for a list stored before that rule too (Pong, 19 Nov 2026).
    dept: surgeonDeptOf(r.surgeon) ?? r.dept,
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
    `INSERT INTO workbook_cases (upload_id, case_id, hn, operation, surgeon, dept, team, room_id, shift, status, urgency, booked_time, position, patient_name, place)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
       $10::text[], $11::text[], $12::text[], $13::int[], $14::text[], $15::text[])`,
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
      column((item) => item.place ?? "skh"),
    ],
  );
}

/**
 * Saves an upload and its cases (both hospitals', each case with its `place`) in one transaction, so the board never
 * sees half a file. The upload is marked as keeping รพ.ท่าฉลอม's cases (Upload.thaChalom). The same transaction deletes
 * every list of the days before this upload's cycle day (or the day it was made, if earlier), at both hospitals
 * (deletePastLists), so patient numbers are
 * not kept longer than the boards need them: neither board shows a past day (Pong, 27 Nov 2026: "Disable past day view
 * and clear pastday data for both places"). Every HN is stored normalised; a case id seen twice keeps its first row.
 */
export async function saveUpload(pool: Pool, input: UploadInput): Promise<Upload> {
  const cases = firstOfEachId(input.cases);
  return withTx(pool, async (c) => {
    const { rows } = await c.query<UploadRow>(
      `INSERT INTO workbook_uploads (target_date, cycle_day, uploaded_at, uploaded_by, uploader_name, file_name, total_rows, kept, placed, summary, tha_chalom)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true) RETURNING ${UPLOAD_COLUMNS}`,
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
    // The day it was made, in Bangkok: an admin's upload for a later day counts in a later cycle (app/upload/actions.ts
    // adminCycleDay), which must not take the days in between with it.
    const made = bangkokParts(input.uploadedAt).date;
    await deletePastLists(c, input.cycleDay < made ? input.cycleDay : made);
    return upload;
  });
}

/**
 * Deletes the lists (uploads, MX's and admins', with their cases at both hospitals) of every day before `day`, and says
 * how many uploads went. Each upload calls it with its cycle day, so today's list stays until the day is over.
 */
export async function deletePastLists(pool: Q, day: string): Promise<number> {
  const { rowCount } = await pool.query("DELETE FROM workbook_uploads WHERE target_date < $1::date", [day]);
  return rowCount ?? 0;
}

/** A day from `from` on that holds HOSxP lists, for the admin's reset (/admin): its uploads and the cases of its latest. */
export type ListedDay = {
  date: string;
  uploads: number;
  /** The latest upload's cases at รพ.สมุทรสาคร and at รพ.ท่าฉลอม. */
  skh: number;
  thaChalom: number;
  latestAt: Date;
  latestBy: string;
};

/** The days from `from` on that hold HOSxP lists, in date order. */
export async function listedDays(pool: Q, from: string): Promise<ListedDay[]> {
  const { rows } = await pool.query<{ date: string; uploads: number; skh: number; tc: number; at: Date; by: string }>(
    `WITH latest AS (
       SELECT DISTINCT ON (target_date) id, target_date, uploaded_at, uploader_name FROM workbook_uploads
       WHERE target_date >= $1::date ORDER BY target_date, uploaded_at DESC, id DESC
     )
     SELECT to_char(l.target_date, 'YYYY-MM-DD') AS date,
       (SELECT count(*)::int FROM workbook_uploads u WHERE u.target_date = l.target_date) AS uploads,
       (SELECT count(*)::int FROM workbook_cases c WHERE c.upload_id = l.id AND c.place = 'skh') AS skh,
       (SELECT count(*)::int FROM workbook_cases c WHERE c.upload_id = l.id AND c.place = 'tha-chalom') AS tc,
       l.uploaded_at AS at, l.uploader_name AS by
     FROM latest l ORDER BY l.target_date`,
    [from],
  );
  return rows.map((row) => ({ date: row.date, uploads: row.uploads, skh: row.skh, thaChalom: row.tc, latestAt: row.at, latestBy: row.by }));
}

/**
 * Resets one day's OR schedule to the bookings alone: deletes every HOSxP list of `date` (every upload, at both
 * hospitals, with its cases), never a booking (Pong, 27 Nov 2026: "Add option for admin to reset OR schedule of specific
 * date (reset only for hosxp case)"). Says how many uploads went; MX may upload the day's list again.
 */
export async function resetDayLists(pool: Q, date: string): Promise<number> {
  const { rowCount } = await pool.query("DELETE FROM workbook_uploads WHERE target_date = $1::date", [date]);
  return rowCount ?? 0;
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

/** An upload's cases at one hospital (รพ.สมุทรสาคร unless named), in file order. */
export async function casesOf(pool: Q, uploadId: string, place: PlaceId = "skh"): Promise<StoredCase[]> {
  const { rows } = await pool.query<CaseRow>(
    `SELECT ${CASE_COLUMNS} FROM workbook_cases WHERE upload_id = $1 AND place = $2 ORDER BY position, id`,
    [uploadId, place],
  );
  return rows.map(toCase);
}

export type Workbook = { upload: Upload; cases: StoredCase[] };

/** An upload's list for `place`, or null for รพ.ท่าฉลอม from an upload that cut its cases (Upload.thaChalom). */
async function listOf(pool: Q, upload: Upload | null, place: PlaceId): Promise<Workbook | null> {
  if (!upload || (place === "tha-chalom" && !upload.thaChalom)) return null;
  return { upload, cases: await casesOf(pool, upload.id, place) };
}

/**
 * The workbook of a day picked on the board: the latest upload for that day, whichever cycle made it, with its cases at
 * `place`, or null when there is none (a day further ahead than the coming one, or one MX never uploaded).
 */
export async function workbookForDay(pool: Q, targetDate: string, place: PlaceId = "skh"): Promise<Workbook | null> {
  return listOf(pool, await latestUploadForTarget(pool, targetDate), place);
}

/** The board's workbook: the latest upload of the cycle with its cases at `place`, or null when MX has not uploaded yet. */
export async function workbookFor(pool: Q, cycleDay: string, targetDate: string, place: PlaceId = "skh"): Promise<Workbook | null> {
  return listOf(pool, await latestUpload(pool, cycleDay, targetDate), place);
}
