"use server";

import type { CaseResult } from "@/app/(board)/actions";
import { bookedMessage, checkCase, type AddedCase, type BookingContext } from "@/lib/added-cases";
import { SAMPLE_DOCTOR_ID } from "./sample";

/**
 * The preview's booking form (/preview?book=1, development only): the same checks as the real action, with the
 * preview's own day and clock, and the bookings kept in this server's memory only, never in the database.
 */
const kept: AddedCase[] = [];

function devOnly() {
  if (process.env.NODE_ENV !== "development") throw new Error("preview only");
}

export async function previewAddCase(context: BookingContext & { name: string }, input: unknown): Promise<CaseResult> {
  devOnly();
  const checked = checkCase(input, context);
  if (!checked.ok) return { ok: false, error: checked.error, earliest: checked.earliest, mine: [...kept] };
  const value = checked.value;
  kept.push({ ...value, id: String(Date.now()), surgeonId: SAMPLE_DOCTOR_ID, surgeon: context.name, subtype: context.subtype });
  kept.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { ok: true, mine: [...kept], message: bookedMessage(value) };
}

/** The preview doctor's bookings so far, so the form's list survives the refresh after each save. */
export async function previewMine(): Promise<AddedCase[]> {
  devOnly();
  return [...kept];
}

export async function previewRemoveCase(id: string): Promise<CaseResult> {
  devOnly();
  const at = kept.findIndex((item) => item.id === id);
  if (at >= 0) kept.splice(at, 1);
  return { ok: true, mine: [...kept], message: at >= 0 ? "ยกเลิกการจองแล้ว" : "การจองนี้ถูกยกเลิกไปแล้ว" };
}
