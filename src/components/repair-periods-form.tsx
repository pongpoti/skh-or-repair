"use client";

import { useEffect, useState, useTransition } from "react";
import type { RepairResult } from "@/app/admin/actions";
import type { RepairView } from "@/app/admin/data";
import { AdminSection } from "@/components/admin-section";
import { Notice } from "@/components/auth-shell";
import { InlineStatus } from "@/components/inline-status";
import { ThaiDateField, type DayState } from "@/components/thai-date-field";
import { checkRepairPeriods, repairOn, REPAIR_LAYOUTS, shortThaiDate, type RepairDates, type RepairPeriods } from "@/lib/repair";

const HALVES = [1, 2] as const;
const KEYS = { 1: "half1", 2: "half2" } as const;

/** The calendar's range, as lib/repair.ts checks it. */
const MIN_DATE = "2000-01-01";
const MAX_DATE = "2100-12-31";
/** Any day can start or end a half, weekends and holidays too. */
const ANY_DAY = (): DayState => ({ disabled: false });

const ENDS = [
  ["from", "วันเริ่ม"],
  ["to", "วันสุดท้าย"],
] as const;

const UNSAVED = "บันทึกไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";

/**
 * The operating rooms of a half as the admin knows them, "ผ่าตัดที่ห้อง 9–13", taken from the layout itself so the hint
 * can never disagree with the plan. Recovery and instrument rooms do not operate and are left out.
 */
function operatingRooms(half: 1 | 2): string {
  const numbers = Object.entries(REPAIR_LAYOUTS[half].rooms)
    .filter(([, use]) => use !== "RR" && use !== "INSTR")
    .map(([room]) => Number(room.replace("or-", "")))
    .sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < numbers.length; ) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    runs.push(j > i ? `${numbers[i]}–${numbers[j]}` : String(numbers[i]));
    i = j + 1;
  }
  return `ผ่าตัดที่ห้อง ${runs.join(", ")}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "14 พ.ย. 2569 – 26 ม.ค. 2570 · 74 วัน", the half at a glance; "" until both are set and in order (the message on saving says what is wrong). */
function rangeText({ from, to }: RepairDates): string {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return "";
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
  return `${shortThaiDate(from)} – ${shortThaiDate(to)} · ${days} วัน`;
}

function samePeriods(a: RepairPeriods, b: RepairPeriods): boolean {
  return a.half1.from === b.half1.from && a.half1.to === b.half1.to && a.half2.from === b.half2.from && a.half2.to === b.half2.to;
}

/**
 * The admin's form for the repair's two halves (/admin): four dates, checked here with the same rules and Thai messages
 * as the server (lib/repair.ts checkRepairPeriods), then saved by `onSave`. A save changes the board for everyone at
 * once. Without `onSave`, as in the development preview, the dates stay in this page. Closed until opened, like every
 * admin section (components/admin-section.tsx); dates changed and not saved are kept while it is closed, and the
 * heading says so.
 */
export function RepairPeriodsForm({ initial, onSave }: { initial: RepairView; onSave?: (input: RepairPeriods) => Promise<RepairResult> }) {
  const [saved, setSaved] = useState<RepairPeriods>(initial.periods);
  const [draft, setDraft] = useState<RepairPeriods>(initial.periods);
  const [changed, setChanged] = useState(initial.changed);
  const [fallback, setFallback] = useState(initial.fallback);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(""), 4000);
    return () => clearTimeout(timer);
  }, [done]);

  const dirty = !samePeriods(draft, saved);
  const running = repairOn(initial.today, saved)?.half ?? null;

  function change(half: 1 | 2, end: keyof RepairDates, value: string) {
    setDraft((current) => ({ ...current, [KEYS[half]]: { ...current[KEYS[half]], [end]: value } }));
    setError("");
  }

  function reset() {
    setDraft(saved);
    setError("");
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !dirty) return;
    const checked = checkRepairPeriods(draft);
    if (!checked.ok) return setError(checked.error);
    const periods = checked.periods;

    if (!onSave) {
      setSaved(periods);
      setDraft(periods);
      setDone("บันทึกแล้ว");
      return;
    }

    setError("");
    startTransition(async () => {
      try {
        const result = await onSave(periods);
        if (!result.ok) return setError(result.error);
        setSaved(result.repair.periods);
        setDraft(result.repair.periods);
        setChanged(result.repair.changed);
        setFallback(result.repair.fallback);
        setDone(result.message);
      } catch {
        setError(UNSAVED);
      }
    });
  }

  const summary = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span data-testid="repair-changed">{changed ? `แก้ไขล่าสุด ${changed.at} โดย ${changed.by}` : "ใช้วันที่ตามแผนเดิม ยังไม่มีผู้แก้ไข"}</span>
      {dirty ? (
        <span className="badge badge-warning" data-testid="repair-unsaved">
          ยังไม่บันทึก
        </span>
      ) : null}
    </span>
  );

  return (
    <AdminSection id="repair-periods" title="ช่วงปิดซ่อมห้องผ่าตัด" summary={summary} testId="repair-section">
      <form onSubmit={save} noValidate>
        {fallback ? (
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
            <Notice tone="warning">โหลดวันที่ไม่ได้ แสดงตามแผนเดิม ลองโหลดหน้าใหม่</Notice>
          </div>
        ) : null}

        <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-2">
          {HALVES.map((half) => {
            const dates = draft[KEYS[half]];
            const range = rangeText(dates);
            return (
              <div
                key={half}
                role="group"
                aria-labelledby={`repair-half-${half}`}
                aria-describedby={`repair-half-${half}-note`}
                className="min-w-0 rounded-xl border border-line bg-white/70 p-3.5 sm:p-4"
                data-testid={`repair-half-${half}`}
              >
                <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <h3 id={`repair-half-${half}`} className="text-[0.9375rem] font-bold text-ink">
                    ช่วงที่ {half}
                  </h3>
                  {running === half ? <span className="badge badge-success">กำลังปิดซ่อม</span> : null}
                </div>
                <p id={`repair-half-${half}-note`} className="text-xs text-muted">
                  {operatingRooms(half)}
                </p>
                {/* One under the other: the dates are written out in Thai (Pong, 15 Nov 2026), as in the booking form. */}
                <div className="mt-3 grid gap-2.5">
                  {ENDS.map(([end, label]) => {
                    const id = `repair-half-${half}-${end}`;
                    return (
                      <div key={end} className="min-w-0">
                        <label htmlFor={id} className="text-sm font-semibold text-ink">
                          {label}
                          <span className="sr-only"> ช่วงที่ {half}</span>
                        </label>
                        <ThaiDateField
                          id={id}
                          value={dates[end]}
                          onChange={(iso) => change(half, end, iso)}
                          min={MIN_DATE}
                          max={MAX_DATE}
                          dayState={ANY_DAY}
                          testId={id}
                          today={initial.today}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 min-h-5 text-xs text-ink-2">{range}</p>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line p-4 sm:p-5">
          {/* The save's result takes the hint's place beside บันทึก while it shows, so the row keeps its shape. */}
          <div className="flex min-h-5 min-w-0 basis-full items-center sm:mr-auto sm:basis-auto">
            {error ? (
              <InlineStatus tone="warning" role="alert">
                {error}
              </InlineStatus>
            ) : done ? (
              <InlineStatus tone="success" role="status">
                {done}
              </InlineStatus>
            ) : (
              <p className="text-xs text-muted">เมื่อบันทึก ตารางผ่าตัดของทุกคนจะเปลี่ยนทันที</p>
            )}
          </div>
          {dirty ? (
            <button type="button" onClick={reset} disabled={pending} className="btn btn-secondary">
              ยกเลิก
            </button>
          ) : null}
          <button type="submit" disabled={pending || !dirty} aria-busy={pending} className="btn btn-primary" data-testid="repair-save">
            {pending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </form>
    </AdminSection>
  );
}
