import dotenv from 'dotenv';
dotenv.config();

// Local (not UTC) calendar-day string, so the cache-key date always matches the same
// day boundary that IMAP searches use (since.setHours(0,0,0,0) is local-time based —
// toISOString() is UTC and drifts a day off near midnight in non-UTC timezones).
export function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const config = {
  // Single source of truth for "today". Override with TODAY_DATE (e.g. "2026-09-17") to
  // test against a specific date instead of editing dates inside individual files.
  today: process.env.TODAY_DATE ? new Date(process.env.TODAY_DATE) : new Date(),
  gmail: {
    user: process.env.GMAIL_USER,
    appPassword: process.env.GMAIL_APP_PASSWORD,
    reportSender: process.env.GMAIL_REPORT_SENDERS.split(",").map(s => s.trim()).filter(Boolean),
    reportSubject: process.env.GMAIL_REPORT_SUBJECT.split(",").map(s => s.trim()).filter(Boolean),
  },
  db: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    table: process.env.DB_TABLE,
    testcaseNameColumn: process.env.DB_TESTCASE_NAME_COLUMN,
    executeColumn: process.env.DB_EXECUTE_COLUMN,
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    // Lowercased to match reply.from in gmailClient.js (mailparser addresses are lowercased
    // there) — otherwise a mixed-case address in AUDIENCE_EMAILS would never match a reply.
    audience: (process.env.AUDIENCE_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
  },
  ollama: {
    host: process.env.OLLAMA_HOST,
    model: process.env.OLLAMA_MODEL,
  },
  // Once a report has been reminded more than this many times with no acknowledgment,
  // remainder.js also escalates to gmail.reportSender on every subsequent run.
  maxReminders: process.env.MAX_REMINDERS ? Number(process.env.MAX_REMINDERS) : 3,
};
