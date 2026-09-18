import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import { ackInstructionsHtml } from './ackNote.js';

export async function sendFailureReport(subject, failures, summary, { dbUpdateFailed = false, dbFailedMessage = '' } = {}) {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: { user: config.smtp.user, pass: config.smtp.password },
  });

  const rows = failures
    .map(f => `<tr><td>${f.testcaseId}</td><td>${f.testcaseName}</td><td>${f.reason}</td></tr>`)
    .join('');

  const dbWarning = dbUpdateFailed
    ? `<p style="color:#b00020;"><strong>Note:</strong> the "${config.db.executeColumn}" update for these testcases did not complete successfully — please check manually.</p>
      <p>${dbFailedMessage}</p>
      <p style="color:#b00020;">QA-Agent will not update the "${config.db.executeColumn}" column for <em>any</em> testcase in this report if even one testcase ID is not found in the table — this is an all-or-nothing update.</p>`
    : '';

  const html = `
    ${summary ? `<p>${summary}</p>` : ''}
    ${dbWarning}
    ${ackInstructionsHtml(subject)}
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><th>Testcase ID</th><th>Name</th><th>Reason</th></tr>
      ${rows}
    </table>
  `;

  for (const email of config.smtp.audience) {
    await transporter.sendMail({
      from: config.smtp.user,
      to: email,
      subject: `QA Report — ${subject} : ${failures.length} Failed Testcase(s)`,
      html,
    });
  }
}
