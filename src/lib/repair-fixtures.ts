import { DEFAULT_REPAIR_PERIODS, type RepairPeriods } from "./repair.ts";

/**
 * Tests only: the repair's halves with the first half starting on 1 Jan 2026, as planned until 21 Nov 2026, so the
 * tests of the repair's rooms keep their November 2026 dates. The planned dates themselves (the repair from 8 Dec 2026,
 * the normal weekly OR schedule before it) are tested in lib/repair.test.ts.
 */
export const REPAIR_FROM_JAN: RepairPeriods = {
  ...DEFAULT_REPAIR_PERIODS,
  half1: { ...DEFAULT_REPAIR_PERIODS.half1, from: "2026-01-01" },
};
