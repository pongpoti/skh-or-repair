/**
 * The checks on the chosen file that need nothing but its name and size, run by the upload form before sending (so a
 * file the server would refuse never travels) and again by the server action (the form's check can be skipped).
 *
 * No imports: the form is a client component, and the reader (lib/xlsx.ts) needs node:zlib. The page hands the form
 * the reader's limit and its .xls message as `rules`, so both sides say the same thing.
 */

export type FileRules = {
  /** Largest file accepted, in bytes (lib/xlsx.ts XLSX_LIMITS.maxFileBytes). */
  maxBytes: number;
  /** What to say about a .xls file (lib/xlsx.ts XLS_MESSAGE). */
  xlsMessage: string;
};

/** What the file input accepts: the extension, and the type phones' pickers filter on. */
export const XLSX_ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The size as people say it: "4 MB". */
export function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Why this file cannot be uploaded, in Thai, or null when it may be sent. The reader checks the content itself. */
export function fileProblem(file: { name: string; size: number } | null | undefined, rules: FileRules): string | null {
  const name = file?.name.trim().toLowerCase() ?? "";
  if (!file || !name) return "เลือกไฟล์ตารางผ่าตัดก่อน";
  if (name.endsWith(".xls")) return rules.xlsMessage;
  if (!name.endsWith(".xlsx")) return "รับเฉพาะไฟล์ .xlsx ที่ส่งออกจาก HOSxP";
  if (file.size <= 0) return "ไฟล์นี้ว่างเปล่า เลือกไฟล์ใหม่";
  if (file.size > rules.maxBytes) return `ไฟล์ใหญ่เกิน ${megabytes(rules.maxBytes)}`;
  return null;
}
