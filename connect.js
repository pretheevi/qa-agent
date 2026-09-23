import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let dbPromise;

function getDb() {
  if (!dbPromise) {
    dbPromise = open({
      filename: './local.db',
      driver: sqlite3.Database,
    }).then(async db => {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS report_cache (
            report_date TEXT NOT NULL,
            report_type TEXT NOT NULL,
            subject TEXT,
            html TEXT,
            created_at TEXT,
            first_sent_at TEXT,
            db_update_failed INTEGER DEFAULT 0,
            db_failed_message TEXT,
            summary TEXT,
            reminder_count INTEGER DEFAULT 0,
            acknowledged INTEGER DEFAULT 0,
            acknowledged_by TEXT,
            acknowledged_at TEXT,
            db_update_details TEXT,
            PRIMARY KEY (report_date, report_type)
          )
        `);

        // Migration for a local.db created before db_update_details existed — CREATE TABLE
        // IF NOT EXISTS above is a no-op against an already-existing table.
        const existingColumns = await db.all(`PRAGMA table_info(report_cache)`);
        if (!existingColumns.some(col => col.name === 'db_update_details')) {
          await db.exec(`ALTER TABLE report_cache ADD COLUMN db_update_details TEXT`);
        }

        // One row per email actually sent to one recipient, so a reply can be traced back
        // to exactly who it was sent to (a single shared column can't survive a multi-recipient
        // audience — the last recipient's send would overwrite everyone else's).
        await db.exec(`
          CREATE TABLE IF NOT EXISTS report_notifications (
            report_date TEXT NOT NULL,
            report_type TEXT NOT NULL,
            recipient TEXT NOT NULL,
            message_id TEXT NOT NULL,
            sent_at TEXT NOT NULL,
            PRIMARY KEY (report_date, report_type, recipient, message_id)
          )
        `);

        // Every inbound reply we've already acted on (as the acknowledger or as a late
        // duplicate), keyed by the reply's own Message-ID, so the same reply is never
        // processed twice even across separate runs.
        await db.exec(`
          CREATE TABLE IF NOT EXISTS reply_receipts (
            reply_message_id TEXT PRIMARY KEY,
            report_date TEXT NOT NULL,
            report_type TEXT NOT NULL,
            replier TEXT NOT NULL,
            role TEXT NOT NULL,
            handled_at TEXT NOT NULL
          )
        `);

      return db;
    });
  }

  return dbPromise;
}

export async function getCachedReports(reportDate) {
  const db = await getDb();

  return db.all(
    `SELECT *
     FROM report_cache
     WHERE report_date = ?
     ORDER BY report_type`,
    [reportDate]
  );
}

export async function saveReportCache(
  reportDate,
  reportType,
  subject,
  html,
  {
    dbUpdateFailed = false,
    dbFailedMessage = '',
    dbUpdateDetails = null,
    summary = '',
    acknowledged = false,
  } = {}
) {
  const db = await getDb();

  await db.run(
    `INSERT INTO report_cache (
      report_date,
      report_type,
      subject,
      html,
      created_at,
      first_sent_at,
      db_update_failed,
      db_failed_message,
      db_update_details,
      summary,
      reminder_count,
      acknowledged
    )
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?, 0, ?)
    ON CONFLICT(report_date, report_type) DO UPDATE SET
      subject = excluded.subject,
      html = excluded.html,
      created_at = excluded.created_at,
      db_update_failed = excluded.db_update_failed,
      db_failed_message = excluded.db_failed_message,
      db_update_details = excluded.db_update_details,
      summary = excluded.summary`,
    [
      reportDate,
      reportType,
      subject,
      html,
      dbUpdateFailed ? 1 : 0,
      dbFailedMessage,
      dbUpdateDetails ? JSON.stringify(dbUpdateDetails) : null,
      summary,
      acknowledged ? 1 : 0,
    ]
  );
}

export async function saveReportNotification(reportDate, reportType, recipient, messageId) {
  const db = await getDb();

  await db.run(
    `INSERT OR IGNORE INTO report_notifications (
      report_date, report_type, recipient, message_id, sent_at
    ) VALUES (?, ?, ?, ?, datetime('now'))`,
    [reportDate, reportType, recipient, messageId]
  );
}

export async function getReportNotifications(reportDate, reportType) {
  const db = await getDb();

  return db.all(
    `SELECT * FROM report_notifications WHERE report_date = ? AND report_type = ?`,
    [reportDate, reportType]
  );
}

export async function hasReplyBeenProcessed(replyMessageId) {
  const db = await getDb();

  const row = await db.get(
    `SELECT 1 FROM reply_receipts WHERE reply_message_id = ?`,
    [replyMessageId]
  );

  return !!row;
}

export async function recordReplyReceipt(reportDate, reportType, replyMessageId, replier, role) {
  const db = await getDb();

  await db.run(
    `INSERT OR IGNORE INTO reply_receipts (
      reply_message_id, report_date, report_type, replier, role, handled_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [replyMessageId, reportDate, reportType, replier, role]
  );
}

export async function getUnacknowledgedReports(reportType) {
  const db = await getDb();

  return db.all(
    `SELECT *
     FROM report_cache
     WHERE report_type = ? AND acknowledged = 0
     ORDER BY report_date, first_sent_at`,
    [reportType]
  );
}

export async function getAcknowledgedReports(reportType) {
  const db = await getDb();

  return db.all(
    `SELECT *
     FROM report_cache
     WHERE report_type = ? AND acknowledged = 1
     ORDER BY report_date, first_sent_at`,
    [reportType]
  );
}

export async function incrementReminder(reportDate, reportType) {
  const db = await getDb();

  await db.run(
    `UPDATE report_cache
     SET reminder_count = reminder_count + 1
     WHERE report_date = ? AND report_type = ?`,
    [reportDate, reportType]
  );
}

export async function markAcknowledged(reportDate, reportType, ackBy) {
  const db = await getDb();

  await db.run(
    `UPDATE report_cache
     SET acknowledged = 1,
         acknowledged_by = ?,
         acknowledged_at = datetime('now')
     WHERE report_date = ? AND report_type = ?`,
    [ackBy, reportDate, reportType]
  );
}

export async function closeLocalDb() {
  if (!dbPromise) return;

  const db = await dbPromise;
  await db.close();
}