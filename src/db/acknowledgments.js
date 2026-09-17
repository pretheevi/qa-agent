import { randomBytes } from 'crypto';
import { config } from '../config/config.js';
// import mysql from 'mysql2/promise';

export function generateToken() {
  return randomBytes(16).toString('hex');
}

export async function createAcknowledgmentRecords(reportRunId, recipientEmails) {
  const records = recipientEmails.map(email => ({
    email,
    token: generateToken(),
  }));

  for (const r of records) {
    // await connection.execute(
    //   `INSERT INTO report_acknowledgments (report_run_id, recipient_email, token) VALUES (?, ?, ?)`,
    //   [reportRunId, r.email, r.token]
    // );
    console.log(`[DB] would insert ack record for ${r.email} token=${r.token}`);
  }

  return records; // [{ email, token }]
}

export async function getPendingAcknowledgments(reportRunId) {
  // return rows where report_run_id = ? AND acknowledged = 0 AND escalated = 0
  return []; // stub
}

export async function incrementReminder(token) {
  // UPDATE report_acknowledgments SET reminder_count = reminder_count + 1 WHERE token = ?
}

export async function markEscalated(token) {
  // UPDATE report_acknowledgments SET escalated = 1 WHERE token = ?
}