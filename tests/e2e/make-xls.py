"""Builds the .xls test files (Excel 97-2003) in tests/fixtures with LibreOffice, from made-up data only.

- e2e-or-export.xls and sample-or-export.xls: the made-up .xlsx exports saved as .xls, so the tests can check that both
  read the same, cell for cell.
- xls-long-strings.xls: 400 invented rows of long Thai and English text, numbers, dates, booleans and formulas, enough
  for the shared strings to run over several records (src/lib/xlsx.test.ts rebuilds every value from the row number).

Run: python3 -I tests/e2e/make-xls.py (needs openpyxl and soffice). Never feed it a real export.
"""

import datetime
import pathlib
import shutil
import subprocess
import tempfile

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"


def long_strings(path: pathlib.Path) -> None:
    book = openpyxl.Workbook()
    first = book.active
    first.title = "สรุป"
    first["A1"] = "ไม่ใช่แผ่นนี้"
    sheet = book.create_sheet("operation")
    sheet.append(["ข้อความ", "รหัส", "จำนวน", "วันที่", "ใช่", "สูตรข้อความ", "สูตรเลข", "สูตรจริงเท็จ"])
    for i in range(1, 401):
        row = i + 1
        sheet.append([
            f"ทดสอบข้อความยาว {i} " + "ข" * (i % 50),
            f"case-{i}",
            i * 1.25 if i % 2 else i,
            datetime.datetime(2026, 11, 1 + i % 28, 8 + i % 9, (i * 7) % 60),
            i % 2 == 0,
            f'=B{row}&"-x"',
            f"=C{row}*2",
            f"=C{row}>100",
        ])
    book.save(path)


def main() -> None:
    with tempfile.TemporaryDirectory() as work:
        work_dir = pathlib.Path(work)
        sources = []
        for name in ("e2e-or-export.xlsx", "sample-or-export.xlsx"):
            shutil.copy(FIXTURES / name, work_dir / name)
            sources.append(work_dir / name)
        long_strings(work_dir / "xls-long-strings.xlsx")
        sources.append(work_dir / "xls-long-strings.xlsx")
        subprocess.run(["soffice", "--headless", "--convert-to", "xls", "--outdir", str(FIXTURES), *map(str, sources)], check=True)


if __name__ == "__main__":
    main()
