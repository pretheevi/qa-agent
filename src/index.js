import { fetchLatestReportHtml } from './email/gmailClient.js';
import { extractFailedTestcases } from './email/parseReport.js';
import { markTestcasesFailed } from './db/updateTestcase.js';
import { summarizeFailures } from './summarize/llmSummary.js';
import { sendFailureReport } from './notify/sendReport.js';
import { log } from './utils/logger.js';

async function run() {
  log('QA agent run started');

  const {html, subject}= await fetchLatestReportHtml();
  if (!html) {
    log('No report found for today. Exiting.');
    return;
  }

  const failures = extractFailedTestcases(html);
  if (failures.length === 0) {
    log('No failed testcases. Nothing to do.');
    return;
  }

  log(`${failures.length} failed testcase(s) found.`);

  let dbUpdateFailed = false;
  try {
    await markTestcasesFailed(failures);
  } catch (err) {
    dbUpdateFailed = true;
    console.error('[DB] update failed, continuing to notify audience anyway:', err.message);
  }

  const summary = await summarizeFailures(failures);

  await sendFailureReport(subject, failures, summary, { dbUpdateFailed });

  log('QA agent run completed.');
}

run().catch(err => {
  console.error('QA agent failed:', err);
  process.exit(1);
});