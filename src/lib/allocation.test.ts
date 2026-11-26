import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocationText,
  DEPARTMENTS,
  INK,
  INSTRUMENT_ROOM,
  readableTextOn,
  RECOVERY_ROOM,
  weekdayIndex,
  weekOfMonth,
  weeklyAllocationFor,
  weeklyGuestRooms,
} from "./allocation.ts";
import { ROOM_CORNER_RADIUS, ROOMS, roomBounds, roomOutline } from "./rooms.ts";

// The usual weekly schedule, which the board shows outside the repair (Pong, 21 Nov 2026; lib/repair.test.ts covers
// when). These tests keep its data right.

const MON = "2026-10-05";
const WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const code = (roomId: string, date: string, part: "am" | "pm" = "am") =>
  weeklyAllocationFor(roomId, date)?.[part]?.code ?? null;

test("reads the weekday and the week of the month from a date", () => {
  assert.equal(weekdayIndex(MON), 0);
  assert.equal(weekdayIndex("2026-10-09"), 4);
  assert.equal(weekdayIndex("2026-10-04"), 6);
  assert.equal(weekOfMonth("2026-10-01"), 1);
  assert.equal(weekOfMonth("2026-10-07"), 1);
  assert.equal(weekOfMonth("2026-10-08"), 2);
  assert.equal(weekOfMonth("2026-10-29"), 5);
  assert.equal(weekdayIndex("nope"), null);
  assert.equal(weekdayIndex("2026-02-31"), null);
});

test("gives each OR to the department the proposed schedule names", () => {
  // Monday to Friday, mornings, one row per OR, as drawn in the 21 Nov 2026 schedule. 5 Oct is the 1st Monday (CVT in
  // OR 11, ORTHO in OR 13) and 7 Oct the 1st Wednesday (GENSX in OR 5); the split days and the turns are tested below.
  const grid: Record<string, string[]> = {
    "or-1": ["INFECT", "INFECT", "INFECT", "INFECT", "INFECT"],
    "or-2": ["GENSX", "GENSX", "GENSX", "GENSX", "GENSX"],
    "or-3": ["SCOPE", "SCOPE", "SCOPE", "SCOPE", "SCOPE"],
    "or-4": ["OBGYN", "ENT", "ENT", "ENT", "ENT"],
    "or-5": ["GENSX", "PEDSX", "GENSX", "GENSX", "GENSX"],
    "or-6": ["OBGYN", "OBGYN", "OBGYN", "OBGYN", "OBGYN"],
    "or-7": ["URO", "URO", "URO", "URO", "URO"],
    "or-8": ["EMER", "EMER", "EMER", "EMER", "EMER"],
    "or-9": ["PLASTIC", "MAXILLO", "PLASTIC", "PLASTIC", "OBGYN"],
    "or-10": ["EYE", "EYE", "EYE", "EYE", "EYE"],
    "or-11": ["CVT", "ORTHO", "ORTHO", "ORTHO", "VASCULAR"],
    "or-12": ["ORTHO", "NEURO", "ORTHO", "NEURO", "ORTHO"],
    "or-13": ["ORTHO", "ORTHO", "CVT", "ORTHO", "ORTHO"],
  };
  for (const [roomId, codes] of Object.entries(grid)) {
    assert.deepEqual(WEEK.map((date) => code(roomId, date)), codes, roomId);
  }
});

test("keeps each room's department all day, except OR 11 on Friday", () => {
  const friday = weeklyAllocationFor("or-11", "2026-10-09");
  assert.deepEqual([friday?.am?.code, friday?.pm?.code, friday?.split], ["VASCULAR", "NEPHRO", true]);
  assert.equal(allocationText(friday!), "เช้า ศัลยกรรมหลอดเลือด · บ่าย อายุรกรรมโรคไต");
  // The 21 Nov 2026 schedule made OR 5 on Tuesday paediatric surgery all day (it was split, GENSX in the afternoon).
  const tuesday = weeklyAllocationFor("or-5", "2026-10-06");
  assert.deepEqual([tuesday?.am?.code, tuesday?.pm?.code, tuesday?.split], ["PEDSX", "PEDSX", false]);
  const split = new Set(["or-11 2026-10-09"]);
  for (const room of ROOMS.filter((item) => item.kind === "or")) {
    for (const date of [...WEEK, "2026-10-12", "2026-10-13", "2026-10-14"]) {
      if (split.has(`${room.id} ${date}`)) continue;
      const allocation = weeklyAllocationFor(room.id, date);
      assert.equal(allocation?.split, false, `${room.id} ${date}`);
      assert.equal(allocation?.am?.code, allocation?.pm?.code);
    }
  }
  assert.equal(allocationText(weeklyAllocationFor("or-7", MON)!), "ศัลยกรรมทางเดินปัสสาวะ");
});

test("alternates OR 11 and OR 13 on Monday and OR 5 on Wednesday by the week of the month", () => {
  // Weeks 1, 3 and 5: CVT in OR 11, ORTHO in OR 13. Weeks 2 and 4: ORTHO in OR 11, CVT in OR 13. The whole day.
  const mondays: [string, string, string][] = [
    ["2026-10-05", "CVT", "ORTHO"],
    ["2026-10-12", "ORTHO", "CVT"],
    ["2026-10-19", "CVT", "ORTHO"],
    ["2026-10-26", "ORTHO", "CVT"],
    ["2026-08-31", "CVT", "ORTHO"], // a 5th Monday (30 Nov 2026 is in the repair)
  ];
  for (const [date, or11, or13] of mondays) {
    for (const part of ["am", "pm"] as const) {
      assert.equal(code("or-11", date, part), or11, `OR 11 ${date} ${part}`);
      assert.equal(code("or-13", date, part), or13, `OR 13 ${date} ${part}`);
    }
  }
  // OR 5 on Tuesday does not alternate: paediatric surgery all day, every week.
  for (const date of ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]) {
    assert.equal(code("or-5", date), "PEDSX", date);
    assert.equal(code("or-5", date, "pm"), "PEDSX", date);
  }
  // OR 5 on Wednesday alternates the whole day: GENSX in weeks 1, 3 and 5, PEDSX in weeks 2 and 4.
  const wednesdays: [string, string][] = [
    ["2026-10-07", "GENSX"],
    ["2026-10-14", "PEDSX"],
    ["2026-10-21", "GENSX"],
    ["2026-10-28", "PEDSX"],
    ["2026-09-30", "GENSX"], // a 5th Wednesday
  ];
  for (const [date, or5] of wednesdays) {
    for (const part of ["am", "pm"] as const) assert.equal(code("or-5", date, part), or5, `OR 5 ${date} ${part}`);
  }
  // Other days of OR 11 and OR 13 do not alternate.
  for (const date of ["2026-10-07", "2026-10-14"]) assert.equal(code("or-13", date), "CVT", date);
  for (const date of ["2026-10-06", "2026-10-13"]) assert.equal(code("or-11", date), "ORTHO", date);
});

test("knows when the schedule is silent", () => {
  assert.equal(weeklyAllocationFor("or-2", "2026-10-03"), null, "Saturday");
  assert.equal(weeklyAllocationFor("or-2", "2026-10-04"), null, "Sunday");
  assert.equal(weeklyAllocationFor("r-1", MON), null, "recovery room");
  assert.equal(weeklyAllocationFor("or-2", "nope"), null);
});

test("gives every OR a department on every weekday", () => {
  const ors = ROOMS.filter((room) => room.kind === "or");
  assert.equal(ors.length, 13);
  for (const room of ors) {
    for (const date of WEEK) {
      const allocation = weeklyAllocationFor(room.id, date);
      assert.ok(allocation?.am && allocation.pm, `${room.id} ${date}`);
    }
  }
});

test("matches the schedule's half-day periods per department", () => {
  // The schedule's periods in a week whose Monday is in week 1 of the month (one period is a half day).
  const periods: Record<string, number> = {};
  for (const room of ROOMS.filter((item) => item.kind === "or")) {
    for (const date of WEEK) {
      const allocation = weeklyAllocationFor(room.id, date)!;
      for (const dept of [allocation.am!, allocation.pm!]) periods[dept.code] = (periods[dept.code] ?? 0) + 1;
    }
  }
  assert.deepEqual(periods, {
    INFECT: 10, GENSX: 18, SCOPE: 10, OBGYN: 14, ENT: 8, PEDSX: 2, URO: 10, EMER: 10,
    PLASTIC: 6, MAXILLO: 2, CVT: 4, ORTHO: 20, VASCULAR: 1, NEPHRO: 1, EYE: 10, NEURO: 4,
  });
  assert.equal(Object.values(periods).reduce((a, b) => a + b, 0), 130);
});

test("sends chest medicine, which has no period, to OR 4 on Mondays (21 Nov 2026 schedule)", () => {
  assert.deepEqual(weeklyGuestRooms("CHEST", MON), ["or-4"]);
  assert.equal(code("or-4", MON), "OBGYN", "the room still shows its owner");
  for (const date of WEEK.slice(1)) assert.deepEqual(weeklyGuestRooms("CHEST", date), [], date);
  assert.deepEqual(weeklyGuestRooms("CHEST", "2026-10-04"), [], "Sunday");
  assert.deepEqual(weeklyGuestRooms("GENSX", MON), []);
  assert.deepEqual(weeklyGuestRooms("CHEST", "nope"), []);
});

test("keeps the plan labels short", () => {
  assert.equal(DEPARTMENTS.INFECT.label, "D/S");
  assert.equal(DEPARTMENTS.VASCULAR.label, "VAS");
  assert.equal(DEPARTMENTS.PLASTIC.label, "PLAST");
  assert.equal(DEPARTMENTS.NEPHRO.label, "NEPHR");
  assert.equal(DEPARTMENTS.MAXILLO.label, "MAXI");
  assert.equal(DEPARTMENTS.EMER.label, "EMER");
  for (const dept of Object.values(DEPARTMENTS)) assert.ok(dept.label.length <= 5, dept.code);
});

test("uses the meaning-based department colours approved on 14 Nov 2026", () => {
  const list = {
    GENSX: "#1E7B3C", SCOPE: "#6B7016", VASCULAR: "#2E4FA8", ORTHO: "#455A64", OBGYN: "#C2188F", EYE: "#0277BD",
    URO: "#9A6B00", PLASTIC: "#A85C52", ENT: "#00838F", NEPHRO: "#6B4A2E", CHEST: "#5867B8", PEDSX: "#C25400",
    NEURO: "#5E35B1", CVT: "#931A32", MAXILLO: "#8A5A83", INFECT: "#8E3E12", EMER: "#D32F2F", MINOR: "#5F7380",
    MIXED: "#5C5650", UNK: "#7A746C",
  };
  assert.deepEqual(Object.fromEntries(Object.values(DEPARTMENTS).map((dept) => [dept.code, dept.color])), list);
  assert.equal(new Set(Object.values(DEPARTMENTS).map((dept) => dept.color)).size, 20);
});

test("picks white or ink text, whichever reads better", () => {
  assert.equal(readableTextOn("#1E7B3C"), "#ffffff");
  assert.equal(readableTextOn("#1D3F8F"), "#ffffff");
  assert.equal(readableTextOn("#B3261E"), "#ffffff");
  assert.equal(readableTextOn("#C9D86A"), INK);
  assert.equal(readableTextOn("#E3A21A"), INK);
  assert.equal(readableTextOn("#E3E8EA"), INK);
});

test("every department label is white and meets 4.5:1 on its colour", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const dept of Object.values(DEPARTMENTS)) {
    assert.equal(readableTextOn(dept.color), "#ffffff", dept.code);
    assert.ok(contrast(dept.color, "#ffffff") >= 4.5, `${dept.code} ${dept.color}`);
  }
  // RR is in the list too, mint with dark green text (Pong, 15 Nov 2026).
  assert.equal(RECOVERY_ROOM.color, "#BFE4D5");
  assert.equal(readableTextOn(RECOVERY_ROOM.color), INK, "white would not read on mint");
  assert.ok(contrast(RECOVERY_ROOM.ink, RECOVERY_ROOM.color) >= 7, `RR ${RECOVERY_ROOM.ink} on ${RECOVERY_ROOM.color}`);
  // The instrument room is light tan with near-black text, as on the repair plan images (Pong, 15 Nov 2026).
  assert.equal(INSTRUMENT_ROOM.color, "#D9C7AE");
  assert.equal(readableTextOn(INSTRUMENT_ROOM.color), INK, "white would not read on light tan");
  assert.ok(contrast(INSTRUMENT_ROOM.ink, INSTRUMENT_ROOM.color) >= 7, `${INSTRUMENT_ROOM.ink} on ${INSTRUMENT_ROOM.color}`);
});

test("an OR is drawn with rounded corners over the box of its cut-corner shape (Pong, 15 Nov 2026)", () => {
  for (const room of ROOMS) {
    const { minX, minY, maxX, maxY } = roomBounds(room);
    if (room.kind !== "or") {
      assert.equal(roomOutline(room), room.d, `${room.id} keeps its square corners`);
      continue;
    }
    // The shape it replaces: the box with 22-unit cut corners, so the rounded outline covers the same room.
    const c = 22;
    const cut = `M${minX} ${maxY - c}L${minX} ${minY + c}L${minX + c} ${minY}L${maxX - c} ${minY}L${maxX} ${minY + c}L${maxX} ${maxY - c}L${maxX - c} ${maxY}L${minX + c} ${maxY}Z`;
    assert.equal(room.d, cut, `${room.id} is a box with cut corners`);
    const r = ROOM_CORNER_RADIUS;
    assert.ok(r > c && r * 2 < Math.min(maxX - minX, maxY - minY), `${room.id}: a little rounder than the cut, still with straight sides`);
    const outline = roomOutline(room);
    assert.ok(outline.startsWith(`M${minX + r} ${minY}H${maxX - r}`), outline);
    assert.equal(outline.match(new RegExp(`A${r} ${r} 0 0 1 `, "g"))?.length, 4, `${room.id}: four round corners`);
  }
});

test("room outlines enclose their label point", () => {
  for (const room of ROOMS) {
    const { minX, minY, maxX, maxY } = roomBounds(room);
    assert.ok(room.labelX > minX && room.labelX < maxX, `${room.id} x`);
    assert.ok(room.labelY > minY && room.labelY < maxY, `${room.id} y`);
  }
});
