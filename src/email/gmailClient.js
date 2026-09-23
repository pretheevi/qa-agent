import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from '../config/config.js';

import { extractNOVAFailedTestcases, atlasDemographicExtractFailedTC, isValidAtlasReportHtml } from './parseReport.js';

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

      if (!config.gmail.reportSender?.length) {
        return [];
      }

      const searchCriteria = { 
        since,
        or: config.gmail.reportSender.map(sender => ({ from: sender }))
      };

      console.log(`[Gmail] Searching INBOX since ${since.toDateString()} from ${config.gmail.reportSender.join(', ')}...`);

      // fetching all the email since today from reportSenders
      const uids = await client.search(searchCriteria, { uid: true });

      if (!uids || uids.length === 0) {
        console.log('[Gmail] No matching mail found for today.');
        return [];
      }

      console.log(`[Gmail] Found ${uids.length} candidate message(s), checking newest first...`);
      // sorted latest gmail reports
      const sortedUids = [...uids].sort((a, b) => b - a);

      const reports = [];
      const foundTypes = new Set();

      for (const uid of sortedUids) {
        if (foundTypes.size === 2) break;
        const message = await client.fetchOne(uid, { source: true }, { uid: true });

        if (!message?.source) continue;

        const parsed = await simpleParser(message.source);
        const subjectLower = parsed.subject?.toLowerCase() || '';

        // Classified independently by which type's own subject list it matches — NOT by
        // position in a shared list, which previously misrouted whichever report happened
        // to be the only one configured into the NOVA branch.
        const isNova = config.gmail.reportSubjectNova.some(s => subjectLower.includes(s.toLowerCase()));
        const isAtlas = config.gmail.reportSubjectAtlas.some(s => subjectLower.includes(s.toLowerCase()));

        if (!isNova && !isAtlas) {
          console.log(`[Gmail] Skipping non-matching subject: "${parsed.subject}"`);
          continue;
        }

        // NOVA
        if (isNova && !foundTypes.has('NOVA')) {
          console.log(`[NOVA] Processing report: "${parsed.subject}"`);

          const failures = extractNOVAFailedTestcases(parsed);

          console.log(`[NOVA] Extracted ${failures.length} failed test case(s).`);
          console.log('[NOVA] Failed test cases:', JSON.stringify(failures, null, 2));

          reports.push({
            html: parsed.html || null,
            subject: parsed.subject,
            reportType: 'NOVA',
            failedTestCases: failures,
          });

          foundTypes.add('NOVA');
          console.log(`[NOVA] Extracted ${failures.length} failed test case(s).`);
        }

        // ATLAS
        if (isAtlas && !foundTypes.has('ATLAS')) {
          console.log(`[Atlas] Processing report: "${parsed.subject}"`);
          console.log(`[Atlas] Total attachments: ${parsed.attachments?.length || 0}`);

          parsed.attachments?.forEach((attachment, index) => {
            console.log(`[Atlas] Attachment ${index}:`);
            console.log(`  filename: ${attachment.filename}`);
            console.log(`  contentType: ${attachment.contentType}`);
            console.log(`  size: ${attachment.size}`);
            console.log(`  content length: ${attachment.content?.length || 0}`);
            console.log(`  disposition: ${attachment.contentDisposition}`);
          });

          const atlasAttachment = parsed.attachments?.find(attachment => {
            const filename = attachment.filename?.toLowerCase() || '';
            const contentType = attachment.contentType?.toLowerCase() || '';

            return (
              contentType === 'text/html' ||
              filename.endsWith('.html') ||
              filename.endsWith('.htm')
            );
          });

          if (!atlasAttachment) {
            console.log('[Atlas] No HTML attachment found.');
            continue;
          }

          console.log(`[Atlas] Found HTML attachment: ${atlasAttachment.filename}`);
          console.log(`[Atlas] Attachment content type: ${atlasAttachment.contentType}`);
          console.log(`[Atlas] Attachment size: ${atlasAttachment.size}`);
          console.log(`[Atlas] Attachment content length: ${atlasAttachment.content?.length || 0}`);

          const atlasHtml = Buffer.isBuffer(atlasAttachment.content)
            ? atlasAttachment.content.toString('utf8')
            : String(atlasAttachment.content || '');

          console.log(`[Atlas] HTML length: ${atlasHtml.length}`);

          let failures = [];
          let parseFailed = false;
          let parseFailedMessage = '';

          if (!isValidAtlasReportHtml(atlasHtml)) {
            parseFailed = true;
            parseFailedMessage =
              `Attachment content looks truncated or corrupted (only ${atlasHtml.length} ` +
              `character(s), missing expected report structure) — could not extract failed ` +
              `testcases. This can happen when a report email is manually forwarded and the ` +
              `attachment doesn't come through intact.`;
            console.error(`[Atlas] ${parseFailedMessage}`);
          } else {
            failures = atlasDemographicExtractFailedTC(atlasHtml);
            console.log(`[Atlas] Extracted ${failures.length} failed test case(s).`);
          }

          reports.push({
            html: atlasHtml,
            subject: parsed.subject,
            reportType: 'ATLAS',
            failedTestCases: failures,
            parseFailed,
            parseFailedMessage,
          });

          foundTypes.add('ATLAS');
          console.log(`[Atlas] Extracted ${failures.length} failed test case(s).`);
        }
      }

      console.log(`[Gmail] Found ${reports.length} matching report(s).`);

      return reports;

    } finally {
      lock.release();
    }

  } finally {
    await client.logout();
  }
}

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
          date: parsed.date || null,
          messageId: parsed.messageId || '',
          inReplyTo: parsed.inReplyTo || '',
          references: parsed.references || [],
        });
      }

      console.log(
        `[Gmail] Parsed ${replies.length} inbox message(s) to check against pending reports.`
      );

      return replies;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}