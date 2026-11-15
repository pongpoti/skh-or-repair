import { Notice } from "@/components/auth-shell";
import type { FlowSummary, MatchReport, MatchRow } from "@/lib/upload-flow";

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/70 px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg leading-7 font-bold text-ink tabular-nums">
        {value} <span className="text-sm font-medium text-muted">{unit}</span>
      </dd>
    </div>
  );
}

/** A heading and its lines of "what · how many"; nothing when there are no lines. */
function Counts({ title, lines }: { title: string; lines: { key: string; label: string; count: number }[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <ul className="mt-1.5 divide-y divide-line rounded-xl border border-line bg-white/70 text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="min-w-0 text-ink-2">{line.label}</span>
            <span className="shrink-0 font-semibold text-ink tabular-nums">{line.count} เคส</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One case that does not match, with what MX needs to sort it out: room, surgeon, HN and operation. */
function Mismatches({ title, badge, tone, rows, testId }: { title: string; badge: string; tone: string; rows: MatchRow[]; testId: string }) {
  if (rows.length === 0) return null;
  return (
    <div data-testid={testId}>
      <h4 className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
        <span className={`badge ${tone}`}>{badge}</span>
        {title} {rows.length} รายการ
      </h4>
      <ul className="mt-1.5 divide-y divide-line rounded-xl border border-line bg-white/70 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="px-3 py-2">
            <p className="flex flex-wrap items-baseline gap-x-2 font-semibold text-ink">
              <span>{row.room}</span>
              <span className="font-medium text-ink-2">{row.surgeon}</span>
            </p>
            <p className="mt-0.5 text-muted">
              <span className="font-medium text-ink-2 tabular-nums">{row.hn ? `HN ${row.hn}` : "ไม่มี HN"}</span> · {row.operation}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The latest upload of the cycle on the upload page: when and by whom, what the file held, what was left off and
 * why, where the cases went, and how they match the doctors' bookings. Only MX and admins see this page, so the
 * mismatches carry HN.
 */
export function UploadSummary({
  time,
  uploader,
  fileName,
  summary,
  matching,
}: {
  /** The upload's time in Bangkok, "15:12". */
  time: string;
  uploader: string;
  fileName: string | null;
  /** Null when the stored summary cannot be read. */
  summary: FlowSummary | null;
  /** Null when the bookings cannot be read. */
  matching: MatchReport | null;
}) {
  const mismatches = matching ? matching.unbooked.length + matching.notInHosxp.length : 0;
  const left = summary
    ? [
        ...(summary.duplicates > 0 ? [{ key: "dup", label: "ID ซ้ำ นับครั้งเดียว", count: summary.duplicates }] : []),
        ...summary.dropped.map((item) => ({ key: `rule-${item.rule}`, label: item.reason, count: item.count })),
        ...summary.cut.map((item) => ({ key: `cut-${item.reason}`, label: item.label, count: item.count })),
      ]
    : [];

  return (
    <section className="card overflow-hidden" aria-labelledby="latest-upload-title" data-testid="upload-latest">
      <div className="border-b border-line p-4 sm:p-5">
        <h2 id="latest-upload-title" className="text-base font-bold text-ink sm:text-lg">
          อัปโหลดล่าสุด
        </h2>
        <p className="text-sm text-muted">
          {time} น. · {uploader}
        </p>
        {fileName ? <p className="truncate text-xs text-muted">{fileName}</p> : null}
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {summary ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="อ่านได้" value={summary.rows} unit="แถว" />
              <Stat label="ผ่านเกณฑ์" value={summary.kept} unit="เคส" />
              <Stat label="ลงห้องผ่าตัด" value={summary.placed} unit="เคส" />
              <Stat label="ไม่ตรงกับการจอง" value={mismatches} unit="รายการ" />
            </dl>
            <Counts title="ไม่นำขึ้นตาราง" lines={left} />
            <Counts
              title="ลงห้องผ่าตัด"
              lines={summary.rooms.map((room) => ({
                key: room.roomId,
                label: room.dept ? `${room.room} · ${room.dept}` : room.room,
                count: room.count,
              }))}
            />
            <Counts
              title="ไม่ได้ลงห้อง"
              lines={summary.unplaced.map((item) => ({ key: item.reason, label: item.label, count: item.count }))}
            />
          </>
        ) : (
          <Notice tone="info">อ่านสรุปของไฟล์นี้ไม่ได้</Notice>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-bold text-ink">เทียบกับการจอง</h3>
          {matching ? (
            <>
              <p className="text-sm text-ink-2" data-testid="upload-matching">
                แพทย์จองไว้ {matching.bookings} รายการ · ตรงกัน {matching.matched} รายการ
              </p>
              {mismatches === 0 ? (
                <Notice tone="success">ไม่มีรายการที่ไม่ตรงกับการจอง</Notice>
              ) : (
                <>
                  <Mismatches
                    title="เคสใน HOSxP ที่ไม่มีการจอง"
                    badge="ไม่มีการจอง"
                    tone="badge-warning"
                    rows={matching.unbooked}
                    testId="upload-unbooked"
                  />
                  <Mismatches
                    title="การจองที่ไม่พบใน HOSxP"
                    badge="ไม่พบใน HOSxP"
                    // The board's "ไม่พบใน HOSxP" badge (globals.css), so the two pages say it alike.
                    tone="badge-stop"
                    rows={matching.notInHosxp}
                    testId="upload-not-in-hosxp"
                  />
                </>
              )}
            </>
          ) : (
            <Notice tone="warning">อ่านการจองไม่ได้ ลองโหลดหน้านี้ใหม่</Notice>
          )}
        </div>
      </div>
    </section>
  );
}
