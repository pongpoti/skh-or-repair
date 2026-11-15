"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@/components/auth-shell";
import { CLAIM_BLOCKED, CLAIM_BLOCKED_LINE } from "@/lib/claim-text";
import { isUserType, matchesName, USER_TYPES, TYPE_LABELS, type PhoneUserType, type UserType } from "@/lib/user-labels";
import { AskAdmin, Chevron, EXPIRED_MESSAGE, H2, HELP, LABEL, OtherPhone, StateIcon } from "../shared";
import { NETWORK_ERROR, postJson } from "../verify/verify-form";

/** How the page starts: the picker, the 24 h block after an undo, or a database problem. */
export type ClaimStart = "pick" | "blocked" | "error";

interface Name {
  id: string;
  first_name: string;
  last_name: string;
  subtype: string | null;
  subtype_label: string | null;
  claimed: boolean;
}

const DIALOG =
  "m-auto w-[min(26rem,calc(100%-2rem))] rounded-[18px] border border-line bg-surface p-5 text-ink shadow-[0_24px_60px_rgb(41_29_20/0.3)] backdrop:bg-[rgb(36_28_22/0.35)] backdrop:backdrop-blur-[2px] sm:p-6";

/**
 * Step 2 has its own history entry (state {claimType}), so the phone's Back button returns to step 1. The names opened
 * from the address (?type=) get one too, with an entry for step 1 put under them (state {claimTypes: true}).
 */
type ClaimHistory = { claimType?: unknown; claimTypes?: unknown } | null;

function historyType(): UserType | null {
  const t = (window.history.state as ClaimHistory)?.claimType;
  return isUserType(t) ? t : null;
}

/** True on the step-1 entry put under names opened from the address. */
function atTypesEntry(): boolean {
  return (window.history.state as ClaimHistory)?.claimTypes === true;
}

/**
 * `initialType`: the position chosen before the number (/login/verify?as=), whose names open at once; "เปลี่ยน" and
 * Back still lead to the other positions. `undo`: an administrator is told of every claim in Telegram and may undo it.
 * `blockedBy` (with start "blocked"): whose claim an administrator undid, this LINE account's or only this number's.
 */
export function ClaimPanel({
  start,
  blockedBy = null,
  phone,
  initialType = null,
  undo = false,
}: {
  start: ClaimStart;
  blockedBy?: "line" | "phone" | null;
  phone: string;
  initialType?: PhoneUserType | null;
  undo?: boolean;
}) {
  const [blocked, setBlocked] = useState<"line" | "phone" | null>(start === "blocked" ? (blockedBy ?? "phone") : null);
  const [type, setType] = useState<UserType | null>(start === "pick" ? initialType : null);
  const [names, setNames] = useState<Name[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(start === "pick" && initialType !== null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Name | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; reason: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [restart, setRestart] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnLoad = useRef(false);
  const firstRender = useRef(true);
  /** The names opened from the address (?type=) on the first render, if any. */
  const openedFromAddress = useRef(start === "pick" ? initialType : null);
  /** Whether the first render shows the positions or names (not a blocked number or an error). */
  const choosing = useRef(start === "pick");

  // A new step or state: its heading takes focus (not on the first render, which must not steal focus).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [type, blocked, restart]);

  // A message above the list takes focus, so it is read where the user is (the button that was pressed may be gone).
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // After "ลองอีกครั้ง" the retry button disappears with the error: focus goes to the search field instead.
  useEffect(() => {
    if (names && focusSearchOnLoad.current) {
      focusSearchOnLoad.current = false;
      searchRef.current?.focus();
    }
  }, [names]);

  // The phone's Back (and Forward) button moves between the two steps. The entries keep the page's address (a new
  // ?type= would make Next.js fetch the page again), so on a reload, or a return that reloads the page, the entry's own
  // state decides the step: its position, or step 1. Only names opened from the address on a first arrival get the
  // entry for step 1 put under them. Written once hydration is over: Next.js wraps history.pushState/replaceState (to
  // keep its own state in each entry) only in its own effects, which run after this one, and an entry without that
  // state makes Back reload the page.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!choosing.current) return;
      const opened = openedFromAddress.current;
      const entry = historyType();
      if (entry) {
        if (entry !== opened) openType(entry);
      } else if (atTypesEntry()) {
        if (opened) closeTypes();
      } else if (opened) {
        window.history.replaceState({ claimTypes: true }, "");
        window.history.pushState({ claimType: opened }, "");
      }
    }, 0);
    const onPop = (e: PopStateEvent) => {
      const t = (e.state as { claimType?: unknown } | null)?.claimType;
      if (isUserType(t)) openType(t);
      else closeTypes();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // The names of the chosen type, read fresh each time (whether a name is taken changes). A re-read keeps the shown
  // list (and the focus in it) until the new one arrives.
  useEffect(() => {
    if (!type) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/auth/claim/list?type=${type}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { names?: Name[]; error?: string; reason?: string; redirect?: string };
        if (!alive) return;
        // Doctors sign in by email (never by number).
        if (data.reason === "doctor_email" && data.redirect) {
          window.location.assign(data.redirect);
          return;
        }
        if (res.status === 401) setRestart(data.error ?? EXPIRED_MESSAGE);
        else if (res.ok && Array.isArray(data.names)) {
          setLoadError(null);
          setNames(data.names);
        } else setLoadError(data.error ?? NETWORK_ERROR);
      } catch {
        if (alive) setLoadError(NETWORK_ERROR);
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [type, reload]);

  const shown = useMemo(
    () => (names ?? []).filter((n) => matchesName(query, n.first_name, n.last_name)),
    [names, query],
  );

  function openType(t: UserType) {
    setNames(null);
    setLoadError(null);
    setLoading(true);
    setError(null);
    setType(t); // the search text stays: a name typed under the wrong position is searched again under this one
  }

  function closeTypes() {
    setType(null);
    setNames(null);
    setLoadError(null);
    setError(null);
  }

  function pickType(t: UserType) {
    window.history.pushState({ claimType: t }, "");
    openType(t);
  }

  /** "เปลี่ยน" and "ลองตำแหน่งอื่น": the same as the Back button when step 2 has its history entry. */
  function backToTypes() {
    if (historyType()) window.history.back();
    else closeTypes();
  }

  function refresh() {
    if (loading) return;
    setLoading(true);
    setReload((n) => n + 1);
  }

  function retry() {
    focusSearchOnLoad.current = true;
    refresh();
  }

  function ask(n: Name) {
    if (n.claimed) return;
    setSelected(n);
    setDialogError(null);
    // Opened once React has rendered the chosen name into the dialog.
    requestAnimationFrame(() => dialogRef.current?.showModal());
  }

  async function confirm() {
    if (!selected || busy) return;
    setBusy(true);
    setDialogError(null);
    try {
      const { status, data } = await postJson("/api/auth/claim", { userId: selected.id });
      if (status === 200 && data.ok) {
        window.location.assign(data.redirect ?? "/");
        return; // the busy state stays until the board opens
      }
      if (status === 401) {
        dialogRef.current?.close();
        setRestart(data.error ?? EXPIRED_MESSAGE);
      } else if (data.reason === "blocked") {
        dialogRef.current?.close();
        setBlocked(data.by === "line" ? "line" : "phone");
      } else if (
        data.reason === "taken" ||
        data.reason === "unavailable" ||
        data.reason === "phone_has_claim" ||
        data.reason === "line_has_claim" ||
        data.reason === "limited"
      ) {
        // Shown above the list (and focused), which is read again so a name taken meanwhile shows as taken.
        dialogRef.current?.close();
        setError({ text: data.error ?? NETWORK_ERROR, reason: data.reason });
        if (data.reason === "taken" || data.reason === "unavailable") refresh();
      } else {
        setDialogError(data.error ?? NETWORK_ERROR);
      }
    } catch {
      setDialogError(NETWORK_ERROR);
    }
    setBusy(false);
  }

  if (restart) {
    return (
      <div role="alert">
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          หมดเวลา
        </h2>
        <div className="mt-3">
          <Notice tone="warning">{restart}</Notice>
        </div>
        <a className="btn btn-primary mt-4 min-h-12 w-full" href="/login">
          เริ่มใหม่
        </a>
      </div>
    );
  }

  if (start === "error") {
    return (
      <div className="text-center" role="alert">
        <StateIcon icon="alert" tone="bad" />
        <h2 className={H2}>ระบบยังไม่พร้อม</h2>
        <p className={HELP}>กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแล</p>
        <a className="btn btn-secondary mt-4 w-full" href="/login/claim">
          ลองอีกครั้ง
        </a>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="text-center" data-testid="claim-blocked">
        <StateIcon icon="alert" tone="bad" />
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          เลือกชื่อไม่ได้ในขณะนี้
        </h2>
        <p className={`${HELP} text-left`}>{blocked === "line" ? CLAIM_BLOCKED_LINE : CLAIM_BLOCKED}</p>
        {/* Another number helps only when the block is this number's, not this LINE account's. */}
        {blocked === "phone" ? <OtherPhone /> : null}
      </div>
    );
  }

  if (!type) {
    return (
      <div data-testid="claim-types">
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          เลือกตำแหน่งของคุณ
        </h2>
        <p className={HELP}>
          ทำครั้งเดียว <span className="whitespace-nowrap">ครั้งต่อไปไม่ต้องยืนยันอีก</span>
        </p>
        <ul className="mt-4 grid gap-2">
          {USER_TYPES.map((t) => (
            <li key={t}>
              {t === "DR" ? (
                // Doctors prove their name by a code sent to their email instead.
                <a className="choice" href="/login/doctor" data-testid="claim-type-DR">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{TYPE_LABELS[t]}</span>
                    <span className="block text-[0.8125rem] leading-5 text-muted">ยืนยันตัวตนด้วยรหัสทางอีเมล</span>
                  </span>
                  <Chevron />
                </a>
              ) : (
                <button type="button" className="choice" onClick={() => pickType(t)} data-testid={`claim-type-${t}`}>
                  <span className="min-w-0 flex-1 font-semibold">{TYPE_LABELS[t]}</span>
                  <Chevron />
                </button>
              )}
            </li>
          ))}
        </ul>
        <AskAdmin className="mt-4" />
        <div>
          <OtherPhone />
        </div>
      </div>
    );
  }

  const free = names?.filter((n) => !n.claimed).length ?? 0;
  const q = query.trim();
  return (
    <div data-testid="claim-names-step">
      <h2 className={H2} ref={headingRef} tabIndex={-1}>
        เลือกชื่อของคุณ
      </h2>
      <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-line bg-white/70 py-0.5 pr-1 pl-3 text-sm">
        <span className="min-w-0 text-ink-2">
          <span className="max-[22.5rem]:sr-only">ตำแหน่ง </span>
          <strong className="font-semibold text-ink" data-testid="claim-type">
            {TYPE_LABELS[type]}
          </strong>
        </span>
        <button type="button" className="text-btn shrink-0" onClick={backToTypes} data-testid="claim-change-type">
          เปลี่ยน
        </button>
      </div>

      {/* The names flow in the page's one scroller; the search stays on top of them while they scroll by. */}
      <div className="claim-search sticky z-10 -mx-6 mt-2 px-6 pt-2 pb-2 sm:-mx-7 sm:px-7" data-testid="claim-search-bar">
        <label className={LABEL} htmlFor="claim-search">
          ค้นหาชื่อหรือนามสกุล
        </label>
        <input
          ref={searchRef}
          id="claim-search"
          className="field field-text"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="พิมพ์ชื่อหรือนามสกุล"
          maxLength={60}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={(e) => {
            // With the keyboard open, bring the field to the top so the results fill the space above the keyboard.
            const bar = e.currentTarget.parentElement;
            window.setTimeout(() => bar?.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
          }}
          aria-describedby="claim-count"
          disabled={!names}
        />
        {names ? (
          <p id="claim-count" className="mt-1.5 text-xs text-muted" role="status" data-testid="claim-count">
            {q ? `พบ ${shown.length} จาก ${names.length} รายชื่อ` : `${names.length} รายชื่อ · เลือกได้ ${free}`}
          </p>
        ) : null}
      </div>

      <div aria-live="polite">
        {error ? (
          <div className="mt-2 outline-none" data-testid="claim-error" ref={errorRef} tabIndex={-1}>
            <Notice tone="warning" role="alert">
              {error.text}
            </Notice>
          </div>
        ) : null}
      </div>

      {loadError ? (
        <div className="mt-3">
          <Notice tone="warning" role="alert">
            {loadError}
          </Notice>
          <button
            type="button"
            className="btn btn-secondary mt-3 w-full"
            onClick={retry}
            aria-disabled={loading || undefined}
            aria-busy={loading || undefined}
          >
            {loading ? "กำลังโหลด…" : "ลองอีกครั้ง"}
          </button>
        </div>
      ) : !names ? (
        <p className="mt-3 text-sm text-muted" role="status">
          <span className="waiting">กำลังโหลดรายชื่อ…</span>
        </p>
      ) : shown.length ? (
        <ul className="choice-list mt-1 grid gap-1.5" data-testid="claim-names" aria-busy={loading || undefined}>
          {shown.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="choice"
                disabled={n.claimed}
                onClick={() => ask(n)}
                data-testid="claim-name"
                data-claimed={n.claimed ? "true" : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold break-words">
                    {n.first_name} {n.last_name}
                  </span>
                  {n.subtype_label ? <span className="block text-[0.8125rem] leading-5 text-muted">{n.subtype_label}</span> : null}
                  {n.claimed ? (
                    <span className="mt-1 flex">
                      <span className="badge badge-muted">มีผู้เลือกแล้ว</span>
                    </span>
                  ) : null}
                </span>
                {n.claimed ? null : <Chevron />}
              </button>
            </li>
          ))}
        </ul>
      ) : names.length ? (
        <div className="mt-1 rounded-xl border border-line bg-white/70 px-3 py-3 text-sm text-ink-2" data-testid="claim-empty">
          <p>
            ไม่พบ “<span className="font-semibold break-words text-ink">{q}</span>” ในรายชื่อ{TYPE_LABELS[type]}
          </p>
          <p className="mt-1 text-[0.8125rem] leading-5 text-muted">ลองพิมพ์เฉพาะชื่อหรือเฉพาะนามสกุล หรือเลือกตำแหน่งอื่น</p>
          <button type="button" className="text-btn mt-1 -ml-1 px-1" onClick={backToTypes} data-testid="claim-other-type">
            ลองตำแหน่งอื่น
          </button>
        </div>
      ) : (
        <p className="mt-1 rounded-xl border border-line bg-white/70 px-3 py-3 text-sm text-ink-2" data-testid="claim-empty">
          ยังไม่มีรายชื่อในตำแหน่งนี้
        </p>
      )}

      <AskAdmin className="mt-4" />
      <div>
        <OtherPhone />
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="claim-confirm-title claim-confirm-name"
        aria-describedby="claim-confirm-note"
        className={DIALOG}
        data-testid="claim-confirm"
        onCancel={(e) => busy && e.preventDefault()}
        onClose={() => setSelected(null)}
      >
        <h2 id="claim-confirm-title" className="text-lg leading-snug font-bold">
          ยืนยันว่าคุณคือ
        </h2>
        <div className="mt-3 rounded-xl border border-line bg-white/80 px-4 py-3">
          <p id="claim-confirm-name" className="text-lg leading-snug font-bold break-words text-ink" data-testid="claim-confirm-name">
            {selected ? `${selected.first_name} ${selected.last_name}` : ""}
          </p>
          <p className="mt-0.5 text-sm text-ink-2" data-testid="claim-confirm-role">
            {TYPE_LABELS[type]}
            {selected?.subtype_label ? ` · ${selected.subtype_label}` : ""}
          </p>
        </div>
        <Notice tone="info" className="mt-3">
          <span id="claim-confirm-note">
            ชื่อนี้จะผูกกับเบอร์ <strong className="whitespace-nowrap text-ink tabular-nums">{phone}</strong> และบัญชี LINE นี้
            แล้วผู้อื่นจะเลือกชื่อนี้ไม่ได้อีก
            {undo ? (
              <> ผู้ดูแลจะได้รับแจ้งทันที หากไม่ใช่ชื่อของคุณ ผู้ดูแลจะยกเลิก และเบอร์นี้กับบัญชี LINE นี้จะเลือกชื่อใหม่ไม่ได้ 24&nbsp;ชั่วโมง</>
            ) : (
              <>
                {" "}
                หากเลือกผิด <span className="whitespace-nowrap">กรุณาติดต่อผู้ดูแล</span>
              </>
            )}
          </span>
        </Notice>
        {dialogError ? (
          <Notice tone="warning" role="alert" className="mt-3">
            {dialogError}
          </Notice>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" autoFocus className="btn btn-secondary" onClick={() => dialogRef.current?.close()} disabled={busy}>
            ยกเลิก
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy} aria-busy={busy} data-testid="claim-confirm-yes">
            {busy ? "กำลังยืนยัน…" : "ใช่ นี่คือชื่อของฉัน"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
