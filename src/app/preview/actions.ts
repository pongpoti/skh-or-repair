"use server";

import type { CaseResult, DayResult } from "@/app/(board)/actions";
import {
  bookedMessage,
  bookingChange,
  checkCase,
  daySlots,
  editedMessage,
  timeClash,
  timeOf,
  type AddedCase,
  type BookingContext,
} from "@/lib/added-cases";
import { TIME_TAKEN_TEXT } from "@/lib/booking-time";
import { SAMPLE_DOCTOR_ID, sampleCases } from "./sample";

/**
 * The preview's booking form (/preview?book=1, development only): the same checks as the real actions, with the
 * preview's own day and clock, and the bookings kept in this server's memory only, never in the database. The sample
 * doctor's own made-up bookings (?sample=1) join them the first time a day is shown, so their rows' actions work too.
 */
const kept: AddedCase[] = [];
/** Ids already taken in (a cancelled one does not come back). */
const seen = new Set<string>();
/** Cancelled bookings, for เลิกทำ, with when. */
const removed = new Map<string, { item: AddedCase; at: number }>();
const UNDO_MS = 10 * 60_000;

function devOnly() {
  if (process.env.NODE_ENV !== "development") throw new Error("preview only");
}

/** Queue order, as the database lists them: by day, then the queue time. */
function sortKept() {
  kept.sort((a, b) => a.date.localeCompare(b.date) || (a.bookedAt ?? "").localeCompare(b.bookedAt ?? "") || a.id.localeCompare(b.id));
}

type PreviewContext = BookingContext & { name: string; sample: boolean };

/** The day's bookings: the form's, and with ?sample=1 the other made-up doctors' of that day. */
function dayOf(context: PreviewContext, date: string): AddedCase[] {
  const others = context.sample ? sampleCases(date, context.periods).bookings.filter((item) => item.surgeonId !== SAMPLE_DOCTOR_ID) : [];
  return [...others, ...kept.filter((item) => item.date === date)];
}

export async function previewDay(context: PreviewContext, date: string): Promise<DayResult> {
  devOnly();
  return { ok: true, date, slots: daySlots(dayOf(context, date), context.periods, SAMPLE_DOCTOR_ID) };
}

export async function previewAddCase(context: PreviewContext, input: unknown): Promise<CaseResult> {
  devOnly();
  const checked = checkCase(input, context);
  if (!checked.ok) return { ok: false, error: checked.error, field: checked.field, earliest: checked.earliest, mine: [...kept] };
  const value = checked.value;
  if (timeClash(timeOf(value), value.roomId, value.date, dayOf(context, value.date), context.periods)) {
    return { ok: false, error: TIME_TAKEN_TEXT, field: "time", mine: [...kept] };
  }
  const id = String(Date.now());
  seen.add(id);
  kept.push({ ...value, id, surgeonId: SAMPLE_DOCTOR_ID, surgeon: context.name, subtype: context.subtype, bookedAt: new Date().toISOString() });
  sortKept();
  return { ok: true, mine: [...kept], message: bookedMessage(value) };
}

export async function previewEditCase(context: PreviewContext, id: string, input: unknown): Promise<CaseResult> {
  devOnly();
  const at = kept.findIndex((item) => item.id === id);
  if (at < 0) return { ok: false, error: "การจองนี้ถูกยกเลิกไปแล้ว", mine: [...kept] };
  const before = kept[at];
  const checked = checkCase(input, { ...context, editing: { ...before, subtype: context.subtype } });
  if (!checked.ok) return { ok: false, error: checked.error, field: checked.field, earliest: checked.earliest };
  const value = checked.value;
  if (timeClash(timeOf(value), value.roomId, value.date, dayOf(context, value.date), context.periods, id)) {
    return { ok: false, error: TIME_TAKEN_TEXT, field: "time", mine: [...kept] };
  }
  const change = bookingChange({ ...before, subtype: context.subtype }, value, context.periods);
  if (!change.changed) return { ok: true, mine: [...kept], message: "ไม่มีอะไรเปลี่ยน" };
  const now = new Date().toISOString();
  kept[at] = { ...before, ...value, shift: before.shift, editedAt: now, ...(change.requeue ? { bookedAt: now } : {}) };
  sortKept();
  return { ok: true, mine: [...kept], message: editedMessage(value, before, change) };
}

/** The preview doctor's bookings so far, with `seed` (the sample's own bookings of the day shown) taken in once. */
export async function previewMine(seed: readonly AddedCase[] = []): Promise<AddedCase[]> {
  devOnly();
  for (const item of seed) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    kept.push(item);
  }
  sortKept();
  return [...kept];
}

export async function previewRemoveCase(id: string): Promise<CaseResult> {
  devOnly();
  const at = kept.findIndex((item) => item.id === id);
  if (at >= 0) removed.set(id, { item: kept.splice(at, 1)[0], at: Date.now() });
  return { ok: true, mine: [...kept], message: at >= 0 ? "ยกเลิกการจองแล้ว" : "การจองนี้ถูกยกเลิกไปแล้ว" };
}

export async function previewRestoreCase(id: string): Promise<CaseResult> {
  devOnly();
  const gone = removed.get(id);
  if (!gone || Date.now() - gone.at > UNDO_MS) return { ok: false, error: "เลิกทำได้ภายใน 10 นาทีหลังยกเลิก จองใหม่แทน", mine: [...kept] };
  removed.delete(id);
  kept.push(gone.item);
  sortKept();
  return { ok: true, mine: [...kept], message: "จองคืนแล้ว คิวเดิม" };
}
