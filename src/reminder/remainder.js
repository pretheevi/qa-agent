import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import { extractFailedTestcases } from '../email/parseReport.js';
import { fetchInboxSince } from '../email/gmailClient.js';
import { getUnacknowledgedReports, markAcknowledged, incrementReminder } from '../../connect.js';
import { ackInstructionsHtml } from '../notify/ackNote.js';

// Runs every scheduled invocation, for every report that's still unacknowledged (any date,
// not just today). Per report: if an audience reply shows up, marks it acknowledged and stops.
// Otherwise (re)sends it — subject is "QA-AGENT" on the first send (reminder_count 0) and
// "REMINDER" on every send after that.
export async function sendRemainder() {
  const pending = await getUnacknowledgedReports();
  if (pending.length === 0) {
    console.log('[Reminder] No unacknowledged reports pending — nothing to do.');
    return;
  }
  console.log(`[Reminder] ${pending.length} unacknowledged report(s) pending: ${pending.map(r => r.report_date).join(', ')}`);

  const oldestSentAt = pending.reduce(
    (min, row) => (row.first_sent_at < min ? row.first_sent_at : min),
    pending[0].first_sent_at
  );
  const replies = await fetchInboxSince({ since: new Date(oldestSentAt) });

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: { user: config.smtp.user, pass: config.smtp.password },
  });

  for (const row of pending) {
    console.log(`[Reminder] Checking "${row.subject}" (${row.report_date}, reminder_count=${row.reminder_count}) for an audience reply...`);
    const match = replies.find(
      reply => config.smtp.audience.includes(reply.from) && reply.subject.includes(row.subject)
    );

    if (match) {
      await markAcknowledged(row.report_date, match.from);
      console.log(`[Reminder] ${row.report_date} ACKNOWLEDGED by ${match.from} — no further reminders will be sent for it.`);
      continue;
    }

    const isFirstSend = row.reminder_count === 0;
    const subjectPrefix = isFirstSend ? 'QA-AGENT' : 'REMINDER';
    console.log(
      isFirstSend
        ? `[Reminder] No reply found. Sending FIRST-TIME report for ${row.report_date} to ${config.smtp.audience.length} audience member(s).`
        : `[Reminder] No reply found. Sending REMINDER #${row.reminder_count} for ${row.report_date} to ${config.smtp.audience.length} audience member(s).`
    );

    const failures = extractFailedTestcases(row.html);
    const rows = failures
      .map(f => `<tr><td>${f.testcaseId}</td><td>${f.testcaseName}</td><td>${f.reason}</td></tr>`)
      .join('');

    const dbWarning = row.db_update_failed
      ? `<p style="color:#b00020;"><strong>Note:</strong> the "${config.db.executeColumn}" update for these testcases did not complete successfully — please check manually.</p>
        <p>${row.db_failed_message}</p>
        <p style="color:#b00020;">QA-Agent will not update the "${config.db.executeColumn}" column for <em>any</em> testcase in this report if even one testcase ID is not found in the table — this is an all-or-nothing update.</p>`
      : '';

    const html = `
      ${isFirstSend && row.summary ? `<p>${row.summary}</p>` : ''}
      ${!isFirstSend ? `<p><strong>Reminder (#${row.reminder_count}):</strong> this report is still unacknowledged.</p>` : ''}
      ${dbWarning}
      ${ackInstructionsHtml()}
      <table border="1" cellpadding="6" cellspacing="0">
        <tr><th>Testcase ID</th><th>Name</th><th>Reason</th></tr>
        ${rows}
      </table>
    `;

    for (const email of config.smtp.audience) {
      await transporter.sendMail({
        from: config.smtp.user,
        to: email,
        subject: `${subjectPrefix}: ${row.subject}`,
        html,
      });
    }

    await incrementReminder(row.report_date);
    console.log(`[Reminder] sent ${subjectPrefix} (#${row.reminder_count + 1}) for ${row.report_date}`);
  }
}
