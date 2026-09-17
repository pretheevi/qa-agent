import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import { createAcknowledgmentRecords } from '../db/acknowledgments.js';

export async function sendFailureReport(subject, failures, summary, { dbUpdateFailed = false } = {}) {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: { user: config.smtp.user, pass: config.smtp.password },
  });

  const reportRunId = new Date().toISOString().slice(0, 10); // e.g. "2026-09-17"

  const records = await createAcknowledgmentRecords(reportRunId, config.smtp.audience);

  const rows = failures
    .map(f => `<tr><td>${f.testcaseId}</td><td>${f.testcaseName}</td><td>${f.reason}</td></tr>`)
    .join('');

  const dbWarning = dbUpdateFailed
    ? `<p style="color:#b00020;"><strong>Note:</strong> the database status update for these testcases did not complete successfully — please check manually.</p>`
    : '';

  for (const { email, token } of records) {
    const ackLink = `${config.ack.baseUrl}?token=${token}`;
    const html = `
      ${summary ? `<p>${summary}</p>` : ''}
      ${dbWarning}
      <table border="1" cellpadding="6" cellspacing="0">
        <tr><th>Testcase ID</th><th>Name</th><th>Reason</th></tr>
        ${rows}
      </table>
      <p><a href="${ackLink}">Click here to acknowledge this report</a></p>
    `;

    await transporter.sendMail({
      from: config.smtp.user,
      to: email,
      subject: `QA Report — ${subject} : ${failures.length} Failed Testcase(s)`,
      html,
    });
  }
}













// import nodemailer from 'nodemailer';
// import { config } from '../config/config.js';

// export async function sendFailureReport(subject, failures, summary, { dbUpdateFailed = false } = {}) {
//   const transporter = nodemailer.createTransport({
//     host: config.smtp.host,
//     port: config.smtp.port,
//     auth: { user: config.smtp.user, pass: config.smtp.password },
//   });

//   const reportRunId = new Date().toISOString().slice(0, 10);

//   const rows = failures
//     .map(f => `<tr><td>${f.testcaseId}</td><td>${f.testcaseName}</td><td>${f.reason}</td></tr>`)
//     .join('');

//   const dbWarning = dbUpdateFailed
//     ? `<p style="color:#b00020;"><strong>Note:</strong> the database status update for these testcases did not complete successfully — please check manually.</p>`
//     : '';

//   const html = `
//     ${summary ? `<p>${summary}</p>` : ''}
//     ${dbWarning}
//     <table border="1" cellpadding="6" cellspacing="0">
//       <tr><th>Testcase ID</th><th>Name</th><th>Reason</th></tr>
//       ${rows}
//     </table>
//   `;

//   await transporter.sendMail({
//     from: config.smtp.user,
//     to: config.smtp.audience.join(','),
//     subject: `QA-Agent Report — ${subject} : ${failures.length} Failed Testcase(s)`,
//     html,
//   });
// }