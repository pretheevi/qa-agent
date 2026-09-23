// parseReport.js

import * as cheerio from 'cheerio';

export function extractNOVAFailedTestcases(parsedData) {
  const html = parsedData?.html;

  if (!html) return [];

  const $ = cheerio.load(html);
  const failures = [];

  $('table').each((_, table) => {
    const headerText = $(table).find('tr').first().text().toLowerCase();

    if (!headerText.includes('tc number')) return;

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

export function extractSummaryCounts(html) {
  if (!html) {
    return {
      passed: null,
      failed: null,
      skipped: null,
      flaky: null,
      total: null,
    };
  }

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


// ============================================================
// ATLAS DEMOGRAPHIC SERVICE
// ============================================================

export function atlasDemographicExtractFailedTC(htmlInput) {
  try {
    if (!htmlInput) {
      console.log('[Atlas Parser] No HTML input received.');
      return [];
    }

    const html = Buffer.isBuffer(htmlInput)
      ? htmlInput.toString('utf8')
      : String(htmlInput);

    console.log(`[Atlas Parser] HTML length: ${html.length}`);

    const $ = cheerio.load(html);
    const failedTestCases = [];

    // Find all test cases
    const testItems = $('.test-item');

    console.log(`[Atlas Parser] Found ${testItems.length} test-item element(s).`);

    testItems.each((_, element) => {
      const $testCase = $(element);
      const status = ($testCase.attr('status') || '').trim().toLowerCase();

      if (status !== 'fail' && status !== 'failed') return;

      // Test case name
      const testCaseName = $testCase
        .find('.test-detail .name')
        .text()
        .replace(/^TestCase Name:\s*/i, '')
        .trim();

      // Test ID
      const testId = $testCase.attr('test-id') || null;

      // Author
      const author = $testCase.attr('author') || '';

      // Execution time
      const summarySpans = $testCase
        .find('.test-detail .text-sm span')
        .map((_, el) => $(el).text().trim())
        .get();

      const executionTime = summarySpans[0] || null;
      const duration = summarySpans[1] || null;

      // Start / end time
      const detailHead = $testCase.find('.detail-head');

      const startTime = detailHead.find('.badge-success').first().text().trim() || null;
      const endTime = detailHead.find('.badge-danger').first().text().trim() || null;

      // Failure events
      const failures = [];

      $testCase.find('.event-row').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');

        if (cells.length < 3) return;

        const eventStatus = $(cells[0]).text().trim().toLowerCase();

        if (eventStatus !== 'fail') return;

        const timestamp = $(cells[1]).text().trim();
        const details = $(cells[2]).text().replace(/\s+/g, ' ').trim();

        if (!details) return;

        failures.push({
          timestamp,
          details,
        });
      });

      failedTestCases.push({
        testId,
        testCaseName,
        author,
        startTime,
        endTime,
        executionTime,
        duration,
        failures,
      });
    });

    console.log(`[Atlas Parser] Extracted ${failedTestCases.length} failed test case(s).`);

    return failedTestCases;
  } catch (error) {
    throw new Error(`Failed to extract failed test cases: ${error.message}`);
  }
}