"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import type { CaseResult } from "@/app/(board)/actions";
import { Notice } from "@/components/auth-shell";
import {
  addDays,
  BOOK_AHEAD_DAYS,
  checkCase,
  MAX_OPERATION,
  NO_OPERATION_LABEL,
  roomForSubtype,
  type AddedCase,
} from "@/lib/added-cases";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { thaiDate, workdayIndex } from "@/lib/days";
import { checkHn } from "@/lib/hn";
import { repairOn, type RepairPeriods } from "@/lib/repair";
import { getRoom, isOpenRoom, openRooms, roomLabel, roomUse, unusedRoomsText } from "@/lib/rooms";
import type { Shift } from "@/lib/schedule";
import { subtypeLabel } from "@/lib/user-labels";

const DIALOG =
  "m-auto max-h-[calc(100dvh-1.5rem)] w-[min(32rem,calc(100%-1.5rem))] overflow-y-auto overscroll-contain rounded-[18px] border border-line bg-surface p-5 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px] sm:p-6";

const UNSAVED = "บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง";

/** A picked radio: brown edge and tint. The input itself is visually hidden but still takes focus and arrow keys. */
const OPTION =
  "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line-strong bg-white px-1 py-2 text-center transition-colors hover:border-brand has-checked:border-brand has-checked:bg-brand-tint has-checked:shadow-[inset_0_0_0_1px_var(--brand)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";

export type Doctor = { name: string; subtype: string | null };

function DeptTag({ dept }: { dept: Department | null }) {
  if (!dept) return <span className="text-[0.6875rem] leading-5 text-muted">ไม่จัดสรร</span>;
  return (
    <span
      className="chip min-h-0 px-1 py-0 text-[0.625rem] leading-5 min-[400px]:px-1.5 min-[400px]:text-[0.6875rem]"
      style={{ "--chip": dept.color, color: readableTextOn(dept.color) } as CSSProperties}
      title={dept.name}
    >
      {dept.label}
    </span>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The doctor's booking of a room, in a dialog: day, room (rooms open that day only under the repair's dates, each with
 * its department), the patient's HN (required: the HOSxP workbook's case is matched by it), the operation's name
 * (optional: the workbook gives it), and in or out of hours. The surgeon is always the signed-in doctor. Below it, the
 * doctor's own bookings from today on, with their HN, each one cancellable. `request` opens it (with a room picked when
 * it came from a room's list).
 */
export function AddCase({
  request,
  onClosed,
  doctor,
  today,
  periods,
  firstDay,
  initialMine,
  onAdd,
  onRemove,
}: {
  /** Set to open the dialog; `roomId` preselects a room. */
  request: { roomId: string | null } | null;
  onClosed: () => void;
  doctor: Doctor;
  /** Today in Thailand, YYYY-MM-DD. */
  today: string;
  /** The repair's dates (lib/repair-store.ts), which decide the rooms open on each day. */
  periods: RepairPeriods;
  /** The day the form opens on (lib/added-cases.ts firstBookingDay): the board's own day, past any holiday. */
  firstDay: string;
  initialMine: readonly AddedCase[];
  onAdd: (input: unknown) => Promise<CaseResult>;
  onRemove: (id: string) => Promise<CaseResult>;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const hnRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(firstDay);
  // The room the doctor chose (from a room's list or in the grid), or null to follow their department's room.
  const [picked, setPicked] = useState<string | null>(null);
  const [hn, setHn] = useState("");
  // The shown error is about the HN, so the box is marked for screen readers too, not only by the message.
  const [hnInvalid, setHnInvalid] = useState(false);
  const [operation, setOperation] = useState("");
  const [shift, setShift] = useState<Shift>("in");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [mine, setMine] = useState<AddedCase[]>(() => [...initialMine]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The server's list wins whenever the page reloads (another device may have added or removed a case).
  const [prevInitial, setPrevInitial] = useState(initialMine);
  if (prevInitial !== initialMine) {
    setPrevInitial(initialMine);
    setMine([...initialMine]);
  }

  // Opening starts a fresh form on the first open day, with the asked-for room or the doctor's department's room.
  const [prevRequest, setPrevRequest] = useState(request);
  if (prevRequest !== request) {
    setPrevRequest(request);
    if (request) {
      setDate(firstDay);
      setPicked(request.roomId);
      setHn("");
      setHnInvalid(false);
      setOperation("");
      setShift("in");
      setError("");
      setDone("");
      setConfirming(null);
    }
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  function changeDate(value: string) {
    setDate(value);
    setError("");
    setDone("");
  }

  function apply(result: CaseResult) {
    if (result.mine) setMine(result.mine);
    if (result.ok) {
      setDone(result.message);
      setError("");
      router.refresh();
    } else {
      setError(result.error);
      setDone("");
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const input = { date, roomId, hn, operation, shift };
    const checked = checkCase(input, today, periods);
    if (!checked.ok) {
      setError(checked.error);
      setDone("");
      // The day and room come from pickers, so a missing or mistyped HN is the usual problem: back to its box.
      const hnCheck = checkHn(hn);
      const aboutHn = !hnCheck.ok && hnCheck.error === checked.error;
      setHnInvalid(aboutHn);
      if (aboutHn) hnRef.current?.focus();
      return;
    }
    setHnInvalid(false);
    startTransition(async () => {
      try {
        // The checked value carries the HN normalised; the server checks it all again.
        const result = await onAdd(checked.value);
        apply(result);
        if (result.ok) {
          // Ready for the next patient on the same day and room.
          setHn("");
          setOperation("");
          hnRef.current?.focus();
        }
      } catch {
        setError(UNSAVED);
        setDone("");
      }
    });
  }

  function remove(id: string) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    startTransition(async () => {
      try {
        apply(await onRemove(id));
      } catch {
        setError("ยกเลิกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง");
        setDone("");
      } finally {
        setConfirming(null);
      }
    });
  }

  const weekend = date !== "" && ISO.test(date) && workdayIndex(date) === null;
  const specialty = subtypeLabel("DR", doctor.subtype);
  // The day whose rooms the form offers: the chosen day, or the first open day while the field is being typed.
  const roomDay = ISO.test(date) ? date : firstDay;
  const repair = repairOn(roomDay, periods);
  const unused = unusedRoomsText(roomDay, periods);
  // Worked out from the day on each render, so a date passing through other days while it is typed never loses the
  // doctor's pick: a picked room counts while it is open that day; otherwise the department's room (the ventilation
  // repair moves the rooms by date), or none.
  const roomId = picked && isOpenRoom(picked, roomDay, periods) ? picked : (roomForSubtype(doctor.subtype, roomDay, periods) ?? "");
  // The HN is saved in its matching form (no leading zeros or dashes, upper case), so the doctor's list may show it
  // differently from what was typed; say so under the box before saving.
  const hnChecked = checkHn(hn);
  const savedHn = hnChecked.ok && hnChecked.hn !== hn.trim() ? hnChecked.hn : null;

  return (
    // While a save runs the dialog stays open (Escape too), so its answer lands in the dialog that sent it.
    <dialog
      ref={ref}
      aria-labelledby="add-case-title"
      className={DIALOG}
      onCancel={(event) => pending && event.preventDefault()}
      onClose={onClosed}
      data-testid="add-case-dialog"
    >
      <form onSubmit={save} noValidate>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="add-case-title" className="text-lg font-bold">
              จองห้องผ่าตัด
            </h2>
            <p className="mt-0.5 text-sm text-ink-2">
              ศัลยแพทย์ <span className="font-semibold text-ink">{doctor.name}</span>
              {specialty ? <span className="text-muted"> · {specialty}</span> : null}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0"
            aria-label="ปิด"
            title="ปิด"
            disabled={pending}
            onClick={() => ref.current?.close()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-ink">วันที่ผ่าตัด</span>
            <input
              type="date"
              value={date}
              min={today}
              max={addDays(today, BOOK_AHEAD_DAYS)}
              onChange={(event) => changeDate(event.target.value)}
              className="field field-text mt-1.5"
              required
              data-testid="case-date"
            />
            <span className={`mt-1 block text-xs ${weekend ? "font-semibold text-[var(--stop)]" : "text-muted"}`}>
              {weekend ? "วันเสาร์และอาทิตย์ไม่มีตารางผ่าตัด" : date ? thaiDate(date) : "เลือกวัน"}
            </span>
          </label>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">ห้องผ่าตัด</legend>
            <div className="mt-1.5 grid grid-cols-5 gap-1.5" data-testid="case-rooms">
              {openRooms(roomDay, periods).map((room) => {
                const allocation = date && !weekend ? allocationFor(room.id, date, periods) : null;
                return (
                  <label key={room.id} className={OPTION}>
                    <input
                      type="radio"
                      name="room"
                      value={room.id}
                      checked={roomId === room.id}
                      onChange={() => {
                        setPicked(room.id);
                        setError("");
                        setDone("");
                      }}
                      className="sr-only"
                    />
                    <span className="text-sm font-bold whitespace-nowrap">{roomLabel(room)}</span>
                    {allocation ? (
                      allocation.split ? (
                        <span className="flex flex-col items-center gap-0.5">
                          <DeptTag dept={allocation.am} />
                          <DeptTag dept={allocation.pm} />
                        </span>
                      ) : (
                        <DeptTag dept={allocation.am} />
                      )
                    ) : (
                      <span className="text-[0.6875rem] leading-5 text-muted">–</span>
                    )}
                  </label>
                );
              })}
            </div>
            {unused ? (
              <p className="mt-1 text-xs text-muted" data-testid="case-rooms-note">
                {repair ? `ช่วงปิดซ่อมห้องผ่าตัด · ${unused}` : unused}
              </p>
            ) : null}
          </fieldset>

          <label className="block">
            <span className="text-sm font-semibold text-ink">HN ผู้ป่วย</span>
            {/*
              HOSxP numbers are digits, so phones show the number pad; letters and dashes typed on a keyboard or
              pasted are still taken. No maxLength: a pasted number cut short without a word could match another
              patient, so a long one is refused with a message instead. No autocomplete: the browser must not keep a
              list of patients' HNs.
            */}
            <input
              ref={hnRef}
              value={hn}
              onChange={(event) => {
                setHn(event.target.value);
                setHnInvalid(false);
                setError("");
                setDone("");
              }}
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={hnInvalid || undefined}
              aria-describedby={savedHn ? "case-hn-saved" : undefined}
              className="field field-text mt-1.5 tabular-nums"
              required
              data-testid="case-hn"
            />
            {savedHn ? (
              <span id="case-hn-saved" className="mt-1 block text-xs text-muted">
                บันทึกเป็น <span className="tabular-nums">{savedHn}</span>
              </span>
            ) : null}
          </label>

          <label className="block">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-ink">
                การผ่าตัด <span className="font-normal text-muted">(ไม่บังคับ)</span>
              </span>
              <span className="text-xs text-muted tabular-nums">
                {operation.length}/{MAX_OPERATION}
              </span>
            </span>
            <input
              value={operation}
              onChange={(event) => {
                setOperation(event.target.value);
                setError("");
                setDone("");
              }}
              maxLength={MAX_OPERATION}
              autoComplete="off"
              placeholder="เช่น Lap chole, ORIF radius"
              className="field field-text mt-1.5"
              data-testid="case-operation"
            />
          </label>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">เวลา</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(
                [
                  ["in", "ในเวลา"],
                  ["out", "นอกเวลา"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className={`${OPTION} min-h-11 flex-row`}>
                  <input
                    type="radio"
                    name="shift"
                    value={value}
                    checked={shift === value}
                    onChange={() => setShift(value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-semibold">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {error ? (
            <Notice tone="warning" role="alert">
              {error}
            </Notice>
          ) : null}
          {done ? (
            <Notice tone="success" role="status">
              {done}
            </Notice>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="btn btn-secondary">
            ปิด
          </button>
          <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-primary" data-testid="case-submit">
            {pending ? "กำลังบันทึก…" : "จองห้อง"}
          </button>
        </div>
      </form>

      <section className="mt-6 border-t border-line pt-4" aria-labelledby="my-cases-title">
        <h3 id="my-cases-title" className="flex items-center gap-2 text-sm font-bold">
          การจองของฉัน
          <span className="count-tag">
            <span className="tabular-nums">{mine.length}</span> รายการ
          </span>
        </h3>
        {mine.length === 0 ? (
          <p className="mt-2 text-sm text-muted">ยังไม่มีการจองตั้งแต่วันนี้</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-white/70" data-testid="my-cases">
            {mine.map((item) => {
              const room = getRoom(item.roomId);
              const asking = confirming === item.id;
              // A case whose room is not in use that day (the ventilation repair moves the rooms) is not on the board.
              const offBoard = roomUse(item.roomId, item.date, periods) !== "open";
              // Names the booking for the cancel button's screen-reader label: several can share a day and an HN.
              const what = [
                thaiDate(item.date, "short"),
                room ? roomLabel(room) : item.roomId,
                item.hn ? `HN ${item.hn}` : item.operation,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink-2">
                      {thaiDate(item.date, "short")} · {room ? roomLabel(room) : item.roomId}
                      {item.shift === "out" ? <span className="badge badge-warning ml-1.5 align-middle">นอกเวลา</span> : null}
                      {offBoard ? <span className="badge badge-warning ml-1.5 align-middle">ห้องนี้ไม่เปิดวันนั้น</span> : null}
                    </p>
                    {/* Cases saved before bookings carried an HN have none; they show their operation as before. */}
                    {item.hn ? (
                      <p className="text-sm font-semibold break-all text-ink tabular-nums" data-testid="my-case-hn">
                        HN {item.hn}
                      </p>
                    ) : null}
                    <p className={`text-sm break-words ${item.operation ? (item.hn ? "text-ink-2" : "font-semibold text-ink") : "text-muted"}`}>
                      {item.operation || NO_OPERATION_LABEL}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(item.id)}
                    onBlur={() => setConfirming((current) => (current === item.id ? null : current))}
                    className={`btn min-h-11 shrink-0 px-3 text-sm ${asking ? "btn-danger" : "btn-ghost btn-ghost-danger"}`}
                    aria-label={asking ? `ยืนยันยกเลิก ${what}` : `ยกเลิกจอง ${what}`}
                  >
                    {asking ? "ยืนยันยกเลิก" : "ยกเลิกจอง"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </dialog>
  );
}
