import dotenv from 'dotenv';
dotenv.config();

// Fails fast with a clear message when a required var is missing/empty, instead of letting
// e.g. `undefined.split(',')` crash later with an unhelpful TypeError that doesn't say which
// setting is the problem — important now that GitLab CI/CD variables (not a checked-in .env)
// are the only place these get set, and a typo'd variable name is easy to miss there.
function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

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
    user: requireEnv('GMAIL_USER'),
    appPassword: requireEnv('GMAIL_APP_PASSWORD'),
    reportSender: requireEnv('GMAIL_REPORT_SENDERS').split(",").map(s => s.trim()).filter(Boolean),
    reportSubject: requireEnv('GMAIL_REPORT_SUBJECT').split(",").map(s => s.trim()).filter(Boolean),
  },
  db: {
    host: requireEnv('DB_HOST'),
    port: requireEnv('DB_PORT'),
    name: requireEnv('DB_NAME'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    table: requireEnv('DB_TABLE'),
    testcaseNameColumn: requireEnv('DB_TESTCASE_NAME_COLUMN'),
    executeColumn: requireEnv('DB_EXECUTE_COLUMN'),

    // Audience recipients live in a table owned by other automation, not this agent —
    // scoped by git_branch since the same table serves multiple environments/pipelines.
    recipients: {
      table: requireEnv('DB_RECIPIENTS_TABLE'),
      gitBranch: requireEnv('AUDIENCE_GIT_BRANCH'),
      columns: {
        gitBranch: 'git_branch',
        emailAddress: 'email_address',
        emailEnabled: 'email_enabled',
      },
    },

    // The agent's own bookkeeping tables (report cache, per-recipient notifications,
    // acknowledgment tracking) — same MySQL connection as above, but their own
    // env-configurable table names so they can't collide with anything else in a shared
    // schema. Column names aren't deployment config (they're not expected to vary between
    // environments), so they're plain constants here rather than one env var each.
    reportCache: {
      table: requireEnv('DB_REPORT_CACHE_TABLE'),
      columns: {
        reportDate: 'report_date',
        reportType: 'report_type',
        subject: 'subject',
        html: 'html',
        createdAt: 'created_at',
        firstSentAt: 'first_sent_at',
        dbUpdateFailed: 'db_update_failed',
        dbFailedMessage: 'db_failed_message',
        dbUpdateDetails: 'db_update_details',
        summary: 'summary',
        reminderCount: 'reminder_count',
        acknowledged: 'acknowledged',
        acknowledgedBy: 'acknowledged_by',
        acknowledgedAt: 'acknowledged_at',
      },
    },
    reportNotifications: {
      table: requireEnv('DB_REPORT_NOTIFICATIONS_TABLE'),
      columns: {
        reportDate: 'report_date',
        reportType: 'report_type',
        recipient: 'recipient',
        messageId: 'message_id',
        sentAt: 'sent_at',
      },
    },
    replyReceipts: {
      table: requireEnv('DB_REPLY_RECEIPTS_TABLE'),
      columns: {
        replyMessageId: 'reply_message_id',
        reportDate: 'report_date',
        reportType: 'report_type',
        replier: 'replier',
        role: 'role',
        handledAt: 'handled_at',
      },
    },
  },
  smtp: {
    host: requireEnv('SMTP_HOST'),
    port: requireEnv('SMTP_PORT'),
    user: requireEnv('SMTP_USER'),
    password: requireEnv('SMTP_PASSWORD'),
  },
  ollama: {
    host: process.env.OLLAMA_HOST,
    model: process.env.OLLAMA_MODEL,
  },
  // Once a report has been reminded more than this many times with no acknowledgment,
  // remainder.js also escalates to gmail.reportSender on every subsequent run.
  maxReminders: process.env.MAX_REMINDERS ? Number(process.env.MAX_REMINDERS) : 3,
};
