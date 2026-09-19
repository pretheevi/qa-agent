import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let dbPromise;

function getDb() {
  if (!dbPromise) {
    dbPromise = open({ filename: './local.db', driver: sqlite3.Database }).then(async db => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS report_cache (
          report_date TEXT PRIMARY KEY,
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
          acknowledged_at TEXT
        )
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function getCachedReport(reportDate) {
  const db = await getDb();
  return db.get('SELECT subject, html FROM report_cache WHERE report_date = ?', [reportDate]);
}

export async function saveReportCache(reportDate, subject, html, { dbUpdateFailed = false, dbFailedMessage = '', summary = '', acknowledged = false } = {}) {
  const db = await getDb();
  await db.run(
    `INSERT INTO report_cache (report_date, subject, html, created_at, first_sent_at, db_update_failed, db_failed_message, summary, reminder_count, acknowledged)
     VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, 0, ?)
     ON CONFLICT(report_date) DO UPDATE SET
       subject = excluded.subject,
       html = excluded.html,
       created_at = excluded.created_at,
       db_update_failed = excluded.db_update_failed,
       db_failed_message = excluded.db_failed_message,
       summary = excluded.summary`,
    [reportDate, subject, html, dbUpdateFailed ? 1 : 0, dbFailedMessage, summary, acknowledged ? 1 : 0]
  );
}

export async function getUnacknowledgedReports() {
  const db = await getDb();
  return db.all('SELECT * FROM report_cache WHERE acknowledged = 0');
}

export async function incrementReminder(reportDate) {
  const db = await getDb();
  await db.run('UPDATE report_cache SET reminder_count = reminder_count + 1 WHERE report_date = ?', [reportDate]);
}

export async function markAcknowledged(reportDate, ackBy) {
  const db = await getDb();
  await db.run(
    `UPDATE report_cache SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime('now') WHERE report_date = ?`,
    [ackBy, reportDate]
  );
}

export async function closeLocalDb() {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.close();
}
