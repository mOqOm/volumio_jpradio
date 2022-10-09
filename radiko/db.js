'use strict';
import sqlite3 from 'sqlite3';

const GetDB = async () => {
    let dbFileName = conf.radiko_config.pgdbname;
    return new sqlite3.Database(__dirname + '/' + dbFileName);
}

const InitDB = async () => {
    let db = await GetDB();
    try {
        db.serialize(() => {
            db.run(`DROP TABLE IF EXISTS prog`);
            db.run(`CREATE TABLE prog (
                id TEXT PRIMARY KEY,
                station TEXT NOT NULL,
                ft TEXT,
                tt TEXT,
                title TEXT,
                pfm TEXT,
                UNIQUE(id) on conflict ignore
            )`);
            db.run(`CREATE INDEX stationindex ON prog(station)`);
            db.run(`CREATE INDEX ftindex ON prog(ft)`);
            db.run(`CREATE INDEX ttindex ON prog(tt)`);
            db.run(`PRAGMA journal_mode = WAL`);
        });
    } finally {
        db.close();
    }
}

export { GetDB, InitDB };