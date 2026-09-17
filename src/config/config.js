import dotenv from 'dotenv';
dotenv.config();

export const config = {
  gmail: {
    user: process.env.GMAIL_USER,
    appPassword: process.env.GMAIL_APP_PASSWORD,
    reportSender: process.env.GMAIL_REPORT_SENDER,
    reportSubject: process.env.GMAIL_REPORT_SUBJECT,
  },
  db: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    table: process.env.DB_TABLE,
    testcaseColumn: process.env.DB_TESTCASE_COLUMN,
    statusColumn: process.env.DB_STATUS_COLUMN,
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    audience: (process.env.AUDIENCE_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean),
  },
  ollama: {
    host: process.env.OLLAMA_HOST,
    model: process.env.OLLAMA_MODEL,
  },
};
