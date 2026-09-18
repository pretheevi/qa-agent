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
      const since = new Date('2026-09-17'); // TESTING: forced date, revert before real runs
      since.setHours(0, 0, 0, 0);
      const before = new Date('2026-09-18'); // TESTING: forced date, revert before real runs

      const searchCriteria = { since, before };
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
          return { html: parsed.html, subject: parsed.subject };
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

// Searches INBOX for acknowledgment replies (subject convention: "Acknowledged - <original subject>")
// received since the given date. Returns [{ subject, from }] for the caller to match against
// pending report rows.
export async function findAcknowledgmentReplies({ since }) {
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
      const uids = await client.search({ since, subject: 'Acknowledged -' }, { uid: true });
      if (!uids || uids.length === 0) {
        return [];
      }

      const replies = [];
      for (const uid of uids) {
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message?.source) continue;

        const parsed = await simpleParser(message.source);
        replies.push({
          subject: parsed.subject || '',
          from: parsed.from?.value?.[0]?.address?.toLowerCase() || '',
        });
      }
      return replies;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
