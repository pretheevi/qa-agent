import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import { fetchInboxSince } from '../email/gmailClient.js';
import { extractNOVAFailedTestcases, atlasDemographicExtractFailedTC } from '../email/parseReport.js';
import {
  getUnacknowledgedReports,
  getAcknowledgedReports,
  getReportNotifications,
  saveReportNotification,
  hasReplyBeenProcessed,
  recordReplyReceipt,
  markAcknowledged,
  incrementReminder,
} from '../../connect.js';
import { ackInstructionsHtml } from '../notify/ackNote.js';
import { resolveAudience } from '../db/audienceRecipients.js';

// pool.js sets dateStrings: true, so MySQL DATETIME columns (always UTC — the RDS instance's
// time_zone is UTC) come back as bare "YYYY-MM-DD HH:MM:SS" strings with no timezone marker.
// new Date() on a string like that is parsed as LOCAL time, which would misread it by a full
// UTC offset on any host not already in UTC (the same class of bug fixed for the cache-key
// date in config.js — see toLocalDateKey). Parse it as UTC explicitly instead.
function parseDbTimestampAsUTC(value) {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function createTransporter() {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.password,
    },
  });
}

export async function sendNovaReminder() {
  await sendReportReminders('NOVA');
}

export async function sendAtlasReminder() {
  await sendReportReminders('ATLAS');
}

// Finds inbox replies that reference an email we actually sent for this report, sent by
// someone in the audience, and not already handled in a previous run. Sorted oldest-first
// so the caller can tell who replied first from anyone else replying later.
async function findAckMatches(row, reportType, replies, audience) {
  const notifications = await getReportNotifications(row.report_date, reportType);

  if (notifications.length === 0) return [];

  const matches = [];

  for (const reply of replies) {
    if (!reply.messageId) continue;
    if (!audience.includes(reply.from)) continue;
    if (await hasReplyBeenProcessed(reply.messageId)) continue;

    const references = Array.isArray(reply.references)
      ? reply.references
      : [reply.references].filter(Boolean);

    const matchedNotification = notifications.find(
      n => n.recipient === reply.from &&
        (reply.inReplyTo === n.message_id || references.includes(n.message_id))
    );

    if (matchedNotification) matches.push(reply);
  }

  matches.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  return matches;
}

async function sendAlreadyAcknowledgedNotice(transporter, reportType, row, lateReply, acknowledgedBy, acknowledgedAt) {
  const info = await transporter.sendMail({
    from: config.smtp.user,
    to: lateReply.from,
    subject: `Re: ${row.subject}`,
    html: `
      <p>Thanks for your reply — this report was already acknowledged by
      <strong>${acknowledgedBy}</strong>${acknowledgedAt ? ` at ${acknowledgedAt}` : ''}.
      No further action is needed.</p>
    `,
  });

  console.log(
    `[${reportType} Reminder] ${row.report_date} — notified ${lateReply.from} that ` +
    `${acknowledgedBy} already acknowledged (message-id: ${info.messageId}).`
  );
}

// Already-acknowledged reports don't get reminders, but a reply that arrives after the
// first acknowledgment (from a different audience member) still needs a courtesy reply
// so that person knows it's already handled — otherwise it's silently dropped forever.
async function handleLateReplies(row, reportType, replies, transporter, audience) {
  const lateReplies = await findAckMatches(row, reportType, replies, audience);

  for (const late of lateReplies) {
    await sendAlreadyAcknowledgedNotice(
      transporter,
      reportType,
      row,
      late,
      row.acknowledged_by,
      row.acknowledged_at
    );

    await recordReplyReceipt(row.report_date, reportType, late.messageId, late.from, 'late');
  }
}

async function sendReportReminders(reportType) {
  const pending = await getUnacknowledgedReports(reportType);
  const acknowledged = await getAcknowledgedReports(reportType);

  if (pending.length === 0 && acknowledged.length === 0) {
    console.log(`[${reportType} Reminder] No reports to process.`);
    return;
  }

  const audience = await resolveAudience();

  const allRows = [...pending, ...acknowledged];
  const oldestSentAt = allRows.reduce(
    (min, row) => (row.first_sent_at < min ? row.first_sent_at : min),
    allRows[0].first_sent_at
  );

  const replies = await fetchInboxSince({
    since: parseDbTimestampAsUTC(oldestSentAt),
  });

  const transporter = createTransporter();

  for (const row of acknowledged) {
    await handleLateReplies(row, reportType, replies, transporter, audience);
  }

  if (pending.length === 0) {
    console.log(`[${reportType} Reminder] No unacknowledged reports — nothing to remind.`);
    return;
  }

  console.log(`[${reportType} Reminder] ${pending.length} unacknowledged report(s) pending.`);

  for (const row of pending) {
    console.log(
      `[${reportType} Reminder] Checking "${row.subject}" ` +
      `(${row.report_date}, reminder_count=${row.reminder_count})...`
    );

    const matches = await findAckMatches(row, reportType, replies, audience);

    if (matches.length > 0) {
      const [acknowledger, ...lateReplies] = matches;

      await markAcknowledged(row.report_date, reportType, acknowledger.from);
      await recordReplyReceipt(row.report_date, reportType, acknowledger.messageId, acknowledger.from, 'acknowledger');

      console.log(
        `[${reportType} Reminder] ${row.report_date} acknowledged by ${acknowledger.from}.`
      );

      for (const late of lateReplies) {
        await sendAlreadyAcknowledgedNotice(
          transporter,
          reportType,
          row,
          late,
          acknowledger.from,
          acknowledger.date
        );

        await recordReplyReceipt(row.report_date, reportType, late.messageId, late.from, 'late');
      }

      continue;
    }

    const isFirstSend = row.reminder_count === 0;
    const subjectPrefix = isFirstSend ? 'QA-AGENT' : 'REMINDER';

    let failures = [];

    // A parse-failed report's html is known-corrupt — don't re-run it through the extractor,
    // there's nothing valid to show.
    if (!row.report_parse_failed) {
      if (reportType === 'NOVA') {
        failures = extractNOVAFailedTestcases({ html: row.html });
      } else if (reportType === 'ATLAS') {
        failures = atlasDemographicExtractFailedTC(row.html);
      }
    }

    let dbStatusByTestCase = {};

    if (reportType === 'ATLAS' && row.db_update_details) {
      try {
        for (const result of JSON.parse(row.db_update_details)) {
          dbStatusByTestCase[result.testCaseName] = result.status;
        }
      } catch {
        dbStatusByTestCase = {};
      }
    }

    const dbStatusLabel = testCaseName => {
      if (row.db_update_failed) return 'Not updated — DB update was aborted (see note above)';

      const status = dbStatusByTestCase[testCaseName];

      if (status === 'set') return `Set ${config.db.executeColumn}='no'`;
      if (status === 'already-no') return `Already ${config.db.executeColumn}='no' — skipped, no change needed`;

      return 'N/A';
    };

    const rows = reportType === 'NOVA'
      ? failures
          .map(f => `
            <tr>
              <td>${f.testcaseId}</td>
              <td>${f.testcaseName}</td>
              <td>${f.reason}</td>
            </tr>
          `)
          .join('')
      : failures
          .map(f => `
            <tr>
              <td>${f.testId}</td>
              <td>${f.testCaseName}</td>
              <td>${f.failures?.map(x => x.details).join('<br>') || 'N/A'}</td>
              <td>${dbStatusLabel(f.testCaseName)}</td>
            </tr>
          `)
          .join('');

    const headers = reportType === 'NOVA'
      ? '<tr><th>Testcase ID</th><th>Name</th><th>Reason</th></tr>'
      : '<tr><th>Test ID</th><th>Name</th><th>Failure Details</th><th>DB Status</th></tr>';

    const dbWarning = row.db_update_failed
      ? `
        <p style="color:#b00020;">
          <strong>Note:</strong> one or more testcases below were not found in
          "${config.db.table}". Because the DB update is all-or-nothing, <strong>none</strong>
          of this report's testcases were updated — not even the ones that were found.
          Please update "${config.db.executeColumn}" manually.
        </p>
        <p>${row.db_failed_message}</p>
      `
      : '';

    const parseFailureWarning = row.report_parse_failed
      ? `
        <p style="color:#b00020;">
          <strong>Note:</strong> this report's content could not be read — it may have been
          corrupted or truncated in transit (e.g. a manually forwarded copy losing its
          attachment). No testcase details are available below, and the database was not
          checked or updated. Please locate and review the original report manually.
        </p>
        <p>${row.report_parse_failed_message}</p>
      `
      : '';

    const escalationNote = config.gmail.reportSender?.length
      ? `
        <p style="color:#555;font-size:0.9em;">
          If this report remains unacknowledged after ${config.maxReminders} reminder(s),
          it will be escalated to ${config.gmail.reportSender.join(', ')}.
        </p>
      `
      : '';

    const html = `
      ${isFirstSend && row.summary ? `<p>${row.summary}</p>` : ''}
      ${!isFirstSend ? `<p><strong>Reminder (#${row.reminder_count}):</strong> this report is still unacknowledged.</p>` : ''}
      ${parseFailureWarning}
      ${dbWarning}
      ${ackInstructionsHtml()}
      ${escalationNote}

      ${row.report_parse_failed ? '' : `
        <table border="1" cellpadding="6" cellspacing="0">
          ${headers}
          ${rows}
        </table>
      `}
    `;

    for (const email of audience) {
      const info = await transporter.sendMail({
        from: config.smtp.user,
        to: email,
        subject: `${subjectPrefix}: ${row.subject}`,
        html,
      });

      await saveReportNotification(row.report_date, reportType, email, info.messageId);

      console.log(
        `[${reportType} Reminder] Notification sent to ${email} with message-id: ${info.messageId}`
      );
    }

    if (row.reminder_count > config.maxReminders && config.gmail.reportSender?.length) {
      for (const sender of config.gmail.reportSender) {
        await transporter.sendMail({
          from: config.smtp.user,
          to: sender,
          subject: `ESCALATION: No acknowledgment after ${row.reminder_count} reminders — ${row.subject}`,
          html: `
            <p>No one in the audience has acknowledged this report after
            <strong>${row.reminder_count}</strong> reminder(s).</p>
            <p>Report Type: <strong>${reportType}</strong></p>
            <p>Report: "${row.subject}" (${row.report_date})</p>
            <p>Audience notified: ${audience.join(', ')}</p>
          `,
        });
      }
    }

    await incrementReminder(row.report_date, reportType);

    console.log(
      `[${reportType} Reminder] sent ${subjectPrefix} (#${row.reminder_count + 1}).`
    );
  }
}
