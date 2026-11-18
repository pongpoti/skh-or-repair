/**
 * Texts an upload stores or logs, made safe: a file's name (it is stored and shown), and an error's kind for the log
 * (never its message, which for a database error can quote the HNs it was given). Used by MX's upload and the admin's
 * import of past lists.
 */

/** The file's name as stored: one line, no control or format characters, at most 120 characters. Never logged. */
export function cleanFileName(name: string): string | null {
  const clean = name
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, 120) : null;
}

/** An error's kind for the log: its code or its class, never its message. */
export function errorKind(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && /^[0-9A-Z_]{1,40}$/i.test(code)) return code;
  return error instanceof Error ? error.name : typeof error;
}
