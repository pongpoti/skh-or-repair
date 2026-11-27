#!/usr/bin/env node
// Makes a key for the calendar API (src/lib/calendar-api.ts): `node scripts/calendar-api-key.mjs`.
// Prints the key, for the calendar's developer only (their server's secret store; never a chat, an email or a repo), and
// its SHA-256, which goes into Vercel's CALENDAR_API_KEY_SHA256 (Production; comma-separated to keep an old key working
// while the calendar switches to a new one). Writes nothing to disk. The app keeps only the hash.
import { createHash, randomBytes } from "node:crypto";

const key = `skhor_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(key, "utf8").digest("hex");
console.log(`key (give to the calendar's developer):      ${key}`);
console.log(`CALENDAR_API_KEY_SHA256 (Vercel, Production): ${hash}`);
