import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Pool } from "pg";
import { AdminBar } from "@/components/admin-bar";
import { UploadForm } from "@/components/upload-form";
import { UploadSummary } from "@/components/upload-summary";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { avatarSrc } from "@/lib/avatar";
import { loadUploadSlot } from "@/lib/board-day";
import { listCasesOn } from "@/lib/cases";
import { now } from "@/lib/clock";
import { db } from "@/lib/db";
import { thaiDate, TIME_ZONE } from "@/lib/days";
import { HOLIDAYS_UNAVAILABLE } from "@/lib/holidays";
import type { RepairPeriods } from "@/lib/repair";
import { getRepairPeriods } from "@/lib/repair-store";
import { isMx } from "@/lib/roles";
import {
  matchBookings,
  nextWindowChange,
  placedSummary,
  readFlowSummary,
  windowStateAt,
  type FlowSummary,
  type MatchReport,
} from "@/lib/upload-flow";
import { casesOf, latestUpload, type Upload } from "@/lib/workbook-store";
import { XLS_MESSAGE, XLSX_LIMITS } from "@/lib/xlsx";
import { uploadWorkbook } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "อัปโหลดตารางผ่าตัด · ORSKH.APP" };

const clockTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE });

/**
 * The latest upload's summary and its cases against the target day's bookings, read now: a doctor may book after the
 * upload, and an admin may move the repair's dates, so the matching and the rooms are worked out on every visit, as
 * the board does, rather than taken from the upload. The stored summary stands, and there is no matching, when the
 * database cannot give the cases.
 */
async function latestOf(pool: Pool, upload: Upload, periods: RepairPeriods): Promise<{ summary: FlowSummary | null; matching: MatchReport | null }> {
  const stored = readFlowSummary(upload.summary);
  try {
    const [cases, bookings] = await Promise.all([casesOf(pool, upload.id), listCasesOn(pool, upload.targetDate)]);
    return {
      summary: stored ? placedSummary(stored, cases, upload.targetDate, periods) : null,
      matching: matchBookings({ date: upload.targetDate, periods, cases, bookings }),
    };
  } catch (error) {
    console.error(`[upload] matching unavailable (${(error as Error).name})`);
    return { summary: stored, matching: null };
  }
}

/**
 * MX's page for the HOSxP file of the next workday (MX and admins only): the window, the day, the upload, and the
 * latest upload made today for that day with its summary and its matching with the bookings.
 */
export default async function UploadPage() {
  const user = await requireUser();
  const pool = await db();
  const admin = isAdmin(user.sub);
  // MX is a database role (lib/roles.ts), so the proxy cannot gate this page as it does /admin: anyone else gets the
  // same page as a mistyped address, and there is no loading screen that would answer 200 first.
  if (!admin && !(await isMx(pool, user))) notFound();

  // Every time decision goes through the app's clock (lib/clock.ts), so the tests can set it.
  const at = now();
  const [slot, name, periods] = await Promise.all([loadUploadSlot(at), displayNameFor(user, user.name), getRepairPeriods(pool)]);
  const target = slot.target.ok ? slot.target.date : null;
  const blocked = slot.target.ok ? null : slot.target.reason === "none" ? "ไม่พบวันทำการใน 14 วันข้างหน้า" : HOLIDAYS_UNAVAILABLE;
  // The upload the board will show for that day: the latest made today (lib/board-day.ts).
  const latest = target ? await latestUpload(pool, slot.cycleDay, target) : null;
  const shown = latest ? await latestOf(pool, latest, periods) : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar
        title="อัปโหลดตารางผ่าตัด"
        eyebrow={admin ? "ผู้ดูแลระบบ" : "ผู้จัดการตาราง"}
        name={name}
        // AdminBar hands the picture straight to the avatar, so only LINE's CDN is let through (as on the board).
        image={avatarSrc(user.picture)}
      />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto w-full max-w-4xl space-y-4">
          <UploadForm
            target={target ? { date: target, label: thaiDate(target) } : null}
            blocked={blocked}
            windowState={windowStateAt(at)}
            admin={admin}
            // A new id for every render: a page brought back by Back keeps its own (components/board-refresh.tsx).
            refreshId={crypto.randomUUID()}
            refreshInMs={nextWindowChange(at).getTime() - at.getTime()}
            rules={{ maxBytes: XLSX_LIMITS.maxFileBytes, xlsMessage: XLS_MESSAGE }}
            onUpload={uploadWorkbook}
          />
          {latest ? (
            <UploadSummary
              time={clockTime.format(latest.uploadedAt)}
              uploader={latest.uploaderName ?? "ไม่ทราบชื่อผู้อัปโหลด"}
              fileName={latest.fileName}
              summary={shown?.summary ?? null}
              matching={shown?.matching ?? null}
            />
          ) : target ? (
            <section className="card p-4 sm:p-5" aria-labelledby="latest-upload-title" data-testid="upload-latest">
              <h2 id="latest-upload-title" className="text-base font-bold text-ink sm:text-lg">
                อัปโหลดล่าสุด
              </h2>
              <p className="mt-1 text-sm text-muted">ยังไม่มีการอัปโหลดตารางของ{thaiDate(target, "short")}</p>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
