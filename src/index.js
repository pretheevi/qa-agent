import { fetchLatestReportHtml } from './email/gmailClient.js';
import { extractFailedTestcases } from './email/parseReport.js';
import { markTestcasesFailed } from './db/updateTestcase.js';
import { summarizeFailures } from './summarize/llmSummary.js';
import { sendFailureReport } from './notify/sendReport.js';
import { sendReminders } from './reminder/remainder.js';
import { log } from './utils/logger.js';
import { pool } from './db/pool.js';
import { getCachedReport, saveReportCache, closeLocalDb } from '../connect.js';

async function run() {
  log('QA agent run started');

  const today = new Date().toISOString().slice(0, 10);
  const cached = await getCachedReport(today);

  let justSentToday = false;

  if (!cached) {
    const { html, subject } = await fetchLatestReportHtml();

    if (!html) {
      log('No report found for today.');
    } else {
      const failures = extractFailedTestcases(html);

      if (failures.length === 0) {
        log('No failed testcases today.');
        await saveReportCache(today, subject, html, { acknowledged: true });
      } else {
        log(`${failures.length} failed testcase(s) found.`);

        let dbUpdateFailed = false;
        let dbFailedMessage = '';
        try {
          await markTestcasesFailed(failures);
        } catch (err) {
          dbUpdateFailed = true;
          dbFailedMessage = err.message;
          console.error('[DB] update failed, continuing to notify audience anyway:', err.message);
        }

        const summary = await summarizeFailures(failures);
        await sendFailureReport(subject, failures, summary, { dbUpdateFailed, dbFailedMessage });
        await saveReportCache(today, subject, html, { dbUpdateFailed, dbFailedMessage });
        justSentToday = true;
      }
    }
  } else {
    log('Using cached report from local DB for today.');
  }

  await sendReminders({ excludeDate: justSentToday ? today : undefined });

  log('QA agent run completed.');
}

run()
  .catch(err => {
    console.error('QA agent failed:', err);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([pool.end(), closeLocalDb()]));
