import { Notice } from "@/components/auth-shell";
import type { FlowSummary, MatchReport, MatchRow, RoomCount, UnplacedCount } from "@/lib/upload-flow";

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
function Counts({ title, lines, level = 3 }: { title: string; lines: { key: string; label: string; count: number }[]; level?: 3 | 4 }) {
  if (lines.length === 0) return null;
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <div>
      <Heading className="text-sm font-bold text-ink">{title}</Heading>
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
      <h5 className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
        <span className={`badge ${tone}`}>{badge}</span>
        {title} {rows.length} รายการ
      </h5>
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

const mismatchesOf = (matching: MatchReport | null) => (matching ? matching.unbooked.length + matching.notInHosxp.length : 0);

/**
 * One hospital's part: where its cases went, which were left off and why, and how they match its doctors' bookings.
 * รพ.สมุทรสาคร's test ids are the page's first ones; รพ.ท่าฉลอม's end in -tc.
 */
function Hospital({
  name,
  rooms,
  unplaced,
  matching,
  suffix,
}: {
  name: string;
  rooms: RoomCount[] | null;
  unplaced: UnplacedCount[];
  matching: MatchReport | null;
  suffix: "" | "-tc";
}) {
  return (
    <section className="space-y-3" aria-label={name} data-testid={`upload-hospital${suffix}`}>
      <h3 className="text-base font-bold text-ink">{name}</h3>
      {rooms ? (
        <>
          <Counts
            level={4}
            title="ลงห้องผ่าตัด"
            lines={rooms.map((room) => ({
              key: room.roomId,
              label: room.dept ? `${room.room} · ${room.dept}` : room.room,
              count: room.count,
            }))}
          />
          <Counts level={4} title="ไม่ได้ลงห้อง" lines={unplaced.map((item) => ({ key: item.reason, label: item.label, count: item.count }))} />
        </>
      ) : null}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-ink">เทียบกับการจอง</h4>
        {matching ? (
          <>
            <p className="text-sm text-ink-2" data-testid={`upload-matching${suffix}`}>
              แพทย์จองไว้ {matching.bookings} รายการ · ตรงกัน {matching.matched} รายการ
            </p>
            {mismatchesOf(matching) === 0 ? (
              <Notice tone="success">ไม่มีรายการที่ไม่ตรงกับการจอง</Notice>
            ) : (
              <>
                <Mismatches
                  title="เคสใน HOSxP ที่ไม่มีการจอง"
                  badge="ไม่มีการจอง"
                  tone="badge-warning"
                  rows={matching.unbooked}
                  testId={`upload-unbooked${suffix}`}
                />
                <Mismatches
                  title="การจองที่ไม่พบใน HOSxP"
                  badge="ไม่พบใน HOSxP"
                  // The board's "ไม่พบใน HOSxP" badge (globals.css), so the two pages say it alike.
                  tone="badge-stop"
                  rows={matching.notInHosxp}
                  testId={`upload-not-in-hosxp${suffix}`}
                />
              </>
            )}
          </>
        ) : (
          <Notice tone="warning">โหลดการจองไม่ได้ ลองโหลดหน้าใหม่</Notice>
        )}
      </div>
    </section>
  );
}

/**
 * The latest upload of the cycle on the upload page: when and by whom, what the file held, what was left off and
 * why, then each hospital's part (the file holds both: Pong, 27 Nov 2026, "Excel file include both place on one
 * sheet"): where its cases went and how they match its doctors' bookings. The counts at the top are both hospitals'.
 * Only MX and admins see this page, so the mismatches carry HN. An upload saved before 27 Nov 2026 cut รพ.ท่าฉลอม's
 * cases (its line under ไม่นำขึ้นตาราง), so it has no part for it.
 */
export function UploadSummary({
  time,
  uploader,
  fileName,
  summary,
  matching,
  thaChalomMatching = null,
}: {
  /** The upload's time in Bangkok, "15:12". */
  time: string;
  uploader: string;
  fileName: string | null;
  /** Null when the stored summary cannot be read. */
  summary: FlowSummary | null;
  /** Null when the bookings cannot be read. */
  matching: MatchReport | null;
  /** รพ.ท่าฉลอม's: null when the bookings cannot be read or the upload has no list for it. */
  thaChalomMatching?: MatchReport | null;
}) {
  const tc = summary?.thaChalom ?? null;
  const mismatches = mismatchesOf(matching) + (tc ? mismatchesOf(thaChalomMatching) : 0);
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
              <Stat label="ลงห้องผ่าตัด" value={summary.placed + (tc?.placed ?? 0)} unit="เคส" />
              <Stat label="ไม่ตรงกับการจอง" value={mismatches} unit="รายการ" />
            </dl>
            <Counts title="ไม่นำขึ้นตาราง" lines={left} />
          </>
        ) : (
          <Notice tone="info">ไม่มีสรุปของไฟล์นี้</Notice>
        )}
        <Hospital name="รพ.สมุทรสาคร" rooms={summary?.rooms ?? null} unplaced={summary?.unplaced ?? []} matching={matching} suffix="" />
        {tc ? <Hospital name="รพ.ท่าฉลอม" rooms={tc.rooms} unplaced={tc.unplaced} matching={thaChalomMatching} suffix="-tc" /> : null}
      </div>
    </section>
  );
}
