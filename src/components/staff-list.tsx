"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { StaffResult } from "@/app/admin/actions";
import type { StaffView } from "@/app/admin/data";
import { AdminSection } from "@/components/admin-section";
import { Notice } from "@/components/auth-shell";
import { InlineStatus } from "@/components/inline-status";
import { specialtyOf } from "@/lib/specialties";
import { searchKey, subtypeChoices, subtypeLabel, TYPE_LABELS, USER_TYPES, type UserType } from "@/lib/user-labels";

/** The admin page's dialog (as the MX picker has it). */
const DIALOG =
  "m-auto w-[min(28rem,calc(100%-2rem))] rounded-[18px] border border-line bg-surface p-6 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px]";

const PLUS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const UNSAVED = "บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง";

/** A new name's draft: nurses and assistants start in the OR unit, a doctor's specialty is picked. */
type Draft = { firstName: string; lastName: string; type: UserType; subtype: string };
const EMPTY_DRAFT: Draft = { firstName: "", lastName: "", type: "RN", subtype: "OR" };

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
 * (all, DR, RN, PN, PCA), then a specialty or unit, and search by name. The list is loaded from Pong's CSV by
 * scripts/sync-users.mjs; เพิ่มชื่อ in the heading (Pong, 17 Nov 2026: "add user button") adds one name, with its type
 * and specialty or unit, through `onAdd` (the server action, lib/user-admin.ts); without it, as in the development
 * preview, the name is added in this page only. `initial` null means the list could not be read.
 */
export function StaffList({
  initial,
  onAdd,
}: {
  initial: readonly StaffView[] | null;
  onAdd?: (draft: Draft) => Promise<StaffResult>;
}) {
  const [list, setList] = useState<readonly StaffView[]>(() => initial ?? []);
  const people = useMemo(() => [...list].sort(byTypeThenName), [list]);
  const [type, setType] = useState<UserType | "">("");
  const [subtype, setSubtype] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [addError, setAddError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();
  const addRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(""), 4000);
    return () => clearTimeout(timer);
  }, [done]);

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

  /** A change to the draft also clears a refusal about the earlier one. */
  function change(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setAddError("");
  }

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setAddError("");
    addRef.current?.showModal();
  }

  /** The new name in the list, shown by itself (the filters cleared, its name searched). */
  function showAdded(name: string, message: string) {
    setType("");
    setSubtype("");
    setQuery(name);
    setDone(message);
    addRef.current?.close();
  }

  function add() {
    if (pending) return;
    const firstName = draft.firstName.trim();
    const lastName = draft.lastName.trim();
    if (!firstName || !lastName) {
      setAddError(!firstName ? "กรอกชื่อ" : "กรอกนามสกุล");
      return;
    }
    if (!draft.subtype) {
      setAddError(draft.type === "DR" ? "เลือกสาขา" : "เลือกหน่วย");
      return;
    }
    const name = `${firstName} ${lastName}`;

    if (!onAdd) {
      if (list.some((person) => person.name === name)) {
        setAddError(`มี ${name} ในรายชื่ออยู่แล้ว`);
        return;
      }
      const subtypeName = subtypeLabel(draft.type, draft.subtype) ?? draft.subtype;
      setList((current) => [...current, { id: `new-${current.length + 1}`, name, type: draft.type, subtype: draft.subtype, subtypeName }]);
      showAdded(name, `เพิ่ม ${name} แล้ว`);
      return;
    }

    setAddError("");
    startTransition(async () => {
      try {
        const result = await onAdd({ ...draft, firstName, lastName });
        if (!result.ok) {
          setAddError(result.error);
          return;
        }
        setList(result.staff);
        showAdded(result.staff.find((person) => person.id === result.id)?.name ?? name, result.message);
      } catch {
        setAddError(UNSAVED);
      }
    });
  }

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

  const summary = (
    <>
      <p data-testid="staff-summary-count">ผู้ใช้ที่ใช้งานอยู่ {people.length} คน</p>
      {done ? (
        <InlineStatus tone="success" role="status" className="mt-1">
          {done}
        </InlineStatus>
      ) : null}
    </>
  );
  // Greyed out and inert while the section is closed (components/admin-section.tsx), as เพิ่ม MX.
  const addButton = (
    <button type="button" onClick={openAdd} className="btn btn-primary px-4" data-testid="staff-add">
      {PLUS}
      เพิ่มชื่อ
    </button>
  );
  const choices = subtypeChoices(draft.type);

  return (
    <AdminSection id="staff" title="รายชื่อทั้งหมด" summary={summary} actions={addButton} testId="staff-section">
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

      {/* While a save runs the dialog stays open (Escape too), so its answer lands in the dialog that sent it. */}
      <dialog ref={addRef} aria-labelledby="staff-add-title" className={DIALOG} onCancel={(event) => pending && event.preventDefault()}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
          noValidate
        >
          <h2 id="staff-add-title" className="text-lg font-bold">
            เพิ่มชื่อในรายชื่อ
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">ชื่อที่เพิ่มจะเลือกได้ตอนเข้าสู่ระบบทันที เหมือนชื่อจากรายชื่อเดิม</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink-2">ชื่อ</span>
              <input
                value={draft.firstName}
                onChange={(event) => change({ firstName: event.target.value })}
                autoComplete="off"
                maxLength={100}
                className="field field-text"
                data-testid="staff-add-first"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink-2">นามสกุล</span>
              <input
                value={draft.lastName}
                onChange={(event) => change({ lastName: event.target.value })}
                autoComplete="off"
                maxLength={100}
                className="field field-text"
                data-testid="staff-add-last"
              />
            </label>
          </div>
          <fieldset className="mt-4">
            <legend className="mb-1 text-sm font-semibold text-ink-2">ตำแหน่ง</legend>
            <div className="grid grid-cols-4 gap-1.5" data-testid="staff-add-types">
              {USER_TYPES.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={draft.type === code}
                  onClick={() => change({ type: code, subtype: code === "DR" ? "" : "OR" })}
                  className={TYPE_OPTION}
                  data-testid={`staff-add-type-${code}`}
                >
                  <span className="text-[0.9375rem] font-bold">{code}</span>
                  <span className="text-[0.6875rem] leading-tight text-muted">{TYPE_LABELS[code]}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-semibold text-ink-2">{SUBTYPE_WORD[draft.type]}</span>
            <select
              value={draft.subtype}
              onChange={(event) => change({ subtype: event.target.value })}
              className="field"
              data-testid="staff-add-subtype"
            >
              {draft.type === "DR" ? <option value="">เลือกสาขา</option> : null}
              {choices.map((choice) => (
                <option key={choice.code} value={choice.code}>
                  {choice.name} ({choice.code})
                </option>
              ))}
            </select>
          </label>
          {/* A refused add is said just above the buttons that sent it. */}
          <div className="mt-5">
            {addError ? (
              <InlineStatus tone="warning" role="alert" className="mb-2">
                {addError}
              </InlineStatus>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => addRef.current?.close()} disabled={pending} className="btn btn-secondary">
                ยกเลิก
              </button>
              <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-primary" data-testid="staff-add-confirm">
                {PLUS}
                {pending ? "กำลังเพิ่ม…" : "เพิ่มชื่อ"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
    </AdminSection>
  );
}
