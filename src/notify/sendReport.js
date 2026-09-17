import nodemailer from 'nodemailer';
import { config } from '../config/config.js';

export async function sendFailureReport(failures, summary) {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: { user: config.smtp.user, pass: config.smtp.password },
  });

  const rows = failures
    .map(f => `<tr><td>${f.testcaseId}</td><td>${f.testcaseName}</td><td>${f.reason}</td></tr>`)
    .join('');

  const html = `
    ${summary ? `<p>${summary}</p>` : ''}
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><th>Testcase ID</th><th>Name</th><th>Reason</th></tr>
      ${rows}
    </table>
  `;

  await transporter.sendMail({
    from: config.smtp.user,
    to: config.smtp.audience.join(','),
    subject: `QA Report — ${failures.length} Failed Testcase(s)`,
    html,
  });
}
