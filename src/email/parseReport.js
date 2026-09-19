import * as cheerio from 'cheerio';

// Parses the "Failed / Skipped / Flaky Test Case Details" table from the
// NOVA CI report email body. Columns: File | TC Number | Status | Reason.
// Only rows with Status === "Failed" are returned (Skipped/Flaky are ignored).
export function extractFailedTestcases(html) {
  const $ = cheerio.load(html);
  const failures = [];

  // Find the table whose header row contains "TC Number" (robust to
  // other tables in the email, e.g. the summary/status tables above it).
  $('table').each((_, table) => {
    const headerText = $(table).find('tr').first().text().toLowerCase();
    if (!headerText.includes('tc number')) return; // not the details table

    $(table).find('tr').slice(1).each((__, row) => {
      const cells = $(row).find('td');
      if (cells.length < 4) return;

      const file = $(cells[0]).text().trim();
      const tcNumber = $(cells[1]).text().trim();
      const status = $(cells[2]).text().trim();
      const reason = $(cells[3]).text().trim();

      if (status.toLowerCase() === 'failed') {
        failures.push({
          testcaseId: tcNumber,
          testcaseName: file,
          reason,
        });
      }
    });
  });

  return failures;
}

// Parses the "Status Summary" line (Passed: N (X%) Failed: N ... Total: N) into counts.
// Returns null for any field it can't find rather than guessing.
export function extractSummaryCounts(html) {
  const $ = cheerio.load(html);
  const text = $.root().text();

  const pick = label => {
    const match = text.match(new RegExp(`${label}:\\s*(\\d+)`, 'i'));
    return match ? Number(match[1]) : null;
  };

  return {
    passed: pick('Passed'),
    failed: pick('Failed'),
    skipped: pick('Skipped'),
    flaky: pick('Flaky'),
    total: pick('Total'),
  };
}
