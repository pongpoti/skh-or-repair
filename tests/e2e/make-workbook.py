#!/usr/bin/env python3
"""Builds tests/fixtures/e2e-or-export.xlsx, the HOSxP file the end-to-end tests upload (tests/e2e/run.mjs).

It is the made-up sample export (tests/fixtures/sample-or-export.xlsx) cut to rows 1-17, the rows that make one
day's file (the sample's own answers: 9 kept, 7 dropped, 1 repeated ID, 2 cut), moved from Thu 5 Nov 2026 to the
e2e upload's day, Tue 17 Nov 2026. Every date column moves by the same 12 days, so the rules see the same gaps
between request, booking and operation. The HNs are replaced by other invented ones (71 + the case number), one
written with leading zeros so the matching's normalisation is exercised. Every name, HN and AN in it is invented.

Run with: python3 -I tests/e2e/make-workbook.py (needs openpyxl). The e2e tests read the result; they never run this.
"""

import datetime
import pathlib
import sys

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tests" / "fixtures" / "sample-or-export.xlsx"
TARGET = ROOT / "tests" / "fixtures" / "e2e-or-export.xlsx"
SHIFT = datetime.timedelta(days=12)  # Thu 2026-11-05 -> Tue 2026-11-17
KEEP_ROWS = 17
# Written with leading zeros: the board must still match it with a booking typed without them.
PADDED = {900015}


def main() -> int:
    book = openpyxl.load_workbook(SOURCE)
    sheet = book["operation"]
    header = [cell.value for cell in sheet[1]]
    hn_col = header.index("HN") + 1
    id_col = header.index("ID") + 1
    date_cols = [i + 1 for i, name in enumerate(header) if name in ("วันที่", "สั่งผ่าตัดวันที่", "วันที่ผ่าตัด")]
    if len(date_cols) != 3:
        print(f"expected three date columns, found {len(date_cols)}", file=sys.stderr)
        return 1

    # Rows 1-17 of the sample are spreadsheet rows 2-18; drop the rest (other days).
    sheet.delete_rows(KEEP_ROWS + 2, sheet.max_row - KEEP_ROWS - 1)
    for row in range(2, KEEP_ROWS + 2):
        for col in date_cols:
            cell = sheet.cell(row=row, column=col)
            if isinstance(cell.value, datetime.datetime):
                cell.value = cell.value + SHIFT
        case_id = int(sheet.cell(row=row, column=id_col).value)
        hn = f"71{case_id - 900000:06d}"
        sheet.cell(row=row, column=hn_col).value = f"00{hn}" if case_id in PADDED else hn

    book.save(TARGET)
    print(f"wrote {TARGET.relative_to(ROOT)}: {KEEP_ROWS} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
