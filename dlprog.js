'use strict';
import { Radiko } from './radiko/radiko.js';
import { format } from 'util';
import fs from 'fs';
import path from 'path';
import url from 'url';
import yamlConfig from 'node-yaml-config';
import log4js from 'log4js';

const __filename = url.fileURLToPath(import.meta.url);
global.__dirname = path.dirname(__filename);

global.conf = yamlConfig.load(__dirname + '/config.yaml');

log4js.configure({
    appenders: {
        out: { type: 'stdout' }
    },
    categories: {
        default: { appenders: ['out'], level: 'debug' },
        errLog: { appenders: ['out'], level: 'error' }
    }
});

const logger = log4js.getLogger();
const rdk = new Radiko(logger);

try {
    var act = {
        mail: conf.account.mail,
        pass: conf.account.pass
    }
} catch {
    act = null;
}

async function showUsage() {
    console.log(format('usage: %s <station_id> <ft> <out_path>'), args[0]);
    console.log('');
    console.log('station_id: Station ID (see http://radiko.jp/v3/station/region/full.xml)');
    console.log('ft: Record start datetime (%Y%m%d%H%M format, JST)');
    console.log('out_path: Output path');
}

const args = process.argv.slice(1);
if (args.length === 4 ) {
    if (!args[2].match('[0-9]{12}')){
        await showUsage()
        process.exit(1);
    }
    await rdk.init('VOLUMIO', act, null, false);
    await rdk.download(args[1], args[2] + '00', args[3]);
} else {
    await showUsage()
    process.exit(1);
}
