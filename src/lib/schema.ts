// Generated copy of db/schema.sql (bundled so no filesystem access is needed at runtime).
// Keep identical to db/schema.sql; tests/unit/schema.test.ts enforces it.
export const SCHEMA_SQL = `-- Idempotent schema, applied lazily once per server instance by lib/db.ts.
-- Keep identical to SCHEMA_SQL in lib/schema.ts (a unit test enforces this).
-- Phone numbers are Thai mobile numbers in the canonical form 0812345678 (lib/phone.ts).

-- One row per code sent by SMS. A row is written (as a reservation that cannot be verified yet) before the SMS goes
-- out and completed once it was accepted. It is deleted again only when sending certainly failed (so such a failure
-- costs nobody a quota); when the SMS may have gone out (a timeout, an unreadable answer) it stays as a reservation
-- that can never be verified but still counts for every limit and the daily cap.
-- Provider mode (deeSMSX) stores the provider's token, encrypted with a key derived from OTP_PEPPER; local mode
-- (development and tests) stores code_hash, an HMAC of the code. ref is the reference shown beside the code.
CREATE TABLE IF NOT EXISTS otp_codes (
  id              bigserial   PRIMARY KEY,
  phone           text        NOT NULL,
  line_sub        text        NOT NULL,
  code_hash       text,
  provider_token  text,
  ref             text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at         timestamptz,
  ip              text
);
CREATE INDEX IF NOT EXISTS otp_codes_phone_sub_idx ON otp_codes (phone, line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_codes_phone_created_idx ON otp_codes (phone, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_sub_created_idx ON otp_codes (line_sub, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_ip_created_idx ON otp_codes (ip, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_created_idx ON otp_codes (created_at);

CREATE TABLE IF NOT EXISTS line_bindings (
  line_sub      text        PRIMARY KEY,
  phone         text        NOT NULL,
  display_name  text,
  verified_at   timestamptz NOT NULL,
  last_login_at timestamptz
);
CREATE INDEX IF NOT EXISTS line_bindings_phone_idx ON line_bindings (phone);

CREATE TABLE IF NOT EXISTS login_events (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  line_sub    text,
  phone       text,
  event       text        NOT NULL,
  ip          text,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS login_events_at_idx ON login_events (at DESC);
CREATE INDEX IF NOT EXISTS login_events_phone_idx ON login_events (phone, at DESC);
CREATE INDEX IF NOT EXISTS login_events_sub_idx ON login_events (line_sub, at DESC);

-- The list of people who may claim their name: table users, shared with the rest of the project, which created and
-- loaded it in production and owns it. This statement mirrors that table's DDL exactly (tests/unit/schema.test.ts
-- compares it with the text in README "Who may sign in"), so it is a no-op where users exists and identical locally.
-- The app never adds columns to users. Its writers are scripts/sync-users.mjs and, one name at a time, an admin's
-- add-user on /admin (lib/user-admin.ts, table users_added; Pong, 17 Nov 2026). Ids stay stable and removals are active = false, never deletes. Claims live in user_claims.
CREATE TABLE IF NOT EXISTS users (
  id          integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name  text        NOT NULL CHECK (btrim(first_name) <> ''),
  last_name   text        NOT NULL CHECK (btrim(last_name) <> ''),
  type        text        NOT NULL CHECK (type IN ('DR','RN','PN','PCA')),
  subtype     text        NOT NULL CHECK (btrim(subtype) <> ''),
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_name_key UNIQUE (first_name, last_name)
);

-- Every claim of a name (never deleted) and the Telegram messages that announced it, with their undo button. After
-- the SMS code, someone whose number is not authorized picks their type and name on /login/claim; the first claim of
-- a name wins. A claim is current while undone_at IS NULL: then it authorizes its number if the user is active
-- (lib/authz.ts) and names it on the board and in alerts. The partial unique indexes keep one current claim per user,
-- per number and per LINE account. undo_reason: 'admin' (the Telegram undo button; blocks that number and LINE account
-- from claiming for 24 h), 'inactive' (closed by the app when the same number or LINE account claims again while its
-- name is inactive, e.g. a corrected spelling; no block), 'manual' (released by hand in SQL; no block).
CREATE TABLE IF NOT EXISTS user_claims (
  id           bigserial   PRIMARY KEY,
  user_id      integer     NOT NULL REFERENCES users (id),
  phone        text        NOT NULL CHECK (phone ~ '^0[689][0-9]{8}$'),
  line_sub     text        NOT NULL,          -- LINE account that made the claim
  line_name    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ip           text,
  undone_at    timestamptz,
  undone_by    bigint,                        -- Telegram id of whoever pressed undo (NULL otherwise)
  undo_reason  text        CHECK (undo_reason IN ('admin', 'inactive', 'manual')),
  tg_messages  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  CHECK ((undone_at IS NULL) = (undo_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS user_claims_current_user_key ON user_claims (user_id) WHERE undone_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_claims_current_phone_key ON user_claims (phone) WHERE undone_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_claims_current_line_sub_key ON user_claims (line_sub) WHERE undone_at IS NULL;
CREATE INDEX IF NOT EXISTS user_claims_phone_idx ON user_claims (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS user_claims_sub_idx ON user_claims (line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS user_claims_user_idx ON user_claims (user_id, created_at DESC);

-- Doctors (users of type DR) prove who they are with a code sent by email instead of an SMS code (lib/email-otp.ts).
-- Such a claim is made by the doctor's LINE account and holds no number: via = 'email', phone NULL, and
-- email_verified_at is when the last email code was checked (a LINE sign-in skips the code for 180 days after it).
-- 'replaced' ends a claim that holds nothing (a doctor's name by number: doctors sign in by email only; an email claim
-- on a name no longer DR) when its name, number or LINE account claims again. A name another LINE account holds by
-- email is refused, never taken over.
-- Applied to existing databases too: claims made before keep via = 'phone'.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'user_claims'::regclass AND attname = 'via' AND NOT attisdropped) THEN
    ALTER TABLE user_claims ADD COLUMN via text NOT NULL DEFAULT 'phone';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'user_claims'::regclass AND attname = 'email_verified_at' AND NOT attisdropped
  ) THEN
    ALTER TABLE user_claims ADD COLUMN email_verified_at timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'user_claims'::regclass AND attname = 'phone' AND attnotnull) THEN
    ALTER TABLE user_claims ALTER COLUMN phone DROP NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_claims'::regclass AND conname = 'user_claims_via_check') THEN
    ALTER TABLE user_claims ADD CONSTRAINT user_claims_via_check CHECK (
      (via = 'phone' AND phone IS NOT NULL) OR (via = 'email' AND phone IS NULL AND email_verified_at IS NOT NULL)
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_claims'::regclass AND conname = 'user_claims_undo_reason_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%replaced%'
  ) THEN
    ALTER TABLE user_claims DROP CONSTRAINT user_claims_undo_reason_check;
    ALTER TABLE user_claims ADD CONSTRAINT user_claims_undo_reason_check
      CHECK (undo_reason IN ('admin', 'inactive', 'manual', 'replaced'));
  END IF;
END $$;

-- Doctors' email addresses (from the hospital's doctor directory), one row per address: a doctor may have several,
-- and a code goes to all of them. Lower case and trimmed. Written by hand (see README, Doctors sign in by email); the
-- sign-in only reads it.
CREATE TABLE IF NOT EXISTS user_emails (
  user_id     integer     NOT NULL REFERENCES users (id),
  email       text        NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, email)
);

-- One row per code sent by email to a doctor (user_id) for one LINE account. Like otp_codes: written as a
-- reservation (expires_at = created_at) before the email goes out and completed once it was accepted, removed when
-- sending certainly failed. Only an HMAC of the code is stored (keyed with OTP_PEPPER).
CREATE TABLE IF NOT EXISTS email_codes (
  id          bigserial   PRIMARY KEY,
  user_id     integer     NOT NULL REFERENCES users (id),
  line_sub    text        NOT NULL,
  code_hash   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at     timestamptz,
  ip          text
);
CREATE INDEX IF NOT EXISTS email_codes_user_sub_idx ON email_codes (user_id, line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS email_codes_sub_created_idx ON email_codes (line_sub, created_at);
CREATE INDEX IF NOT EXISTS email_codes_ip_created_idx ON email_codes (ip, created_at);
CREATE INDEX IF NOT EXISTS email_codes_created_idx ON email_codes (created_at);

-- Access requests (typed names, decided in Telegram) from before 15 Nov 2026, kept as history only: names now come
-- only from users, and no row here authorizes or names anyone. position is a user type.
CREATE TABLE IF NOT EXISTS access_requests (
  id           bigserial   PRIMARY KEY,
  phone        text        NOT NULL,
  line_sub     text        NOT NULL,
  line_name    text,
  first_name   text        NOT NULL,
  last_name    text        NOT NULL,
  position     text        NOT NULL CHECK (position IN ('DR', 'RN', 'PN', 'PCA')),
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  ip           text,
  decided_at   timestamptz,
  decided_by   bigint,
  tg_messages  jsonb       NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending_idx ON access_requests (phone) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS access_requests_phone_idx ON access_requests (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS access_requests_sub_idx ON access_requests (line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS access_requests_approved_idx ON access_requests (phone) WHERE status = 'approved';

-- Databases made before positions became user types (doctor/nurse): move them over once.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'access_requests'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%doctor%'
  ) THEN
    ALTER TABLE access_requests DROP CONSTRAINT access_requests_position_check;
    UPDATE access_requests SET position = CASE position WHEN 'doctor' THEN 'DR' ELSE 'RN' END
    WHERE position IN ('doctor', 'nurse');
    ALTER TABLE access_requests ADD CONSTRAINT access_requests_position_check CHECK (position IN ('DR', 'RN', 'PN', 'PCA'));
  END IF;
END $$;

-- Cases a doctor added on the board (lib/cases.ts, the board's จองห้อง button). Only a signed-in doctor (a current claim on
-- an active users row of type DR) adds them, and the surgeon is always that doctor. op_date is the operation's day in
-- Thailand; room_id is an operating room (lib/rooms.ts: only open rooms are offered); shift is in (ในเวลา) or out
-- (นอกเวลา). A removed case keeps its row with removed_at set, so the history stays.
CREATE TABLE IF NOT EXISTS cases (
  id          bigserial   PRIMARY KEY,
  op_date     date        NOT NULL,
  room_id     text        NOT NULL CHECK (room_id ~ '^or-([1-9]|1[0-3])$'),
  operation   text        NOT NULL CHECK (btrim(operation) <> '' AND char_length(operation) <= 300),
  shift       text        NOT NULL DEFAULT 'in' CHECK (shift IN ('in', 'out')),
  surgeon_id  integer     NOT NULL REFERENCES users (id),
  line_sub    text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS cases_day_idx ON cases (op_date, created_at) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS cases_surgeon_idx ON cases (surgeon_id, op_date) WHERE removed_at IS NULL;

-- Bookings: during the ventilation repair a doctor books a room for a patient by HN (lib/added-cases.ts), and the HOSxP
-- workbook's cases are matched to the bookings by it (lib/board-rows.ts). hn is stored normalised (lib/hn.ts: upper
-- case, no spaces or dashes, no leading zeros); cases saved before bookings carried an HN keep NULL. The operation name
-- became optional (the workbook names the operation): a booking without one stores NULL, never an empty string, so
-- the CHECK above still refuses a blank name. Applied to existing databases too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'hn' AND NOT attisdropped) THEN
    ALTER TABLE cases ADD COLUMN hn text CONSTRAINT cases_hn_check CHECK (hn ~ '^[0-9A-Z]{1,15}$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'operation' AND attnotnull) THEN
    ALTER TABLE cases ALTER COLUMN operation DROP NOT NULL;
  END IF;
END $$;

-- The doctor's choice of room (Pong, 15 Nov 2026: "let surgeon decide which room to use: dept room or dressing room"):
-- dressing is true for the dressing room (ห้องทำแผล) and false for the doctor's department's room; scrub_does is the
-- answer to "scrub ทำให้แทนไหม ?" for a dressing-room booking, true when the scrub nurse does the dressing and false
-- when the doctor does, and NULL otherwise. Bookings saved before the form asked keep NULL in both, and their saved
-- room says which room they are in (lib/added-cases.ts bookedChoice). Applied to existing databases too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'dressing' AND NOT attisdropped) THEN
    ALTER TABLE cases ADD COLUMN dressing boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'scrub_does' AND NOT attisdropped) THEN
    ALTER TABLE cases ADD COLUMN scrub_does boolean;
  END IF;
  -- The scrub answer is given for a dressing-room booking, and only for one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cases'::regclass AND conname = 'cases_scrub_does_check') THEN
    ALTER TABLE cases ADD CONSTRAINT cases_scrub_does_check CHECK ((dressing IS TRUE) = (scrub_does IS NOT NULL));
  END IF;
END $$;

-- The doctor's note to the OR team (หมายเหตุ; Pong, 17 Nov 2026: "Add หมายเหตุ input on booking form"), optional: shown on
-- the board's row of the booking to everyone who opens the board. NULL when there is none, never an empty string; at
-- most 500 characters (lib/added-cases.ts MAX_NOTE). Applied to existing databases too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'note' AND NOT attisdropped) THEN
    ALTER TABLE cases ADD COLUMN note text CONSTRAINT cases_note_check CHECK (btrim(note) <> '' AND char_length(note) <= 500);
  END IF;
END $$;

-- A doctor's edits of their own booking (Pong, 25 Nov 2026: "on DR case row : allow surgeon to edit, move date, delete
-- and other functions"; lib/added-cases.ts bookingChange). The row is changed in place, so its id stays. queued_at is
-- the booking's place in its room's queue ("จองก่อน ได้คิวก่อน"), the time the case rows show as วันเวลาที่จองคิว: the
-- time it was made, set again to the time of an edit that moves it to another day, room or patient (HN), which counts as
-- a new booking at the back of that queue. Fixing the operation's name, the note or the scrub answer keeps it.
-- edited_at is the last edit's time, NULL for a booking never edited. Applied to existing databases too: a booking made
-- before keeps its place (queued_at = created_at).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'queued_at' AND NOT attisdropped) THEN
    ALTER TABLE cases ADD COLUMN queued_at timestamptz;
    UPDATE cases SET queued_at = created_at;
    ALTER TABLE cases ALTER COLUMN queued_at SET DEFAULT now(), ALTER COLUMN queued_at SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'edited_at' AND NOT attisdropped) THEN
    ALTER TABLE cases ADD COLUMN edited_at timestamptz;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS cases_day_queue_idx ON cases (op_date, queued_at) WHERE removed_at IS NULL;

-- The booking's time on its day (Pong, 27 Nov 2026: "select time (time range 8.30 to 15.30) on day view of calendar"):
-- start_min and end_min are minutes after midnight, Thailand time, on 15-minute steps from 08:30 (510) to 15:30 (930),
-- the end after the start (lib/booking-time.ts). Both NULL for a booking without a time (the form's ระบุเวลา switch is
-- off by default, Pong 27 Nov 2026), or one made before the form asked. Two timed bookings in one room never share a
-- minute (app/(board)/actions.ts checks it under an advisory lock on the day). Applied to existing databases too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'start_min' AND NOT attisdropped) THEN
    ALTER TABLE cases ADD COLUMN start_min smallint, ADD COLUMN end_min smallint;
    ALTER TABLE cases ADD CONSTRAINT cases_time_check CHECK (
      (start_min IS NULL AND end_min IS NULL) OR
      (start_min IS NOT NULL AND end_min IS NOT NULL AND start_min >= 510 AND end_min <= 930 AND start_min < end_min
       AND start_min % 15 = 0 AND end_min % 15 = 0)
    );
  END IF;
END $$;

-- The hospital of the booking (Pong, 27 Nov 2026: "Add booking btn on ท่าฉลอม also"; lib/places.ts): 'skh' for
-- รพ.สมุทรสาคร, 'tha-chalom' for รพ.ท่าฉลอม. room_id is one of that hospital's rooms: OR 1 to OR 13 at รพ.สมุทรสาคร, OR 1
-- to OR 4 or the Scope room at รพ.ท่าฉลอม (lib/tha-chalom-schedule.ts). Every booking made before is at รพ.สมุทรสาคร.
-- Applied to existing databases too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'cases'::regclass AND attname = 'place' AND NOT attisdropped) THEN
    ALTER TABLE cases ADD COLUMN place text NOT NULL DEFAULT 'skh' CONSTRAINT cases_place_check CHECK (place IN ('skh', 'tha-chalom'));
    ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_room_id_check;
    ALTER TABLE cases ADD CONSTRAINT cases_place_room_check CHECK (
      (place = 'skh' AND room_id ~ '^or-([1-9]|1[0-3])$') OR
      (place = 'tha-chalom' AND room_id IN ('or-1', 'or-2', 'or-3', 'or-4', 'scope'))
    );
  END IF;
END $$;

-- The ventilation repair's two halves, which an admin can move on /admin (lib/repair-store.ts; the room layout of each
-- half is in lib/repair.ts). Seeded once with the planned dates; a saved row is never overwritten by the seed.
-- updated_by is the LINE sub of the admin who saved it (NULL for the seed).
CREATE TABLE IF NOT EXISTS repair_periods (
  half        smallint    PRIMARY KEY CHECK (half IN (1, 2)),
  from_date   date        NOT NULL,
  to_date     date        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  CHECK (from_date <= to_date)
);
INSERT INTO repair_periods (half, from_date, to_date) VALUES (1, '2026-12-08', '2027-01-26'), (2, '2027-01-27', '2027-03-17')
ON CONFLICT (half) DO NOTHING;
-- The repair starts on 8 Dec 2026 and runs 100 days, to 17 Mar 2027 (Pong, 21 Nov 2026); before it the board shows the
-- normal weekly OR schedule. Moves the first day of a seed nobody has edited (the old 14 Nov 2026 start, then 1 Jan 2026,
-- "apply first half schedule retrospectively", 18 Nov 2026); an admin's own dates stay.
UPDATE repair_periods SET from_date = '2026-12-08'
WHERE half = 1 AND from_date IN ('2026-11-14', '2026-01-01') AND updated_by IS NULL;

-- The admin's switch for which rooms the board shows (lib/repair.ts ScheduleMode, Pong, 21 Nov 2026): 'auto' by the
-- repair's dates, 'normal' the weekly OR schedule on every day, 'half1' or 'half2' that half's rooms on every day. One
-- row; no row means 'auto'. updated_by is the LINE sub of the admin who saved it.
CREATE TABLE IF NOT EXISTS schedule_mode (
  id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode        text        NOT NULL CHECK (mode IN ('auto', 'normal', 'half1', 'half2')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

-- MX (ผู้จัดการตาราง): the users who upload the HOSxP workbook (lib/roles.ts), granted and revoked by an admin on /admin.
-- Revoking deletes the row. The role holds only while the user's current claim does (an inactive user loses it).
-- added_by is the LINE sub of the admin who granted it.
CREATE TABLE IF NOT EXISTS mx_members (
  user_id   integer     PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  text
);

-- Names an admin added on /admin (lib/user-admin.ts; Pong, 17 Nov 2026), one row per users row the app inserted or
-- brought back. scripts/sync-users.mjs does not set these inactive for missing from the CSV. added_by is the admin's
-- LINE sub. users itself keeps the production DDL: no column is added to it.
CREATE TABLE IF NOT EXISTS users_added (
  user_id   integer     PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  text        NOT NULL
);

-- The mobile number an admin gave with a name added on /admin (lib/user-admin.ts; Pong, 21 Nov 2026: a new name that is
-- not a doctor's needs its number, a doctor's its email in user_emails). Only that number may claim the name by SMS
-- (lib/user-list.ts claimUser); names without a row are claimed by any verified number, as before. One number per name
-- and one name per number.
CREATE TABLE IF NOT EXISTS user_phones (
  user_id     integer     PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  phone       text        NOT NULL UNIQUE CHECK (phone ~ '^0[689][0-9]{8}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  added_by    text        NOT NULL
);

-- HOSxP workbook uploads (lib/workbook-store.ts): MX uploads the next workday's list between 15:00 and 16:00 Bangkok
-- time. cycle_day is the Bangkok date of the upload and target_date the workday it lists; the board shows the latest
-- upload of its cycle (lib/board-day.ts). uploaded_by is the uploader's LINE sub. summary holds counts only (rows read,
-- dropped by reason, placed per room), never a row. Whenever a new one is saved, uploads older than 30 days go, with
-- their cases, unless one is the latest of its day: every past day keeps its list for the board's calendar (Pong,
-- 19 Nov 2026).
CREATE TABLE IF NOT EXISTS workbook_uploads (
  id             bigserial   PRIMARY KEY,
  target_date    date        NOT NULL,
  cycle_day      date        NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  uploaded_by    text        NOT NULL,
  uploader_name  text,
  file_name      text,
  total_rows     integer,
  kept           integer,
  placed         integer,
  summary        jsonb
);
CREATE INDEX IF NOT EXISTS workbook_uploads_cycle_idx ON workbook_uploads (cycle_day, target_date, uploaded_at DESC);

-- The kept cases of one upload, with only what the board needs: never the patient's age, AN, diagnosis, illnesses or
-- costs. hn is normalised (lib/hn.ts) for matching the bookings; it and patient_name (the export's ชื่อ, NULL when the
-- file has no such column; Pong, 16 Nov 2026: "Add patient name line above HN") are shown only to the doctor who
-- booked the case, MX and admins, and go with the upload when it is deleted after 30 days. room_id is where the case was placed at upload (NULL when it was not, e.g. obstetrics
-- during the repair); the board places the case again when it is read, from the surgeon's own department (found by
-- name, dept when the surgeon is on no list) and urgency, so a change of the repair's dates or of the rules moves it. position is its order in the
-- file.
CREATE TABLE IF NOT EXISTS workbook_cases (
  id           bigserial   PRIMARY KEY,
  upload_id    bigint      NOT NULL REFERENCES workbook_uploads (id) ON DELETE CASCADE,
  case_id      text        NOT NULL,
  hn           text        NOT NULL,
  operation    text        NOT NULL,
  surgeon      text        NOT NULL,
  dept         text,
  team         text,
  room_id      text        CHECK (room_id ~ '^or-([1-9]|1[0-3])$'),
  shift        text        CHECK (shift IN ('in', 'out')),
  status       text        NOT NULL CHECK (status IN ('scheduled', 'in-progress', 'delayed', 'done', 'cancelled', 'recovery')),
  urgency      text,
  booked_time  text,
  position     integer     NOT NULL,
  patient_name text
);
CREATE INDEX IF NOT EXISTS workbook_cases_upload_idx ON workbook_cases (upload_id);
-- Applied to existing databases too.
ALTER TABLE workbook_cases ADD COLUMN IF NOT EXISTS patient_name text;
-- Past days' lists an admin imported from a HOSxP export of many days (/admin, lib/past-lists.ts; Pong, 19 Nov 2026).
-- past_import marks them, so an import replaces only its own lists, never a list MX uploaded.
ALTER TABLE workbook_uploads ADD COLUMN IF NOT EXISTS past_import boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS workbook_uploads_target_idx ON workbook_uploads (target_date, uploaded_at DESC);
-- The hospital of a kept case (Pong, 27 Nov 2026: "Excel file include both place on one sheet"; lib/places.ts): 'skh'
-- for รพ.สมุทรสาคร, 'tha-chalom' for รพ.ท่าฉลอม, whose rows (lib/workbook.ts thaChalom) were cut before. room_id is one
-- of that hospital's rooms (lib/tha-chalom-schedule.ts for รพ.ท่าฉลอม's), or NULL. tha_chalom marks an upload that kept
-- รพ.ท่าฉลอม's rows: one saved before cut them, so it holds no list for รพ.ท่าฉลอม. Applied to existing databases too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'workbook_cases'::regclass AND attname = 'place' AND NOT attisdropped) THEN
    ALTER TABLE workbook_cases ADD COLUMN place text NOT NULL DEFAULT 'skh' CONSTRAINT workbook_cases_place_check CHECK (place IN ('skh', 'tha-chalom'));
    ALTER TABLE workbook_cases DROP CONSTRAINT IF EXISTS workbook_cases_room_id_check;
    ALTER TABLE workbook_cases ADD CONSTRAINT workbook_cases_place_room_check CHECK (
      room_id IS NULL OR
      (place = 'skh' AND room_id ~ '^or-([1-9]|1[0-3])$') OR
      (place = 'tha-chalom' AND room_id IN ('or-1', 'or-2', 'or-3', 'or-4', 'scope'))
    );
  END IF;
END $$;
ALTER TABLE workbook_uploads ADD COLUMN IF NOT EXISTS tha_chalom boolean NOT NULL DEFAULT false;
-- Doctors who have seen the tutorial (/tutorial; Pong, 19 Nov 2026): a doctor's first visit to the board goes to it
-- once, and a row here, written when they start or skip it, stops that. The tutorial itself saves nothing.
CREATE TABLE IF NOT EXISTS tutorial_seen (
  user_id  integer     PRIMARY KEY REFERENCES users (id),
  seen_at  timestamptz NOT NULL DEFAULT now()
);
`;
