# orskh

Operating-suite board. Staff sign in with LINE and a one-time code sent by SMS, then pick a room on the floor plan to see that day’s cases.

The board shows **one day**, dated in Thai with the Buddhist year (Thailand time). The suite's day turns over at **16:00**, not at midnight (`src/lib/board-day.ts`): until 16:00 on a workday the board shows today; from 16:00 it shows the next workday, whose list MX uploaded between 15:00 and 16:00. At the weekend and on a holiday it already shows the next workday. The line above the date says which: "ตารางผ่าตัดวันนี้" (today), "ตารางผ่าตัดพรุ่งนี้" (tomorrow) or "ตารางผ่าตัด" (a later day, such as Monday seen on a Saturday). There is no paging between days. A workday is Monday to Friday and not a Thai public or special holiday. Holidays come from the Bank of Thailand's Financial Institutions' Holidays API (public holidays, substitution days and the special holidays the cabinet announces), fetched again every six hours, plus any dates in `EXTRA_HOLIDAYS` (`src/lib/holidays.ts`). If the API cannot be read, the board carries on with weekdays and `EXTRA_HOLIDAYS`; only the upload stops (see HOSxP upload). The page refreshes itself at 16:00 and at midnight, and when the tab comes back after more than 5 minutes in the background. A board brought back with the browser's Back button refreshes at once if its moment passed meanwhile. In development, `/preview` shows the board without signing in (see Local development).

## Case data

A room's case rows come from two places, merged on the server for the board's day (`src/lib/board-rows.ts`):

1. **The HOSxP workbook.** HOSxP is รพ.สมุทรสาคร's hospital information system. Every day between 15:00 and 16:00 an MX user (ผู้จัดการตาราง) uploads HOSxP's operation list for the next workday as an `.xlsx` file on `/upload` (see HOSxP upload). Rows show only from the upload of the board's own cycle, so nothing is left over from an earlier day.
2. **Doctors' room bookings**, each with the patient's HN (see Room bookings by doctors).

A workbook case and a booking with the same HN on the same day are one case (see Case rows: source and matching).

The old weekly export (`scripts/build_week.py`, `src/data/week-data.ts`) no longer feeds the board. The week file is empty, and it is kept only for its tests.

The rules for the workbook (`src/lib/workbook.ts`, `src/lib/placement.ts`):

- **Only what the board needs is kept:** case ID, HN, operation name, surgeon (with the surgeon's team, for the SCOPE rule below), department, room, shift, status, urgency and booked time. Patient name, age, AN, diagnosis, illnesses and costs are never read into a row, stored or logged.
- **Every row's `สั่งผ่าตัดวันที่` must be the upload's day** (Buddhist years are converted). Otherwise the whole file is refused and the message lists the dates found.
- **These rows are dropped,** and the upload's summary counts each reason:
  - cancelled;
  - marked Stat or Emergency;
  - the operation name says on call, emergency, stat, ด่วน and the like;
  - out of hours (SMC included);
  - booked outside 08:00–15:00;
  - Urgency with no booked time;
  - no case ID.
- **A repeated case ID** counts once.
- **Cuts, following the utilisation report:** Tha Chalom hospital cases, and vascular surgery on Tuesday to Thursday (Tha Chalom's quota).
- **The department** comes from แผนก, then ชนิด, then the surgeon lists (`src/lib/physicians.ts`), then the department that surgeon has most often in the same file. A case with none is left off the board.
- **The export's room column is not trusted** and is not even stored. Every case is placed by the report's rules:
  - **During the repair**, rooms come from the repair's layout (below):
    - dressing cases go to the dressing room;
    - emergency cases go to the emergency room, and NEURO and CVT emergencies to the half's override rooms;
    - SCOPE cases, and departments with no room of their own, go to the คละแผนก (OTHER) room;
    - anything else goes to its department's room, the one with the fewest cases when there are several.
    - Obstetrics and gynaecology are not placed at all: they operate in the obstetric OR (อาคารแม่ ชั้น 3), and the summary says so.
  - **Outside the repair**, the weekly allocation applies:
    - dressing cases go to OR 1, emergency cases to OR 8 (obstetrics-gynaecology stays in its own room);
    - anything else goes to a room its department holds that day, spread across them when it holds several;
    - a case whose department holds no room that day is left off the board.
- Outside the repair, OR 1 is exclusive to dressing cases from any sub-specialty, checked before everything else (even emergency); during the repair the half's dressing room is. A case is a dressing case when its operation name matches the hospital's keyword regex (dressing, d/s, ds and dw as whole words, ทำแผล, ล้างแผล, เปลี่ยนแผล, change vac, vac d) and does not also name debridement/db, scrub, graft, suture, closure, escharotomy, fasciotomy, excision, incision or amputation. The hospital's last step (every item in the operation-items column must be a dressing) is skipped because the export has no such column, so this is the broader definition.
- Outside the repair, the SCOPE room (OR 3) is exclusive (during the repair SCOPE cases go to the คละแผนก room): it takes only cases by a GENSX-labelled surgeon whose operation name matches `egd, gastroscop, esophagoscop, ogd, colono, sigmoido, ercp, endoscop, eus` (case-insensitive, whole word for the short ones) and does not match `remove fb, foreign body, fb`. Such cases go nowhere else; other general-surgery cases use the GENSX rooms. The file has one operation-name column, so only that is matched.
- Cases are listed by their position in the file, with the shift flagged when it is out of hours.
- Surgeons are matched to the supplied physician list (`src/lib/physicians.ts`). Who may sign in is a separate list, the `users` table (see Sign-in).

Room allocation comes from the new proposed OR schedule (ตารางผ่าตัดใหม่ที่นำเสนอ, 4 Nov 2026; `src/lib/allocation.ts`). Every OR has one department all day, except OR 5 on Tuesday (paediatric surgery in the morning, general surgery in the afternoon) and OR 11 on Friday (vascular in the morning, nephrology in the afternoon). On Mondays OR 11 and OR 13 alternate by week of the month: weeks 1, 3 and 5 CVT in OR 11 and ORTHO in OR 13, weeks 2 and 4 the other way round. Periods the schedule marks as over quota (*) are shown like any other. The per-department half-day periods are checked by a test (130 a week). Department colours are the chip colours of the proposed-schedule image Pong shared on 4 Nov 2026 (CHEST, LA and unknown keep their earlier colours); each OR takes its department's colour and code as its label, and every colour clears 4.5:1 against its white label. Every OR is filled with its department's colour for the day, whether or not it has cases; a room with no department would use the list's "unknown" gray. Recovery rooms share the service-area beige and the old circulation zone is a walkway.

### Open rooms

**All of OR 1 to 13 are open (the normal OR)**, each holding the department the weekday OR schedule gives it (Pong, 5 Nov 2026). Every OR can be opened on the plan, takes imported cases by the rules above, and can be chosen for a new case. Closing a room is still possible: the open list is `OPEN_ROOM_IDS` in `src/lib/rooms.ts`, and a room taken out of it is drawn grey with stripes and ปิด, cannot be opened (a `?room=` link to one is ignored), takes no imported case and cannot be chosen for a new case (OR 6 to 13 were closed this way in early November 2026). With OR 8 closed, an imported emergency case would go to its department's open room instead. Which rooms are open depends on the day and the repair's dates (`roomUse(room, date, periods)`, see the repair layout below).

### Ventilation repair layout (in use from 14 Nov 2026)

The air-ventilation system is repaired in two halves (Pong, 14 Nov 2026). While a half runs, the weekly schedule is set aside: each room in use has one fixed use every working day, morning and afternoon. Outside both halves the weekly allocation applies as before. The layout lives in `src/lib/repair.ts` (`REPAIR_LAYOUTS`).

| | Operating | Recovery rooms (RR) | Instrument room | Closed | NEURO and CVT emergencies |
| --- | --- | --- | --- | --- | --- |
| 1st half, planned 14 Nov 2026 – 26 Jan 2027 | OR 9 EMER, OR 10 dressing (D/S), OR 11 คละแผนก (OTHER), OR 12 GENSX, OR 13 ORTHO | OR 7, 8 | – | OR 1–6, RR 1 and 2 | OR 12 or 13 (fewer cases) |
| 2nd half, planned 27 Jan – 17 Mar 2027 | OR 1 dressing, OR 2 ORTHO, OR 3 EMER, OR 4 คละแผนก (OTHER), OR 5 GENSX | RR 2 (as usual) | OR 6 (เครื่องมือ) | OR 7–13, RR 1 | OR 2 |

**The dates are the admin's.** The planned dates are only the seed: an admin moves either half on `/admin` (ช่วงปิดซ่อมห้องผ่าตัด, see Admin page). The dates are kept in the `repair_periods` table (one row per half, with who saved it and when). The rules: both halves need a start and an end, and the second half must start after the first ends; a gap between them is allowed, and the weekly schedule applies then. A save changes the board for everyone at once, HOSxP cases already uploaded included: the board places an upload's cases again each time it is read, under the dates in force then, so a case never stays in a room the new dates close (the upload page's rooms and matching follow too). If the table cannot be read, the board uses the planned dates and logs it once.

**Obstetrics and gynaecology** operate in the obstetric OR (อาคารแม่ ชั้น 3) for the whole repair, so their HOSxP cases are not placed on the board.

**How it looks:**
- Each operating room is drawn in its department's own colour with the department's code as its label, as outside the repair.
- The recovery rooms and the instrument room are drawn in the app's brown (`REPAIR_COLOR`), labelled RR and เครื่องมือ. They cannot be opened.
- Closed rooms keep the grey stripes and ปิด.
- The closed area of the half is drawn as one dark zone with taupe stripes, a dashed edge and the tag "พื้นที่ปิดซ่อม". It lies under nothing clickable, the closed rooms' numbers still read through it, and it never covers a room in use, the lifts, the stairs or the lobby.
- The board shows a one-line note with the half and its last day ("ปิดซ่อมห้องผ่าตัด ช่วงที่ 1 · ถึง 26 ม.ค. 2570").

A booking already saved for a room that does not operate on its day is marked in the doctor's list and left off the board. In development, `/preview?date=2027-02-01` shows the board as on any date.

### Room bookings by doctors (with HN)

A signed-in doctor (a current claim on an active `users` row of type `DR`) sees a **จองห้อง** button at the corner of the plan. The form (จองห้องผ่าตัด) asks for:
- **the day:** today up to 60 days ahead, Monday to Friday, not a holiday. The form opens on the board's day (from 16:00 the next workday, past any holiday);
- **an open room:** only rooms operating on that day under the repair's dates, each shown with its department; the doctor's own department's room is picked first;
- **the patient's HN** (required): 1 to 15 letters, digits or dashes. It is saved in its matching form (spaces and dashes removed, upper case, no leading zeros), and the form says so under the box when that differs from what was typed;
- **the operation name** (optional, up to 300 characters): HOSxP's file gives it later;
- **ในเวลา or นอกเวลา.**

The surgeon is always the doctor who books. Under the form the doctor sees their own bookings from today on, with their HN, and can cancel them (only their own; ยกเลิกจอง, then ยืนยันยกเลิก). Nurses, assistants, approved requests and `ALLOWED_PHONES` numbers see no button. The server actions (`src/app/(board)/actions.ts`) check the doctor again on every call, check the day and room against the repair's dates and the holidays, and never log an HN. A doctor can book at most 60 rooms in 24 hours.

Bookings are stored in the `cases` table (`db/schema.sql`, created on first use like the sign-in tables) with the HN and no other patient field. Bookings made before the HN was asked for have none. A cancelled booking keeps its row with `removed_at` set. If the table cannot be read, the board shows a notice ("โหลดเคสไม่สำเร็จ ลองรีเฟรช") and the button is hidden.

### HOSxP upload (MX)

**MX** (ผู้จัดการตาราง) is a role an admin grants on `/admin` (table `mx_members`, by `users.id`). It follows the user's claim: it ends when the claim ends or the user goes inactive. Admins can do everything MX can.

MX and admins get an **อัปโหลดตาราง** button in the top bar and the same link in the account menu, both opening `/upload`. On phones the button is an icon. On the narrowest phones (below 390px, or 450px beside the admin button) it is left out so the date keeps its year, and the menu's link stands in. Everyone else gets a not-found page at `/upload`.

The page shows:
- the day the file is for, "ตารางของ{วัน}": the next workday after today by the Bank of Thailand's holidays, even when today is a weekend or holiday;
- the window, "เปิดรับไฟล์ 15:00–16:00 น.", with its state in words (ยังไม่เปิดรับ, เปิดรับอยู่, ปิดรับแล้ว);
- for admins, "ผู้ดูแลอัปโหลดได้ทุกเวลา".

**Who may upload, and when.** MX may upload from 15:00:00 up to 16:00:00 Bangkok time, every day, holidays included. Admins may upload at any time. If the holidays API cannot be read, nobody can upload ("ตรวจวันหยุดจากธนาคารแห่งประเทศไทยไม่ได้ ลองใหม่อีกครั้ง"), because a guessed day could put a list on the wrong date.

**The file.** **Only `.xlsx` is accepted**, up to 4 MB (Vercel refuses any request over 4.5 MB before the app sees it, so the limit stays under that and a refused file always gets the app's own message). An `.xls`, or an Excel file with a password, is refused with "ไฟล์นี้เป็น .xls หรือตั้งรหัสผ่านไว้ กรุณาเปิดใน Excel แล้วบันทึกเป็น .xlsx (ไม่ตั้งรหัสผ่าน) ก่อน". It is refused both by its name in the page and by its content on the server. The reader (`src/lib/xlsx.ts`) is the app's own, with no npm dependency. It reads the sheet named `operation` (or the first sheet) and refuses zip bombs: at most 30 MB unpacked, 1,000 zip entries, 5,000 rows and 200 columns.

**The checks on the server.** The server action (`src/app/upload/actions.ts`) checks the role, the window and the file again, by the server's clock. The day the page named must still be the upload's day. Then the file goes through the rules under Case data, and is placed in the rooms of its day.

**What is saved.** The upload is saved in the `workbook_uploads` and `workbook_cases` tables, holding only the fields listed under Case data, with the HN in its matching form. Each new upload deletes, in the same transaction, the uploads made more than 30 days before it, with their cases. Nothing else deletes them: if MX stops uploading (after the repair, say), the last 30 days of lists stay until the next upload or until they are deleted by hand (`DELETE FROM workbook_uploads WHERE uploaded_at < now() - interval '30 days'`; the cases go with them).

**After an upload**, the page shows a one-line answer and the day's latest upload:
- when it was made and by whom;
- rows read, kept and placed;
- the rows left out, by reason;
- the cases per room, and the cases not placed, with why;
- how it matches the doctors' bookings: matched; HOSxP cases nobody booked; bookings HOSxP does not list. Each case has its room, surgeon, HN and operation, since only MX and admins see this page.

The rooms and the matching are worked out again on every visit, as the board does, so a booking made after the upload counts, and so does a change of the repair's dates. MX may upload again before 16:00; the latest upload of the day wins.

### The 16:00 turnover

An upload belongs to the day it was made (its cycle) and is for the next workday after it. The board shows only **the latest upload made on its cycle day for its own date**. A cycle day is today from 16:00, yesterday before then. So at 16:00 every day the board clears the day's rows and shows the next workday with the upload MX made between 15:00 and 16:00. An admin's upload after 16:00 shows at once.

If MX has not uploaded, every user sees "ยังไม่มีตาราง HOSxP ของ {date}" above the plan, in the repair or not: the board's rows come only from the uploads, so an empty room must not look like a day with no cases. The rooms still open and show the doctors' bookings, with no flags since there is nothing to compare with.

### Case rows: source and matching

Each row in a room's list carries a small chip, an icon and a word, saying where it comes from (`src/components/case-source.tsx`; the icons are Lucide's, under the ISC licence). The word is always there, so the colour is never the only sign:
- **HOSxP** (a database glyph, not the vendor's logo): a workbook case.
- **จอง** (a calendar with a check): a doctor's booking.
- **ตรงกัน** (a handshake): a workbook case that matches a booking by HN on the same day.

**Matching.** Matching is one to one by the HN's matching form. Workbook cases are taken in file order, and each takes the earliest booking with its HN that is still free.
- A matched pair shows once, in the booking's room (the surgeon reserved it), with HOSxP's operation name and status.
- A HOSxP case nobody booked shows in the room placement gave it, with the badge **ไม่มีการจอง** (amber).
- A booking HOSxP does not list shows in its room with **ไม่พบใน HOSxP** (red), but only once the day has an upload.
- A booking with no operation name reads "จองห้อง (รอข้อมูล HOSxP)".

**Mismatches are shown to all users:** "ไม่ตรงกับการจอง {n} รายการ" above the plan, and an amber triangle with "!" in the corner of each room that has one. The room's spoken name gains "ข้อมูลไม่ตรงกับการจอง".

**HN is shown only to:**
- the doctor who made the booking (their own bookings);
- MX;
- admins.

For anyone else the server leaves the HN out of the page's data altogether, not just off the screen. No HN or workbook row is ever logged.

## Design

The look follows the SAKHONMSO P4P dashboard: shadcn/ui's design language with a deep brown primary and a tan accent, frosted-glass panels over a warm gradient, and an OR surgeon in scrub cap, surgical mask and scrubs on a brown tile as the mark (`BrandMark`, the same drawing as `src/app/icon.svg`, `apple-icon.png` and `favicon.ico`). Text is Inter for Latin and Noto Sans Thai Looped for Thai (looped letters keep their heads and read better on a phone), with extra line height for Thai. The layout is kept short: one app bar holds the mark, today's date and the account menu (a popover behind the avatar, with a plain sign-out button where popovers are unsupported), and the floor plan takes the rest. On a desktop the plan fills the full height beside the room's case column, which widens with the screen (26rem, 30rem from 1280px, 34rem from 1536px), and the layout spreads to 120rem. Tokens (colour, surfaces, status, shadows) live at the top of `src/app/globals.css`; shared pieces are `.btn` (`-primary`, `-secondary`, `-ghost`), `.field`, `.card`, `.pill`, `.badge`, `.chip` and `.notice`, plus `AuthShell` and `BrandMark` in `src/components`. The app is built to be usable by everyone:

- Text and status pairs meet WCAG AA (4.5:1); department labels are checked by a test.
- One blue focus ring on every control, and keyboard focus on a room outlines its wall.
- Touch targets are at least 44px. Pinch-zoom is left on.
- Colour is never the only cue: room markers differ by shape (live = circle, delayed = diamond), rooms carry a text code, cancelled cases are struck through, and each case's status is read out to screen readers.


## Stack

Next.js 16, React 19, Tailwind CSS 4, Postgres (Neon in production) through `pg`, `jose` for tokens, [deeSMSX](https://deesmsx.com) for the SMS codes (plain `fetch`, no SDK); the admin page's surgeon list goes through drizzle (`src/db`). The sign-in is the one from skh-or-schedule, restyled for this board.

## Sign-in

1. **LINE Login** (OAuth with PKCE). The LINE account's id is the session's `sub`.
2. **Mobile number and SMS code.** On `/login/verify` (ยืนยันเบอร์มือถือ) the user types a Thai mobile number (10 digits starting 06, 08 or 09; `081-234-5678`, `081 234 5678` and `+66 81 234 5678` all work, Thai digits too) and gets a 6-digit code by SMS. The code works for 5 minutes, once, with 5 attempts. The screen shows the number and the SMS's reference (รหัสอ้างอิง), so the user can tell which SMS is the latest. After the first correct code the LINE account is bound to that number for 180 days, so later visits skip this step.
3. **Authorized?** A number may open the board when it has a current claim on an active user of the `users` table (a claimed name, table `user_claims`), it has an approved access request, or it is in `ALLOWED_PHONES`.
4. **Claim a name (first time).** A correct code for a number that is not authorized yet leads to `/login/claim` (ยืนยันชื่อของคุณ): pick the position (พยาบาล, ผู้ช่วยพยาบาล, พนักงานช่วยเหลือคนไข้; แพทย์ leads to the email sign-in, step 5), then your own name from the `users` list (searchable by first or last name), then confirm. The first claim of a name wins; a name someone already claimed shows as taken. The name is then bound to the number and the LINE account and the board opens at once; every claim is posted to Telegram with an undo button. Claims are open only while Telegram is set up with at least one person who can press that button (see Telegram); otherwise the code leads straight to the access request. Whoever cannot find their name, or finds it taken, sends an **access request** instead (`/login/request`); an administrator approves or rejects it in Telegram, and the waiting page signs the user in once approved.
5. **Doctors sign in by email instead** (see Doctors sign in by email). On `/login/verify` a doctor taps **แพทย์ ยืนยันตัวตนทางอีเมล** (`/login/doctor`), picks their name, and types the 6-digit code emailed to their own addresses (table `user_emails`). No number is involved, nothing to undo; the LINE account is then bound to that doctor for 180 days. Doctors are no longer offered on the claim page; doctors who claimed their name by number before the switch keep signing in as before.
6. **Session**: a signed cookie for 30 days. Authorization is checked again on every request (against a list cached for at most 60 s), so a removed number loses access within a minute.

The top bar shows the claimed full name from the `users` table, through the number's current claim (or the name given in an approved access request, otherwise the LINE name). The account menu behind the avatar shows the name, the role (`แพทย์ · ออร์โธปิดิกส์`, `พยาบาล · ห้องผ่าตัด`) and the number (`081-234-5678`).

Every number is stored in one form, `0812345678` (`src/lib/phone.ts`; `scripts/phone.mjs`, used by dev-session, repeats the same rules and a test checks that both agree). deeSMSX is sent `66812345678`.

The live board is [https://orskh.vercel.app](https://orskh.vercel.app). Guests are sent to `/login`.

### How a code is sent

In production (`SMS_PROVIDER=deesmsx`, the default and the only mode allowed on Vercel) deeSMSX makes the code, sends the SMS and checks the code: the app calls `POST /otp/request` (`to`, `sender`, `lang=th`, `isShowRef`) and stores the returned token encrypted (AES-GCM with a key derived from `OTP_PEPPER`), and on a guess calls `POST /otp/verify` with the token and the typed code. The app enforces its own limits on top (they also count sends whose outcome is unclear, see below), the 5-minute life, the 5 attempts and single use, and never logs the API keys, the token or the code; it logs only deeSMSX's reference code (for example `code 102`).

Before deeSMSX is called, a row is reserved in `otp_codes` under a database lock, so the daily cap and the limits hold even for double taps and several servers. What happens to that row depends on whether the SMS may have gone out:

- **Certainly not sent**: one of deeSMSX's documented refusals (99, 9, 100, 102, 204), or the request never left (no DNS answer, connection refused). The row is deleted: the failure uses no quota and starts no countdown.
- **Maybe sent**: no answer within 10 s, a dropped connection, an answer that is not JSON (such as a gateway's HTML 504), 101 ("Unsuccess"), an unknown code, or a success without a usable token. deeSMSX may already have sent and billed the SMS, so the row is kept. It can never be verified, but it counts for the 60 s countdown, every limit and `SMS_DAILY_CAP` like a sent code, so a slow or failing deeSMSX can never be used to send SMS past the limits. Three of these within 15 minutes on one server give a Telegram alert.

What the user sees:

| deeSMSX answer | Message |
| --- | --- |
| 99 (bad number) | ส่ง SMS ไปที่เบอร์นี้ไม่ได้ กรุณาตรวจสอบเบอร์มือถือ |
| 9 (key or secret), 100 (sender), 204 (no OTP template) | ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล, plus a Telegram alert |
| 102 (out of credit) | ขณะนี้ระบบส่ง SMS ไม่ได้ กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแล, plus a Telegram alert |
| maybe sent (see above) | ส่งรหัสไม่สำเร็จ หากได้รับ SMS ภายหลัง รหัสนั้นใช้ไม่ได้ กรุณารอ 1 นาทีแล้วขอรหัสใหม่, with a countdown on the button |

A reference (`ref`) in an unexpected format does not fail a delivered code: it is shown cleaned (printable characters, at most 16), or not at all.

If deeSMSX cannot be reached while a code is being checked, the attempt is not counted and the typed code stays in the box for another try. deeSMSX's own expiry (201) or reuse (202) is shown as "รหัสหมดอายุหรือใช้ไปแล้ว กรุณาขอรหัสใหม่".

In local mode (`SMS_PROVIDER=console` or `file`, development and tests only) the app makes the code itself, stores only an HMAC of it (`OTP_PEPPER`), and writes the SMS to the log or to a JSON file `{to, text, code, ref, at}` in `SMS_OUTBOX_DIR`. Limits, cap and screens are the same.

## Environment variables

Copy `.env.example` to `.env.local` for local work. Names only here; values live in Vercel and `.env.local`.

| Name | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | yes | Canonical origin, `https://orskh.vercel.app`. Requests to other hosts are redirected to it in production |
| `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` | yes | LINE Login channel. The secret is server only. The old Auth.js names `AUTH_LINE_ID` and `AUTH_LINE_SECRET` are read when these are unset |
| `SESSION_SECRET` | yes | 32+ characters (`openssl rand -base64 32`). Signs the session and the other sign-in cookies. Rotating it signs everyone out |
| `OTP_PEPPER` | yes | 16+ characters. Key for the stored code HMACs and for encrypting deeSMSX tokens at rest |
| `DATABASE_URL` | yes | Postgres (Neon pooled connection string). Server only |
| `DEESMSX_API_KEY`, `DEESMSX_SECRET_KEY` | yes | deeSMSX API keys (from the API settings in my.deesmsx.com). Server only |
| `DEESMSX_SENDER` | no | SMS sender name. Default `deeSMS.OTP`, deeSMSX's shared OTP sender. Set it to `ORSKH` once that name is approved (see deeSMSX) |
| `SMS_DAILY_CAP` | no | At most this many codes in any 24 hours, for everyone together. Default `300`. See Cost control |
| `SMTP_USER`, `SMTP_PASS` | for doctors | The email account that sends doctors their codes, e.g. a Gmail address and its [app password](https://myaccount.google.com/apppasswords) (needs 2-Step Verification). Server only. Without them the doctor page answers "ระบบยังไม่พร้อม" |
| `SMTP_HOST`, `SMTP_PORT` | no | SMTP server. Default `smtp.gmail.com` and `465` (TLS from the start); any other port uses STARTTLS |
| `EMAIL_FROM` | no | The From of the code emails, e.g. `ORSKH <orskh.app@gmail.com>`. Default `SMTP_USER` (Gmail only sends as its own address or a verified alias) |
| `EMAIL_DAILY_CAP` | no | At most this many code emails in any 24 hours, for all doctors together. Default `300` (Gmail allows about 500 a day) |
| `ALLOWED_PHONES` | no | Break-glass list of mobile numbers, comma-separated (any common way of writing them). These stay authorized without a database read. Keep it empty or one administrator. Needs a redeploy to change |
| `AUTH_ADMIN_LINE_IDS` | no | Comma-separated LINE user ids (the session's `sub`) of the admins, who may open `/admin`. Unset or empty means no admin. See Admin page |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | for name claims | Sign-in alerts, SMS alerts, access-request decisions, and name claims with their undo button. Chat IDs comma-separated; the numeric (person) IDs are also who may approve and undo. Name claims need both settings and at least one numeric ID; without them every new number goes to the access request. Off when either is unset |
| `BOT_API_TOKEN` | for the upload | Bank of Thailand API token for the Financial Institutions' Holidays API (free, from [portal.api.bot.or.th](https://portal.api.bot.or.th)). Server only. Without it the board skips only weekends and `EXTRA_HOLIDAYS`, and nobody can upload the HOSxP file (its day must come from the holidays) |
| `EXTRA_HOLIDAYS` | no | Closures the API does not list, comma-separated `YYYY-MM-DD`, each optionally `=name` |
| `LIFF_ID` | yes, for the link | The board's LIFF app id (`2001234567-AbCdEfGh`). Not a secret. The "open in LINE" page links to `https://liff.line.me/<LIFF_ID>`. See Device gate |
| `CLIENT_GATE` | no | `off` turns the device gate off (break-glass). Unset, the gate is on everywhere on Vercel (production and preview) and off elsewhere. Any other value means on |
| `SMS_PROVIDER`, `SMS_OUTBOX_DIR`, `DEESMSX_API_URL`, `LINE_AUTH_URL`, `LINE_API_URL`, `TELEGRAM_API_URL` | dev only | Local SMS mode (`console` or `file`), the mock deeSMSX, mock LINE and Telegram. Ignored when `VERCEL` is set: there the app always uses the real deeSMSX |
| `EMAIL_PROVIDER`, `EMAIL_OUTBOX_DIR` | dev only | Local email mode: `console` (the email in the log) or `file` (one JSON file per email, with the code). Ignored when `VERCEL` is set: there the app always uses SMTP |
| `BOT_HOLIDAYS_URL` | tests only | Another address for the holidays API, such as the stub in `tests/mock-line.mjs` (`http://127.0.0.1:4010/financial-institutions-holidays/`). Ignored when `VERCEL` is set |
| `APP_FAKE_NOW`, `APP_FAKE_NOW_FILE` | tests only | The app's clock (`src/lib/clock.ts`) for the 16:00 turnover, the upload window and the upload's day. Each takes an ISO time with its offset, such as `2026-11-16T15:30:00+07:00`. `APP_FAKE_NOW_FILE` names a file holding one, read again on every call, so a test can move a running server's clock; it wins over `APP_FAKE_NOW`. A value without an offset is ignored. Both are ignored when `VERCEL` is set, so production always runs on the real time |

If `DATABASE_URL` or the deeSMSX keys are missing in production, pages still build and serve, the sign-in endpoints answer "ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล", and the log names the missing variables.

### LINE

In the LINE Developers console, open the Login channel and set the callback to:

`https://orskh.vercel.app/api/auth/line/callback`

While the channel is in Developing mode, only testers and admins can sign in. Publish the channel, or add staff as testers, before a wider rollout. Issue a new channel secret if the current one was ever pasted into a chat, ticket or commit.

### Device gate (LIFF on a phone only)

On Vercel the board, and LINE Login with it, opens only inside the board's LIFF app in the LINE app on a mobile phone (`src/lib/gate.ts`, run by `src/proxy.ts` before the sign-in gate, and again by `/api/auth/line/start` and `/api/auth/line/callback`). Any other browser, a desktop, a tablet (iPad, Android without "Mobile"), Safari or Chrome on a phone, or the plain address opened from a LINE chat, gets the page `/open-in-line` (เปิดผ่าน LINE บนมือถือ) at whatever address it asked for, and API calls answer 403. So LINE Login can never be started or finished outside LIFF. On a phone the page has a เปิดใน LINE button to `https://liff.line.me/<LIFF_ID>`; on a computer it shows that link to open on the phone. The Telegram webhook is exempt.

LINE adds `LIFF` to the in-app browser's User-Agent inside a LIFF app, and the gate looks for it together with `Line/<version>` and a phone. The User-Agent can be faked: the gate keeps everyday use inside LIFF, while LINE Login, the SMS code and the claimed name remain the real access control. Without `LIFF_ID` the gate still holds; the page just has no link. Outside Vercel (local development, tests) there is no gate. `CLIENT_GATE=off` in Vercel is the break-glass that turns it off without a code change, for example if LINE ever changes its User-Agent.

Inside the LIFF app the login page signs in by itself through the LIFF SDK (`src/components/liff-sign-in.tsx`): `liff.init()`, then `liff.getIDToken()` goes to `POST /api/auth/line/liff`, which has LINE's verify endpoint check it (issuer, this channel's id, expiry) and then follows the same rules as the web callback (`src/lib/auth/line-signin.ts`). The app never leaves for LINE Login's web page, which in the LIFF browser makes LINE show "This is an external page..." over it. This needs the `openid` scope on the LIFF app, and the LIFF app in the channel `LINE_CHANNEL_ID` (the token's audience). If anything fails, the page falls back to the web redirect (`/api/auth/line/start`). The login page has no sign-in button: inside the LIFF app it shows only that it is signing in, and anywhere else (no `LIFF_ID`, local development, `CLIENT_GATE=off`) it goes straight on to `/api/auth/line/start`. After signing out (`/login?signed_out=1`) it says so (ออกจากระบบแล้ว, เปิดใหม่ได้จากเมนูใน LINE) instead of signing straight back in; opening the board again from the LINE menu signs in. A browser with a name to pick or an access request in progress gets a link back to it instead.

To set up the LIFF app: in the LINE Developers console, open the LINE Login channel whose id is `LINE_CHANNEL_ID`, LIFF tab, Add. Size **Full**, endpoint URL the site's address with a trailing slash (`APP_URL/`), scopes `profile` and `openid`, bot link feature off. Copy the LIFF ID into Vercel as `LIFF_ID` and redeploy. The channel's callback URL must include `APP_URL/api/auth/line/callback`. Share `https://liff.line.me/<LIFF_ID>` with staff (a LINE group's note or announcement, or a rich menu of the official account).

### deeSMSX

Setup, in order (prices as listed by deeSMSX in October 2026; check before paying):

1. Register at [deesmsx.com](https://deesmsx.com) with the hospital's or your own details. The free trial cannot use the API, so it is no use for this app.
2. Buy the **Starter** package (350 THB plus VAT). Credits are per SMS; a Thai message of up to 70 characters is one SMS.
3. In my.deesmsx.com, open the API settings and copy the **apiKey** and **secretKey** into Vercel as `DEESMSX_API_KEY` and `DEESMSX_SECRET_KEY` (Production only, marked sensitive). Never paste them into a chat, ticket or commit; if that happens, issue new ones there.
4. Set up the **OTP template** in my.deesmsx.com (without one, deeSMSX answers 204 "Please Settings In my.deesmsx.com"). Keep it short and Thai, with the code and **no link**, for example `รหัส ORSKH ของคุณคือ {code} ใช้ได้ 5 นาที ห้ามบอกผู้อื่น` (use the code placeholder deeSMSX shows in its editor). Do **not** put the reference in the template: the app sends `isShowRef=1`, so deeSMSX appends ` [Ref : XXXX]` itself. The template plus that suffix must stay within 70 Thai characters (one SMS): the example is 56 characters, 69 with the suffix, so add nothing to it. deeSMSX makes a 6-digit code, which is what the app requires. Set its validity to 5 minutes if deeSMSX offers the setting; the app stops accepting a code after 5 minutes anyway.
5. Start with the shared sender **deeSMS.OTP** (leave `DEESMSX_SENDER` unset). It works at once, but users see deeSMSX's name, not ours, and deeSMSX sends its own fixed OTP text (code and reference): deeSMSX says the system sender's text cannot be edited. The template from step 4 takes effect only once `DEESMSX_SENDER=ORSKH` is approved and set (step 6).
6. Then ask deeSMSX to **whitelist the sender name `ORSKH`**: send the request with a copy of your ID card. Approval takes about 1 to 2 working days. Choose carefully: on packages under 5,000 THB the name cannot be changed later. Once approved, set `DEESMSX_SENDER=ORSKH` in Vercel and redeploy.
7. Deploy, sign in once yourself with your own number and check that the SMS arrives and shows the same reference as the screen. On `deeSMS.OTP` expect deeSMSX's standard wording, not your template. After switching to `ORSKH`, check again: your template's text, the reference exactly once, and one credit used per code in my.deesmsx.com.

deeSMSX has no sandbox; local work and the tests use the mock (`tests/mock-deesmsx.mjs`) or local mode instead.

What the deeSMSX documentation leaves open, and how the app copes: it says deeSMSX makes a 6-digit code (which matches the app) but not how long a code lives (the app keeps its own 5-minute limit), whether errors always come with an error status (the examples use HTTP 500; the app reads the JSON whatever the status, and treats an answer it cannot read as "maybe sent"), whether the reference code arrives as `error` or `code`, as text or a number (both are accepted), or what rate limits deeSMSX applies (the app's own limits are well below any likely one).

### Thai SMS rules

- **No links** in the code SMS. Thai operators filter messages with links, more so from senders that are not registered, and a code SMS needs none.
- **Registered sender names only.** A sender name must be approved for the provider before it can be used (the whitelist step above); until then use the provider's shared sender.
- **One SMS = 70 Thai characters** (140 English characters by deeSMSX's count). A longer Thai text is billed as two or more. The template above plus deeSMSX's ` [Ref : XXXX]` fits in one, with 1 character to spare.
- Send only the code, to the person who asked for it, and nothing for marketing.

### Cost control

Every code is a paid SMS, so sending is capped:

- **Per person**: 3 codes per number per 15 minutes, 6 per number and LINE account per 24 hours, 5 per LINE account per hour, at most 5 different numbers per LINE account per 24 hours, 20 per IP address per hour, 60 s between sends. A send deeSMSX certainly refused counts for none of these; one that may have gone out (a timeout, an unreadable answer) counts like a sent code.
- **For everyone together**: `SMS_DAILY_CAP` codes in any 24 hours (default 300, a rolling window). At the cap nobody gets a code: the page says "ระบบส่ง SMS ครบจำนวนของวันนี้แล้ว กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแล" and Telegram is told once an hour. People already bound to their LINE account still sign in, since they need no code. If the cap is reached by real use, raise it in Vercel and redeploy.
- **Telegram alerts** (when Telegram is set up): when half the cap is used in 24 hours, when the cap is reached, when deeSMSX's credit drops under 100, when credit runs out, when deeSMSX refuses our settings, and when three sends within 15 minutes end without knowing whether the SMS went out. Each kind is sent at most once an hour (credit and volume once every 6 hours) per server.
- Access-request decisions send no SMS: the waiting page signs the user in by itself.

### Telegram (needed for name claims)

Create a bot with @BotFather and put its token in `TELEGRAM_BOT_TOKEN`. Use a bot of its own, not skh-or-schedule's: a bot has a single webhook, and each app takes it over when it registers, so taps on one app's messages would reach the other. The same people can press **Start** in both bots and use the same chat IDs. (The buttons also carry an orskh-only tag, so a stray tap from the other app is refused rather than deciding a request here.) Each person who should get alerts and decide requests presses **Start** in the bot; put their numeric chat IDs in `TELEGRAM_CHAT_ID`. The app registers its own webhook (`/api/telegram/webhook`) and derives the webhook secret from the bot token and `SESSION_SECRET`, so there is nothing else to set. Every SMS-code sign-in sends an alert with the name, LINE name, number and time, every name claim sends a message with an undo button (see Claims), plus the SMS alerts above.

The undo button is the only check on a claim, so **claims are open only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, valid, and `TELEGRAM_CHAT_ID` holds at least one numeric (person) chat ID**: group IDs (negative) and `@channel` names get the messages, but only a person's ID may press a button. Without that, the claim page, its list and `POST /api/auth/claim` send everyone to the access request, and access requests save but wait until decided in SQL. A claim whose message could not be sent even after one retry (Telegram down, a revoked token) still stands; find it with the "unannounced claims" query under Claims.

## Who may sign in (table `users`)

The list of people who may claim their name is the Postgres table `users`. It is **shared with the rest of the project**: another workstream created it in production (Neon) and loaded it (196 rows), and it owns it. The agreement with its owner: ids stay stable, a removal is `active = false` (never a delete), and the sign-in never adds columns to `users` and never writes it at runtime; the claims live in their own table, `user_claims`, which references `users(id)`. The production DDL is:

```sql
CREATE TABLE users (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, first_name text NOT NULL CHECK (btrim(first_name) <> ''), last_name text NOT NULL CHECK (btrim(last_name) <> ''), type text NOT NULL CHECK (type IN ('DR','RN','PN','PCA')), subtype text NOT NULL CHECK (btrim(subtype) <> ''), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT users_name_key UNIQUE (first_name, last_name));
```

`db/schema.sql` (applied by the app on first use) holds the same statement as `CREATE TABLE IF NOT EXISTS users (...)`, so it is a no-op where the table exists and gives a local database the identical table (a unit test compares the two texts and the resulting catalogs, and checks that applying the schema to a filled `users` writes nothing). `type` is `DR`, `RN`, `PN` or `PCA`; `subtype` is a code (doctors: the department, e.g. `ORTHO`, `GENSX`, `ANES`; nurses and aides: `OR` or `ANES`). It holds names only; the numbers come from the claims. One row per person (first and last name are unique). The app only reads the table: changes apply within 60 s, with no redeploy.

**Until people have claimed their names, only `ALLOWED_PHONES` and approved access requests can sign in.** In production the table is already loaded, so there is nothing to load. To load or update it from a CSV, use the sync script with a file kept **outside** this repository (UTF-8, header `first_name,last_name,type,subtype`; in Excel, Save As "CSV UTF-8"); the script refuses a file inside the repository:

```bash
npm run sync-users -- /path/outside/repo/all-users.csv           # dry run: prints the changes
npm run sync-users -- /path/outside/repo/all-users.csv --apply   # writes them in one transaction
```

Example file (invented names):

```csv
first_name,last_name,type,subtype
สมชาย,ใจดี,DR,ORTHO
ปราณี,สายบุญ,RN,OR
สุดา,คำดี,PN,ANES
```

It reads `DATABASE_URL` from the environment or `.env.local`, prints the target database without credentials, the changes (names included, for your review) and a summary of counts per type. Rows are matched by first and last name (the table's unique key); a person whose type changes keeps their row and their claim, with the new type and subtype. It never sets an id (the table numbers new rows), never deletes a row (people missing from the CSV are set inactive; a claimed name that goes inactive stops signing in, and the dry run marks those), sets `updated_at` on every row it changes, never touches `user_claims`, refuses the whole file on a bad line (naming the line: wrong column count, unknown type, empty or malformed subtype, a duplicate name), and refuses to deactivate more than 5 rows and 10% of the list at once unless `--allow-mass-deactivate` is added. It is the only writer of `users` on the sign-in side; coordinate with the table's owner before running `--apply` against production.

Single edits in the Neon SQL editor (deactivate, never delete):

```sql
-- add or bring back one person
INSERT INTO users (first_name, last_name, type, subtype) VALUES ('ชื่อ', 'นามสกุล', 'DR', 'GENSX')
ON CONFLICT ON CONSTRAINT users_name_key DO UPDATE SET type = excluded.type, subtype = excluded.subtype, active = true, updated_at = now();

-- correct a spelling (the claim stays: it points at the id)
UPDATE users SET last_name = 'นามสกุลใหม่', updated_at = now() WHERE id = 42;

-- remove (the row stays, inactive; its claimed number stops signing in within 60 s)
UPDATE users SET active = false, updated_at = now() WHERE id = 42;
```

The surgeon list in `src/lib/physicians.ts` is only for matching surgeons in the case data; it does not decide who can sign in.

### Claims (table `user_claims`)

Every claim is a row of `user_claims` (`user_id`, `phone`, `line_sub`, `line_name`, `created_at`, `ip`, `undone_at`, `undone_by`, `undo_reason`, `tg_messages`), never deleted. A user's **current claim** is their row with `undone_at IS NULL`; partial unique indexes allow at most one current claim per user, per number and per LINE account. A number is authorized while it has a current claim on an **active** user; the board's name and role come from `users` through that claim.

A claim is one transaction: an `INSERT INTO user_claims` that reads the user in the same statement (it must exist and be active) and is guarded by those indexes, so of two people claiming at once exactly one wins (the other is told the name is taken), and neither the number nor the LINE account can hold a second name (one LINE account, one number, one name). The LINE account is bound to the number in the same transaction. A number with an access request (pending, approved, or rejected less than 24 hours ago) cannot claim, and a number that holds a name cannot file a request: claims and requests of one number exclude each other. Each LINE account and each number may try 5 claims per 24 hours. Every claim is posted to every chat in `TELEGRAM_CHAT_ID`:

```
🪪 ยืนยันชื่อ: สมชาย ใจดี (แพทย์ · ออร์โธปิดิกส์)
เบอร์ 081-234-5678 · LINE: ต้นข้าว
เวลา 29 ต.ค. 2569 08:15 น.
```

with one button, **↩️ ยกเลิกการยืนยัน** (`oc:<claim id>:u`). An administrator who taps it ends the claim (`undone_at`, `undone_by` = their Telegram id, `undo_reason = 'admin'`, in one conditional update, so a second tap or an old message changes nothing), which frees the name; the number's LINE bindings are removed, and the person is signed out (at once on the server that got the tap, within 60 s on the others). The message is edited to say who undid it. After an administrator's undo, that number and that LINE account cannot claim any name for 24 hours; they can still send an access request. `users` is never written by a claim or an undo.

`undo_reason` says how a claim ended: `admin` (the undo button; the only one that starts the 24-hour block), `inactive` (closed by the app when the same number or LINE account claims again while its earlier name is inactive, see Spelling fixes), `manual` (released by hand in SQL), `replaced` (a doctor proved the name by email from another LINE account, see Doctors sign in by email). `via` says how the claim was made: `phone` (SMS code and this page) or `email` (a doctor's email code; `phone` is then NULL).

```sql
-- who claimed what (current claims have undone_at NULL)
SELECT c.id, u.first_name, u.last_name, u.type, u.active, c.phone, c.line_name, c.created_at, c.undone_at, c.undo_reason
FROM user_claims c JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC;

-- claims whose Telegram message reached nobody (check them; release by hand if wrong)
SELECT c.id, u.first_name, u.last_name, c.phone, c.created_at
FROM user_claims c JOIN users u ON u.id = c.user_id
WHERE c.tg_messages = '[]'::jsonb AND c.undone_at IS NULL;

-- release a claim by hand: frees the name and signs the number out within 60 s, without the 24-hour block
-- (to block as the undo button does, use undo_reason = 'admin' instead)
BEGIN;
UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE id = 7 AND undone_at IS NULL;
DELETE FROM line_bindings WHERE phone = '0812345678';
COMMIT;

-- give a name a number without the claim page (e.g. for someone who cannot use it)
INSERT INTO user_claims (user_id, phone, line_sub, line_name) VALUES (42, '0812345678', 'manual-42', 'by hand');
```

(`line_sub` is required and unique among current claims; for a hand-made claim use any text that is not a real LINE id, as above.)

**Spelling fixes.** Best done in the table first (`correct a spelling` above): the claim stays, since it points at the id. If the corrected spelling reached the table as a new row through the CSV instead, the old row is set inactive and its claim stops authorizing; the person signs in again (LINE, SMS code) and picks the corrected name. Their old claim on the inactive row is then closed automatically (`undo_reason = 'inactive'`, no undo needed and no 24-hour block). The new claim is announced like any other.

To find a person's LINE user id (for `AUTH_ADMIN_LINE_IDS`), look it up by **their own number, confirmed with them in person**, never by name: a name is self-claimed and could be held by someone else until an undo. `SELECT line_sub FROM line_bindings WHERE phone = '0812345678'` (see Admin page). Before adding the id, check that the number's current claim is theirs: `SELECT u.first_name, u.last_name, c.line_sub, c.created_at FROM user_claims c JOIN users u ON u.id = c.user_id WHERE c.phone = '0812345678' AND c.undone_at IS NULL`.

## Doctors sign in by email (table `user_emails`)

Doctors (`users.type = 'DR'`) prove who they are with a code sent to their own email instead of an SMS code and a name claim. After LINE, `/login/verify` offers **แพทย์ ยืนยันตัวตนทางอีเมล**, which opens `/login/doctor`: the active doctors (names and specialties, searchable), each marked when no address is on file. The doctor picks their name and taps **ส่งรหัสทางอีเมล**; one email goes to **every** address on file for that name (subject `รหัสเข้าสู่ระบบ ORSKH: 123456`; plain text plus an HTML version in the app's theme with the app's mark as an inline image; no link, nothing loaded from the web), and the page shows the addresses masked (`so•••@gmail.com`). The code works for 10 minutes, once, with 5 attempts, and only for the LINE account that asked; only an HMAC of it is stored (table `email_codes`, keyed with `OTP_PEPPER`). Limits: one code a minute, 3 codes per doctor per 15 minutes (whoever asks), 6 per doctor and LINE account a day, 5 per LINE account an hour and for at most 3 different doctors a day, 20 per IP address an hour, and `EMAIL_DAILY_CAP` for everyone.

A good code makes that LINE account the holder of the doctor's name: a `user_claims` row with `via = 'email'`, `phone` NULL and `email_verified_at`. The board shows the name and role as for any claim (the account menu shows no number), the add-case form works, and later LINE sign-ins skip the code for 180 days after the last one. Since the code went to the doctor's own addresses, a newer email proof wins: if the name was held by another LINE account, or by a number (a doctor who claimed by SMS before the switch), that claim ends with `undo_reason = 'replaced'` and its holder is signed out. A LINE account that already holds another active name is refused. Telegram gets a notice without a button (`📧 แพทย์ยืนยันตัวตนทางอีเมล: …`, saying when an earlier holder was replaced). The session carries the doctor's `users.id` instead of a number, and is checked on every request like a number (cached for at most 60 s).

The addresses come from the hospital's doctor directory (matched by full name) and were loaded by hand; a doctor may have several. They are lower case and trimmed (a check constraint). The sign-in only reads `user_emails`:

```sql
-- a doctor's addresses
SELECT u.id, u.first_name, u.last_name, e.email FROM users u LEFT JOIN user_emails e ON e.user_id = u.id
WHERE u.type = 'DR' AND u.active ORDER BY u.first_name;

-- active doctors with no address (they cannot sign in by email until one is added)
SELECT u.id, u.first_name, u.last_name FROM users u
WHERE u.type = 'DR' AND u.active AND NOT EXISTS (SELECT 1 FROM user_emails e WHERE e.user_id = u.id);

-- add or remove an address (lower case)
INSERT INTO user_emails (user_id, email) VALUES (42, 'doctor@example.com');
DELETE FROM user_emails WHERE user_id = 42 AND email = 'old@example.com';
```

To send from Gmail: sign in to the sending account, turn on 2-Step Verification, create an app password (Google account, Security, App passwords), and set `SMTP_USER` (the address) and `SMTP_PASS` (the 16-letter app password) in Vercel, then redeploy. Codes may land in junk mail the first time; the page says so.

The old `staff_registrations` table (Auth.js registration; `src/db/schema.ts`, `drizzle/0000`) is no longer used and is left in place; nothing reads or writes it. The rest of `src/db` and `drizzle/` is still in use: the `surgeons` table (`drizzle/0001`) is read and written by `/admin` (see Admin page).

## Access requests (names not on the list)

For someone whose name is missing from the `users` list or already claimed (and for everyone while claims are off, see Telegram): the claim page links to `/login/request`, which shows the verified number and asks for first name, last name and position (แพทย์, พยาบาล, ผู้ช่วยพยาบาล, พนักงานช่วยเหลือคนไข้; stored as `DR`, `RN`, `PN`, `PCA`). A number with a request goes straight to its request after the code. The request goes to every chat in `TELEGRAM_CHAT_ID` with approve and reject buttons; the first tap decides. On approval the waiting page (checked every 10 s) signs in by itself; no SMS is sent. Someone who closed the page signs in again later with LINE and another SMS code. After a rejection the same number cannot ask again for 24 hours, and cannot claim a name instead. A number that holds a name is told to sign in instead of filing a request. One pending request per number, at most 3 requests per LINE account per 24 hours.

An approved request keeps working whatever happens in `users` or `user_claims` (an undo of a claim of the same number says so in its Telegram answer instead of "signed out"), so revoke it on its own:

```sql
SELECT id, phone, first_name, last_name, position, status, created_at, decided_at
FROM access_requests ORDER BY created_at DESC;

UPDATE access_requests SET status = 'rejected', decided_at = now()
WHERE phone = '0812345678' AND status = 'approved';
```

## Switching from Auth.js

Checklist for the first deploy of this sign-in:

1. Set up deeSMSX (steps 1 to 5 under deeSMSX). Ask for the `ORSKH` sender name at the same time; the shared sender works meanwhile.
2. In Vercel, add: `APP_URL` (`https://orskh.vercel.app`), `SESSION_SECRET`, `OTP_PEPPER`, `DEESMSX_API_KEY`, `DEESMSX_SECRET_KEY`. For name claims: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` with at least one person's numeric chat ID (without them everyone goes through access requests decided in SQL). Optional: `ALLOWED_PHONES`, `SMS_DAILY_CAP`, `DEESMSX_SENDER`. `DATABASE_URL`, `BOT_API_TOKEN` and `EXTRA_HOLIDAYS` stay as they are. The LINE channel needs nothing new: the existing `AUTH_LINE_ID` and `AUTH_LINE_SECRET` are read as `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET`.
3. After the deploy, in Vercel, remove: `AUTH_SECRET`, `AUTH_TRUST_HOST`, `AUTH_TEST_MODE`, `AUTH_LINE_ALLOWLIST`, and anything left from the email version of this sign-in (`SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `ALLOWED_EMAILS`). Make sure `SMS_PROVIDER`, `SMS_OUTBOX_DIR` and `DEESMSX_API_URL` are not set (they are ignored on Vercel anyway). `AUTH_ADMIN_LINE_IDS`, `AUTH_LINE_ID` and `AUTH_LINE_SECRET` stay (the admin list's values are LINE user ids, the new session's `sub`, same as before).
4. If a preview of the email version or an earlier version of this branch ever ran against this database, its sign-in tables must go before the first deploy (the app creates them again; no production sign-in data exists yet). In the Neon SQL editor: `DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, physicians, staff_claims, staff, access_requests;` (`physicians`, `staff` and `staff_claims` are the sign-in lists of earlier versions of this branch.) **Never drop `users`**: it belongs to the rest of the project and holds the list; the sign-in only reads it, and `user_claims` is created next to it.
5. In the LINE console, add the callback `https://orskh.vercel.app/api/auth/line/callback` (the old `/api/auth/callback/line` can be removed afterwards).
6. Nothing to load: production already has the `users` table with the list (created and loaded by the rest of the project). The first request creates the sign-in tables, `user_claims` included, next to it and leaves `users` as it is. Anyone on the list, you included, can claim their own name right after the SMS code; nobody has to go first. Use `ALLOWED_PHONES` only for a break-glass number that holds no name: a number there goes straight to the board and never reaches the claim page. (To change the list later: `npm run sync-users`, dry run then `--apply`, or the SQL under Who may sign in, agreed with the table's owner.)
7. Deploy. Everyone signed in with Auth.js is signed out once and signs in again with LINE and an SMS code.
8. Sign in once yourself with your own number and check the SMS (sender, the reference shown exactly once, no link; on `deeSMS.OTP` the wording is deeSMSX's own), pick your name on `/login/claim`, and check the Telegram message and its undo button.

## Admin page

Admins (the LINE user ids in `AUTH_ADMIN_LINE_IDS`, compared with the session's `sub`) see a "จัดการระบบ" button in the top bar (an icon on phones, labelled from 768px, left out below 390px so the date keeps its year) and the same link in the account menu, both opening `/admin`. Everyone else gets a not-found page there, and every save is checked against the admin list again on the server. An admin still signs in like everyone else (LINE, SMS code, an authorized number); the admin list only adds the page.

To find someone's LINE user id, have them sign in once, then look it up in the Neon SQL editor and add it to `AUTH_ADMIN_LINE_IDS` (comma-separated, redeploy to apply):

```sql
SELECT line_sub, display_name, last_login_at FROM line_bindings WHERE phone = '0812345678';
```

The ids are the same LINE user ids Auth.js used, so a list set before the switch keeps working.

The page (จัดการระบบ) holds three sections:

- **ช่วงปิดซ่อมห้องผ่าตัด**, the repair's dates:
  - Four date inputs, a start and a last day for each half. Each half shows its operating rooms, the range in Thai dates with its number of days, and "กำลังปิดซ่อม" on the half that includes today.
  - The dates are checked in the page and again on the server, with the same Thai messages (see the repair layout).
  - A save changes the board for everyone at once. The section says who saved last and when ("แก้ไขล่าสุด … โดย …"), or that the planned dates are in use.
- **ผู้จัดการตาราง (MX)**, the users who may upload the HOSxP file:
  - Each member shows with their name, role and the date they were added. A member whose user is inactive is marked "ปิดใช้งานอยู่ สิทธิ์ยังไม่มีผล": the role does nothing until the user is active again.
  - **เพิ่ม MX** searches the active users by name (names and roles only). The admin picks a name, then confirms.
  - Taking the role back asks for a confirmation first.
  - The role lives in the `mx_members` table, by `users.id`.
- **รายชื่อแพทย์**, the surgeon list (below).

The surgeon list has search, a specialty filter, and add, edit and delete. Specialty is a dropdown of department codes. Names are stored with invisible format characters (zero-width spaces, direction marks, soft hyphens) removed, runs of spaces evened out and Unicode NFC applied, and each name can appear once. The list is stored in the `surgeons` table. Nothing else reads it yet: the case board still matches surgeons to `src/lib/physicians.ts`, and who may sign in is the separate `users` table (see Sign-in).

The surgeon list reaches the database through `src/db` (drizzle, Neon's HTTP driver); the repair's dates and the MX list go through `pg` like the rest of the app. Each section shows a notice when its data cannot be read, and the others still work. The surgeon list's table is created by the SQL files in `drizzle/`, run in order against the database (Neon's SQL editor works). `0001_surgeons.sql` creates `surgeons` and seeds it with the 76 surgeons supplied on 27 Oct 2026 (`src/data/surgeons.ts`). The seed only runs while the table's id sequence has never been used, so running the file again never brings back names the admin deleted.

## Local development

Requirements: Node 22, npm, a local Postgres.

```bash
npm install
cp .env.example .env.local      # fill in values; .env.local is gitignored
node tests/mock-line.mjs &      # mock LINE Login on :4010 (uses LINE_CHANNEL_ID/SECRET from .env.local)
npm run dev                     # http://localhost:3000
```

For local work set `APP_URL=http://localhost:3000`, `LINE_AUTH_URL=http://localhost:4010/oauth2/v2.1/authorize`, `LINE_API_URL=http://localhost:4010`, `SMS_PROVIDER=file` and `SMS_OUTBOX_DIR=<folder outside the repo>`. No SMS is sent: each code is written as a JSON file `{to, text, code, ref, at}` into that folder (`SMS_PROVIDER=console` prints it in the terminal instead). No deeSMSX keys are needed in local mode.

To try the deeSMSX path without sending anything, run the mock instead: `node tests/mock-deesmsx.mjs &` (port 4011), then set `SMS_PROVIDER=deesmsx`, `DEESMSX_API_URL=http://localhost:4011/v1` and any `DEESMSX_API_KEY` / `DEESMSX_SECRET_KEY` (the mock takes them from `.env.local`). The codes it "sends" are listed at `http://localhost:4011/__control/sms`.

To skip the sign-in while working on the UI:

```bash
npm run dev-session -- 0812345678 "ชื่อที่แสดง"   # prints: session=eyJ...
```

Set that cookie for `http://localhost:3000` in the browser. The number must be in `ALLOWED_PHONES`, hold a current claim on an active user of the local `users` table, or be approved. The script refuses to run when `APP_URL` is https.

`/preview` renders the board without signing in, and `/preview/admin` renders the admin page with the planned repair dates, invented MX members and the supplied surgeon list (changes stay in the page and are not saved). Both work only while `NODE_ENV` is `development`. `/preview` takes these parameters:

| Parameter | Shows |
| --- | --- |
| `?date=2026-12-14` | the board as on that date |
| `?day=tue` | the Tuesday of this week |
| `?at=2026-11-16T16:30+07:00` | the board's day at that moment (after 16:00: the next workday) |
| `?holiday=วันปิยมหาราช` | a closed day |
| `?sample=1` | made-up HOSxP cases and bookings, to see the source chips, flags and room marks; add `&upload=0` for the bookings alone, as before MX uploads |
| `?mx=1` | the board as MX sees it (every HN, the upload button); without it, as the sample's doctor, who sees the HN of their own bookings |
| `?admin=1` | the admin button |

The upload page needs a signed-in MX user or admin. To try it locally, run `node tests/mock-line.mjs &` (it also serves the holidays stub; give the app `BOT_API_TOKEN=mock-bot-token` and `BOT_HOLIDAYS_URL=http://127.0.0.1:4010/financial-institutions-holidays/`), then set the clock inside the window with `APP_FAKE_NOW_FILE`. `tests/fixtures/e2e-or-export.xlsx` is a made-up file for Tue 17 Nov 2026 (made by `python3 -I tests/e2e/make-workbook.py` from `tests/fixtures/sample-or-export.xlsx`, needs openpyxl).

## Tests

```bash
npm run lint
npm run typecheck
npm test            # unit tests (node:test via tsx); Postgres database orskh_test
npm run build
npm run test:e2e    # mock LINE + mock deeSMSX + next build/start + Playwright (Chromium)
```

`npm test` reads `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/orskh_test`). It covers the number rules, the users CSV and sync script, the doctors' email codes (configuration, limits, the claim moving between LINE accounts, sessions by user id), the `users` DDL against the production text (and that applying the schema to a filled `users` writes nothing), claims (first claim wins under concurrency, one name per number and per LINE account, claims and requests excluding each other, a claim moving to a corrected row, limits, undo and its 24-hour block, claims off without a Telegram administrator), the deeSMSX adapter against a stubbed `fetch` (every reference code, timeouts, broken answers), local mode, the limits, the daily cap (also under concurrent sends), alerts and the rest of the sign-in. For the repair phase it covers:
- the clock, the 16:00 cycle and the upload window;
- the holidays;
- the repair's layouts and the saved dates;
- the `.xlsx` reader (zip bombs, encrypted and `.xls` files);
- the workbook rules against the made-up sample and its answers;
- placement;
- HN rules;
- the merge of uploads and bookings, with the HN filtered by viewer;
- the upload's storage and its 30-day clean-up;
- the MX role.

`npm run test:e2e` reads `E2E_DATABASE_URL` (default database `orskh_e2e`), `E2E_APP_PORT` (3100), `E2E_FILE_APP_PORT` (3101), `E2E_LINE_PORT` (4010), `E2E_SMS_PORT` (4011), `E2E_OUTBOX_DIR`, `E2E_SCREENS_DIR` (both default to the system temp folder) and `E2E_SKIP_BUILD=1`. It drops and recreates the sign-in tables and `users` in that database and loads invented names into `users` with the sync script. The main server runs in deeSMSX mode against the mock (sign-in with a name claim, binding, a second account that finds the name taken, a doctor's email sign-in from the file outbox and its LINE fast path, access requests, deactivation, break-glass, the Telegram undo and its 24-hour block, deeSMSX failures and low credit, logout, CSRF, open redirects, the admin gate); a second server on the same build runs in file mode with Telegram sent only to a group (a full sign-in, name claims off, and the daily cap).

The repair-phase tests move the app's clock through `APP_FAKE_NOW_FILE` and read the holidays from the stub in `tests/mock-line.mjs`, through `BOT_HOLIDAYS_URL`; a holiday there, Mon 7 Dec 2026, is stepped over. They cover:
- the board's day across the 16:00 turnover, a weekend and that holiday, and the no-upload alert after the repair;
- the board refreshing itself: at 16:00 with no reload, after more than 5 minutes hidden, and at once when Back brings it back after its moment;
- an admin saving the repair's dates on `/admin`, with the board following at once;
- an admin granting and taking back MX;
- doctors booking rooms with an HN, and the form opening on the board's day after 16:00, past a holiday;
- the no-upload alert, with the bookings still in their rooms;
- MX's upload: closed before 15:00; an `.xls` refused both by name and by content; a file of other days refused; refused by the server at 16:00; accepted inside the window, with its summary and matching. The file is `tests/fixtures/e2e-or-export.xlsx`;
- the board from 16:00, with HOSxP, จอง and ตรงกัน rows, flags, room marks and the mismatch alert;
- the HN appearing in each viewer's page only as allowed;
- no HN or workbook row in the server logs.

It saves screenshots of the sign-in pages and the board at 360 and 1280 px wide (the claim steps and the request form also at 320 px), and of the repair-phase pages on a 390 px phone. Playwright is pinned to the version whose Chromium is installed.

Both test runs drop and truncate tables, `users` among them, and `users` is shared in production (another workstream owns it, with stable ids). So both refuse to start (`tests/db-guard.mjs`) when `TEST_DATABASE_URL` or `E2E_DATABASE_URL` names a host other than `localhost`, `127.0.0.1`, `::1` or a Unix socket, and when `users` in that database already holds more than 50 rows (more than the tests ever insert). Never point them at Neon or at a Neon branch of production. `ALLOW_REMOTE_TEST_DB=1` lifts only the host check, for a remote database that holds nothing you need.

`overrides.zod` lifts the zod copy pulled in by `@vercel/functions` to a patched release.

## Security overview

- `src/proxy.ts`: canonical-host redirect in production, Origin check on every non-GET request, a CSP nonce per request, the device gate (the LIFF app on a phone, see Device gate), and a sign-in gate on every route except `/login*`, `/api/auth/*` and `/preview*` (the preview pages answer 404 outside development). Every board page also checks the session itself. The one exception to both checks is `POST /api/telegram/webhook`, which requires Telegram's secret header instead.
- Session: HS256 JWT (30 days) in an HttpOnly, Secure, SameSite=Lax `__Host-session` cookie, carrying the number in its canonical form, or, for a doctor signed in by email, their `users.id` (sessions from the old email version, which carried an address, are refused). The number, or the doctor's email claim, must still be authorized on every request; when the database is unreachable only `ALLOWED_PHONES` is (fail closed).
- Codes: 6 digits, 5 minutes, single use, at most 5 attempts (counted before deeSMSX is asked). In deeSMSX mode the code never reaches the app's database; deeSMSX's token is stored encrypted. In local mode the code is stored as an HMAC with `OTP_PEPPER`. The API keys, tokens and codes are never logged. Limits and the daily cap are under Cost control. Every valid number gets a code and the same answer, so the page never shows whether a number is on the list before the code is checked.
- `/admin`: a signed-in session whose `sub` is in `AUTH_ADMIN_LINE_IDS`; anyone else gets a 404, and every server action checks the admin list again.
- `/upload`: MX (a row in `mx_members` for the session's user) or an admin; anyone else gets a 404 with no loading screen first. The upload action checks the role, the window (by the server's clock), the file's name, size and content, and the day again. The `.xlsx` reader caps sizes, entries, rows and columns, and refuses encrypted and `.xls` files.
- Patient data: the HOSxP file's patient fields (name, age, AN, diagnosis, illnesses, costs) are never read into a row or stored. Each new upload deletes the uploads made more than 30 days before it (nothing else does, see HOSxP upload). A booking keeps its HN as long as the booking's row, cancelled ones included (`cases.hn`). The HN is sent only to MX, admins and the doctor who booked (the server filters the page's data), and no HN or workbook row is ever logged. The repository holds only the made-up sample workbooks.
- Access requests: the `access` cookie (12 hours, own key) never grants a session; names allow only letters, spaces and `. - '`; everything sent to Telegram is escaped.
- Headers: CSP (nonce and `strict-dynamic`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `X-Robots-Tag: noindex`, and `robots.txt` disallowing all.
- Real names, real phone numbers, the users CSV, deeSMSX keys and other secrets never go in this public repository; examples, tests and screenshots use invented names and numbers only (`*.csv`, `outbox/` and `screens/` are gitignored as a safety net).
- Name claims: open only while every claim can be announced to a Telegram administrator with an undo button (fail closed, like access requests); one name per number and per LINE account; claims and access requests of one number exclude each other.
