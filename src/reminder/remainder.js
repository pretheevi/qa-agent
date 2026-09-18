import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import { extractFailedTestcases } from '../email/parseReport.js';
import { findAcknowledgmentReplies } from '../email/gmailClient.js';
import { getUnacknowledgedReports, markAcknowledged, incrementReminder } from '../../connect.js';

// Runs every scheduled invocation. Sends a reminder for every report that's still
// unacknowledged (any date, not just today), and marks a report acknowledged the moment
// a matching "Acknowledged - <subject>" reply shows up from an audience address.
export async function sendReminders({ excludeDate } = {}) {
  const pending = await getUnacknowledgedReports({ excludeDate });
  if (pending.length === 0) return;

  const oldestSentAt = pending.reduce(
    (min, row) => (row.first_sent_at < min ? row.first_sent_at : min),
    pending[0].first_sent_at
  );
  const replies = await findAcknowledgmentReplies({ since: new Date(oldestSentAt) });

  for (const row of pending) {
    const match = replies.find(
      reply => config.smtp.audience.includes(reply.from) && reply.subject.includes(row.subject)
    );

    if (match) {
      await markAcknowledged(row.report_date, match.from);
      console.log(`[Reminder] ${row.report_date} acknowledged by ${match.from}`);
      continue;
    }

    await sendReminderEmail(row);
    await incrementReminder(row.report_date);
    console.log(`[Reminder] sent reminder #${row.reminder_count + 1} for ${row.report_date}`);
  }
}

async function sendReminderEmail(row) {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: { user: config.smtp.user, pass: config.smtp.password },
  });

  const failures = extractFailedTestcases(row.html);
  const rows = failures
    .map(f => `<tr><td>${f.testcaseId}</td><td>${f.testcaseName}</td><td>${f.reason}</td></tr>`)
    .join('');

  const dbWarning = row.db_update_failed
    ? `<p style="color:#b00020;"><strong>Note:</strong> the "${config.db.executeColumn}" update for these testcases did not complete successfully — please check manually.</p>
      <p>${row.db_failed_message}</p>
      <p style="color:#b00020;">QA-Agent will not update the "${config.db.executeColumn}" column for <em>any</em> testcase in this report if even one testcase ID is not found in the table — this is an all-or-nothing update.</p>`
    : '';

  const ackSubject = `Acknowledged - ${row.subject}`;
  const ackNote = `<p style="color:#1565c0;"><strong>To acknowledge this report</strong>, reply to this email with the subject line exactly:<br/><code>${ackSubject}</code></p>`;

  const html = `
    <p><strong>Reminder (#${row.reminder_count + 1}):</strong> this report is still unacknowledged.</p>
    ${dbWarning}
    ${ackNote}
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><th>Testcase ID</th><th>Name</th><th>Reason</th></tr>
      ${rows}
    </table>
  `;

  for (const email of config.smtp.audience) {
    await transporter.sendMail({
      from: config.smtp.user,
      to: email,
      subject: `REMINDER: ${row.subject}`,
      html,
    });
  }
}
