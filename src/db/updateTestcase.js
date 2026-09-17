import { config } from '../config/config.js';
// Swap in your driver of choice: mysql2, pg, mssql, etc.
// import mysql from 'mysql2/promise';

export async function markTestcasesFailed(failures) {
  // const connection = await mysql.createConnection({
  //   host: config.db.host,
  //   port: config.db.port,
  //   database: config.db.name,
  //   user: config.db.user,
  //   password: config.db.password,
  // });

  for (const failure of failures) {
    // await connection.execute(
    //   `UPDATE ${config.db.table} SET ${config.db.statusColumn} = 'no' WHERE ${config.db.testcaseColumn} = ?`,
    //   [failure.testcaseId]
    // );
    console.log(`[DB] would set ${config.db.statusColumn}='no' for ${failure.testcaseId}`);
  }

  // await connection.end();
}
