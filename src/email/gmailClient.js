import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from '../config/config.js';

// Connects via IMAP using an app password (no OAuth) and returns the HTML
// body of the most recent report email from today matching sender/subject.
export async function fetchLatestReportHtml() {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: config.gmail.user,
      pass: config.gmail.appPassword,
    },
    logger: false,
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Search today's mail from the report sender.
      const since = new Date();
      since.setHours(0, 0, 0, 0);

      const searchCriteria = { since };
      if (config.gmail.reportSender) {
        searchCriteria.from = config.gmail.reportSender;
      }

      const uids = await client.search(searchCriteria, { uid: true });
      if (!uids || uids.length === 0) {
        return null; // no report found for today
      }

      // Walk newest-first, optionally matching subject too.
      const sortedUids = [...uids].sort((a, b) => b - a);

      for (const uid of sortedUids) {
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message?.source) continue;

        const parsed = await simpleParser(message.source);

        if (
          config.gmail.reportSubject &&
          !parsed.subject?.toLowerCase().includes(config.gmail.reportSubject.toLowerCase())
        ) {
          continue; // not the report email, keep looking
        }

        if (parsed.html) {
          return parsed.html;
        }
      }

      return null;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
