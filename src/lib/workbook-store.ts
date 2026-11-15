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
 * stored, never the patient's name, age, AN, diagnosis, illnesses or costs, and nothing here is ever logged.
 */

/** Uploads are kept this long, then deleted with their cases when a new upload is saved. */
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
}

const UPLOAD_COLUMNS =
  "id::text AS id, to_char(target_date, 'YYYY-MM-DD') AS target_date, to_char(cycle_day, 'YYYY-MM-DD') AS cycle_day, " +
  "uploaded_at, uploaded_by, uploader_name, file_name, total_rows, kept, placed, summary";

const CASE_COLUMNS =
  "id::text AS id, upload_id::text AS upload_id, case_id, hn, operation, surgeon, dept, team, room_id, shift, status, " +
  "urgency, booked_time, position";

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
  };
}

/**
 * Saves an upload and its cases in one transaction, so the board never sees half a file. The same transaction deletes
 * uploads made more than 30 days before this one (their cases go with them), so patient numbers are not kept longer
 * than the board needs them. Every HN is stored normalised; a case id seen twice keeps its first row.
 */
export async function saveUpload(pool: Pool, input: UploadInput): Promise<Upload> {
  const seen = new Set<string>();
  const cases = input.cases.filter((item) => {
    if (seen.has(item.caseId)) return false;
    seen.add(item.caseId);
    return true;
  });
  return withTx(pool, async (c) => {
    await c.query("DELETE FROM workbook_uploads WHERE uploaded_at < $1::timestamptz - make_interval(days => $2)", [
      input.uploadedAt,
      KEEP_UPLOAD_DAYS,
    ]);
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
    if (cases.length > 0) {
      // One statement for the whole file: each column goes as one array.
      await c.query(
        `INSERT INTO workbook_cases (upload_id, case_id, hn, operation, surgeon, dept, team, room_id, shift, status, urgency, booked_time, position)
         SELECT $1::bigint, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
           $10::text[], $11::text[], $12::text[], $13::int[])`,
        [
          upload.id,
          cases.map((item) => item.caseId),
          cases.map((item) => normalizeHn(item.hn)),
          cases.map((item) => item.operation),
          cases.map((item) => item.surgeon),
          cases.map((item) => item.dept),
          cases.map((item) => item.team),
          cases.map((item) => item.roomId),
          cases.map((item) => item.shift),
          cases.map((item) => item.status),
          cases.map((item) => item.urgency),
          cases.map((item) => item.bookedTime),
          cases.map((item) => item.position),
        ],
      );
    }
    return upload;
  });
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

/** The board's workbook: the latest upload of the cycle with its cases, or null when MX has not uploaded yet. */
export async function workbookFor(pool: Q, cycleDay: string, targetDate: string): Promise<{ upload: Upload; cases: StoredCase[] } | null> {
  const upload = await latestUpload(pool, cycleDay, targetDate);
  return upload ? { upload, cases: await casesOf(pool, upload.id) } : null;
}
