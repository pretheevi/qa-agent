import { fetchLatestReportHtml } from './email/gmailClient.js';
import { markTestcaseForAtlas } from './db/updateTestcase.js';
import { summarizeFailures } from './summarize/llmSummary.js';
import { sendNovaReminder, sendAtlasReminder } from './reminder/remainder.js';
import { log } from './utils/logger.js';
import { config, toLocalDateKey } from './config/config.js';
import { pool } from './db/pool.js';
import { getCachedReports, saveReportCache } from '../connect.js';

async function run() {
  log('QA agent run started');

  const today = toLocalDateKey(config.today);

  log(`Checking local cache for today's reports (${today})...`);
  const cached = await getCachedReports(today);

  if (cached.length === 0) {
    log('Cache MISS — no reports cached yet for today. Fetching from Gmail...');

    const reports = await fetchLatestReportHtml();

    if (!reports || reports.length === 0) {
      log('No reports found for today.');
    } else {
      log(`Found ${reports.length} latest report(s) for today.`);

      for (const report of reports) {
        const { html, subject, reportType, failedTestCases } = report;

        log(`Processing ${reportType} report: "${subject}"`);

        const failures = failedTestCases || [];

        log(`${reportType} — ${failures.length} failed testcase(s) found.`);

        if (failures.length === 0) {
          log(`${reportType} — No failed testcases. Caching as acknowledged.`);

          await saveReportCache(
            today,
            reportType,
            subject,
            html,
            {
              reportType,
              acknowledged: true,
            }
          );
          continue;
        }

        log(`${reportType} — Failed testcases: ${failures.map(f => f.testcaseId || f.testId).join(', ')}`);

        let dbUpdateFailed = false;
        let dbFailedMessage = '';
        let dbUpdateDetails = null;

        log(`Checking testcases exist in DB table "${config.db.table}" before updating...`);

        try {
          if (reportType === 'ATLAS') {
            dbUpdateDetails = await markTestcaseForAtlas(failures);
            log('[ATLAS] DB update succeeded.');
          }
          if (reportType === 'NOVA') {
            log('[NOVA] DB update skipped.');
          }
        } catch (err) {
          dbUpdateFailed = true;
          dbFailedMessage = err.message;
          console.error(`[${reportType}] DB update failed, continuing to notify audience anyway:`, err.message);
        }

        log(`Requesting LLM summary of ${reportType} failures...`);
        const summary = await summarizeFailures(failures);

        log(summary ? `${reportType} — LLM summary generated.` : `${reportType} — No LLM summary available.`);

          await saveReportCache(
            today,
            reportType,
            subject,
            html,
            {
              reportType,
              dbUpdateFailed,
              dbFailedMessage,
              dbUpdateDetails,
              summary,
            }
          );

        log(`${reportType} report cached for today.`);
      }
    }
  } else {
    log(`Cache HIT — using previously cached reports for today (${today}).`);
  }

  log('Checking all unacknowledged reports and sending first-time reports / reminders as needed...');

  // Each run independently — one report type's audience/DB failure (e.g. no enabled
  // recipients for the configured git_branch) shouldn't stop the other type's reminders
  // from going out. The run is still reported as failed overall so it's visible in CI.
  let reminderFailed = false;

  log('Checking unacknowledged NOVA reports...');
  try {
    await sendNovaReminder();
  } catch (err) {
    reminderFailed = true;
    console.error('[NOVA Reminder] failed, continuing to ATLAS reminders anyway:', err.message);
  }

  log('Checking unacknowledged ATLAS reports...');
  try {
    await sendAtlasReminder();
  } catch (err) {
    reminderFailed = true;
    console.error('[ATLAS Reminder] failed:', err.message);
  }

  log('QA agent run completed.');

  if (reminderFailed) {
    throw new Error('One or more reminder cycles failed — see errors above.');
  }
}

run()
  .catch(err => {
    console.error('QA agent failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());