# qa-agent

Scheduled agent that:
1. Reads the daily QA testcase report (HTML) from Gmail via IMAP
2. Extracts failed testcases from the "Failed / Skipped / Flaky" table in the email body
3. Updates the DB (sets status column to "no" for each failed testcase)
4. Optionally summarizes failures in plain language via a local LLM (Ollama)
5. Emails the failure report to the audience list

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in real values
3. Gmail access uses IMAP + an App Password (no OAuth/Cloud Console needed):
   - Turn on 2-Step Verification on the Gmail account: Google Account → Security
   - Generate an app password at https://myaccount.google.com/apppasswords
   - Put the Gmail address in `GMAIL_USER` and the 16-char password in `GMAIL_APP_PASSWORD`
4. Wire up your actual DB driver in `src/db/updateTestcase.js`
5. `npm start` to run once manually

## Scheduling
Run this on a schedule (4pm daily) via:
- GitLab CI scheduled pipeline, or
- Windows Task Scheduler on the AWS instance (`schtasks`), or
- cron, if running on Linux

See project notes for trade-offs between these.
