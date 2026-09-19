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

  console.log(`[Gmail] Connecting to ${config.gmail.user} to look for today's report...`);
  await client.connect();

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(config.today);
      since.setHours(0, 0, 0, 0);

      const searchCriteria = { since };
      if (config.gmail.reportSender) {
        searchCriteria.from = config.gmail.reportSender;
      }

      console.log(`[Gmail] Searching INBOX since ${since.toDateString()}${config.gmail.reportSender ? ` from ${config.gmail.reportSender}` : ''}...`);
      const uids = await client.search(searchCriteria, { uid: true });
      if (!uids || uids.length === 0) {
        console.log('[Gmail] No matching mail found for today.');
        return { html: null, subject: null };
      }
      console.log(`[Gmail] Found ${uids.length} candidate message(s), checking newest first...`);

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
          console.log(`[Gmail] Skipping non-matching subject: "${parsed.subject}"`);
          continue; // not the report email, keep looking
        }

        if (parsed.html) {
          console.log(`[Gmail] Using report: "${parsed.subject}"`);
          return { html: parsed.html, subject: parsed.subject };
        }
      }

      console.log('[Gmail] No candidate had a matching subject with HTML content.');
      return { html: null, subject: null };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// Fetches every INBOX message received since the given date, with no subject/sender filtering.
// Returns [{ subject, from }] for the caller (remainder.js) to match against pending report rows
// and decide what actually counts as an acknowledgment.
export async function fetchInboxSince({ since }) {
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
      console.log(`[Gmail] Scanning INBOX for replies since ${since.toISOString()}...`);
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) {
        console.log('[Gmail] No inbox messages found in that window.');
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
      console.log(`[Gmail] Parsed ${replies.length} inbox message(s) to check against pending reports.`);
      return replies;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
