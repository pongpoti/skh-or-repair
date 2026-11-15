/**
 * Whether an operation is a dressing case, from its name: the one rule for doctors' bookings and for the HOSxP
 * workbook's cases (lib/placement.ts isDressingCase), so both go to the dressing room alike.
 *
 * Pong, 15 Nov 2026: a name holding any of dress, dressing, ds, d/s, dw, d/w, vac or vacuum, in any case and in any
 * combination ("D/S + VAC", "vacdressing"), goes to the dressing room; so does debride, debridement or db; a graft
 * does not, whatever else the name holds. Typos in the longer words still count ("dresing", "vaccum", "vacume",
 * "debridment"), by a small edit distance on whole words that start with the same letter; the short words must be
 * exact, since a typo there would catch other names ("DJ stent" is one letter from "ds"). Also read as these words:
 * the usual shorthand dsg and drsg, "D-S", "D. S.", "D.B." and "V.A.C.", a count or re- around a word ("VACx2",
 * "revac"), and words glued by a dot ("Rt.VAC"). From the hospital's own rule: Thai ทำแผล, ล้างแผล and เปลี่ยนแผล
 * (however the vowels and tone marks are typed), "vacc" and "vacd", and STSG and SSKG as grafts; Claude added FTSG,
 * SSG, typos of graft and Thai ปลูก(ถ่าย)ผิวหนัง. The D of I&D never joins the next word ("I&D B/L" is no D/B), and a
 * DB colostomy is a double-barrelled one, not a debridement. A vacuum used for
 * something else (aspiration, curettage, extraction, a biopsy) is not a dressing. Isomorphic: the form shows the room
 * the server will pick.
 */

/** Words that mark a dressing case when they stand alone or join with each other. */
const WORDS = ["dress", "dressing", "ds", "d/s", "dw", "d/w", "dsg", "drsg", "vac", "vacc", "vacd", "vaccd", "vacuum", "db", "d/b", "debride", "debridement"] as const;
const EXACT: ReadonlySet<string> = new Set(WORDS);
/** The words long enough to forgive a typo, with how many edits each forgives. */
const FUZZY: readonly (readonly [string, number])[] = [
  ["dress", 1],
  ["dressing", 2],
  // Two, for "vacume" and "vaccume"; nothing that starts with v and is an operation is that close.
  ["vacuum", 2],
  ["debride", 1],
  ["debridement", 2],
];
/** A word that holds one of these is a dressing word whatever surrounds it ("redressing", "vacuumassisted", "debrided"). */
const INSIDE = ["dress", "vacuum", "debrid"] as const;
/** A graft keeps a case out of the dressing room (Pong, 15 Nov 2026): a word holding "graft", or STSG, FTSG, SSKG. */
const isGraftWord = (word: string) =>
  word.includes("graf") ||
  (word[0] === "g" && Math.abs(word.length - 5) <= 1 && editDistance(word, "graft") <= 1) ||
  ["stsg", "ftsg", "sskg", "ssg"].includes(bareWord(word).replace(/s$/, ""));
/** Thai skin graft: ปลูกถ่ายผิวหนัง, ปลูกผิวหนัง. */
const THAI_GRAFT = ["ปลูกถ่ายผิว", "ปลูกผิว"].map(thaiForm);
/**
 * The Thai text as it is compared: NFKC (which splits the vowel ำ in two), sara e typed twice read as sara ae (เเ looks
 * like แ), no tone marks (เปลียนแผล is a common slip), and no spaces between Thai letters ("ทำ แผล").
 */
function thaiForm(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u0E40\u0E40/g, "\u0E41")
    .replace(/[\u0E48-\u0E4B]/g, "")
    .replace(/(?<=[\u0E00-\u0E7F])\s+(?=[\u0E00-\u0E7F])/g, "");
}
const THAI = ["ทำแผล", "ล้างแผล", "เปลี่ยนแผล"].map(thaiForm);

/** Vacuum procedures that are not dressings. */
const VACUUM_OTHER = /aspirat|curett|extract|deliver|biops|vabb|thrombect|abort/;

/**
 * The optimal-string-alignment distance between two words: insertions, deletions, substitutions and swaps of two
 * neighbouring letters each cost one ("vaccum" is one from "vacuum", "drsesing" one from "dressing").
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** A word made entirely of dressing words with nothing between them ("dsvac", "vacdressing"). */
function joined(word: string): boolean {
  const ok: boolean[] = Array.from({ length: word.length + 1 }, (_, i) => i === 0);
  for (let end = 1; end <= word.length; end += 1) {
    for (const part of EXACT) {
      const start = end - part.length;
      if (start >= 0 && ok[start] && word.slice(start, end) === part) {
        ok[end] = true;
        break;
      }
    }
  }
  return word.length > 0 && ok[word.length];
}

function isWord(word: string): boolean {
  if (EXACT.has(word) || joined(word)) return true;
  // A word holding "dress" or "vacuum" counts, but not "address".
  if (INSIDE.some((inside) => word.includes(inside)) && !word.includes("address")) return true;
  return FUZZY.some(
    ([target, edits]) => word[0] === target[0] && Math.abs(word.length - target.length) <= edits && editDistance(word, target) <= edits,
  );
}

/** A word without a count after or before it ("VACx2", "DS2", "2DS") or re- before it ("revac"). */
const bareWord = (word: string) => word.replace(/x?\d+$/, "").replace(/^\d+x?/, "").replace(/^re(?=.)/, "");

function dressingWord(word: string): boolean {
  if (isWord(word)) return true;
  const bare = bareWord(word);
  return bare !== word && bare.length > 0 && isWord(bare);
}

/**
 * The words of an operation's name, lower case. "d / s", "D-S", "D\\S", "D. S." and "d s" are read as d/s (and the
 * same for d/w); letters each followed by a dot are one word ("D.S." is d/s, "V.A.C." is vac); any other dot breaks
 * words ("Rt.VAC" is rt and vac).
 */
export function operationWords(operation: string): string[] {
  let text = operation
    .normalize("NFKD")
    // Accents off ("Débridement"); Thai is not read here (isDressingOperation reads it whole).
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // Not the D of I&D (I & D, I/D, I+D, I and D), and not before a letter that starts another slash word: "I&D B/L",
    // "I&D w/ drain" and "D S/P" are no D/B, D/W or D/S.
    .replace(/(?<!(?<![a-z])i\s*(?:[&/+]|and)\s*)(?<![a-z0-9])d\s*[-\\./]?\s*([sbw])(?![a-z0-9]|\s*\/\s*[a-z])/g, "d/$1");
  // Join single letters each followed by a dot, until none is left.
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/(?<![a-z])([a-z])\.(?=[a-z](?:\.|(?![a-z])))/g, "$1");
  }
  text = text.replace(/\./g, " ").replace(/\s*\/\s*/g, "/");
  const words: string[] = [];
  for (const token of text.split(/[^a-z0-9/]+/)) {
    if (!token) continue;
    words.push(token);
    // "dressing/vac" is two words, "wound/d/w" is wound and d/w; "d/s" and "d/w" stay whole.
    if (token.includes("/") && !EXACT.has(token)) words.push(...(token.match(/(?<![a-z0-9])d\/[sbw](?![a-z0-9])|[^/]+/g) ?? []));
  }
  return words;
}

/**
 * "Vacuum" (or a typo of it) and no other dressing word. Every other dressing word has a d (dress, ds, dw, dsg, drsg,
 * db, debride); VAC itself is the vacuum dressing, so "I&D, aspiration, VAC" is still one.
 */
const vacuumOnly = (word: string) => !word.includes("d") && !["vac", "vacc"].includes(bareWord(word));

export function isDressingOperation(operation: string): boolean {
  const words = operationWords(operation);
  const thai = thaiForm(operation);
  if (words.some(isGraftWord) || THAI_GRAFT.some((word) => thai.includes(word))) return false;
  if (THAI.some((word) => thai.includes(word))) return true;
  const hits = words.filter(dressingWord);
  if (hits.length === 0) return false;
  const lower = operation.normalize("NFKC").toLowerCase();
  // "Vacuum aspiration", "vacuum-assisted breast biopsy": a vacuum, but no dressing.
  if (hits.every(vacuumOnly) && VACUUM_OTHER.test(lower)) return false;
  // "DB colostomy" is a double-barrelled stoma.
  if (hits.every((word) => ["db", "d/b"].includes(bareWord(word))) && /colost|ileost|stoma/.test(lower)) return false;
  return true;
}
