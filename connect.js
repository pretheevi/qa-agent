import sqlite3 from 'sqlite3';
import {open} from 'sqlite';


export async function connect() {
    const db = await open({
        filename: './database.db',
        driver: sqlite3.Database
    })
    return db
}

class Database{

    static async initializeTables() {
        const NovaSectionTable = `
            CREATE TABLE IF NOT EXISTS nova_sections(
                id TEXT PRIMARY KEY,
                section_name TEXT NOT NULL,
            );
        `
    }

    static async createAcknowledgmentRecords() {

    }
}