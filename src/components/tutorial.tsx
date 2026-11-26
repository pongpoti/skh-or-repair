"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { seeTutorial, type CaseResult } from "@/app/(board)/actions";
import { NoteIcon } from "@/components/case-list";
import { CaseSymbol } from "@/components/case-source";
import { NoTableIcon } from "@/components/no-table-icon";
import { Mascot, talkFor, type MascotMood } from "@/components/mascot";
import { SuiteBoard, type BoardView, type CaseAdding } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { bookedMessage, bookingChange, checkCase, editedMessage, type AddedCase } from "@/lib/added-cases";
import { allocationFor, DEPARTMENTS, INSTRUMENT_ROOM, readableTextOn, RECOVERY_ROOM, type Department } from "@/lib/allocation";
import { boardNotices } from "@/lib/board-notices";
import { thaiDate } from "@/lib/days";
import type { Holiday } from "@/lib/holidays";
import { isDressingCase } from "@/lib/placement";
import { BOARD_PATH } from "@/lib/places";
import type { RepairPeriods } from "@/lib/repair";
import { getRoom, openRooms, roomLabel } from "@/lib/rooms";
import {
  AUTO_DRESSING_OPERATION,
  DRESSING_EXAMPLES,
  LONG_OPERATION,
  practiceRoom,
  TUTORIAL_COOKIE,
  TUTORIAL_ME,
  TUTORIAL_NOTICE,
  tutorialBoard,
  tutorialCases,
  type TutorialPhase,
} from "@/lib/tutorial";

/**
 * The doctors' tutorial (Pong, 19 Nov 2026: "create user-friendly step-by-step interactive tutorial guide with dummy
 * example (just like start of mobile game app), also explain details of symbols. Note that this tutorial is for DR role
 * only"). The real board (TopBar, SuiteBoard and the booking form) on a made-up day (lib/tutorial.ts), with a coach over
 * it as a phone game's first run has: the screen dimmed but for the one thing to look at or tap, a speech bubble from the
 * app's surgeon, a pointing hand on what to tap, a progress bar by chapter, and confetti when a booking is made and at
 * the end. The doctor makes a practice booking (kept in this page only; the booking form's save is replaced), sees the
 * day before and after MX's 16:00 upload, and is told what each icon, mark and colour means. Nothing is saved but the
 * note that the doctor has seen it (actions.ts seeTutorial), which stops the board from opening it by itself again.
 */

type Box = { x: number; y: number; w: number; h: number };

type Mode = "info" | "tap" | "do";

type CardKind = "welcome" | "plan-symbols" | "priority" | "row-symbols" | "upload" | "dressing-rule" | "examples" | "finish";

type Step = {
  id: string;
  /** Index into CHAPTERS. */
  chapter: number;
  title?: string;
  body?: ReactNode;
  /** A card in the middle of the screen instead of a bubble beside a target. */
  card?: CardKind;
  /** What the spotlight is on; missing for a card. */
  target?: () => Element | null;
  /** info: read, then ถัดไป; tap: tap the lit thing, which moves on by itself; do: use the lit thing, then ถัดไป. */
  mode?: Mode;
  /** tap: the tap has done its work (move on); do: ถัดไป can be pressed. */
  done?: () => boolean;
  /** Puts the board as the step needs it (a room open, the form open); again if the target goes missing. */
  setup?: () => void;
  /** Left out when it would show nothing (a name that fits on its line, a day with no repair zone). */
  skip?: () => boolean;
  /** Scrolls the target into view inside its list or dialog. */
  scroll?: ScrollLogicalPosition;
  /** The field to focus, for typing. */
  focus?: () => HTMLElement | null;
  /** A ready answer the doctor can put in with one tap. */
  example?: { label: string; fill: () => void };
  hand?: "tap" | "swipe";
  round?: boolean;
  pad?: number;
  confetti?: boolean;
};

const CHAPTERS = ["แปลนห้อง", "จองห้อง", "ดูการจอง", "หลังอัปโหลด HOSxP", "ห้องทำแผล", "ตัวอย่างจริง", "จบบทเรียน"] as const;

const EXAMPLE_HN = "1234567";
/** The short name surgeons type (Pong, 20 Nov 2026: "For พิมพ์ชื่อผ่าตัด change from lap chole to LC"). */
const EXAMPLE_OPERATION = "LC";

// ---------------------------------------------------------------------------------------------------------------------
// The page's own elements, found as the board draws them.

function find(selector: string, root: ParentNode | null = document): HTMLElement | null {
  return root?.querySelector<HTMLElement>(selector) ?? null;
}

function sheet(): HTMLElement | null {
  return find("aside[data-room-view]");
}

function caseRows(): HTMLElement[] {
  return Array.from(sheet()?.querySelectorAll<HTMLElement>("li.case-row") ?? []);
}

/** The doctor's own row: the only one with an HN. */
function myRow(): HTMLElement | null {
  return sheet()?.querySelector("[data-testid=row-hn]")?.closest<HTMLElement>("li.case-row") ?? null;
}

/** The colleague's booking with the long name and the note. */
function colleagueRow(): HTMLElement | null {
  return caseRows().find((row) => row.querySelector("[data-op-id]")?.textContent === LONG_OPERATION) ?? null;
}

/** HOSxP's case nobody booked that the board put in the dressing room by its name. */
function autoDressingRow(): HTMLElement | null {
  return caseRows().find((row) => row.querySelector("[data-op-id]")?.textContent === AUTO_DRESSING_OPERATION) ?? null;
}

function floor(roomId: string): Element | null {
  return document.querySelector(`g#${CSS.escape(roomId)} > path.fp-floor`);
}

function roomShown(roomId: string): boolean {
  return document.querySelector(`g#${CSS.escape(roomId)}.is-selected`) !== null && find("[data-testid=room-close]") !== null;
}

function dialogOpen(testId: string): boolean {
  return document.querySelector(`dialog[data-testid="${testId}"][open]`) !== null;
}

/** A click as a tap makes it: SVG paths have no click(). */
function press(element: Element | null) {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}

function openRoom(roomId: string) {
  if (!roomShown(roomId)) press(floor(roomId));
}

function closeRoom() {
  closeDialog("room-full");
  closeDialog("case-note-dialog");
  find("[data-testid=room-close]")?.click();
}

function closeDialog(testId: string) {
  const dialog = document.querySelector<HTMLDialogElement>(`dialog[data-testid="${testId}"][open]`);
  dialog?.close();
}

function openForm() {
  if (!dialogOpen("add-case-dialog")) find("[data-testid=add-case-button]")?.click();
}

/** Types into a field as a person would, so the form's own handlers run. */
function fill(field: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!field) return;
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The modal dialog on top, which makes the rest of the page inert: the coach goes inside it. */
function topModal(): HTMLDialogElement | null {
  let found: HTMLDialogElement | null = null;
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) {
    let modal = true;
    try {
      modal = dialog.matches(":modal");
    } catch {
      // A browser without :modal: every open dialog here is modal.
    }
    if (modal) found = dialog;
  }
  return found;
}

/**
 * A dialog still sliding in has a transform, which would place the coach's fixed layer against the dialog rather than
 * the screen: the coach waits for it.
 */
function settled(dialog: Element): boolean {
  try {
    return dialog.getAnimations().every((animation) => animation.playState !== "running");
  } catch {
    return true;
  }
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

// ---------------------------------------------------------------------------------------------------------------------

export function Tutorial({
  first,
  seenKey,
  doctor,
  ownSubtype,
  profile,
  today: todayProp,
  day: dayProp,
  holidays,
  unlisted,
  periods,
}: {
  /** The board sent the doctor here on their first visit: the welcome offers to skip, and starting or skipping notes it. */
  first: boolean;
  /** The doctor's users.id, for the seen cookie (null for an admin who is not a doctor). */
  seenKey: string | null;
  /** The doctor's name and the department the practice booking goes by (lib/tutorial.ts practiceSubtype). */
  doctor: { name: string; subtype: string };
  /** The doctor's own department, when it is not the practice one (obstetrics during the repair). */
  ownSubtype: string | null;
  profile: { name: string; role: string | null; image: string | null };
  today: string;
  /** The made-up day: the first day the doctor could book. */
  day: string;
  holidays: readonly Holiday[];
  unlisted: readonly number[];
  periods: RepairPeriods;
}) {
  const router = useRouter();
  // The made-up day stays the one the tutorial opened on: opening a room re-renders the page on the server, and after
  // 15:00 it would name the next day and leave the practice booking behind.
  const [today] = useState(todayProp);
  const [day] = useState(dayProp);
  const [phase, setPhase] = useState<TutorialPhase>("before");
  const [mine, setMine] = useState<AddedCase | null>(null);
  const [index, setIndex] = useState(0);
  // A new run of the tutorial (เล่นอีกครั้ง) starts the board afresh.
  const [run, setRun] = useState(0);

  const built = useMemo(() => tutorialBoard({ date: day, today, periods, doctor, mine, phase }), [day, today, periods, doctor, mine, phase]);
  const board: BoardView = {
    date: day,
    rows: built.rows,
    uploaded: built.uploaded,
    mismatchCount: built.mismatchCount,
    mismatchByRoom: built.mismatchByRoom,
  };
  const notices = useMemo(
    () => (phase === "before" ? [TUTORIAL_NOTICE, ...boardNotices({ missingUpload: day })] : [TUTORIAL_NOTICE]),
    [phase, day],
  );

  // The practice booking stays in this page: the form's save and cancel are stood in for here, with the same checks.
  const onAdd = useCallback(
    async (input: unknown): Promise<CaseResult> => {
      const checked = checkCase(input, { today, earliest: day, periods, subtype: doctor.subtype, holidays });
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (!checked.ok) return { ok: false, error: checked.error };
      const { value } = checked;
      const booking: AddedCase = {
        ...value,
        id: TUTORIAL_ME,
        surgeonId: TUTORIAL_ME,
        surgeon: doctor.name,
        subtype: doctor.subtype,
        bookedAt: new Date().toISOString(),
      };
      setMine(booking);
      return { ok: true, mine: [booking], message: bookedMessage(value) };
    },
    [today, day, periods, doctor, holidays],
  );
  // The row's จัดการ edits it the same way; the coach never sends the doctor there, so these only stand in.
  const onEdit = useCallback(
    async (id: string, input: unknown): Promise<CaseResult> => {
      if (mine === null || mine.id !== id) return { ok: false, error: "การจองนี้ถูกยกเลิกไปแล้ว", mine: [] };
      const editing = { ...mine, subtype: doctor.subtype };
      const checked = checkCase(input, { today, earliest: day, periods, subtype: doctor.subtype, holidays, editing });
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (!checked.ok) return { ok: false, error: checked.error };
      const change = bookingChange(editing, checked.value, periods);
      if (!change.changed) return { ok: true, mine: [mine], message: "ไม่มีอะไรเปลี่ยน" };
      const now = new Date().toISOString();
      const booking: AddedCase = { ...mine, ...checked.value, shift: mine.shift, editedAt: now, ...(change.requeue ? { bookedAt: now } : {}) };
      setMine(booking);
      return { ok: true, mine: [booking], message: editedMessage(checked.value, mine, change) };
    },
    [mine, today, day, periods, doctor, holidays],
  );
  const cancelled = useRef<AddedCase | null>(null);
  const onRemove = useCallback(async (): Promise<CaseResult> => {
    cancelled.current = mine;
    setMine(null);
    return { ok: true, mine: [], message: "ยกเลิกแล้ว" };
  }, [mine]);
  const onRestore = useCallback(async (): Promise<CaseResult> => {
    const back = cancelled.current;
    cancelled.current = null;
    if (back === null) return { ok: false, error: "เลิกทำไม่ได้แล้ว จองใหม่แทน", mine: [] };
    setMine(back);
    return { ok: true, mine: [back], message: "จองคืนแล้ว คิวเดิม" };
  }, []);
  const mineList = useMemo(() => (mine ? [mine] : []), [mine]);
  const adding: CaseAdding = useMemo(
    () => ({ doctor, today, earliest: day, holidays, unlisted, mine: mineList, onAdd, onEdit, onRemove, onRestore }),
    [doctor, today, day, holidays, unlisted, mineList, onAdd, onEdit, onRemove, onRestore],
  );

  // The rooms the steps point at.
  const roomId = practiceRoom(doctor.subtype, day, periods) ?? "or-12";
  const made = useMemo(() => tutorialCases({ date: day, today, periods, doctor, mine: null }).bookings, [day, today, periods, doctor]);
  const goneRoom = made.find((item) => item.id === "tutorial-gone")?.roomId ?? null;
  const dressingRoom = made.find((item) => item.id === "tutorial-dressing")?.roomId ?? null;
  const label = (id: string | null) => {
    const room = getRoom(id);
    return room ? roomLabel(room) : (id ?? "");
  };
  const roomName = label(roomId);
  // The practice room is not the doctor's own department's (obstetrics during the repair, or no department of theirs).
  const stand = ownSubtype === null || practiceRoom(ownSubtype, day, periods) !== roomId;

  const steps = useMemo(
    () =>
      buildSteps({
        roomId,
        roomName,
        goneRoom,
        goneName: label(goneRoom),
        dressingRoom,
        dressingName: label(dressingRoom),
        stand,
      }),
    [roomId, roomName, goneRoom, dressingRoom, stand],
  );
  const step = steps[Math.min(index, steps.length - 1)];

  const go = useCallback(
    (to: number) => {
      let next = to;
      while (next < steps.length - 1 && steps[next].skip?.()) next += 1;
      setIndex(Math.min(next, steps.length - 1));
    },
    [steps],
  );

  function exit() {
    seen();
    router.push(BOARD_PATH);
  }

  /**
   * Notes the tutorial seen: a cookie at once, which the board reads, and the doctor's row for every other phone. The
   * cookie goes before any navigation, so the board never sends the doctor back here because the row was not written
   * yet, or could not be written at all.
   */
  function seen() {
    if (!first || !seenKey) return;
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${TUTORIAL_COOKIE}=${encodeURIComponent(seenKey)}; path=/; max-age=31536000; samesite=lax${secure}`;
    void seeTutorial();
  }

  function start() {
    seen();
    go(1);
  }

  function again() {
    setRun((value) => value + 1);
    setPhase("before");
    setMine(null);
    go(1);
  }

  function uploaded() {
    setPhase("after");
    closeRoom();
    go(index + 1);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden" data-testid="tutorial">
      <div key={run} className="contents">
        <TopBar
          date={day}
          eyebrow="บทเรียน · ตารางตัวอย่าง"
          name={profile.name}
          role={profile.role}
          image={profile.image}
          pathname="/tutorial"
          helpHref="/tutorial"
        />
        <SuiteBoard board={board} today={today} periods={periods} pathname="/tutorial" adding={adding} notices={notices} swipe={null} />
      </div>
      <Coach
        step={step}
        index={index}
        total={steps.length}
        onNext={() => go(index + 1)}
        onExit={exit}
        card={
          step.card === "welcome" ? (
            <WelcomeCard first={first} onStart={start} onSkip={exit} />
          ) : step.card === "plan-symbols" ? (
            <PlanSymbolsCard day={day} periods={periods} onNext={() => go(index + 1)} />
          ) : step.card === "priority" ? (
            <PriorityCard onNext={() => go(index + 1)} />
          ) : step.card === "row-symbols" ? (
            <RowSymbolsCard onNext={() => go(index + 1)} />
          ) : step.card === "upload" ? (
            <UploadCard day={day} onNext={uploaded} />
          ) : step.card === "dressing-rule" ? (
            <DressingRuleCard onNext={() => go(index + 1)} />
          ) : step.card === "examples" ? (
            <ExamplesCard onNext={() => go(index + 1)} />
          ) : step.card === "finish" ? (
            <FinishCard onBoard={exit} onAgain={again} />
          ) : null
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The steps.

function buildSteps({
  roomId,
  roomName,
  goneRoom,
  goneName,
  dressingRoom,
  dressingName,
  stand,
}: {
  roomId: string;
  roomName: string;
  goneRoom: string | null;
  goneName: string;
  dressingRoom: string | null;
  dressingName: string;
  /** The practice room is not the doctor's own department's. */
  stand: boolean;
}): Step[] {
  const plan = () => document.querySelector('svg[aria-label="แปลนห้องผ่าตัด"]');
  const form = () => {
    closeRoom();
    openForm();
  };
  return [
    { id: "welcome", chapter: 0, card: "welcome" },

    // 1. The plan.
    {
      id: "plan",
      chapter: 0,
      title: "นี่คือแปลนห้องผ่าตัด",
      body: "สีของห้องคือแผนกที่ได้ห้องวันนั้น เลขในวงกลมคือเลขห้อง",
      target: plan,
      setup: () => {
        closeDialog("add-case-dialog");
        closeRoom();
      },
    },
    {
      id: "notices",
      chapter: 0,
      title: "แถบแจ้งเตือน",
      body: (
        <>
          ป้ายสีแดงบอกว่ายังไม่มีตาราง HOSxP ของวันนั้น แตะป้ายเพื่ออ่านเพิ่ม <span className="text-muted">(ป้ายบทเรียนมีเฉพาะในบทเรียนนี้)</span>
        </>
      ),
      target: () => find(".notice-strip"),
    },
    {
      id: "zone",
      chapter: 0,
      title: "พื้นที่ปิดซ่อม",
      body: "ลายทางเข้มคือพื้นที่ปิดซ่อมระบบระบายอากาศ ห้องในนั้นใช้ผ่าตัดไม่ได้",
      target: () => find("[data-testid=repair-zone]"),
      skip: () => find("[data-testid=repair-zone]") === null,
    },
    { id: "plan-symbols", chapter: 0, card: "plan-symbols" },
    {
      id: "date",
      chapter: 0,
      title: "วันที่ของตาราง",
      body: "ก่อน 16:00 น. แสดงวันนี้ หลังจากนั้นแสดงวันทำการถัดไป แตะวันที่เพื่อดูวันอื่น",
      target: () => find("[data-testid=board-eyebrow]")?.parentElement?.parentElement ?? null,
    },
    {
      id: "swipe",
      chapter: 0,
      title: "ปัดเพื่อเปลี่ยนวัน",
      body: "ปัดแปลนไปทางซ้ายดูวันถัดไป ปัดไปทางขวาดูวันก่อน",
      target: plan,
      hand: "swipe",
    },

    // 2. Why book (Pong, 19 Nov 2026: "emphasize the importance of elective booking is to guarantee first priority of OR
    // room queue and promote surgeon to always book"), then the practice booking.
    { id: "priority", chapter: 1, card: "priority" },
    {
      id: "book",
      chapter: 1,
      title: "จองห้อง",
      body: "แตะปุ่ม จองห้อง เพื่อจองเคสของคุณ",
      target: () => find("[data-testid=add-case-button]"),
      mode: "tap",
      hand: "tap",
      done: () => dialogOpen("add-case-dialog"),
      setup: closeRoom,
    },
    {
      id: "form-date",
      chapter: 1,
      title: "วันผ่าตัด",
      body: "จองได้ตั้งแต่วันทำการถัดไป หลัง 15:00 น. ปิดรับของวันทำการถัดไป บทเรียนเลือกวันไว้ให้แล้ว",
      target: () => find("#case-date-hint")?.parentElement ?? null,
      setup: form,
      scroll: "center",
    },
    {
      id: "form-hn",
      chapter: 1,
      title: "HN ผู้ป่วย",
      body: "พิมพ์ HN 7 หลัก ระบบใช้ HN จับคู่กับตาราง HOSxP",
      target: () => find("[data-testid=case-hn-card]"),
      mode: "do",
      done: () => (find("[data-testid=case-hn]") as HTMLInputElement | null)?.value.length === 7,
      setup: form,
      scroll: "center",
      focus: () => find("[data-testid=case-hn]"),
      example: { label: "ใส่ HN ตัวอย่าง", fill: () => fill(find("[data-testid=case-hn]") as HTMLInputElement | null, EXAMPLE_HN) },
    },
    {
      id: "form-operation",
      chapter: 1,
      title: "ชื่อการผ่าตัด",
      body: `พิมพ์ชื่อการผ่าตัด เช่น ${EXAMPLE_OPERATION}`,
      target: () => find("#case-operation")?.parentElement ?? null,
      mode: "do",
      done: () => ((find("#case-operation") as HTMLInputElement | null)?.value.trim().length ?? 0) > 0,
      setup: form,
      scroll: "center",
      focus: () => find("#case-operation"),
      example: { label: "ใส่ตัวอย่าง", fill: () => fill(find("#case-operation") as HTMLInputElement | null, EXAMPLE_OPERATION) },
    },
    {
      id: "form-room",
      chapter: 1,
      title: "เลือกห้อง",
      body: stand
        ? `บทเรียนนี้ใช้ ${roomName} เป็นตัวอย่าง ถ้าเป็นเคสทำแผล เลือกห้องทำแผล แล้วตอบว่าฝาก scrub ทำไหม`
        : `${roomName} คือห้องของแผนกคุณวันนั้น ถ้าเป็นเคสทำแผล เลือกห้องทำแผล แล้วตอบว่าฝาก scrub ทำไหม`,
      target: () => find("[data-testid=case-room]"),
      setup: form,
      scroll: "center",
    },
    {
      id: "form-note",
      chapter: 1,
      title: "หมายเหตุ (ถ้ามี)",
      body: "ฝากข้อความถึงทีม OR เช่น ขอ C-arm ทุกคนที่เปิดตารางเห็น ไม่ต้องใส่ชื่อหรือ HN ผู้ป่วย",
      target: () => find("#case-note")?.parentElement ?? null,
      mode: "do",
      done: () => true,
      setup: form,
      scroll: "center",
    },
    {
      id: "form-submit",
      chapter: 1,
      title: "กดจองห้อง",
      body: "แตะ จองห้อง เพื่อบันทึก",
      target: () => find("[data-testid=case-submit]"),
      mode: "tap",
      hand: "tap",
      done: () => find("[data-testid=my-cases]") !== null,
      setup: form,
      scroll: "center",
    },
    {
      id: "booked",
      chapter: 1,
      title: "จองแล้ว!",
      body: "เคสนี้ได้คิวก่อนเคสที่ไม่ได้จองแล้ว การจองของคุณอยู่ตรงนี้ แก้ไขหรือยกเลิกได้",
      target: () => find("[data-testid=my-cases]"),
      setup: form,
      scroll: "center",
      confetti: true,
    },
    {
      id: "form-close",
      chapter: 1,
      title: "กลับไปที่แปลน",
      body: "แตะ ปิด",
      target: () => find("[data-testid=add-case-close]"),
      scroll: "nearest",
      mode: "tap",
      hand: "tap",
      round: true,
      done: () => !dialogOpen("add-case-dialog"),
    },

    // 3. The booking on the board, before MX's upload.
    {
      id: "room",
      chapter: 2,
      title: "ห้องของคุณ",
      body: `แตะ ${roomName} เพื่อดูรายการ`,
      target: () => floor(roomId),
      mode: "tap",
      hand: "tap",
      done: () => roomShown(roomId),
      setup: () => closeDialog("add-case-dialog"),
    },
    {
      id: "my-row",
      chapter: 2,
      title: "เคสของคุณ",
      body: "HN ของคุณ แพทย์คนอื่นไม่เห็น บรรทัดล่างคือเวลาที่จอง",
      target: myRow,
      setup: () => openRoom(roomId),
      scroll: "nearest",
    },
    {
      id: "my-manage",
      chapter: 2,
      title: "ปุ่มจัดการ",
      body: "เคสที่คุณจองมีปุ่มนี้ แก้ไข เลื่อนวัน จองซ้ำ หรือยกเลิก แก้ไขได้จนถึงเวลาปิดรับจอง 15.00 น.",
      target: () => find("[data-testid=row-manage]", myRow()),
      round: true,
      setup: () => openRoom(roomId),
      scroll: "nearest",
    },
    {
      id: "my-icon",
      chapter: 2,
      title: "ไอคอนปฏิทิน",
      body: "แตะไอคอนเพื่อดูความหมาย ปฏิทิน = แพทย์จองแล้ว รอตาราง HOSxP",
      target: () => find("[data-testid=row-icon]", myRow()),
      mode: "tap",
      hand: "tap",
      round: true,
      done: () => find("[data-testid=row-icon-tip]", myRow()) !== null,
      setup: () => openRoom(roomId),
      scroll: "nearest",
    },
    {
      id: "colleague",
      chapter: 2,
      title: "เคสของแพทย์คนอื่น",
      body: "ไม่เห็น HN ของคนอื่น เคสที่จองเรียงตามเวลาที่จอง ยิ่งจองเร็ว ยิ่งได้คิวก่อน",
      target: colleagueRow,
      setup: () => openRoom(roomId),
      scroll: "nearest",
    },
    {
      id: "no-table",
      chapter: 2,
      title: "ยังไม่มีตาราง HOSxP",
      body: "ไอคอนนี้บอกว่า Manager ยังไม่อัปโหลดตาราง HOSxP ของวันนั้น ตอนนี้เห็นเฉพาะเคสที่แพทย์จอง",
      target: () => find("[data-testid=room-no-table]", sheet()),
      round: true,
      setup: () => openRoom(roomId),
    },
    { id: "upload", chapter: 3, card: "upload" },

    // 4. After the upload.
    {
      id: "mismatch",
      chapter: 3,
      title: "สามเหลี่ยม !",
      body: "ห้องนี้มีเคสในตาราง HOSxP ที่ไม่มีใครจอง",
      target: () => document.querySelector(`g#${CSS.escape(roomId)} .fp-mismatch`),
      round: true,
      pad: 16,
      setup: closeRoom,
    },
    {
      id: "gone",
      chapter: 3,
      title: "เคสที่ไม่มีใน HOSxP",
      body: `เคสที่จองไว้แต่ไม่มีในตาราง HOSxP จะหายไป ${goneName} จึงว่างแล้ว`,
      target: () => (goneRoom ? floor(goneRoom) : null),
      skip: () => goneRoom === null,
      setup: closeRoom,
    },
    {
      id: "room-again",
      chapter: 3,
      title: "เปิดห้องของคุณอีกครั้ง",
      body: `แตะ ${roomName}`,
      target: () => floor(roomId),
      mode: "tap",
      hand: "tap",
      done: () => roomShown(roomId),
    },
    {
      id: "matched",
      chapter: 3,
      title: "ไอคอนจับมือ",
      body: "ตาราง HOSxP ตรงกับที่คุณจอง เคสที่จองยังได้คิวก่อน ชื่อผู้ป่วยของคุณ แพทย์คนอื่นไม่เห็น",
      target: myRow,
      setup: () => openRoom(roomId),
      scroll: "nearest",
    },
    {
      id: "unbooked",
      chapter: 3,
      title: "เคสที่ไม่มีใครจอง",
      body: "เคสจากตาราง HOSxP ที่ไม่มีใครจอง ต่อท้ายคิว หลังเคสที่จองทุกเคส",
      target: () => find("li.case-row[data-flag=unbooked]", sheet()),
      setup: () => openRoom(roomId),
      scroll: "nearest",
    },
    {
      id: "unfold",
      chapter: 3,
      title: "ชื่อยาว",
      body: "ชื่อที่ยาวเกินบรรทัดถูกตัดไว้ แตะชื่อเพื่ออ่านทั้งหมด",
      target: () => find("button.case-op", colleagueRow()),
      mode: "tap",
      hand: "tap",
      done: () => find("button.case-op", colleagueRow())?.getAttribute("aria-expanded") === "true",
      skip: () => find("button.case-op", colleagueRow()) === null,
      setup: () => openRoom(roomId),
      scroll: "nearest",
    },
    {
      id: "note",
      chapter: 3,
      title: "หมายเหตุ",
      body: "แตะ หมายเหตุ เพื่ออ่านข้อความถึงทีม OR",
      target: () => find("[data-testid=row-note]", colleagueRow()),
      mode: "tap",
      hand: "tap",
      done: () => dialogOpen("case-note-dialog"),
      setup: () => openRoom(roomId),
      scroll: "nearest",
    },
    {
      id: "note-close",
      chapter: 3,
      title: "อ่านแล้วปิดได้",
      body: "ข้อความถึงทีม OR อยู่ตรงนี้ แตะ ปิด",
      target: () => find("dialog[open] [data-testid=case-note-close]"),
      mode: "tap",
      hand: "tap",
      done: () => !dialogOpen("case-note-dialog"),
    },
    {
      id: "expand",
      chapter: 3,
      title: "ขยายเต็มจอ",
      body: "แตะเพื่อดูรายการเต็มจอ",
      target: () => find("[data-testid=room-expand]", sheet()),
      mode: "tap",
      hand: "tap",
      round: true,
      done: () => dialogOpen("room-full"),
      setup: () => openRoom(roomId),
    },
    {
      id: "full-close",
      chapter: 3,
      title: "รายการเต็มจอ",
      body: "บนคอมพิวเตอร์แบ่งเป็น 2 คอลัมน์ แตะเพื่อย่อกลับ",
      target: () => find("dialog[open] [data-testid=room-full-close]"),
      mode: "tap",
      hand: "tap",
      round: true,
      done: () => !dialogOpen("room-full"),
    },

    // 5. The dressing room.
    {
      id: "dressing",
      chapter: 4,
      title: "ห้องทำแผล",
      body: `แตะ ${dressingName} ห้องทำแผล`,
      target: () => (dressingRoom ? floor(dressingRoom) : null),
      mode: "tap",
      hand: "tap",
      done: () => (dressingRoom ? roomShown(dressingRoom) : true),
      skip: () => dressingRoom === null,
      setup: closeRoom,
    },
    // Pong, 20 Nov 2026: "show how app automatically assign some cases to dressing room".
    {
      id: "auto-dressing",
      chapter: 4,
      title: "ระบบจัดลงห้องทำแผลให้เอง",
      body: "เคสนี้ไม่มีใครจอง ชื่อการผ่าตัดมี I&D ระบบจึงจัดลงห้องทำแผล ไม่ใช่ห้องของแผนก",
      target: autoDressingRow,
      skip: () => dressingRoom === null,
      setup: () => (dressingRoom ? openRoom(dressingRoom) : undefined),
      scroll: "nearest",
    },
    { id: "dressing-rule", chapter: 4, card: "dressing-rule" },
    {
      id: "doers",
      chapter: 4,
      title: "ใครทำแผล",
      body: "ห้องทำแผลแสดงรูปคนทำแทนไอคอน รูปพยาบาล = ฝาก scrub ทำ รูปหมอ = แพทย์ทำเอง",
      target: () => find("ol", sheet()),
      skip: () => dressingRoom === null,
      setup: () => (dressingRoom ? openRoom(dressingRoom) : undefined),
    },

    // 6. The real days before (Pong, 20 Nov 2026: "note to user that user can view previous real example of in-hours
    // elective case assignment (ตัวอย่างเคส elective ในเวลา) on month Jan to Oct 2026 by swiping layout or choose date
    // from calendar, the OR layout will assume to be first half of repair phase").
    { id: "examples", chapter: 5, card: "examples", setup: closeRoom },

    // 7. The end.
    { id: "row-symbols", chapter: 6, card: "row-symbols" },
    {
      id: "help",
      chapter: 6,
      title: "ดูบทเรียนอีกครั้ง",
      body: "แตะรูปโปรไฟล์ แล้วเลือก วิธีใช้งาน",
      target: () => find("[data-testid=user-menu]"),
      round: true,
      setup: closeRoom,
    },
    { id: "finish", chapter: 6, card: "finish", confetti: true },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// The coach: dim, spotlight, bubble, hand, confetti.

type View = {
  /** The step this was measured for: until the first frame of a new step, the last step's answer is not this one's. */
  at: number;
  /** The modal dialog the coach sits in, or null for the page. */
  host: HTMLElement | null;
  /** Waiting for a dialog to finish opening, or the scrub question is open over the form. */
  hidden: boolean;
  rect: Box | null;
  /** ถัดไป can be pressed (a do step's field is filled). */
  can: boolean;
  /** The target has not turned up for a while: ถัดไป shows, so nobody is stuck. */
  stuck: boolean;
  vw: number;
  vh: number;
  vtop: number;
};

const START: View = { at: -1, host: null, hidden: true, rect: null, can: false, stuck: false, vw: 0, vh: 0, vtop: 0 };

function sameView(a: View, b: View): boolean {
  return (
    a.at === b.at &&
    a.host === b.host &&
    a.hidden === b.hidden &&
    sameBox(a.rect, b.rect) &&
    a.can === b.can &&
    a.stuck === b.stuck &&
    a.vw === b.vw &&
    a.vh === b.vh &&
    a.vtop === b.vtop
  );
}

function Coach({
  step,
  index,
  total,
  onNext,
  onExit,
  card,
}: {
  step: Step;
  index: number;
  total: number;
  onNext: () => void;
  onExit: () => void;
  card: ReactNode;
}) {
  const [view, setView] = useState<View>(START);
  const [mounted, setMounted] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [bubbleHeight, setBubbleHeight] = useState(180);
  const stepRef = useRef(step);
  const nextRef = useRef(onNext);
  // The bubble's height decides whether it fits above or below the target (an observer reports it on first sight too).
  const bubbleRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(() => setBubbleHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stepRef.current = step;
    nextRef.current = onNext;
  });

  // The page is drawn on the server without the coach; it comes in once the browser has the page.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Each step: set the board up, then watch its target every frame (rooms slide, lists scroll, dialogs open).
  useEffect(() => {
    let frame = 0;
    let lost = 0;
    let lastSetup = 0;
    let scrolled = false;
    let moving = false;
    const begun = performance.now();
    const setupFrame = requestAnimationFrame(() => {
      lastSetup = performance.now();
      stepRef.current.setup?.();
    });
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const current = stepRef.current;
      const modal = topModal();
      const scrub = dialogOpen("scrub-dialog");
      const hidden = scrub || (modal !== null && !settled(modal));
      const element = current.target?.() ?? null;
      let rect: Box | null = null;
      if (element && !hidden) {
        const box = element.getBoundingClientRect();
        if (box.width > 0 || box.height > 0) {
          const pad = current.pad ?? 6;
          rect = { x: Math.round(box.left - pad), y: Math.round(box.top - pad), w: Math.round(box.width + pad * 2), h: Math.round(box.height + pad * 2) };
        }
        // A step that asks for it scrolls its target into place once; any other target out of sight (scrolled off the
        // top of a dialog, below the screen) is brought into view once too, or a tap step could not be done.
        const visual = window.visualViewport;
        const top = visual?.offsetTop ?? 0;
        const bottom = top + (visual?.height ?? window.innerHeight);
        // Only a target that fits on the screen: a big one (the plan) is never moved.
        const outOfSight = box.height < bottom - top && (box.top < top || box.bottom > bottom);
        if (rect && !scrolled && (current.scroll || outOfSight)) {
          scrolled = true;
          element.scrollIntoView({ block: current.scroll ?? "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
        }
      }
      if (current.target && !rect && !hidden) {
        lost += 1;
        // The board lost the state the step needs (a room closed by the phone's back gesture): put it back.
        if (current.setup && lost > 45 && performance.now() - lastSetup > 1500) {
          lastSetup = performance.now();
          current.setup();
        }
      } else {
        lost = 0;
      }
      const can = current.done ? current.done() : true;
      const viewport = window.visualViewport;
      const next: View = {
        at: index,
        host: modal,
        hidden,
        rect,
        can,
        stuck: Boolean(current.target) && performance.now() - begun > 4000 && rect === null,
        vw: Math.round(viewport?.width ?? window.innerWidth),
        vh: Math.round(viewport?.height ?? window.innerHeight),
        vtop: Math.round(viewport?.offsetTop ?? 0),
      };
      setView((previous) => (sameView(previous, next) ? previous : next));
      // A tap step moves on by itself once the tap has done its work.
      if (current.mode === "tap" && can && !moving && performance.now() - begun > 200) {
        moving = true;
        window.setTimeout(() => nextRef.current(), 320);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(setupFrame);
    };
  }, [index]);

  // Escape would close the room, the form or a dialog under the coach: it does nothing while the tutorial runs.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);


  // The field to type in, or the button to press, takes the focus.
  const host = view.host;
  const hidden = view.hidden;
  useEffect(() => {
    if (hidden) return;
    const frame = requestAnimationFrame(() => {
      const field = stepRef.current.focus?.();
      if (field) field.focus();
      else primaryRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [index, host, hidden]);

  if (!mounted || view.hidden) return null;

  const mode: Mode = step.card ? "info" : (step.mode ?? "info");
  // A do step's ถัดไป waits for this step's own answer, never the last step's (one frame stale on a new step).
  const can = view.at === index && view.can;
  const rect = step.card ? null : view.rect;
  const width = Math.min(360, Math.max(240, view.vw - 24));
  const progress = Math.round((index / Math.max(1, total - 1)) * 100);
  const chapter = CHAPTERS[step.chapter];

  // Where the bubble goes: under the target, else above it, else at the screen's edge away from it.
  let bubbleStyle: CSSProperties = {};
  let side: "below" | "above" | "edge" | "middle" = "middle";
  let tail = 0;
  if (rect) {
    const top = view.vtop;
    const bottom = view.vtop + view.vh;
    const cx = rect.x + rect.w / 2;
    const left = Math.min(Math.max(cx - width / 2, 12), view.vw - width - 12);
    const below = bottom - (rect.y + rect.h) - 16;
    const above = rect.y - top - 16;
    let y: number;
    if (below >= bubbleHeight + 8) {
      side = "below";
      y = rect.y + rect.h + 16;
    } else if (above >= bubbleHeight + 8) {
      side = "above";
      y = rect.y - 16 - bubbleHeight;
    } else {
      side = "edge";
      y = rect.y + rect.h / 2 > top + view.vh / 2 ? top + 12 : bottom - bubbleHeight - 12;
    }
    tail = Math.min(Math.max(cx - left, 26), width - 26);
    bubbleStyle = { left, top: y, width };
  } else {
    bubbleStyle = { left: Math.max(12, (view.vw - width) / 2), top: view.vtop + Math.max(12, (view.vh - bubbleHeight) / 2), width };
  }

  // The surgeon cheers with the confetti, points up at a target above the bubble that is to be tapped or filled, and
  // otherwise talks, for about as long as the bubble's words take.
  const mood: MascotMood = step.confetti ? "cheer" : side === "below" && mode !== "info" ? "point" : "talk";
  const talk = talkFor(`${step.title ?? ""}${typeof step.body === "string" ? step.body : " ".repeat(48)}`);

  const hole = rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : null;
  const blockers: CSSProperties[] =
    !rect || mode === "info"
      ? [{ inset: 0 }]
      : [
          { left: 0, top: 0, right: 0, height: Math.max(0, rect.y) },
          { left: 0, top: rect.y + rect.h, right: 0, bottom: 0 },
          { left: 0, top: rect.y, width: Math.max(0, rect.x), height: rect.h },
          { left: rect.x + rect.w, top: rect.y, right: 0, height: rect.h },
        ];
  const showNext = mode === "info" || mode === "do" || (view.at === index && view.stuck);

  const layer = (
    <div className="coach" data-testid="coach" data-step={step.id} data-mode={mode} role="presentation">
      {hole ? <div className={`coach-hole${step.round ? " is-round" : ""}`} style={hole} aria-hidden="true" /> : <div className="coach-dim" aria-hidden="true" />}
      {blockers.map((style, at) => (
        <div key={at} className="coach-block" style={style} onPointerDown={() => setNudge((value) => value + 1)} aria-hidden="true" />
      ))}
      {hole && mode !== "info" ? <div key={nudge} className={`coach-ring${step.round ? " is-round" : ""}${nudge ? " is-nudged" : ""}`} style={hole} aria-hidden="true" /> : null}
      {rect && step.hand ? <Hand kind={step.hand} rect={rect} up={rect.y + rect.h / 2 > view.vtop + view.vh - 72} /> : null}
      {step.card ? (
        <div className="coach-card-wrap">{card}</div>
      ) : (
        <div
          ref={bubbleRef}
          className="coach-bubble"
          data-side={side}
          style={{ ...bubbleStyle, "--tail": `${tail}px` } as CSSProperties}
          role="dialog"
          aria-label={`บทเรียน ${chapter}`}
          data-testid="coach-bubble"
        >
          <div className="coach-head">
            <span className="coach-chapter">
              บทที่ {step.chapter + 1} · {chapter}
            </span>
            <button type="button" className="coach-skip" onClick={onExit} data-testid="coach-exit">
              ข้ามบทเรียน
            </button>
          </div>
          <div className="coach-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="coach-say">
            <span className="coach-mascot" aria-hidden="true">
              <Mascot key={step.id} mood={mood} look={side === "below" ? "up" : side === "above" ? "down" : undefined} talk={talk} />
            </span>
            <div className="min-w-0" aria-live="polite">
              <p className="coach-title" data-testid="coach-title">
                {step.title}
              </p>
              <p className="coach-text">{step.body}</p>
            </div>
          </div>
          {showNext || step.example ? (
            <div className="coach-actions">
              {step.example && !can ? (
                <button type="button" className="btn btn-secondary min-h-10 px-3 text-sm" onClick={step.example.fill} data-testid="coach-example">
                  {step.example.label}
                </button>
              ) : null}
              {showNext ? (
                <button
                  ref={primaryRef}
                  type="button"
                  className="btn btn-primary min-h-10 px-5 text-sm"
                  disabled={mode === "do" && !can}
                  onClick={onNext}
                  data-testid="coach-next"
                >
                  ถัดไป
                </button>
              ) : null}
            </div>
          ) : (
            <p className="coach-hint">แตะตรงที่มีวงกระพริบ</p>
          )}
        </div>
      )}
      {/* Over the card or bubble, so it rains on what was just done. */}
      {step.confetti ? <Confetti key={step.id} /> : null}
    </div>
  );

  return createPortal(layer, host ?? document.body);
}

/** Lucide "pointer" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors), filled white. */
function Hand({ kind, rect, up }: { kind: "tap" | "swipe"; rect: Box; up: boolean }) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // Near the screen's bottom the hand would hang off it: it points down at the target from above instead.
  return (
    <>
      {kind === "tap" ? <span className="coach-ripple" style={{ left: cx, top: cy }} aria-hidden="true" /> : null}
      <span className={`coach-hand is-${kind}${up ? " is-up" : ""}`} style={{ left: cx, top: cy }} aria-hidden="true">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="#fff" stroke="#241c16" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 14a8 8 0 0 1-8 8" />
          <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
          <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />
          <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />
          <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
      </span>
    </>
  );
}

const CONFETTI_COLOURS = ["#1E7B3C", "#D32F2F", "#0277BD", "#C2188F", "#ddbf94", "#9A6B00", "#5E35B1", "#00838F"];

/** A number from 0 to 1 that looks random but is the same on every draw. */
function scatter(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function Confetti() {
  return (
    <div className="coach-confetti" aria-hidden="true">
      {Array.from({ length: 42 }, (_, index) => (
        <i
          key={index}
          style={
            {
              left: `${4 + scatter(index, 1) * 92}%`,
              background: CONFETTI_COLOURS[index % CONFETTI_COLOURS.length],
              "--drift": `${(scatter(index, 2) - 0.5) * 160}px`,
              "--spin": `${360 + scatter(index, 3) * 720}deg`,
              animationDelay: `${scatter(index, 4) * 0.35}s`,
              animationDuration: `${1.5 + scatter(index, 5) * 1.1}s`,
              width: `${7 + scatter(index, 6) * 6}px`,
              height: `${10 + scatter(index, 7) * 8}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The cards.

function Card({ children, testId, wide = false }: { children: ReactNode; testId: string; wide?: boolean }) {
  return (
    <div className={`coach-card${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId}>
      {children}
    </div>
  );
}

function BigMascot({ mood }: { mood: MascotMood }) {
  return (
    <span className="coach-mascot-big" aria-hidden="true">
      <Mascot mood={mood} talk={14} />
    </span>
  );
}

function WelcomeCard({ first, onStart, onSkip }: { first: boolean; onStart: () => void; onSkip: () => void }) {
  return (
    <Card testId="coach-welcome">
      <BigMascot mood="wave" />
      <h2 id="coach-welcome-title" className="coach-card-title">
        ยินดีต้อนรับสู่ ORSKH.APP
      </h2>
      <p className="coach-card-text">มาลองจองห้องผ่าตัดในตารางตัวอย่างกัน ใช้เวลาราว 2 นาที เคสทั้งหมดเป็นเคสสมมติ ไม่ได้บันทึกจริง</p>
      <Tip testId="coach-welcome-tip">เคสที่จองล่วงหน้า ได้คิวห้องผ่าตัดก่อนเสมอ</Tip>
      <ol className="coach-stages">
        {CHAPTERS.slice(0, -1).map((name, at) => (
          <li key={name}>
            <span className="coach-stage-no">{at + 1}</span>
            {name}
          </li>
        ))}
      </ol>
      <div className="coach-card-actions">
        <button type="button" className="btn btn-primary w-full" onClick={onStart} data-testid="coach-start">
          เริ่มเลย
        </button>
        <button type="button" className="btn btn-ghost w-full" onClick={onSkip} data-testid="coach-skip">
          {first ? "ข้ามไปก่อน" : "กลับตาราง"}
        </button>
      </div>
      {first ? <p className="coach-card-note">ดูบทเรียนอีกครั้งได้ที่เมนูรูปโปรไฟล์ › วิธีใช้งาน</p> : null}
    </Card>
  );
}

function Chip({ dept }: { dept: Pick<Department, "color" | "label" | "name"> & { ink?: string } }) {
  return (
    <span className="coach-chip" style={{ background: dept.color, color: dept.ink ?? readableTextOn(dept.color) }}>
      {dept.label}
    </span>
  );
}

function Key({ symbol, children }: { symbol: ReactNode; children: ReactNode }) {
  return (
    <li className="coach-key">
      <span className="coach-key-symbol">{symbol}</span>
      <span className="coach-key-text">{children}</span>
    </li>
  );
}

/** The plan's colours and marks: every department that holds a room that day, then the rooms that are not a department's. */
function PlanSymbolsCard({ day, periods, onNext }: { day: string; periods: RepairPeriods; onNext: () => void }) {
  const depts = useMemo(() => {
    const seen = new Map<string, Department>();
    for (const room of openRooms(day, periods)) {
      const allocation = allocationFor(room.id, day, periods);
      for (const dept of [allocation?.am, allocation?.pm]) if (dept && !seen.has(dept.code)) seen.set(dept.code, dept);
    }
    return [...seen.values()];
  }, [day, periods]);
  return (
    <Card testId="coach-plan-symbols" wide>
      <h2 id="coach-plan-symbols-title" className="coach-card-title">
        สีและสัญลักษณ์บนแปลน
      </h2>
      <p className="coach-card-text">สีห้องของวันที่แสดง</p>
      <ul className="coach-keys" data-testid="coach-plan-keys">
        {depts.map((dept) => (
          <Key key={dept.code} symbol={<Chip dept={dept} />}>
            {dept.name}
          </Key>
        ))}
        <Key symbol={<Chip dept={{ ...RECOVERY_ROOM }} />}>{RECOVERY_ROOM.name}</Key>
        <Key symbol={<Chip dept={{ ...INSTRUMENT_ROOM }} />}>{INSTRUMENT_ROOM.name}</Key>
        <Key symbol={<span className="coach-stripes" />}>ปิด หรือพื้นที่ปิดซ่อม</Key>
        <Key
          symbol={
            <svg width="28" height="26" viewBox="-20 -20 40 36" aria-hidden="true">
              <path d="M0 -19L18 13H-18Z" fill="var(--fp-delayed)" />
              <text x="0" y="6" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--ink)">
                !
              </text>
            </svg>
          }
        >
          มีเคสใน HOSxP ที่ไม่มีใครจอง
        </Key>
        <Key symbol={<NoTableIcon size={22} />}>ยังไม่มีตาราง HOSxP ของวันนั้น</Key>
      </ul>
      <p className="coach-card-note">
        {DEPARTMENTS.EMER.label} ห้องฉุกเฉิน · {DEPARTMENTS.INFECT.label} ห้องทำแผล · {DEPARTMENTS.MIXED.label} ห้องคละแผนก
      </p>
      <div className="coach-card-actions">
        <button type="button" className="btn btn-primary w-full" onClick={onNext} data-testid="coach-next">
          เข้าใจแล้ว
        </button>
      </div>
    </Card>
  );
}

/** Every mark a row of a room's list can carry. */
function RowSymbolsCard({ onNext }: { onNext: () => void }) {
  return (
    <Card testId="coach-row-symbols" wide>
      <h2 id="coach-row-symbols-title" className="coach-card-title">
        สัญลักษณ์ในรายการ
      </h2>
      <p className="coach-card-text">แตะไอคอนในรายการเพื่อดูความหมายได้ทุกเมื่อ</p>
      <ul className="coach-keys" data-testid="coach-row-keys">
        <Key symbol={<CaseSymbol source="booking" />}>แพทย์จองแล้ว รอตาราง HOSxP</Key>
        <Key symbol={<CaseSymbol source="matched" />}>ตาราง HOSxP ตรงกับการจอง</Key>
        <Key symbol={<CaseSymbol source="hosxp" />}>มีในตาราง HOSxP ไม่มีการจอง</Key>
        <Key symbol={<CaseSymbol source="booking" doneBy="scrub" />}>ห้องทำแผล: ฝาก scrub ทำ</Key>
        <Key symbol={<CaseSymbol source="booking" doneBy="surgeon" />}>ห้องทำแผล: แพทย์ทำเอง</Key>
        <Key
          symbol={
            <span className="case-note">
              <NoteIcon size={15} />
              หมายเหตุ
            </span>
          }
        >
          ข้อความถึงทีม OR แตะเพื่ออ่าน
        </Key>
      </ul>
      <p className="coach-card-note">ลำดับในห้อง: เคสที่จองก่อน เรียงตามเวลาที่จอง แล้วจึงเป็นเคสที่ไม่ได้จอง</p>
      <div className="coach-card-actions">
        <button type="button" className="btn btn-primary w-full" onClick={onNext} data-testid="coach-next">
          ถัดไป
        </button>
      </div>
    </Card>
  );
}

function StarIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      {/* Lucide "star" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */}
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  );
}

/** The one rule the tutorial keeps coming back to: book, and the case is ahead of every case nobody booked. */
function Tip({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <p className="coach-tip" data-testid={testId}>
      <StarIcon />
      <span>{children}</span>
    </p>
  );
}

/**
 * Why book (Pong, 19 Nov 2026: "emphasize the importance of elective booking is to guarantee first priority of OR room
 * queue and promote surgeon to always book"). A room's list puts every booked case first, earliest booking first, and
 * the HOSxP cases nobody booked after them (lib/board-rows.ts), so the card shows that queue as it stands after the
 * upload: handshakes, then the database icon (a calendar row never shares a list with a database one).
 */
function PriorityCard({ onNext }: { onNext: () => void }) {
  return (
    <Card testId="coach-priority">
      <span className="coach-trophy" aria-hidden="true">
        <StarIcon size={40} />
      </span>
      <p className="coach-card-eyebrow">กฎข้อสำคัญ</p>
      <h2 id="coach-priority-title" className="coach-card-title">
        จองก่อน ได้คิวก่อน
      </h2>
      <p className="coach-card-text">เคส elective ที่จองล่วงหน้า ได้คิวห้องผ่าตัดก่อนเสมอ เคสที่ไม่ได้จองต่อท้ายคิว</p>
      <ol className="coach-queue" data-testid="coach-queue" aria-label="ลำดับคิวในห้อง">
        <li className="is-booked">
          <span className="coach-queue-no">1</span>
          <CaseSymbol source="matched" />
          <span className="coach-queue-text">เคสที่จองก่อน</span>
          <span className="coach-queue-tag">คิวแรก</span>
        </li>
        <li className="is-booked">
          <span className="coach-queue-no">2</span>
          <CaseSymbol source="matched" />
          <span className="coach-queue-text">เคสที่จองทีหลัง</span>
        </li>
        <li className="is-last">
          <span className="coach-queue-no">3</span>
          <CaseSymbol source="hosxp" />
          <span className="coach-queue-text">เคสที่ไม่ได้จอง</span>
          <span className="coach-queue-tag">ต่อท้าย</span>
        </li>
      </ol>
      <Tip testId="coach-priority-tip">จองทุกเคส ก่อน 15:00 น. ของวันทำการก่อนผ่าตัด</Tip>
      <div className="coach-card-actions">
        <button type="button" className="btn btn-primary w-full" onClick={onNext} data-testid="coach-next">
          เข้าใจแล้ว ไปจองกัน
        </button>
      </div>
    </Card>
  );
}

/** The jump to 16:00: MX's upload, matched with the bookings by HN. */
function UploadCard({ day, onNext }: { day: string; onNext: () => void }) {
  return (
    <Card testId="coach-upload">
      <span className="coach-clock" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* Lucide "clock-4" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */}
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </span>
      <p className="coach-card-eyebrow">ข้ามเวลาไป 16:00 น.</p>
      <h2 id="coach-upload-title" className="coach-card-title">
        Manager อัปโหลดตาราง HOSxP แล้ว
      </h2>
      <p className="coach-card-text">
        ทุกวัน 15:00–16:00 น. ตาราง HOSxP ของ {thaiDate(day, "short")} มาถึง ระบบจับคู่กับการจองด้วย HN มาดูว่าอะไรเปลี่ยนไป
      </p>
      <div className="coach-card-actions">
        <button type="button" className="btn btn-primary w-full" onClick={onNext} data-testid="coach-next">
          ดูตารางหลังอัปโหลด
        </button>
      </div>
    </Card>
  );
}

/** Lucide "arrow-right" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */
function ArrowIcon() {
  return (
    <svg className="coach-route-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/**
 * How the board puts HOSxP's cases nobody booked in the dressing room (Pong, 20 Nov 2026: "show how app automatically
 * assign some cases to dressing room"): by the operation's name alone, whatever the department (lib/dressing.ts). Each
 * example's room is asked of the rule itself, so the card says what the board does. A booked case goes where its doctor
 * chose on the form, whatever its name.
 */
function DressingRuleCard({ onNext }: { onNext: () => void }) {
  return (
    <Card testId="coach-dressing-rule">
      <p className="coach-card-eyebrow">ระบบจัดให้เอง</p>
      <h2 id="coach-dressing-rule-title" className="coach-card-title">
        เคสทำแผล ไปห้องทำแผลเอง
      </h2>
      <p className="coach-card-text">เคสใน HOSxP ที่ไม่มีใครจอง ระบบดูจากชื่อการผ่าตัด ถ้าเป็นงานทำแผล จัดลงห้องทำแผลให้ ทุกแผนก</p>
      <ul className="coach-route" data-testid="coach-dressing-examples" aria-label="ตัวอย่างชื่อการผ่าตัด และห้องที่ระบบจัดให้">
        {DRESSING_EXAMPLES.map((name) => {
          const dressing = isDressingCase(name);
          return (
            <li key={name} data-dressing={dressing ? "true" : "false"}>
              <span className="coach-route-op">{name}</span>
              <ArrowIcon />
              <span className="coach-route-to">
                {dressing ? <Chip dept={DEPARTMENTS.INFECT} /> : <span className="coach-chip is-dept">แผนก</span>}
                {dressing ? "ห้องทำแผล" : "ห้องแผนก"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="coach-card-note">คำที่ระบบดู เช่น dressing, D/S, VAC, debridement, I&amp;D, ทำแผล</p>
      <p className="coach-card-note mt-1">เคสที่จองไว้ ลงห้องตามที่แพทย์เลือกตอนจอง</p>
      <div className="coach-card-actions">
        <button type="button" className="btn btn-primary w-full" onClick={onNext} data-testid="coach-next">
          เข้าใจแล้ว
        </button>
      </div>
    </Card>
  );
}

/**
 * The real days before (Pong, 20 Nov 2026: "note to user that user can view previous real example of in-hours elective
 * case assignment (ตัวอย่างเคส elective ในเวลา) on month Jan to Oct 2026 by swiping layout or choose date from
 * calendar, the OR layout will assume to be first half of repair phase"). HOSxP's lists of January to October 2026 are
 * on the board's past days (admin import, lib/past-lists.ts: cases booked ahead, in hours). Since the repair starts on
 * 8 Dec 2026 (Pong, 21 Nov 2026), those days have the normal weekly OR schedule (lib/repair.ts repairOn).
 */
function ExamplesCard({ onNext }: { onNext: () => void }) {
  return (
    <Card testId="coach-examples">
      <span className="coach-history" aria-hidden="true">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* Lucide "history" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */}
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </svg>
      </span>
      <p className="coach-card-eyebrow">ตารางจริงย้อนหลัง</p>
      <h2 id="coach-examples-title" className="coach-card-title">
        ดูตัวอย่างเคส elective ในเวลา
      </h2>
      <p className="coach-card-text">เปิดดูวันใดก็ได้ใน ม.ค.–ต.ค. 2569 ว่าเคส elective ในเวลาของวันนั้น ลงห้องไหน</p>
      <ol className="coach-stages" data-testid="coach-examples-ways">
        <li>
          <span className="coach-stage-no" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {/* Lucide "move-horizontal" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */}
              <path d="m18 8 4 4-4 4" />
              <path d="M2 12h20" />
              <path d="m6 8-4 4 4 4" />
            </svg>
          </span>
          ปัดแปลนไปทางขวา ย้อนทีละวัน
        </li>
        <li>
          <span className="coach-stage-no" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {/* Lucide "calendar-days" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */}
              <path d="M8 2v4" />
              <path d="M16 2v4" />
              <rect width="18" height="18" x="3" y="4" rx="2" />
              <path d="M3 10h18" />
              <path d="M8 14h.01" />
              <path d="M12 14h.01" />
              <path d="M16 14h.01" />
              <path d="M8 18h.01" />
              <path d="M12 18h.01" />
              <path d="M16 18h.01" />
            </svg>
          </span>
          แตะวันที่ด้านบน เลือกจากปฏิทิน
        </li>
      </ol>
      <p className="coach-card-note" data-testid="coach-examples-plan">
        วันย้อนหลังแสดงห้องตามตารางผ่าตัดปกติ
      </p>
      <div className="coach-card-actions">
        <button type="button" className="btn btn-primary w-full" onClick={onNext} data-testid="coach-next">
          เข้าใจแล้ว
        </button>
      </div>
    </Card>
  );
}

function FinishCard({ onBoard, onAgain }: { onBoard: () => void; onAgain: () => void }) {
  return (
    <Card testId="coach-finish">
      <BigMascot mood="cheer" />
      <h2 id="coach-finish-title" className="coach-card-title">
        จบบทเรียนแล้ว เก่งมาก!
      </h2>
      <p className="coach-card-text">พร้อมจองห้องผ่าตัดจริงแล้ว การจองในบทเรียนไม่ได้บันทึก</p>
      <Tip testId="coach-finish-tip">จองทุกเคส elective ล่วงหน้า เพื่อได้คิวก่อนเสมอ</Tip>
      <div className="coach-card-actions">
        <button type="button" className="btn btn-primary w-full" onClick={onBoard} data-testid="coach-finish-board">
          ไปที่ตารางจริง
        </button>
        <button type="button" className="btn btn-ghost w-full" onClick={onAgain} data-testid="coach-again">
          เล่นอีกครั้ง
        </button>
      </div>
    </Card>
  );
}
