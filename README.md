# qa-agent

Scheduled agent that:
1. Reads the daily QA testcase report (HTML) from Gmail via IMAP
2. Extracts failed testcases from the "Failed / Skipped / Flaky" table in the email body
3. Checks every failed testcase exists in the DB table before touching anything — if even one
   ID isn't found, the whole update is aborted (all-or-nothing), and the audience is told which
   IDs were missing
4. Optionally summarizes failures in plain language via a local LLM (Ollama)
5. Emails the report to the audience, then keeps reminding them every run until someone
   acknowledges it by simply replying to the email — no special wording required
6. Caches each day's fetched report in MySQL so re-running the same day doesn't hit Gmail or the
   DB again

## Architecture

```
src/index.js              Entry point. Cache-or-fetch today's report, run the DB check,
                           cache the result, then hand off to the reminder cycle.
src/config/config.js       All env vars in one place, plus config.today (see Testing below).
src/email/gmailClient.js   IMAP: fetchLatestReportHtml() (today's report) and
                           fetchInboxSince() (raw inbox scan used for acknowledgment detection).
src/email/parseReport.js   Parses the report HTML: extractFailedTestcases(), extractSummaryCounts().
src/db/pool.js             mysql2 connection pool, built from config.db.
src/db/updateTestcase.js   markTestcasesFailed(): existence-checks every failed testcase before
                           updating (the actual UPDATE is currently commented out — see below).
src/summarize/llmSummary.js Optional Ollama call; fails gracefully (empty summary) if unreachable.
src/reminder/remainder.js  sendRemainder(): the single function that drives all outbound email.
src/notify/ackNote.js      Shared "reply to acknowledge" HTML snippet.
connect.js                 Report cache, per-recipient notification, and acknowledgment
                           tables in MySQL — same connection as src/db/pool.js, table names
                           configurable via env (see Environment variables below).
```

## How the daily cycle works

Each run of `src/index.js`:
1. Checks the report cache table (`connect.js`, MySQL) for a cached report for `config.today`.
   Cache **hit** → skip straight to step 4. Cache **miss** → fetch from Gmail.
2. If a report is found: parses it, logs the Passed/Failed/Skipped/Flaky/Total summary, and:
   - **0 failures** → cached and immediately marked `acknowledged` (nothing to notify about).
   - **failures found** → runs `markTestcasesFailed()` (see below), requests an LLM summary,
     and caches the report along with the DB result and summary.
3. (Cache miss with no report found for today, or fetch/parse errors, just log and move on.)
4. The reminder cycle runs unconditionally on **every** run: it scans *all* unacknowledged
   reports in the cache — not just today's — checks the inbox for a reply from anyone in
   the resolved audience (see Acknowledgment below), and either marks a report acknowledged
   (reply found) or (re)sends it.
   The subject is `QA-AGENT: <subject>` the first time a report is sent, and
   `REMINDER: <subject>` every time after that.

This means an old unacknowledged report keeps getting reminded on every scheduled run,
indefinitely, regardless of what today's report looked like — until someone replies.

## All-or-nothing DB update

`markTestcasesFailed()` first checks that **every** failed testcase's ID exists in
`DB_TABLE` (matched on `DB_TESTCASE_NAME_COLUMN`). If any are missing, it throws with the full
list of missing IDs and **no update runs at all**. `index.js` catches this, keeps going (the
audience still gets notified), and the email includes a warning naming the missing IDs plus an
explicit note that the DB was not touched because of it.

**Current state:** the actual `UPDATE ... SET <DB_EXECUTE_COLUMN> = 'no'` statement in
`src/db/updateTestcase.js` is commented out — right now the agent only *checks* existence and
logs what it *would* update. Uncomment that block once you're ready for it to write to the DB
for real.

## Audience

The notification audience is **not** static config — it's resolved from the
`DB_RECIPIENTS_TABLE` table (owned by other automation, not this agent) on every run, filtered
to rows where `git_branch = AUDIENCE_GIT_BRANCH` and `email_enabled = 'yes'`
(`src/db/audienceRecipients.js`). There's no fallback: if the table/branch aren't configured or
the filtered result is empty, the run fails loudly rather than silently mailing no one or a
stale list.

## Acknowledgment

The audience acknowledges a report by **replying to the email** — nothing special to type.
Every notification sent to a recipient is recorded in its own row (report, recipient,
Message-ID). A reply counts if its sender is in the resolved audience and it references one of
those Message-IDs (`In-Reply-To`/`References`). Whoever replies **first** is recorded as the
acknowledger; anyone else who replies afterward — even in a later run — gets a courtesy
"already acknowledged by X" email instead of re-triggering or being silently dropped. Every
reply is recorded once it's handled, so it's never processed twice.

## Setup

1. `npm install`
2. Create a `.env` in the project root (there's no `.env.example` checked in — see **Environment
   variables** below for the full list) with real values.
3. Gmail access uses IMAP + an App Password (no OAuth/Cloud Console needed):
   - Turn on 2-Step Verification on the Gmail account: Google Account → Security
   - Generate an app password at https://myaccount.google.com/apppasswords
   - Put the Gmail address in `GMAIL_USER` and the 16-char password in `GMAIL_APP_PASSWORD`
4. `npm start` to run once manually.

### Environment variables

| Variable | Used for |
|---|---|
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | IMAP login — also the mailbox `fetchInboxSince` scans for replies |
| `GMAIL_REPORT_SENDERS` | Comma-separated sender list — filters which inbox email is even considered |
| `GMAIL_REPORT_SUBJECT_NOVA`, `GMAIL_REPORT_SUBJECT_ATLAS` | Comma-separated subject substrings that classify a candidate email as NOVA or Atlas — independent lists, not positions in one shared list |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection (`mysql2` pool), shared by both the testcase table and the agent's own tables below |
| `DB_TABLE`, `DB_TESTCASE_NAME_COLUMN`, `DB_EXECUTE_COLUMN` | Which QA testcase table/columns `markTestcaseForAtlas` checks and updates |
| `DB_REPORT_CACHE_TABLE`, `DB_REPORT_NOTIFICATIONS_TABLE`, `DB_REPLY_RECEIPTS_TABLE` | Table names for the agent's own report cache / per-recipient notification / acknowledgment tracking (`connect.js`) — auto-created if missing; column names are fixed in `config.js` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Outgoing mail (reports, reminders) |
| `DB_RECIPIENTS_TABLE`, `AUDIENCE_GIT_BRANCH` | Which shared table/branch the notification audience is resolved from (see Audience above) — required, no fallback |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | Optional LLM summary — safe to leave unreachable, degrades to no summary |
| `TODAY_DATE` | Optional override for `config.today` (e.g. `2026-09-17`), for testing against a specific date instead of real "today" |

## Testing without touching real dates

`config.today` (`src/config/config.js`) is the single source of truth for "today" everywhere
in the codebase — `index.js`'s cache key and `gmailClient.js`'s IMAP search both read it. Set
`TODAY_DATE=YYYY-MM-DD` before running instead of hardcoding a date inside any file:

```
TODAY_DATE=2026-09-17 npm start
```

Truncating the `DB_REPORT_CACHE_TABLE`/`DB_REPORT_NOTIFICATIONS_TABLE`/`DB_REPLY_RECEIPTS_TABLE`
tables gives a clean test slate — it just means the next run re-fetches from Gmail instead of
using a cached copy.

## Scheduling

Run this on a schedule (e.g. every 2 hours) via:
- GitLab CI scheduled pipeline, or
- Windows Task Scheduler on the AWS instance (`schtasks`), or
- cron, if running on Linux

Note: if running Ollama locally for the LLM summary, a GitLab-hosted runner has no network path
to your machine — either host Ollama somewhere network-reachable and point `OLLAMA_HOST` at it,
or accept that the summary silently comes back empty in CI (it degrades gracefully either way).
