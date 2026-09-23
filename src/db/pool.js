import mysql from 'mysql2/promise';
import { config } from '../config/config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  // Return DATETIME/DATE columns as plain strings instead of JS Date objects, so
  // report_cache rows behave the same as they did when local.db was sqlite.
  dateStrings: true,
});
