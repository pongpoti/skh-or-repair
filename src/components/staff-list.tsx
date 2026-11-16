"use client";

import { useMemo, useState } from "react";
import type { StaffView } from "@/app/admin/data";
import { AdminSection } from "@/components/admin-section";
import { Notice } from "@/components/auth-shell";
import { specialtyOf } from "@/lib/specialties";
import { searchKey, TYPE_LABELS, USER_TYPES, type UserType } from "@/lib/user-labels";

const SEARCH_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4.2-4.2" />
  </svg>
);

/** A type button: picked like the booking form's options (components/add-case.tsx). */
const TYPE_OPTION =
  "flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl border border-line-strong bg-white px-1 py-1.5 text-center leading-tight text-ink transition-colors hover:border-brand aria-pressed:border-brand aria-pressed:bg-brand-tint aria-pressed:shadow-[inset_0_0_0_1px_var(--brand)]";

/** What the subtype filter is called for each type: a doctor's specialty, everyone else's unit. */
const SUBTYPE_WORD: Record<UserType, string> = { DR: "สาขา", RN: "หน่วย", PN: "หน่วย", PCA: "หน่วย" };

const TYPE_ORDER = new Map<string, number>(USER_TYPES.map((type, index) => [type, index]));

/** Doctors first, then nurses, assistants and aides, each in Thai name order. */
function byTypeThenName(a: StaffView, b: StaffView): number {
  return (TYPE_ORDER.get(a.type) ?? 9) - (TYPE_ORDER.get(b.type) ?? 9) || a.name.localeCompare(b.name, "th");
}

/** The type's code on a quiet tag, the same width for all four. */
function TypeTag({ type }: { type: UserType }) {
  return (
    <span className="inline-flex w-11 shrink-0 justify-center rounded-md border border-line-strong bg-white text-[0.6875rem] leading-5 font-bold tracking-[0.02em] text-ink-2">
      {type}
    </span>
  );
}

/** A doctor's specialty on its department colour, as the old surgeon list had it; null for a code the app does not list. */
function SpecialtyTag({ code }: { code: string }) {
  const specialty = specialtyOf(code);
  if (!specialty) return null;
  return (
    <span
      className="chip min-h-0 shrink-0 justify-center px-2 py-0 text-[0.6875rem] leading-5 tracking-[0.02em]"
      style={{ "--chip": specialty.color, color: specialty.text } as React.CSSProperties}
    >
      {specialty.label}
    </span>
  );
}

/**
 * Everyone on the staff list (Pong, 16 Nov 2026: "change to all name list, allow to select user type (DR, RN, ...)"),
 * in place of the old surgeon list: the active names of table `users`, the list people sign in with. Pick a type
 * (all, DR, RN, PN, PCA), then a specialty or unit, and search by name. Read only: the list is loaded from Pong's CSV
 * by scripts/sync-users.mjs, its only writer. `initial` null means the list could not be read.
 */
export function StaffList({ initial }: { initial: readonly StaffView[] | null }) {
  const people = useMemo(() => [...(initial ?? [])].sort(byTypeThenName), [initial]);
  const [type, setType] = useState<UserType | "">("");
  const [subtype, setSubtype] = useState("");
  const [query, setQuery] = useState("");

  const typeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const person of people) map.set(person.type, (map.get(person.type) ?? 0) + 1);
    return map;
  }, [people]);

  /** The picked type's specialties or units, in Thai order, with how many people each has. */
  const subtypes = useMemo(() => {
    if (!type) return [];
    const map = new Map<string, { code: string; name: string; count: number }>();
    for (const person of people) {
      if (person.type !== type) continue;
      const item = map.get(person.subtype) ?? { code: person.subtype, name: person.subtypeName, count: 0 };
      item.count += 1;
      map.set(person.subtype, item);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [people, type]);

  const shown = useMemo(() => {
    const needle = searchKey(query);
    return people.filter(
      (person) =>
        (!type || person.type === type) && (!subtype || person.subtype === subtype) && (!needle || searchKey(person.name).includes(needle)),
    );
  }, [people, type, subtype, query]);

  const pickType = (next: UserType | "") => {
    setType(next);
    setSubtype("");
  };

  if (!initial) {
    return (
      <AdminSection id="staff" title="รายชื่อทั้งหมด" summary="อ่านรายชื่อจากระบบไม่ได้" testId="staff-section">
        <div className="p-4 sm:p-5">
          <Notice tone="warning" role="alert">
            อ่านรายชื่อจากระบบไม่ได้ ลองโหลดหน้านี้ใหม่
          </Notice>
        </div>
      </AdminSection>
    );
  }

  const options: Array<{ value: UserType | ""; label: string; name: string; count: number }> = [
    { value: "", label: "ทั้งหมด", name: "ทุกตำแหน่ง", count: people.length },
    ...USER_TYPES.map((code) => ({ value: code, label: code, name: TYPE_LABELS[code], count: typeCounts.get(code) ?? 0 })),
  ];
  const word = type ? SUBTYPE_WORD[type] : "";

  return (
    <AdminSection id="staff" title="รายชื่อทั้งหมด" summary={`ผู้ใช้ที่ใช้งานอยู่ ${people.length} คน`} testId="staff-section">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
        {/* ทั้งหมด is the longest word, so its button is wider (it still fits a 320px phone). */}
        <div role="group" aria-label="ตำแหน่ง" className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-1.5" data-testid="staff-types">
          {options.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={type === option.value}
              onClick={() => pickType(option.value)}
              className={TYPE_OPTION}
              data-testid={`staff-type-${option.value || "all"}`}
            >
              <span className="text-[0.9375rem] font-bold">{option.label}</span>
              {/* The Thai name is read out with the code, so DR is also แพทย์ to a screen reader. */}
              {option.value ? <span className="sr-only">{option.name}</span> : null}
              <span className="text-xs text-muted tabular-nums">{option.count} คน</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">ค้นหาชื่อหรือนามสกุล</span>
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted">{SEARCH_ICON}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ค้นหาชื่อหรือนามสกุล"
              autoComplete="off"
              className="field field-text pl-10"
              data-testid="staff-search"
            />
          </label>
          {type ? (
            <label className="block sm:w-72">
              <span className="sr-only">กรองตาม{word}</span>
              <select value={subtype} onChange={(event) => setSubtype(event.target.value)} className="field" data-testid="staff-subtype">
                <option value="">
                  ทุก{word} ({typeCounts.get(type) ?? 0})
                </option>
                {subtypes.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name} ({item.count})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <p className="text-sm text-muted" role="status" data-testid="staff-count">
          {shown.length === people.length
            ? `ทั้งหมด ${people.length} คน`
            : `แสดง ${shown.length} จาก ${people.length} คน${type ? ` · ${TYPE_LABELS[type]}` : ""}`}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">
          {people.length ? "ไม่พบชื่อที่ตรงกับคำค้นหรือตำแหน่งที่เลือก" : "ยังไม่มีผู้ใช้ที่ใช้งานอยู่"}
        </p>
      ) : (
        <ul className="divide-y divide-line" data-testid="staff-list">
          {shown.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5" data-type={person.type}>
              <TypeTag type={person.type} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-semibold text-ink">{person.name}</p>
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  {person.type === "DR" ? <SpecialtyTag code={person.subtype} /> : null}
                  <span className="truncate">
                    {TYPE_LABELS[person.type]}
                    {person.subtypeName ? ` · ${person.subtypeName}` : ""}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}
