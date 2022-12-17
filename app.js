'use strict';
const serverPort = 9000;
import express from 'express';
const app = express();
import { InitDB } from './radiko/db.js';
import { RdkProg } from './radiko/prog.js';
import { Radiko } from './radiko/radiko.js';
import { format } from 'util';

import IcyMetadata from 'icy-metadata';
import { CronJob } from 'cron';

import path from 'path';
import url from 'url';
import yamlConfig from 'node-yaml-config';
import log4js from 'log4js';

const __filename = url.fileURLToPath(import.meta.url);
global.__dirname = path.dirname(__filename);

global.conf = yamlConfig.load(__dirname + '/config.yaml');

if (conf.system_config.debug_mode) {
    log4js.configure({
        appenders: {
            out: { type: 'stdout' }
        },
        categories: {
            default: { appenders: ['out'], level: 'debug' },
            errLog: { appenders: ['out'], level: 'error' }
        }
    });
} else {
    log4js.configure({
        appenders: {
            out: { type: 'stdout' }
        },
        categories: {
            default: { appenders: ['out'], level: 'info' },
            errLog: { appenders: ['out'], level: 'error' }
        }
    });
}

const logger = log4js.getLogger();

const prg = new RdkProg();
const rdk = new Radiko(logger);
const cronTime = '01 3,9,15 * * *';
const job = new CronJob({
    cronTime: cronTime,
    onTick: function () {
        pgupdate();
    },
    start: false,
    timeZone: 'Asia/Tokyo'
});

async function pgupdate() {
    logger.info('Updating program listings');
    await prg.updatePrograms();
    await prg.clearOldProgram();
}

console.log('***************************************************************************');
console.log(' _    __      __                _              ____  ___    ____  ________ ');
console.log('| |  / /___  / /_  ______ ___  (_)___         / __ \\/   |  / __ \\/  _/ __ \\');
console.log('| | / / __ \\/ / / / / __ `__ \\/ / __ \\       / /_/ / /| | / / / // // / / /');
console.log('| |/ / /_/ / / /_/ / / / / / / / /_/ /      / _, _/ ___ |/ /_/ // // /_/ / ');
console.log('|___/\\____/_/\\__,_/_/ /_/ /_/_/\\____/      /_/ |_/_/  |_/_____/___/\\____/  ');
console.log('***************************************************************************');
await rdk.checkFfmpeg();
await InitDB();

let playlist = {
    url: conf.radiko_config.playlist_url,
    file: conf.system_config.tgt_env === 'VOLUMIO' ? conf.radiko_config.playlist_file_volumio : conf.radiko_config.playlist_file_mpd
}
try {
    var act = {
        mail: conf.account.mail,
        pass: conf.account.pass
    }
} catch {
    act = null;
}

await rdk.init(conf.system_config.tgt_env, act, playlist);
await pgupdate();

app.get('/radiko', (req, res) => {
    res.send('Hello, world. You\'re at the radiko_app index.');
});

app.get('/radiko/pgupdate', async (req, res) => {
    await pgupdate();
    res.send('OK');
});

app.get('/radiko/:stationID', async (req, res) => {
    let station = req.params['stationID'];

    if (rdk.stations.has(station)) {
        await rdk.init(conf.system_config.tgt_env, act, playlist);
        const icyMetadata = new IcyMetadata();

        let ffmpeg = await rdk.play(station);
        res.setHeader('HeaderCacheControl', 'no-cache, no-store');
        res.setHeader('icy-name', await rdk.getStationAsciiName(station));
        res.setHeader('icy-metaint', icyMetadata.metaInt);
        res.setHeader('Content-Type', 'audio/aac');
        res.setHeader('Connection', 'keep-alive');

        let progData = await prg.getCurProgram(station);
        let title = null;
        if (progData) {
            title = (progData['pfm'] ? progData['pfm'] : '') + ' - ' + (progData['title'] ? progData['title'] : '');
        }

        if (title) {
            icyMetadata.setStreamTitle(title);
        }

        ffmpeg.stdout.pipe(icyMetadata).pipe(res);

        res.on('close', function () {
            (async () => {
                await rdk.del();
                process.kill(-ffmpeg.pid, 'SIGTERM');
            })();
        });
        logger.debug('get returning response');
    } else {
        res.send(format('%s not in available stations', station));
        logger.error(format('%s not in available stations', station))
    }

});

app.listen(serverPort, function () {
    logger.info('Starting Server On Port:', serverPort);
    job.start();
});
