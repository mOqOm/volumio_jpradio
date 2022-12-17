'use strict';
import 'date-utils';
import { format } from 'util';
import got from 'got';
import { parseXml } from './utils.js';

import { GetDB } from './db.js';

class RdkProg {
    #PROG_URL = 'http://radiko.jp/v3/program/date/%s/%s.xml';

    constructor() {
        this.db = null;
        this.station = null;
        this.lastdt = null;
        this.progdata = null;
    }

    getDB = async () => {
        if (!this.db) {
            this.db = await GetDB();
        }
        return this.db;
    }

    getCurProgram = async (station) => {
        let curdt = new Date().toFormat('YYYYMMDDHH24MI');
        if (station != this.station || curdt != this.lastdt) {
            let db = await GetDB();
            try {
                db.serialize(() => {
                    db.each(`SELECT * FROM prog WHERE station = ? AND ft <= ? AND tt >= ?`, station, curdt, curdt, (error, row) => {
                        if (error) {
                            console.error(error.message);
                        }
                        this.progdata = row;
                    });
                });
            } catch (error) {
                db.rollback();
            }
        }
        this.station = station;
        this.lastdt = curdt;
        return this.progdata;
    }

    putProgram = async (prog_data) => {
        let db = await this.getDB();
        try {
            db.serialize(() => {
                let sql = db.prepare(`INSERT INTO prog (station, id, ft, tt, title, pfm) values(?, ?, ?, ?, ?, ?)`);
                sql.run(prog_data.station, prog_data.id, prog_data.ft, prog_data.tt, prog_data.title, prog_data.pfm);
                sql.finalize();
            });
        } catch (error) {
            db.rollback();
        }
    }

    clearOldProgram = async () => {
        let curdt = new Date().toFormat('YYYYMMDDHH24MI');
        let db = await this.getDB();
        try {
            db.serialize(() => {
                let sql = db.prepare(`DELETE FROM prog WHERE tt < ?`);
                sql.run(curdt);
                sql.finalize();
            });
        } catch (error) {
            db.rollback();
        }
    }

    updatePrograms = async () => {
        let curdt = new Date().toFormat('YYYYMMDD');
        for (let i = 1; i <= 47; i++) {
            let areaID = format('JP%d', i);
            let url = format(this.#PROG_URL, curdt, areaID)

            const response = await got(url);
    
            let data = await parseXml(response.body);
    
            for await (let stations of data['radiko']['stations']) {
                for await (let station of stations['station']) {
                    for await (let progs of station['progs']) {
                        for await (let prog of progs['prog']) {
                            await this.putProgram({
                                station: station.$['id'],
                                id: station.$['id'] + prog.$['id'],
                                ft: prog.$['ft'],
                                tt: prog.$['to'],
                                title: prog['title'][0],
                                pfm: prog['pfm'][0]
                            });
                        }
                    }
                }
            }
        }
    }
}

export { RdkProg };