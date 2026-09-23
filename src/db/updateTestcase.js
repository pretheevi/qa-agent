import { config } from '../config/config.js';
import { pool } from './pool.js';

export async function markTestcaseForAtlas(failures) {
  const notFound = [];

  for (const failure of failures) {
    const testCaseName = failure.testCaseName;

    const [rows] = await pool.execute(
      `SELECT * FROM ${config.db.table} WHERE ${config.db.testcaseNameColumn} = ?`,
      [testCaseName]
    );

    if (rows.length === 0) {
      notFound.push(testCaseName);
    }
  }

  if (notFound.length > 0) {
    throw new Error(
      `Atlas testcase(s) not found in ${config.db.table}: ${notFound.join(', ')}`
    );
  }

  const connection = await pool.getConnection();
  const results = [];

  try {
    await connection.beginTransaction();

    for (const failure of failures) {
      const testCaseName = failure.testCaseName;

      const [result] = await connection.execute(
        `UPDATE ${config.db.table}
        SET ${config.db.executeColumn} = 'no'
        WHERE ${config.db.testcaseNameColumn} = ?
          AND ${config.db.executeColumn} != 'no'`,
        [testCaseName]
      );

      if (result.affectedRows > 0) {
        console.log(`[DB][Atlas] set ${config.db.executeColumn}='no' for ${testCaseName}`);
        results.push({ testCaseName, status: 'set' });
      } else {
        console.log(`[DB][Atlas] ${testCaseName} already has ${config.db.executeColumn}='no'`);
        results.push({ testCaseName, status: 'already-no' });
      }
    }

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return results;
}