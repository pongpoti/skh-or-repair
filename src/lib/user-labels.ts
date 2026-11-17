import { DEPARTMENTS, type DeptCode } from "./allocation.ts";
import { SPECIALTY_CODES, specialtyOf } from "./specialties.ts";

/**
 * User types and their Thai labels: the `type` column of the `users` table (db/schema.sql), the position step of
 * /login/verify, the claim page's step 1 (/login/claim) and the doctors' page (/login/doctor). Isomorphic: no
 * server-only imports.
 */
export const USER_TYPES = ["DR", "RN", "PN", "PCA"] as const;
export type UserType = (typeof USER_TYPES)[number];

export const TYPE_LABELS: Record<UserType, string> = {
  DR: "แพทย์",
  RN: "พยาบาล",
  PN: "ผู้ช่วยพยาบาล",
  PCA: "พนักงานช่วยเหลือคนไข้",
};

export function isUserType(v: unknown): v is UserType {
  return typeof v === "string" && (USER_TYPES as readonly string[]).includes(v);
}

/** The types that sign in with an SMS code to their mobile number: everyone but doctors, who use email only. */
export type PhoneUserType = Exclude<UserType, "DR">;

export function isPhoneType(v: unknown): v is PhoneUserType {
  return isUserType(v) && v !== "DR";
}

/** Nursing units of RN, PN and PCA users. */
const UNIT_LABELS: Record<string, string> = { OR: "ห้องผ่าตัด", ANES: "วิสัญญี" };

/** Doctor subtypes the operating-suite department list does not hold. */
const EXTRA_SPECIALTIES: Record<string, string> = { ANES: "วิสัญญี" };

/**
 * The subtype in Thai: for doctors the app's specialty names (lib/specialties.ts, then the department list in
 * lib/allocation.ts, then a few more), for nurses and assistants the unit (OR ห้องผ่าตัด, ANES วิสัญญี). An unknown
 * code is shown as it is; no subtype is null.
 */
export function subtypeLabel(type: string, subtype: string | null | undefined): string | null {
  const code = subtype?.trim();
  if (!code) return null;
  if (type === "DR") {
    const specialty = specialtyOf(code);
    if (specialty) return specialty.name;
    if (Object.hasOwn(DEPARTMENTS, code)) return DEPARTMENTS[code as DeptCode].name;
    return Object.hasOwn(EXTRA_SPECIALTIES, code) ? EXTRA_SPECIALTIES[code] : code;
  }
  return Object.hasOwn(UNIT_LABELS, code) ? UNIT_LABELS[code] : code;
}

/**
 * The subtypes an admin can give a name added on /admin (Pong, 17 Nov 2026): a doctor's specialty (the app's list, then
 * วิสัญญี), everyone else's unit (ห้องผ่าตัด, วิสัญญี). The same codes Pong's CSV uses.
 */
export function subtypeChoices(type: UserType): Array<{ code: string; name: string }> {
  const codes = type === "DR" ? [...SPECIALTY_CODES, ...Object.keys(EXTRA_SPECIALTIES)] : Object.keys(UNIT_LABELS);
  return codes.map((code) => ({ code, name: subtypeLabel(type, code) ?? code }));
}

/** "แพทย์ · ออร์โธปิดิกส์", or just the type when there is no subtype. */
export function roleLabel(type: string, subtype: string | null | undefined): string {
  const t = isUserType(type) ? TYPE_LABELS[type] : type;
  const s = subtypeLabel(type, subtype);
  return s ? `${t} · ${s}` : t;
}

/** Search text: NFC, no invisible format characters, lower case, without spaces (so extra or missing spaces never matter). */
export function searchKey(s: string): string {
  return s.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/\s+/g, "").toLocaleLowerCase("th");
}

/**
 * True when the query is found in the first name, the last name, or "first last" (spaces ignored on both sides).
 * An empty query matches everyone.
 */
export function matchesName(query: string, firstName: string, lastName: string): boolean {
  const q = searchKey(query);
  if (!q) return true;
  return searchKey(`${firstName}${lastName}`).includes(q) || searchKey(`${lastName}${firstName}`).includes(q);
}
