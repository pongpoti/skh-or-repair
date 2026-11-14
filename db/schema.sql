-- Idempotent schema, applied lazily once per server instance by lib/db.ts.
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
-- The sign-in only reads users: it never adds columns to it and never writes it at runtime (only scripts/sync-users.mjs
-- does). Ids stay stable and removals are active = false, never deletes. Claims live in user_claims.
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
-- 'replaced' ends a claim when the doctor proves the name by email from another LINE account (the code went to their
-- own address, so the newer proof wins). Applied to existing databases too: claims made before keep via = 'phone'.
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
  email       text        NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
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

-- Access requests from verified numbers that hold no claimed name (decided in Telegram). position is a user type.
-- A number is authorized while it has an approved row; revoke with
-- UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE phone = '0812345678' AND status = 'approved'.
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
INSERT INTO repair_periods (half, from_date, to_date) VALUES (1, '2026-11-14', '2027-01-26'), (2, '2027-01-27', '2027-03-17')
ON CONFLICT (half) DO NOTHING;

-- MX (ผู้จัดการตาราง): the users who upload the HOSxP workbook (lib/roles.ts), granted and revoked by an admin on /admin.
-- Revoking deletes the row. The role holds only while the user's current claim does (an inactive user loses it).
-- added_by is the LINE sub of the admin who granted it.
CREATE TABLE IF NOT EXISTS mx_members (
  user_id   integer     PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  text
);

-- HOSxP workbook uploads (lib/workbook-store.ts): MX uploads the next workday's list between 15:00 and 16:00 Bangkok
-- time. cycle_day is the Bangkok date of the upload and target_date the workday it lists; the board shows the latest
-- upload of its cycle (lib/board-day.ts). uploaded_by is the uploader's LINE sub. summary holds counts only (rows read,
-- dropped by reason, placed per room), never a row. Uploads older than 30 days go, with their cases, whenever a new
-- one is saved.
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

-- The kept cases of one upload, with only what the board needs: never the patient's name, age, AN, diagnosis,
-- illnesses or costs. hn is normalised (lib/hn.ts) for matching the bookings, and shown only to the doctor who booked
-- the case, MX and admins. room_id is where the case was placed at upload (NULL when it was not, e.g. obstetrics
-- during the repair); the board places the case again when it is read, from dept, team (the surgeon's team, for the
-- SCOPE rule) and urgency, so a change of the repair's dates after the upload moves it. position is its order in the
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
  position     integer     NOT NULL
);
CREATE INDEX IF NOT EXISTS workbook_cases_upload_idx ON workbook_cases (upload_id);
