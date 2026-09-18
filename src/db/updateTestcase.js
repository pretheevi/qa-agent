import { config } from '../config/config.js';
import { pool } from './pool.js';

export async function markTestcasesFailed(failures) {
  const notFound = [];
  for (const failure of failures) {
    const [rows] = await pool.execute(
      `SELECT * FROM ${config.db.table} WHERE ${config.db.testcaseNameColumn} = ?`,
      [failure.testcaseId]
    );
    if (rows.length === 0) {
      notFound.push(failure.testcaseId);
    }
  }
  if (notFound.length > 0) {
    throw new Error(`Testcase(s) not found in ${config.db.table}: ${notFound.join(', ')}`);
  }

  // for (const failure of failures) {
  //   await pool.execute(
  //     `UPDATE ${config.db.table} SET ${config.db.executeColumn} = 'no' WHERE ${config.db.testcaseNameColumn} = ?`,
  //     [failure.testcaseId]
  //   );
  //   console.log(`[DB] set ${config.db.executeColumn}='no' for ${failure.testcaseId}`);
  // }
}
