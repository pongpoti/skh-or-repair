"use client";

import { useState, useTransition } from "react";
import type { ResetResult } from "@/app/admin/actions";
import type { ListedDayView } from "@/app/admin/data";
import { AdminSection } from "@/components/admin-section";
import { InlineStatus } from "@/components/inline-status";

const UNSENT = "ล้างไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";

/** The section's line: how many days hold HOSxP lists. */
function summaryLine(days: readonly ListedDayView[] | null): string {
  if (!days) return "อ่านข้อมูลไม่ได้ ลองโหลดหน้าใหม่";
  return days.length > 0 ? `มีตาราง HOSxP ${days.length} วัน` : "ยังไม่มีตาราง HOSxP";
}

/**
 * The admin's reset of one day's OR schedule (Pong, 27 Nov 2026: "Add option for admin to reset OR schedule of specific
 * date (reset only for hosxp case)"): each day from today on that holds HOSxP lists, with a ล้าง button that asks once
 * more before it deletes them (app/admin/actions.ts resetHosxpDay). The bookings stay; both hospitals' cases go, since
 * one upload holds both.
 */
export function HosxpResetSection({
  initial,
  onReset,
}: {
  initial: ListedDayView[] | null;
  onReset: (date: string) => Promise<ResetResult>;
}) {
  const [days, setDays] = useState(initial);
  // The day whose ล้าง was tapped once, waiting for ยืนยัน.
  const [asking, setAsking] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [pending, startTransition] = useTransition();

  function reset(date: string) {
    if (pending) return;
    if (asking !== date) {
      setAsking(date);
      setResult(null);
      return;
    }
    setAsking(null);
    startTransition(async () => {
      try {
        const answer = await onReset(date);
        setResult(answer);
        if (answer.days) setDays(answer.days);
      } catch {
        setResult({ ok: false, error: UNSENT });
      }
    });
  }

  return (
    <AdminSection id="reset" title="ล้างตาราง HOSxP" summary={<span data-testid="reset-summary">{summaryLine(days)}</span>} testId="reset-section">
      <div className="space-y-3 p-4 sm:p-5">
        <p className="text-sm text-ink-2">ล้างเฉพาะเคสจาก HOSxP ของวันนั้น ทั้งสองโรงพยาบาล เคสที่จองไว้ยังอยู่ MX อัปโหลดใหม่ได้ในเวลา 15:00–16:00 น.</p>
        {days && days.length > 0 ? (
          <ul className="divide-y divide-line rounded-xl border border-line" data-testid="reset-days">
            {days.map((day) => (
              <li key={day.date} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3" data-date={day.date}>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-semibold text-ink tabular-nums">{day.label}</p>
                  <p className="text-xs text-muted">{day.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => reset(day.date)}
                  disabled={pending}
                  className={`btn ${asking === day.date ? "btn-danger" : "btn-secondary"} shrink-0`}
                  data-testid="reset-day"
                >
                  {asking === day.date ? "ยืนยันล้าง" : "ล้าง"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {asking ? (
          <InlineStatus tone="warning" role="status">
            แตะ ยืนยันล้าง อีกครั้ง ลบแล้วกู้คืนไม่ได้
          </InlineStatus>
        ) : null}
        {result ? (
          <div data-testid="reset-result">
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
    </AdminSection>
  );
}
