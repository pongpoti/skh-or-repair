"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type Ref, type SyntheticEvent } from "react";
import { InlineStatus } from "@/components/inline-status";

/** Hospital numbers here are exactly seven digits. */
export const HN_DIGITS = 7;

const THAI_DIGITS = /[๐-๙]/g;

/** Digits only: NFKC, Thai digits (๐-๙) as Arabic, everything that is not 0-9 dropped. */
export function hnDigits(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(THAI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/[^0-9]/g, "");
}

type BoxState = "empty" | "filled" | "active" | "picked";

const BOX =
  "relative flex h-13 max-w-12 min-w-0 flex-1 items-center justify-center rounded-xl border text-2xl font-semibold text-ink tabular-nums motion-safe:transition-[border-color,background-color,box-shadow] motion-safe:duration-150";

/**
 * Each box's edge and fill. The box the next digit goes into has a doubled brown edge and a soft halo (the field's
 * focus mark: the page's blue outline would ring the whole row instead); a selected run of digits is tinted like a
 * picked option; an HN the form refused is red throughout.
 */
const TONE: Record<"ok" | "bad", Record<BoxState, string>> = {
  ok: {
    empty: "border-line-strong bg-surface",
    filled: "border-brand bg-white",
    active: "border-brand bg-white shadow-[inset_0_0_0_1px_var(--brand)] ring-4 ring-brand/15",
    picked: "border-brand bg-brand-tint shadow-[inset_0_0_0_1px_var(--brand)]",
  },
  bad: {
    empty: "border-[var(--stop)] bg-[rgb(253_236_234/0.5)]",
    filled: "border-[var(--stop)] bg-white",
    active: "border-[var(--stop)] bg-white shadow-[inset_0_0_0_1px_var(--stop)] ring-4 ring-[rgb(163_39_27/0.15)]",
    picked: "border-[var(--stop)] bg-[rgb(253_236_234)] shadow-[inset_0_0_0_1px_var(--stop)]",
  },
};

/** A number longer than seven digits that the field turned away, while the HN is still the one it kept. */
type Refused = { at: string; keystroke: boolean; count: number };

/**
 * The patient's HN as seven digits in a row of boxes, on a card that floats above the booking form (Pong, 15 Nov 2026:
 * "for HN input: redesign to be 7 digits OTP-like floating card").
 *
 * One real input lies, transparent, over the boxes, so a tap anywhere on them opens the number pad, and paste,
 * backspace, select all and screen readers work as in any text box; the boxes only draw its digits. The caret always
 * waits after the last digit, because the boxes do not line up with the text under them and a tap would otherwise put
 * it somewhere the boxes cannot show. The field keeps no list of HNs (autocomplete off) and has no maxLength: a longer
 * number is turned away with a line under the boxes, never cut short, since a number cut short could be another
 * patient's.
 */
export function HnField({
  id,
  value,
  onChange,
  inputRef,
  invalid = false,
  describedBy,
  testId,
}: {
  id: string;
  /** 0 to 7 digits. */
  value: string;
  onChange: (digits: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** The form refused this HN (missing or not found); the boxes turn red and the input says so to screen readers. */
  invalid?: boolean;
  /** The id of the form's own message about the HN, if any. */
  describedBy?: string;
  /** Goes on the real input. */
  testId?: string;
}) {
  const [focused, setFocused] = useState(false);
  // A selected run of digits (select all, a long press), drawn as tinted boxes; null while the caret is after the last.
  const [picked, setPicked] = useState<readonly [number, number] | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // The booking dialog stays mounted between openings and starts each one with an empty HN, the same value a long
  // number pasted into an empty field left behind; without this, that refusal would still show, red, on the next
  // opening.
  useEffect(() => {
    const dialog = cardRef.current?.closest("dialog");
    if (!dialog) return;
    const reset = () => {
      setRefused(null);
      setPicked(null);
    };
    dialog.addEventListener("close", reset);
    return () => dialog.removeEventListener("close", reset);
  }, []);

  // The line lasts while the HN is the one kept when the long number came in; any change to the HN ends it.
  const tooLong = refused !== null && refused.at === value;
  const bad = invalid || tooLong;
  const noteId = `${id}-too-long`;
  const full = value.length >= HN_DIGITS;
  const next = Math.min(value.length, HN_DIGITS - 1);
  const from = picked && focused ? Math.min(picked[0], value.length) : 0;
  const to = picked && focused ? Math.min(picked[1], value.length) : 0;

  function follow(event: SyntheticEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const end = input.value.length;
    const start = input.selectionStart ?? end;
    const stop = input.selectionEnd ?? start;
    if (start !== stop) {
      setPicked([start, stop]);
      return;
    }
    if (start !== end) input.setSelectionRange(end, end);
    setPicked(null);
  }

  function change(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.currentTarget.value;
    const digits = hnDigits(raw);
    // Any edit leaves the caret collapsed; the selection it replaced is gone.
    setPicked(null);
    if (digits.length > HN_DIGITS) {
      const native = event.nativeEvent as Partial<InputEvent>;
      // A whole HN put in at once (a keyboard's clipboard suggestion, an autofill tool, select all then a new number
      // on a phone that loses the selection) is the HN meant: it replaces the one in the boxes. Anything else that
      // would make the row longer is kept as it was (React puts the input back to `value`).
      const inserted = typeof native.data === "string" ? hnDigits(native.data) : "";
      if (inserted.length === HN_DIGITS) {
        setRefused(null);
        onChange(inserted);
        return;
      }
      // One character typed onto a full row is a typed digit; a paste, a drop, or several characters at once is a
      // pasted number. Without an InputEvent, one character more than before counts as typed.
      const kind = native.inputType ?? "";
      const keystroke = kind.startsWith("insertFrom")
        ? false
        : typeof native.data === "string"
          ? [...native.data].length === 1
          : raw.length === value.length + 1;
      setRefused((prev) => ({ at: value, keystroke, count: (prev?.count ?? 0) + 1 }));
      return;
    }
    // A key that is not a digit (a dash or dot on some number pads, a space) changes nothing: React puts the input
    // back, and the form's own message about this HN and any refusal line under the boxes stay, since the HN is the same.
    if (digits === value) return;
    setRefused(null);
    onChange(digits);
  }

  // A pasted HN of exactly seven digits ("700-0002", "HN 7000002") is the HN meant, wherever the caret is: it replaces
  // the boxes rather than joining what is there. Other pastes go through change() as usual.
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = hnDigits(event.clipboardData.getData("text"));
    if (pasted.length !== HN_DIGITS) return;
    event.preventDefault();
    setPicked(null);
    setRefused(null);
    if (pasted !== value) onChange(pasted);
  }

  const described = [describedBy, tooLong ? noteId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div ref={cardRef} className="rounded-2xl bg-white p-3 shadow-[0_18px_40px_-18px_rgb(41_29_20/0.35),0_4px_12px_-6px_rgb(41_29_20/0.16)] ring-1 ring-line min-[360px]:p-4">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-ink">HN ผู้ป่วย</span>
        <span className="text-xs text-muted">{HN_DIGITS} หลัก</span>
      </label>

      <div className="relative mt-2.5">
        <div aria-hidden="true" className="flex justify-center gap-1 min-[360px]:gap-1.5 min-[400px]:gap-2">
          {Array.from({ length: HN_DIGITS }, (_, index) => {
            const digit = value[index] ?? "";
            const state: BoxState =
              focused && to > from && index >= from && index < to
                ? "picked"
                : focused && to === from && index === next
                  ? "active"
                  : digit
                    ? "filled"
                    : "empty";
            return (
              <span key={index} className={`${BOX} ${TONE[bad ? "bad" : "ok"][state]}`}>
                {digit}
                {state === "active" ? (
                  // A blinking caret (the stepped pulse from globals.css, so it blinks rather than fades), steady when
                  // the phone asks for less motion. On a full row it stands after the last digit.
                  <span
                    className={`absolute top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full motion-safe:animate-[pulse_1s_steps(1,end)_infinite] ${
                      bad ? "bg-[var(--stop)]" : "bg-brand"
                    } ${full ? "left-[calc(50%+0.45em)]" : "left-1/2 -translate-x-1/2"}`}
                  />
                ) : null}
              </span>
            );
          })}
        </div>
        {/*
          The real input, laid over the boxes with its text, caret and selection transparent. 16px text keeps iOS from
          zooming in on focus. No name and autocomplete off: the browser must never keep a list of patients' HNs.
        */}
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={change}
          onPaste={paste}
          onSelect={follow}
          onFocus={(event) => {
            setFocused(true);
            follow(event);
          }}
          onBlur={() => {
            setFocused(false);
            setPicked(null);
          }}
          aria-invalid={bad || undefined}
          aria-describedby={described}
          className="absolute inset-0 z-10 size-full cursor-text appearance-none rounded-xl border-0 bg-transparent p-0 text-base text-transparent caret-transparent outline-none! selection:bg-transparent selection:text-transparent"
          data-testid={testId}
        />
      </div>

      {tooLong ? (
        // Keyed by the try, so a second long number is announced again even though the words are the same.
        <div key={refused.count} id={noteId} className="mt-2">
          <InlineStatus tone="warning" role="alert" testId={testId ? `${testId}-too-long` : undefined}>
            {refused.keystroke ? `HN มี ${HN_DIGITS} หลัก ตรวจเลขอีกครั้ง` : `HN มี ${HN_DIGITS} หลัก ตรวจเลขที่วางอีกครั้ง`}
          </InlineStatus>
        </div>
      ) : null}
    </div>
  );
}
