"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@/components/auth-shell";
import { waitText } from "@/lib/format";
import { matchesName } from "@/lib/user-labels";
import { EXPIRED_MESSAGE, H2, HELP, LABEL } from "../request/request-panel";
import { cleanCode, NETWORK_ERROR, postJson, StepHeading } from "../verify/verify-form";

/** One doctor on the page: no address, only whether one is on file. */
export interface DoctorChoice {
  id: string;
  first_name: string;
  last_name: string;
  subtype_label: string | null;
  has_email: boolean;
}

/** Answers of /api/auth/email/send and /verify (see verify-form ApiResult for the shared fields). */
interface EmailResult {
  ok?: boolean;
  error?: string;
  reason?: string;
  cooldown?: number;
  retryAfter?: number;
  codePending?: boolean;
  restart?: boolean;
  redirect?: string;
  to?: string[];
}

type Step = "pick" | "send" | "code";

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

async function post(url: string, body: unknown): Promise<{ status: number; data: EmailResult }> {
  const { status, data } = await postJson(url, body);
  return { status, data: data as EmailResult };
}

/** Pick your name, have a code emailed to you, type it in. `back` is the way to the SMS sign-in. */
export function DoctorPanel({ names, back }: { names: DoctorChoice[] | null; back: string }) {
  const [step, setStep] = useState<Step>("pick");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DoctorChoice | null>(null);
  const [sentTo, setSentTo] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [locked, setLocked] = useState(false);
  const [restart, setRestart] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // A new step: the code field, or the step's heading, takes focus (not on the first render).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (step === "code") codeRef.current?.focus();
    else headingRef.current?.focus();
  }, [step]);

  const shown = useMemo(() => (names ?? []).filter((n) => matchesName(query, n.first_name, n.last_name)), [names, query]);

  function pick(n: DoctorChoice) {
    if (!n.has_email) return;
    if (selected?.id !== n.id) {
      setSentTo(null);
      setCooldown(0);
    }
    setSelected(n);
    setError(null);
    setCode("");
    setLocked(false);
    setStep("send");
  }

  function backToNames() {
    setStep("pick");
    setError(null);
  }

  async function sendCode() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await post("/api/auth/email/send", { userId: selected.id });
      if (status === 200 && data.ok) {
        setSentTo(data.to ?? []);
        setCooldown(data.cooldown ?? 60);
        setCode("");
        setLocked(false);
        if (step === "code") codeRef.current?.focus();
        setStep("code");
        return;
      }
      if (status === 401 || data.restart) {
        setRestart(data.error ?? EXPIRED_MESSAGE);
        return;
      }
      setError(data.error ?? NETWORK_ERROR);
      if (data.retryAfter) setCooldown(Math.min(data.retryAfter, 24 * 3600));
      // A code sent before is still usable: let the doctor type it in.
      if (status === 429 && data.codePending) {
        setLocked(false);
        setStep("code");
      }
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (!selected || busy || locked || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await post("/api/auth/email/verify", { userId: selected.id, code: value });
      if (status === 200 && data.ok) {
        window.location.assign(data.redirect ?? "/");
        return; // the busy state stays until the board opens
      }
      if (status === 401 || data.restart) {
        setRestart(data.error ?? EXPIRED_MESSAGE);
        return;
      }
      setError(data.error ?? NETWORK_ERROR);
      setCode("");
      if (data.reason === "locked" || data.reason === "expired") setLocked(true);
      else codeRef.current?.focus();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(raw: string) {
    const v = cleanCode(raw);
    setCode(v);
    if (v.length === 6) void verify(v);
  }

  if (restart) {
    return (
      <div role="alert">
        <h2 className={H2}>หมดเวลา</h2>
        <div className="mt-3">
          <Notice tone="warning">{restart}</Notice>
        </div>
        <a className="btn btn-primary mt-4 min-h-12 w-full" href="/login">
          เข้าสู่ระบบด้วย LINE อีกครั้ง
        </a>
      </div>
    );
  }

  const smsLink = (
    <a className="text-btn -ml-1.5 mt-3 h-auto min-h-11 py-2 text-left leading-6" href={back} data-testid="doctor-sms-link">
      ไม่ใช่แพทย์? ยืนยันด้วยเบอร์มือถือ
    </a>
  );

  if (!names) {
    return (
      <div role="alert">
        <Notice tone="warning">ระบบยังไม่พร้อม กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแล</Notice>
        <a className="btn btn-secondary mt-4 w-full" href="/login/doctor">
          ลองอีกครั้ง
        </a>
      </div>
    );
  }

  const selectedBox = selected ? (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-line bg-white/70 py-1.5 pr-1 pl-3 text-sm">
      <span className="min-w-0">
        <strong className="block font-semibold break-words text-ink" data-testid="doctor-selected">
          {selected.first_name} {selected.last_name}
        </strong>
        {selected.subtype_label ? <span className="block text-[0.8125rem] leading-5 text-muted">{selected.subtype_label}</span> : null}
      </span>
      <button type="button" className="text-btn shrink-0" onClick={backToNames} data-testid="doctor-change">
        เปลี่ยน
      </button>
    </div>
  ) : null;

  const errorBox = error ? (
    <div className="mt-3" data-testid="doctor-error">
      <Notice tone="warning" role="alert">
        {error}
      </Notice>
    </div>
  ) : null;

  if (step === "send" && selected) {
    return (
      <div data-testid="doctor-send-step">
        <h2 className={H2} ref={headingRef} tabIndex={-1}>
          ส่งรหัสทางอีเมล
        </h2>
        {selectedBox}
        <p className={HELP}>
          รหัส 6&nbsp;หลักจะส่งไปที่อีเมลของคุณในรายชื่อแพทย์ ครั้งต่อไปเข้าด้วย LINE ได้ทันที
        </p>
        {errorBox}
        <button
          className="btn btn-primary mt-4 min-h-12 w-full"
          type="button"
          onClick={() => void sendCode()}
          disabled={busy || cooldown > 0}
          data-testid="doctor-send"
        >
          {busy ? "กำลังส่ง…" : cooldown > 0 ? `ส่งรหัสได้ใน ${waitText(cooldown)}` : "ส่งรหัสทางอีเมล"}
        </button>
        {smsLink}
      </div>
    );
  }

  if (step === "code" && selected) {
    return (
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
        noValidate
        data-testid="doctor-code-step"
      >
        <StepHeading>กรอกรหัส 6&nbsp;หลักจากอีเมล</StepHeading>
        {selectedBox}
        {sentTo?.length ? (
          <div id="email-info" className="mt-3" data-testid="doctor-sent-to">
            <Notice tone="success" role="status">
              ส่งรหัสไปที่{" "}
              {sentTo.map((to, i) => (
                <span key={to}>
                  {i ? ", " : null}
                  <strong className="font-semibold break-all">{to}</strong>
                </span>
              ))}{" "}
              แล้ว
            </Notice>
          </div>
        ) : null}
        <p id="email-code-help" className={HELP}>
          รหัสใช้ได้ 10&nbsp;นาที หากไม่พบอีเมล ลองดูในโฟลเดอร์จดหมายขยะ (Junk หรือ Spam)
        </p>
        <label className={`${LABEL} mt-4`} htmlFor="email-code">
          รหัสยืนยัน
        </label>
        <input
          ref={codeRef}
          id="email-code"
          name="code"
          className="field field-text min-h-14 text-center text-2xl font-bold tracking-[0.4em] tabular-nums placeholder:tracking-[0.3em]"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          enterKeyHint="done"
          aria-describedby={[sentTo?.length ? "email-info" : null, "email-code-help"].filter(Boolean).join(" ")}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          disabled={locked}
          placeholder="••••••"
          data-testid="doctor-code"
        />
        <div aria-live="polite">{errorBox}</div>
        <button className="btn btn-primary mt-4 min-h-12 w-full" type="submit" disabled={busy || locked || code.length !== 6}>
          {busy ? "กำลังตรวจสอบ…" : "ยืนยันรหัส"}
        </button>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="text-btn -mr-1.5"
            onClick={() => void sendCode()}
            disabled={cooldown > 0}
            aria-disabled={busy || undefined}
            data-testid="doctor-resend"
          >
            {cooldown > 0 ? `ส่งรหัสอีกครั้งได้ใน ${waitText(cooldown)}` : "ส่งรหัสอีกครั้ง"}
          </button>
        </div>
      </form>
    );
  }

  const q = query.trim();
  return (
    <div data-testid="doctor-pick-step">
      <h2 className={H2} ref={headingRef} tabIndex={-1}>
        เลือกชื่อของคุณ
      </h2>
      <p className={HELP}>เลือกชื่อของคุณ แล้วระบบจะส่งรหัสไปที่อีเมลของคุณ</p>
      <div className="claim-search sticky z-10 -mx-6 mt-2 px-6 pt-2 pb-2 sm:-mx-7 sm:px-7">
        <label className={LABEL} htmlFor="doctor-search">
          ค้นหาชื่อหรือนามสกุล
        </label>
        <input
          id="doctor-search"
          className="field field-text"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="พิมพ์ชื่อหรือนามสกุล"
          maxLength={60}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby="doctor-count"
          data-testid="doctor-search"
        />
        <p id="doctor-count" className="mt-1.5 text-xs text-muted" role="status">
          {q ? `พบ ${shown.length} จาก ${names.length} รายชื่อ` : `${names.length} รายชื่อ`}
        </p>
      </div>
      {shown.length ? (
        <ul className="choice-list mt-1 grid gap-1.5" data-testid="doctor-names">
          {shown.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="choice"
                disabled={!n.has_email}
                onClick={() => pick(n)}
                data-testid="doctor-name"
                data-no-email={n.has_email ? undefined : "true"}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold break-words">
                    {n.first_name} {n.last_name}
                  </span>
                  {n.subtype_label ? <span className="block text-[0.8125rem] leading-5 text-muted">{n.subtype_label}</span> : null}
                  {n.has_email ? null : (
                    <span className="mt-1 flex">
                      <span className="badge badge-muted">ยังไม่มีอีเมลในระบบ ติดต่อผู้ดูแล</span>
                    </span>
                  )}
                </span>
                {n.has_email ? <Chevron /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 rounded-xl border border-line bg-white/70 px-3 py-3 text-sm text-ink-2" data-testid="doctor-empty">
          {names.length ? (
            <>
              ไม่พบ “<span className="font-semibold break-words text-ink">{q}</span>” ในรายชื่อแพทย์
            </>
          ) : (
            "ยังไม่มีรายชื่อแพทย์"
          )}
        </p>
      )}
      {smsLink}
    </div>
  );
}
