"use client";

import { useRef, useState, useTransition } from "react";
import type { UploadResult } from "@/app/upload/actions";
import { fileProblem, megabytes, XLSX_ACCEPT, type FileRules } from "@/app/upload/file-check";
import { Notice } from "@/components/auth-shell";
import { useTimedRefresh } from "@/components/board-refresh";
import type { WindowState } from "@/lib/upload-flow";

const UNSENT = "อัปโหลดไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง";

const WINDOW_BADGE: Record<WindowState, { text: string; tone: string }> = {
  before: { text: "ยังไม่เปิดรับ", tone: "badge-muted" },
  open: { text: "เปิดรับอยู่", tone: "badge-success" },
  after: { text: "ปิดรับแล้ว", tone: "badge-muted" },
};

const UPLOAD_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

/**
 * MX's upload card: the day the file is for, the 15:00–16:00 window, the file input and the upload button. The file
 * is checked here before it is sent (name and size) and again by the server action, which also re-checks the role and
 * the window by the server's clock. The page refreshes itself when the window opens or closes and at midnight, so the
 * card never offers an upload the server would refuse for the time.
 */
export function UploadForm({
  target,
  blocked,
  windowState,
  admin,
  refreshId,
  refreshInMs,
  rules,
  onUpload,
}: {
  /** The workday the file must list (YYYY-MM-DD) and its Thai name, or null when it cannot be known. */
  target: { date: string; label: string } | null;
  /** Why nothing can be uploaded now (the holiday feed failed), or null. */
  blocked: string | null;
  windowState: WindowState;
  /** Admins may upload at any time. */
  admin: boolean;
  /** An id of the server's render, so the wait below survives a page brought back by Back (components/board-refresh.tsx). */
  refreshId: string;
  /** Milliseconds until the window opens, closes or the day turns, by the server's clock. */
  refreshInMs: number;
  rules: FileRules;
  onUpload: (form: FormData) => Promise<UploadResult>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [pending, startTransition] = useTransition();

  // A second after the window opens or closes (or the day turns), and when the page comes back after more than five
  // minutes in the background, fetch the page again: the window or the day may have moved. The delay is at least five
  // seconds, so a clock held still by the tests cannot make the page refresh over and over.
  useTimedRefresh(refreshId, refreshInMs);

  const open = windowState === "open";
  // MX may pick the file early; only sending waits for the window.
  const canSend = target !== null && !blocked && (admin || open);
  const badge = WINDOW_BADGE[windowState];

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setResult(null);
    setProblem(file ? (fileProblem(file, rules) ?? "") : "");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canSend) return;
    const issue = fileProblem(input.current?.files?.[0], rules);
    if (issue) {
      setProblem(issue);
      input.current?.focus();
      return;
    }
    const form = new FormData(event.currentTarget);
    setProblem("");
    setResult(null);
    startTransition(async () => {
      try {
        const answer = await onUpload(form);
        setResult(answer);
        // A saved file is done with; a refused one stays chosen so MX can see which it was.
        if (answer.ok && input.current) input.current.value = "";
      } catch {
        setResult({ ok: false, error: UNSENT });
      }
    });
  }

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="upload-title" data-testid="upload-card">
      <h2 id="upload-title" className="text-base font-bold text-ink sm:text-lg">
        {target ? `ตารางของ${target.label}` : "อัปโหลดตารางผ่าตัด"}
      </h2>
      <p id="upload-window" className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <span>เปิดรับไฟล์ 15:00–16:00 น.</span>
        <span className={`badge ${badge.tone}`} data-testid="upload-window">
          {badge.text}
        </span>
      </p>
      {admin ? <p className="mt-1 text-sm text-muted">ผู้ดูแลอัปโหลดได้ทุกเวลา</p> : null}

      {blocked ? (
        <Notice tone="warning" role="alert" className="mt-4">
          {blocked}
        </Notice>
      ) : null}

      <form onSubmit={submit} noValidate className="mt-4 space-y-3">
        {target ? <input type="hidden" name="target" value={target.date} /> : null}
        <label className="block">
          <span className="text-sm font-semibold text-ink">ไฟล์ตารางผ่าตัดจาก HOSxP</span>
          <span id="upload-file-hint" className="block text-xs text-muted">
            ไฟล์ .xlsx ไม่เกิน {megabytes(rules.maxBytes)}
          </span>
          <input
            ref={input}
            type="file"
            name="file"
            accept={XLSX_ACCEPT}
            onChange={choose}
            disabled={pending || target === null}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "upload-file-hint upload-file-problem" : "upload-file-hint"}
            className="field field-text mt-1.5 cursor-pointer py-1.5 text-sm file:mr-3 file:min-h-8 file:cursor-pointer file:rounded-lg file:border file:border-[rgb(124_96_66/0.28)] file:bg-[var(--tan-fill)] file:px-3 file:text-sm file:font-semibold file:text-brand"
            data-testid="upload-file"
          />
        </label>
        {problem ? (
          <div id="upload-file-problem">
            <Notice tone="warning" role="alert">
              {problem}
            </Notice>
          </div>
        ) : null}
        <button
          type="submit"
          disabled={pending || !canSend}
          aria-busy={pending}
          aria-describedby={canSend ? undefined : "upload-window"}
          className="btn btn-primary w-full sm:w-auto"
          data-testid="upload-submit"
        >
          {UPLOAD_ICON}
          {pending ? "กำลังอัปโหลด…" : "อัปโหลด"}
        </button>
      </form>

      {result ? (
        <div className="mt-4" data-testid="upload-result">
          {result.ok ? (
            <Notice tone="success" role="status">
              {result.message}
            </Notice>
          ) : (
            <Notice tone="warning" role="alert">
              {result.error}
            </Notice>
          )}
        </div>
      ) : null}
    </section>
  );
}
