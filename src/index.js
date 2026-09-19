import { fetchLatestReportHtml } from './email/gmailClient.js';
import { extractFailedTestcases, extractSummaryCounts } from './email/parseReport.js';
import { markTestcasesFailed } from './db/updateTestcase.js';
import { summarizeFailures } from './summarize/llmSummary.js';
import { sendRemainder } from './reminder/remainder.js';
import { log } from './utils/logger.js';
import { config, toLocalDateKey } from './config/config.js';
import { pool } from './db/pool.js';
import { getCachedReport, saveReportCache, closeLocalDb } from '../connect.js';

async function run() {
  log('QA agent run started');

  const today = toLocalDateKey(config.today);
  log(`Checking local cache for today's report (${today})...`);
  const cached = await getCachedReport(today);

  if (!cached) {
    log('Cache MISS — no report cached yet for today. Fetching from Gmail...');
    const { html, subject } = await fetchLatestReportHtml();

    if (!html) {
      log('No report found for today.');
    } else {
      log(`Report fetched: "${subject}". Parsing for failed testcases...`);
      const failures = extractFailedTestcases(html);
      const counts = extractSummaryCounts(html);
      log(
        `Summary — Passed: ${counts.passed ?? '?'}, Failed: ${counts.failed ?? '?'}, ` +
        `Skipped: ${counts.skipped ?? '?'}, Flaky: ${counts.flaky ?? '?'}, Total: ${counts.total ?? '?'}`
      );

      if (failures.length === 0) {
        log('No failed testcases today — nothing to update or notify. Caching as acknowledged.');
        await saveReportCache(today, subject, html, { acknowledged: true });
      } else {
        log(`${failures.length} failed testcase(s) found: ${failures.map(f => f.testcaseId).join(', ')}`);

        let dbUpdateFailed = false;
        let dbFailedMessage = '';
        log(`Checking testcases exist in DB table "${config.db.table}" before updating...`);
        try {
          await markTestcasesFailed(failures);
          log('DB update succeeded — all testcases found and marked.');
        } catch (err) {
          dbUpdateFailed = true;
          dbFailedMessage = err.message;
          console.error('[DB] update failed, continuing to notify audience anyway:', err.message);
        }

        log('Requesting LLM summary of failures...');
        const summary = await summarizeFailures(failures);
        log(summary ? 'LLM summary generated.' : 'No LLM summary available — continuing without it.');

        await saveReportCache(today, subject, html, { dbUpdateFailed, dbFailedMessage, summary });
        log('Report cached for today.');
      }
    }
  } else {
    log(`Cache HIT — using previously cached report for today (${today}).`);
  }

  log('Checking all unacknowledged reports and sending first-time reports / reminders as needed...');
  await sendRemainder();

  log('QA agent run completed.');
}

run()
  .catch(err => {
    console.error('QA agent failed:', err);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([pool.end(), closeLocalDb()]));
