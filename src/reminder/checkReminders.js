import { getPendingAcknowledgments, incrementReminder, markEscalated } from '../db/acknowledgments.js';
import nodemailer from 'nodemailer';
import { config } from '../config/config.js';

const MAX_REMINDERS = 3;

async function run() {
  const reportRunId = new Date().toISOString().slice(0, 10);
  const pending = await getPendingAcknowledgments(reportRunId);

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: { user: config.smtp.user, pass: config.smtp.password },
  });

  const toEscalate = [];

  for (const row of pending) {
    if (row.reminder_count >= MAX_REMINDERS) {
      toEscalate.push(row);
      await markEscalated(row.token);
      continue;
    }

    const ackLink = `${config.ack.baseUrl}?token=${row.token}`;
    await transporter.sendMail({
      from: config.smtp.user,
      to: row.recipient_email,
      subject: `Reminder: QA Report needs acknowledgment`,
      html: `<p>Please acknowledge the QA failure report.</p><p><a href="${ackLink}">Acknowledge</a></p>`,
    });
    await incrementReminder(row.token);
  }

  if (toEscalate.length > 0) {
    await transporter.sendMail({
      from: config.smtp.user,
      to: config.ack.teamLeadEmail,
      subject: `Escalation: ${toEscalate.length} unacknowledged QA report(s)`,
      html: `<p>The following recipients have not acknowledged after ${MAX_REMINDERS} reminders:</p>
             <ul>${toEscalate.map(r => `<li>${r.recipient_email}</li>`).join('')}</ul>`,
    });
  }
}

run().catch(err => {
  console.error('Reminder check failed:', err);
  process.exit(1);
});