import { config } from '../config/config.js';
import { pool } from './pool.js';

// Resolves the notification audience from the shared recipients table (owned by other
// automation, not this agent) for the configured git_branch. No fallback — a misconfigured
// table/branch or an empty result should fail loudly rather than silently mailing no one
// or the wrong list.
export async function resolveAudience() {
  const { table, gitBranch, columns } = config.db.recipients;

  if (!table || !gitBranch) {
    throw new Error('DB_RECIPIENTS_TABLE and AUDIENCE_GIT_BRANCH must both be set to resolve the audience.');
  }

  const [rows] = await pool.execute(
    `SELECT ${columns.emailAddress} AS email_address
     FROM ${table}
     WHERE ${columns.gitBranch} = ? AND LOWER(${columns.emailEnabled}) = 'yes'`,
    [gitBranch]
  );

  const emails = [...new Set(
    rows.flatMap(row =>
      (row.email_address || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean)
    )
  )];

  if (emails.length === 0) {
    throw new Error(`No enabled recipients found in "${table}" for git_branch="${gitBranch}".`);
  }

  console.log(`[Audience] Resolved ${emails.length} recipient(s) from "${table}" for git_branch="${gitBranch}".`);

  return emails;
}
