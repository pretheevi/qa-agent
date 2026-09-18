import { config } from './src/config/config.js';
import { pool } from './src/db/pool.js';

// const [rows] = await pool.query(`SHOW DATABASES`);
// console.log(rows);

const [rows] = await pool.query('SHOW TABLES FROM service_automation_runner_manager');
console.log(rows);

await pool.end();

// SELECT * FROM service_automation_runner_manager.atlas_demographic_runner_manager;