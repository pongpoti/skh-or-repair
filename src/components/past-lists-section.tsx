"use client";

import { useRef, useState, useTransition } from "react";
import type { PastListsResult } from "@/app/admin/actions";
import type { PastListView } from "@/app/admin/data";
import { fileProblem, megabytes, XLSX_ACCEPT, type FileRules } from "@/app/upload/file-check";
import { AdminSection } from "@/components/admin-section";
import { InlineStatus } from "@/components/inline-status";

const UNSENT = "นำเข้าไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";

/** The section's line: the past days that hold an imported list. */
function spanLine(view: PastListView | null): string {
  if (!view) return "อ่านข้อมูลไม่ได้ ลองโหลดหน้าใหม่";
  return view.days > 0 && view.span ? `มีแล้ว ${view.days} วัน · ${view.span}` : "ยังไม่มีตารางย้อนหลัง";
}

/**
 * The admin's import of past days' HOSxP lists (Pong, 19 Nov 2026: the Jan-Oct cases on the board's calendar): one
 * export of many days, checked here by name and size before it is sent and again by the server action
 * (app/admin/actions.ts importPastLists), which splits it by day with MX's own rules.
 */
export function PastListsSection({
  initial,
  rules,
  onImport,
}: {
  initial: PastListView | null;
  rules: FileRules;
  onImport: (form: FormData) => Promise<PastListsResult>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState(initial);
  const [fileName, setFileName] = useState("");
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState<PastListsResult | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileName(file?.name ?? "");
    setResult(null);
    setProblem(file ? (fileProblem(file, rules) ?? "") : "");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
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
        const answer = await onImport(form);
        setResult(answer);
        if (answer.ok) {
          setView(answer.view);
          if (input.current) input.current.value = "";
          setFileName("");
        }
      } catch {
        setResult({ ok: false, error: UNSENT });
      }
    });
  }

  return (
    <AdminSection id="past" title="ตารางย้อนหลังจาก HOSxP" summary={<span data-testid="past-span">{spanLine(view)}</span>} testId="past-section">
      <form onSubmit={submit} noValidate className="space-y-3 p-4 sm:p-5">
        <p className="text-sm text-ink-2">
          ไฟล์จาก HOSxP กี่วันก็ได้ ใช้กฎเดียวกับ MX คือเคสที่ลงก่อน 16:00 ของวันก่อนผ่าตัด นำเข้าซ้ำได้ วันที่ MX อัปโหลดแล้วจะไม่ถูกแทน
        </p>
        <div>
          <label className="block">
            <span id="past-file-hint" className="block text-xs text-muted">
              ไฟล์ .xlsx หรือ .xls ไม่เกิน {megabytes(rules.maxBytes)}
            </span>
            <span className={`file-picker mt-1.5 ${pending ? "file-picker-disabled" : ""}`}>
              <input
                ref={input}
                type="file"
                name="file"
                accept={XLSX_ACCEPT}
                onChange={choose}
                disabled={pending}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? "past-file-hint past-file-problem" : "past-file-hint"}
                className="sr-only"
                data-testid="past-file"
              />
              <span className="file-picker-button" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5" />
                </svg>
                เลือกไฟล์
              </span>
              <span className={`min-w-0 truncate text-sm ${fileName ? "text-ink" : "text-muted"}`} aria-hidden="true">
                {fileName || "ยังไม่ได้เลือกไฟล์"}
              </span>
            </span>
          </label>
          {problem ? (
            <div id="past-file-problem" className="mt-1.5">
              <InlineStatus tone="warning" role="alert">
                {problem}
              </InlineStatus>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-primary w-full sm:w-auto" data-testid="past-submit">
            {pending ? "กำลังนำเข้า…" : "นำเข้า"}
          </button>
          {result ? (
            <div className="order-first flex min-w-0 basis-full items-center sm:order-none sm:flex-1 sm:basis-0" data-testid="past-result">
              {result.ok ? (
                <InlineStatus tone="success" role="status">
                  {result.message}
                </InlineStatus>
              ) : (
                <InlineStatus tone="warning" role="alert">
                  {result.error}
                </InlineStatus>
              )}
            </div>
          ) : null}
        </div>
      </form>
    </AdminSection>
  );
}
