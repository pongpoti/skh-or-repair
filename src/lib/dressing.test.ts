import assert from "node:assert/strict";
import { test } from "node:test";
import { editDistance, isDressingOperation, operationWords } from "./dressing.ts";

test("the edit distance counts insertions, deletions, substitutions and swapped neighbours as one each", () => {
  assert.equal(editDistance("vacuum", "vacuum"), 0);
  assert.equal(editDistance("vaccum", "vacuum"), 1, "two neighbours swapped");
  assert.equal(editDistance("dresing", "dressing"), 1, "a letter left out");
  assert.equal(editDistance("dresssing", "dressing"), 1, "a letter doubled");
  assert.equal(editDistance("drewsing", "dressing"), 1, "a letter mistyped");
  assert.equal(editDistance("", "ds"), 2);
  assert.equal(editDistance("drape", "dress"), 3);
});

test("an operation's words: lower case, d / s read as d/s, dotted letters joined, other dots and slashes split", () => {
  assert.deepEqual(operationWords("D.S. + VAC"), ["d/s", "vac"]);
  assert.deepEqual(operationWords("d / s"), ["d/s"]);
  for (const name of ["D-S", "D\\S", "D. S.", "d s"]) assert.deepEqual(operationWords(name), ["d/s"], name);
  assert.deepEqual(operationWords("V.A.C."), ["vac"]);
  assert.deepEqual(operationWords("Rt.VAC change"), ["rt", "vac", "change"]);
  assert.deepEqual(operationWords("Lt.D/W"), ["lt", "d/w"]);
  assert.deepEqual(operationWords("Wound/D/W"), ["wound/d/w", "wound", "d/w"]);
  assert.deepEqual(operationWords("Dressing/VAC wound"), ["dressing/vac", "dressing", "vac", "wound"]);
  assert.deepEqual(operationWords("ＤＲＥＳＳＩＮＧ"), ["dressing"], "full-width letters");
});

test("each of Pong's words marks a dressing case, in any case and any combination", () => {
  for (const name of [
    "Dressing",
    "dress wound",
    "DS",
    "D/S",
    "d / s",
    "D.S.",
    "DW",
    "D/W",
    "VAC",
    "Vacuum",
    "Change VAC",
    "D/S + VAC",
    "Wound dressing/VAC",
    "dsvac",
    "vacdressing",
    "Re-dressing",
    "Redressing",
    "dressings",
    "Debridement + VAC",
    "Wound debridement and dressing",
    // debride, debridement and db count on their own (Pong, 15 Nov 2026), typos and D.B. too
    "Debridement",
    "Debride Lt foot",
    "Debrided wound",
    "Redebridement",
    "Debridment",
    "DB",
    "D.B. + VAC",
    "D/B",
    "DBx2",
    "Débridement",
    "Debridement B/L feet + VAC",
    "D/S B/L legs",
    "I&D w/ VAC",
    "VACD",
    "vaccd",
    "Amputation + dressing",
    "ทำแผล",
    "ล้างแผลที่ขา",
    // the usual shorthand, and ways of writing the words that a phone or a habit gives
    "Wound drsg",
    "Dsg change",
    "D-S",
    "D. S.",
    "V.A.C.",
    "Rt.VAC change",
    "1.VAC change",
    "Lt.D/W",
    "S/P amputation.VAC",
    "Wound/D/W",
    "VACx2",
    "VAC2",
    "DSx2",
    "D/Sx2",
    "Revac",
    "Vacuum-assisted closure",
    // VAC is the vacuum dressing whatever else the name holds
    "Aspiration + VAC",
    "I&D, aspiration, VAC",
    // Thai typed with เเ for แ, without the tone mark, or with a space
    "ทำเเผล",
    "ล้างเเผล",
    "เปลียนแผล",
    "ทำ แผล",
  ]) {
    assert.equal(isDressingOperation(name), true, name);
  }
});

test("typos in the longer words still count", () => {
  for (const name of ["Dresing", "dressinng", "drsesing", "Dresign", "dres", "drress", "vaccum", "vacum", "Vacuun", "Vacume", "Vaccume", "VAC dressnig"]) {
    assert.equal(isDressingOperation(name), true, name);
  }
});

test("other operations do not, the short words must be exact, and an address is not a dress", () => {
  for (const name of [
    "Lap chole",
    "ORIF radius",
    "DJ stent",
    "D&C",
    "I&D abscess",
    "TURP",
    "Vasectomy",
    "Vaccine",
    "Drape",
    "Press",
    "DSD",
    "Address",
    "Thyroidectomy",
    // a graft keeps a case out whatever else the name holds (Pong, 15 Nov 2026)
    "STSG/D/S",
    "Skin graft + dressing",
    "Debridement + STSG",
    "FTSG + VAC",
    "Split-thickness skin grafting, D/S",
    "Debridement + skin graf",
    "Debridement + garft",
    "Debridement + SSG",
    "DB + STSGs",
    "Debridement + ปลูกถ่ายผิวหนัง",
    "ล้างแผล ปลูกผิวหนัง",
    // the D of I&D is not D/B, D/W or D/S; debris is not debridement; a DB colostomy is a stoma
    "I&D B/L buttock abscess",
    "I & D B/L",
    "I/D B/L",
    "I and D B/L",
    "I&D w/ drain",
    "I&D w/ packing",
    "I&D S/P fall",
    "Removal of ear debris",
    "Arthroscopic debris removal",
    "DB colostomy",
    // short words glued to others are not the words
    "DBS insertion",
    // a vacuum for something else is not a dressing
    "Vacuum-assisted breast biopsy",
    "VABB (vacuum assisted breast biopsy)",
    "Manual vacuum aspiration",
    "Vacuum curettage",
    "Vacuum extraction (V/E)",
    "Vacuum delivery",
    // short words around a dot or with letters glued on stay themselves
    "Evac hematoma",
    "DSA",
    "Vagotomy",
    "Vascular access",
    "",
    "   ",
  ]) {
    assert.equal(isDressingOperation(name), false, name);
  }
});
