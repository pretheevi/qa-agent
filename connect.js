import { pool } from './src/db/pool.js';
import { config } from './src/config/config.js';

let schemaReady;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const rc = config.db.reportCache;
      const rn = config.db.reportNotifications;
      const rr = config.db.replyReceipts;

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${rc.table} (
          ${rc.columns.reportDate} VARCHAR(20) NOT NULL,
          ${rc.columns.reportType} VARCHAR(20) NOT NULL,
          ${rc.columns.subject} TEXT,
          ${rc.columns.html} LONGTEXT,
          ${rc.columns.createdAt} DATETIME,
          ${rc.columns.firstSentAt} DATETIME,
          ${rc.columns.dbUpdateFailed} TINYINT(1) DEFAULT 0,
          ${rc.columns.dbFailedMessage} TEXT,
          ${rc.columns.dbUpdateDetails} TEXT,
          ${rc.columns.summary} TEXT,
          ${rc.columns.reminderCount} INT DEFAULT 0,
          ${rc.columns.acknowledged} TINYINT(1) DEFAULT 0,
          ${rc.columns.acknowledgedBy} VARCHAR(255),
          ${rc.columns.acknowledgedAt} DATETIME,
          PRIMARY KEY (${rc.columns.reportDate}, ${rc.columns.reportType})
        )
      `);

      // One row per email actually sent to one recipient, so a reply can be traced back
      // to exactly who it was sent to (a single shared column can't survive a multi-recipient
      // audience — the last recipient's send would overwrite everyone else's).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${rn.table} (
          ${rn.columns.reportDate} VARCHAR(20) NOT NULL,
          ${rn.columns.reportType} VARCHAR(20) NOT NULL,
          ${rn.columns.recipient} VARCHAR(255) NOT NULL,
          ${rn.columns.messageId} VARCHAR(255) NOT NULL,
          ${rn.columns.sentAt} DATETIME NOT NULL,
          PRIMARY KEY (${rn.columns.reportDate}, ${rn.columns.reportType}, ${rn.columns.recipient}, ${rn.columns.messageId})
        )
      `);

      // Every inbound reply we've already acted on (as the acknowledger or as a late
      // duplicate), keyed by the reply's own Message-ID, so the same reply is never
      // processed twice even across separate runs.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${rr.table} (
          ${rr.columns.replyMessageId} VARCHAR(255) PRIMARY KEY,
          ${rr.columns.reportDate} VARCHAR(20) NOT NULL,
          ${rr.columns.reportType} VARCHAR(20) NOT NULL,
          ${rr.columns.replier} VARCHAR(255) NOT NULL,
          ${rr.columns.role} VARCHAR(20) NOT NULL,
          ${rr.columns.handledAt} DATETIME NOT NULL
        )
      `);
    })();
  }

  return schemaReady;
}

export async function getCachedReports(reportDate) {
  await ensureSchema();

  const rc = config.db.reportCache;
  const c = rc.columns;

  const [rows] = await pool.execute(
    `SELECT * FROM ${rc.table} WHERE ${c.reportDate} = ? ORDER BY ${c.reportType}`,
    [reportDate]
  );

  return rows;
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
  await ensureSchema();

  const rc = config.db.reportCache;
  const c = rc.columns;

  await pool.execute(
    `INSERT INTO ${rc.table} (
      ${c.reportDate},
      ${c.reportType},
      ${c.subject},
      ${c.html},
      ${c.createdAt},
      ${c.firstSentAt},
      ${c.dbUpdateFailed},
      ${c.dbFailedMessage},
      ${c.dbUpdateDetails},
      ${c.summary},
      ${c.reminderCount},
      ${c.acknowledged}
    )
    VALUES (?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, 0, ?)
    ON DUPLICATE KEY UPDATE
      ${c.subject} = VALUES(${c.subject}),
      ${c.html} = VALUES(${c.html}),
      ${c.createdAt} = VALUES(${c.createdAt}),
      ${c.dbUpdateFailed} = VALUES(${c.dbUpdateFailed}),
      ${c.dbFailedMessage} = VALUES(${c.dbFailedMessage}),
      ${c.dbUpdateDetails} = VALUES(${c.dbUpdateDetails}),
      ${c.summary} = VALUES(${c.summary})`,
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
  await ensureSchema();

  const rn = config.db.reportNotifications;
  const c = rn.columns;

  await pool.execute(
    `INSERT IGNORE INTO ${rn.table} (
      ${c.reportDate}, ${c.reportType}, ${c.recipient}, ${c.messageId}, ${c.sentAt}
    ) VALUES (?, ?, ?, ?, NOW())`,
    [reportDate, reportType, recipient, messageId]
  );
}

export async function getReportNotifications(reportDate, reportType) {
  await ensureSchema();

  const rn = config.db.reportNotifications;
  const c = rn.columns;

  const [rows] = await pool.execute(
    `SELECT * FROM ${rn.table} WHERE ${c.reportDate} = ? AND ${c.reportType} = ?`,
    [reportDate, reportType]
  );

  return rows;
}

export async function hasReplyBeenProcessed(replyMessageId) {
  await ensureSchema();

  const rr = config.db.replyReceipts;

  const [rows] = await pool.execute(
    `SELECT 1 FROM ${rr.table} WHERE ${rr.columns.replyMessageId} = ?`,
    [replyMessageId]
  );

  return rows.length > 0;
}

export async function recordReplyReceipt(reportDate, reportType, replyMessageId, replier, role) {
  await ensureSchema();

  const rr = config.db.replyReceipts;
  const c = rr.columns;

  await pool.execute(
    `INSERT IGNORE INTO ${rr.table} (
      ${c.replyMessageId}, ${c.reportDate}, ${c.reportType}, ${c.replier}, ${c.role}, ${c.handledAt}
    ) VALUES (?, ?, ?, ?, ?, NOW())`,
    [replyMessageId, reportDate, reportType, replier, role]
  );
}

export async function getUnacknowledgedReports(reportType) {
  await ensureSchema();

  const rc = config.db.reportCache;
  const c = rc.columns;

  const [rows] = await pool.execute(
    `SELECT * FROM ${rc.table}
     WHERE ${c.reportType} = ? AND ${c.acknowledged} = 0
     ORDER BY ${c.reportDate}, ${c.firstSentAt}`,
    [reportType]
  );

  return rows;
}

export async function getAcknowledgedReports(reportType) {
  await ensureSchema();

  const rc = config.db.reportCache;
  const c = rc.columns;

  const [rows] = await pool.execute(
    `SELECT * FROM ${rc.table}
     WHERE ${c.reportType} = ? AND ${c.acknowledged} = 1
     ORDER BY ${c.reportDate}, ${c.firstSentAt}`,
    [reportType]
  );

  return rows;
}

export async function incrementReminder(reportDate, reportType) {
  await ensureSchema();

  const rc = config.db.reportCache;
  const c = rc.columns;

  await pool.execute(
    `UPDATE ${rc.table}
     SET ${c.reminderCount} = ${c.reminderCount} + 1
     WHERE ${c.reportDate} = ? AND ${c.reportType} = ?`,
    [reportDate, reportType]
  );
}

export async function markAcknowledged(reportDate, reportType, ackBy) {
  await ensureSchema();

  const rc = config.db.reportCache;
  const c = rc.columns;

  await pool.execute(
    `UPDATE ${rc.table}
     SET ${c.acknowledged} = 1,
         ${c.acknowledgedBy} = ?,
         ${c.acknowledgedAt} = NOW()
     WHERE ${c.reportDate} = ? AND ${c.reportType} = ?`,
    [ackBy, reportDate, reportType]
  );
}
