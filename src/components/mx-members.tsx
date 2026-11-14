"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MxResult } from "@/app/admin/actions";
import type { MxData, MxView, PickView } from "@/app/admin/data";
import { Notice } from "@/components/auth-shell";
import { searchKey } from "@/lib/user-labels";

const icon = {
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4.2-4.2" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  remove: <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM16 11h6" />,
} as const;

function Icon({ name, size = 18 }: { name: keyof typeof icon; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon[name]}
    </svg>
  );
}

/** The same dialog as the surgeon list's (components/physician-admin.tsx). */
const DIALOG =
  "m-auto w-[min(28rem,calc(100%-2rem))] rounded-[18px] border border-line bg-surface p-6 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px]";

const UNSAVED = "บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง";

/** A name matches when the query is found in it, spaces and case ignored (lib/user-labels.ts searchKey). */
function matches(query: string, name: string): boolean {
  const needle = searchKey(query);
  return !needle || searchKey(name).includes(needle);
}

/**
 * The admin's list of MX members (ผู้จัดการตาราง, who upload the HOSxP workbook; lib/roles.ts): remove one, or add one by
 * picking an active user by name. Picking takes two steps (choose, then add) because the role lets that person replace
 * everyone's schedule. With `onAdd` and `onRemove` (the server actions) every change is saved; without them, as in the
 * development preview, changes stay in this page. `initial` null means the list could not be read.
 */
export function MxMembers({
  initial,
  onAdd,
  onRemove,
}: {
  initial: MxData | null;
  onAdd?: (userId: string) => Promise<MxResult>;
  onRemove?: (userId: string) => Promise<MxResult>;
}) {
  const [members, setMembers] = useState<MxView[]>(() => initial?.members ?? []);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PickView | null>(null);
  const [removing, setRemoving] = useState<MxView | null>(null);
  const [pickError, setPickError] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();
  const pickRef = useRef<HTMLDialogElement>(null);
  const removeRef = useRef<HTMLDialogElement>(null);
  const users = initial?.users;

  const memberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);
  const shown = useMemo(() => (users ?? []).filter((user) => matches(query, user.name)), [users, query]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(""), 4000);
    return () => clearTimeout(timer);
  }, [done]);

  if (!initial) {
    return (
      <section className="card overflow-hidden" aria-labelledby="mx-title">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <h2 id="mx-title" className="text-base font-bold text-ink sm:text-lg">
            ผู้จัดการตาราง (MX)
          </h2>
          <Notice tone="warning" role="alert">
            อ่านรายชื่อจากระบบไม่ได้ ลองโหลดหน้านี้ใหม่
          </Notice>
        </div>
      </section>
    );
  }

  /** Applies a server answer: the fresh list (on some failures too), the message, and whether to close. */
  function applied(result: MxResult, showError: (message: string) => void): boolean {
    if (result.members) setMembers(result.members);
    if (!result.ok) {
      showError(result.error);
      return false;
    }
    setDone(result.message);
    return true;
  }

  function openPicker() {
    setQuery("");
    setPicked(null);
    setPickError("");
    pickRef.current?.showModal();
  }

  function add() {
    if (!picked || pending) return;
    const person = picked;

    if (!onAdd) {
      setMembers((list) =>
        [...list, { userId: person.id, name: person.name, role: person.role, active: true, addedOn: "วันนี้" }].sort((a, b) =>
          a.name.localeCompare(b.name, "th"),
        ),
      );
      setDone(`เพิ่ม ${person.name} เป็นผู้จัดการตารางแล้ว`);
      pickRef.current?.close();
      return;
    }

    setPickError("");
    startTransition(async () => {
      try {
        if (applied(await onAdd(person.id), setPickError)) pickRef.current?.close();
      } catch {
        setPickError(UNSAVED);
      }
    });
  }

  function openRemove(member: MxView) {
    setRemoving(member);
    setRemoveError("");
    removeRef.current?.showModal();
  }

  function remove() {
    if (!removing || pending) return;
    const { userId, name } = removing;

    if (!onRemove) {
      setMembers((list) => list.filter((member) => member.userId !== userId));
      setDone(`ถอดสิทธิ์ผู้จัดการตารางของ ${name} แล้ว`);
      removeRef.current?.close();
      return;
    }

    setRemoveError("");
    startTransition(async () => {
      try {
        if (applied(await onRemove(userId), setRemoveError)) removeRef.current?.close();
      } catch {
        setRemoveError(UNSAVED);
      }
    });
  }

  return (
    <section className="card overflow-hidden" aria-labelledby="mx-title">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="mx-title" className="text-base font-bold text-ink sm:text-lg">
              ผู้จัดการตาราง (MX)
            </h2>
            <p className="text-sm text-muted">อัปโหลดตาราง HOSxP ได้ · {members.length} คน</p>
          </div>
          <button type="button" onClick={openPicker} className="btn btn-primary shrink-0 px-4" data-testid="mx-add">
            <Icon name="plus" />
            เพิ่ม MX
          </button>
        </div>
        {done ? (
          <Notice tone="success" role="status">
            {done}
          </Notice>
        ) : null}
      </div>

      {members.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">ยังไม่มีผู้จัดการตาราง กด “เพิ่ม MX” แล้วเลือกจากรายชื่อผู้ใช้</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="mx-list">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[rgb(166_137_102/0.08)] sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-semibold text-ink">{member.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {member.role} · เพิ่มเมื่อ {member.addedOn}
                </p>
                {member.active ? null : (
                  <span className="mt-1 flex">
                    <span className="badge badge-muted">ปิดใช้งานอยู่ สิทธิ์ยังไม่มีผล</span>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => openRemove(member)}
                aria-label={`ถอดสิทธิ์ผู้จัดการตารางของ ${member.name}`}
                className="btn btn-ghost btn-ghost-danger size-11 min-h-0 shrink-0 p-0 sm:w-auto sm:px-3.5"
              >
                <Icon name="remove" />
                <span className="hidden sm:inline">ถอดสิทธิ์</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* While a save runs the dialog stays open (Escape too), so its answer lands in the dialog that sent it. */}
      <dialog ref={pickRef} aria-labelledby="mx-pick-title" className={DIALOG} onCancel={(event) => pending && event.preventDefault()}>
        <h2 id="mx-pick-title" className="text-lg font-bold">
          เพิ่มผู้จัดการตาราง
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted">เลือกจากผู้ใช้ที่ใช้งานอยู่ ผู้จัดการตารางอัปโหลดตาราง HOSxP ได้ทุกวัน 15:00–16:00 น.</p>
        <label className="relative mt-4 block">
          <span className="sr-only">ค้นหาชื่อหรือนามสกุล</span>
          <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted">
            <Icon name="search" />
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาชื่อหรือนามสกุล"
            autoComplete="off"
            className="field field-text pl-10"
            data-testid="mx-search"
          />
        </label>
        <p className="mt-2 text-xs text-muted" role="status">
          {shown.length ? `พบ ${shown.length} คน` : users?.length ? "ไม่พบชื่อนี้ ลองพิมพ์เฉพาะชื่อหรือเฉพาะนามสกุล" : "ยังไม่มีผู้ใช้ที่ใช้งานอยู่"}
        </p>
        {shown.length ? (
          <ul className="choice-list mt-1 grid max-h-[min(20rem,40dvh)] gap-1.5 overflow-y-auto overscroll-contain" data-testid="mx-users">
            {shown.map((user) => {
              const member = memberIds.has(user.id);
              const chosen = picked?.id === user.id;
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    className={`choice ${chosen ? "border-[var(--brand)] bg-[var(--brand-tint)]" : ""}`}
                    disabled={member || pending}
                    aria-pressed={chosen}
                    onClick={() => {
                      setPicked(user);
                      setPickError("");
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold break-words">{user.name}</span>
                      <span className="block text-[0.8125rem] leading-5 text-muted">{user.role}</span>
                      {member ? (
                        <span className="mt-1 flex">
                          <span className="badge badge-muted">เป็น MX แล้ว</span>
                        </span>
                      ) : null}
                    </span>
                    {chosen ? (
                      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--brand)]">
                        <Icon name="check" />
                        เลือกแล้ว
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {pickError ? (
          <Notice tone="warning" role="alert" className="mt-3">
            {pickError}
          </Notice>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => pickRef.current?.close()} disabled={pending} className="btn btn-secondary">
            ยกเลิก
          </button>
          <button type="button" onClick={add} disabled={!picked || pending} aria-busy={pending} className="btn btn-primary" data-testid="mx-confirm">
            <Icon name="plus" />
            {pending ? "กำลังเพิ่ม…" : picked ? `เพิ่ม ${picked.name}` : "เลือกชื่อก่อน"}
          </button>
        </div>
      </dialog>

      <dialog ref={removeRef} aria-labelledby="mx-remove-title" className={DIALOG} onCancel={(event) => pending && event.preventDefault()}>
        <h2 id="mx-remove-title" className="text-lg font-bold">
          ถอดสิทธิ์ผู้จัดการตาราง
        </h2>
        <dl className="mt-4 space-y-3 rounded-xl border border-line bg-white/70 p-4 text-sm">
          <div>
            <dt className="text-muted">ชื่อ</dt>
            <dd className="mt-0.5 font-semibold text-ink">{removing?.name}</dd>
          </div>
          <div>
            <dt className="text-muted">ตำแหน่ง</dt>
            <dd className="mt-0.5 font-semibold text-ink">{removing?.role}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-6 text-muted">คนนี้จะอัปโหลดตาราง HOSxP ไม่ได้อีก ถ้าต้องการคืนสิทธิ์ ให้เพิ่มใหม่อีกครั้ง</p>
        {removeError ? (
          <Notice tone="warning" role="alert" className="mt-3">
            {removeError}
          </Notice>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" autoFocus onClick={() => removeRef.current?.close()} disabled={pending} className="btn btn-secondary">
            ยกเลิก
          </button>
          <button type="button" onClick={remove} disabled={pending} aria-busy={pending} className="btn btn-danger">
            <Icon name="remove" />
            {pending ? "กำลังถอดสิทธิ์…" : "ถอดสิทธิ์"}
          </button>
        </div>
      </dialog>
    </section>
  );
}
