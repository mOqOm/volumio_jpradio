'use strict';
import 'date-utils';
import { format } from 'util';
import got from 'got';
import fs from 'fs';
import { parseXml } from './utils.js';
import { spawn, exec } from 'child_process';
import capitalize from 'capitalize';
import writer from 'm3u-file-parser';

import tough from 'tough-cookie';

class Radiko {
    #LOGIN_URL = 'https://radiko.jp/ap/member/webapi/member/login';
    #CHECK_URL = 'https://radiko.jp/ap/member/webapi/member/login/check';
    #LOGOUT_URL = 'https://radiko.jp/ap/member/webapi/member/logout';
    #AUTH_KEY = 'bcd151073c03b352e1ef2fd66c32209da9ca0afa';
    #AUTH1_URL = 'https://radiko.jp/v2/api/auth1';
    #AUTH2_URL = 'https://radiko.jp/v2/api/auth2';
    #CHANNEL_AREA_URL = 'http://radiko.jp/v3/station/list/%s.xml';
    #CHANNEL_FULL_URL = 'http://radiko.jp/v3/station/region/full.xml';
    #PLAY_URL = 'http://f-radiko.smartstream.ne.jp/%s/_definst_/simul-stream.stream/playlist.m3u8';
    #MAX_RETRY_COUNT = 2;
    #instCtr = 0;
    #PROG_DAILY_URL = "https://radiko.jp/v3/program/station/date/%s/%s.xml"
    constructor(logger) {
        this.logger = logger;

        this.token = null;
        this.areaID = null;

        this.areaData = null;
        this.stations = null;
        this.cookieJar = null;

        this.stationData = [];
    }

    init = async (tgtEnv = 'VOLUMIO', acct, playList, forceGetStations = false) => {
        this.#instCtr += 1;
        this.logger.debug(format('Radiko constructor: %s'), this.#instCtr);
        let cookieJar = new tough.CookieJar();;
        if (acct) {
            var loginState = null;
            if (this.cookieJar) {
                loginState = await this.#checkLogin(cookieJar);
            }
            if (!this.cookieJar || !this.loginState) {
                cookieJar = await this.#login(acct);
                loginState = await this.#checkLogin(cookieJar);
                if (loginState) {
                    this.cookieJar = cookieJar;
                }
            }
            this.loginState = loginState;
        } else {
            this.loginState = null
        }

        if (forceGetStations || !this.areaID) {
            let [authToken, areaID] = await this.#getToken(cookieJar);
            this.token = authToken;
            this.areaID = areaID;
            this.logger.info('getting stations');
            await this.#getStations();
            if (playList) {
                if (tgtEnv == 'VOLUMIO') {
                    await this.#genPlayListVolumio(
                        playList.url,
                        playList.file
                    );
                } else {
                    await this.#genPlaylistMpd(
                        playList.url,
                        playList.file
                    );
                }
            }
        }
    }

    #getToken = async (cookieJar) => {
        let authResponse = await this.#auth1(cookieJar);
        let [partialKey, authToken] = await this.#getPartialKey(authResponse);

        let txt = await this.#auth2(authToken, partialKey, cookieJar);
        this.logger.debug(txt.trim().toString());
        let [areaID, areaName, areaNameAscii] = txt.trim().split(',');

        return [authToken, areaID];
    }

    #login = async (acct) => {
        let cookieJar = new tough.CookieJar();
        const options = {
            cookieJar,
            method: 'POST',
            methodRewriting: true,
            form: {
                mail: acct['mail'],
                pass: acct['pass']
            },
        }
        try {
            await got(this.#LOGIN_URL, options);
            return cookieJar;
        } catch (err) {
            console.log(err);
            if (err.statusCode == 302) {
                return cookieJar;
            }
        }
        return null;
    }

    #checkLogin = async (cookieJar) => {
        if (!cookieJar) {
            this.logger.info('premium account not set');
            return null;
        }
        try {
            const options = {
                cookieJar,
                method: 'GET'
            }
            const response = await got(this.#CHECK_URL, options);
            this.logger.info('premium logged in');
            return response.body;
        } catch (err) {
            if (err.statusCode === 400) {
                this.logger.info('premium not logged in');
                return null;
            }
        }
    }

    #logout = async (cookieJar) => {
        if (this.loginState) {
            let logout = await got(this.#LOGOUT_URL, { cookieJar });
            let txt = logout.read();
            this.loginState = null;
            this.logger.info('premium logout');
            return json.loads(txt.decode());
        }
    }

    #auth1 = async (cookieJar) => {
        const options = {
            cookieJar,
            method: 'GET',
            headers: {
                'User-Agent': 'curl/7.56.1',
                'Accept': '*/*',
                'X-Radiko-App': 'pc_html5',
                'X-Radiko-App-Version': '0.0.1',
                'X-Radiko-User': 'dummy_user',
                'X-Radiko-Device': 'pc',
            }
        }
        const response = await got(this.#AUTH1_URL, options);
        return { Headers: response.headers };
    }

    #getPartialKey = async (authResponse) => {
        let authToken = authResponse.Headers['x-radiko-authtoken'];
        let keyLength = parseInt(authResponse.Headers['x-radiko-keylength'], 10);
        let keyOffset = parseInt(authResponse.Headers['x-radiko-keyoffset'], 10);
        let partialKey = this.#AUTH_KEY.slice(keyOffset, (keyOffset + keyLength));
        partialKey = Buffer.from(partialKey).toString('base64');
        return [partialKey, authToken];
    };

    #auth2 = async (authToken, partialKey, cookieJar) => {
        const options = {
            cookieJar,
            method: 'GET',
            headers: {
                'X-Radiko-AuthToken': authToken,
                'X-Radiko-Partialkey': partialKey,
                'X-Radiko-User': 'dummy_user',
                'X-Radiko-Device': 'pc',
            }
        }
        const response = await got(this.#AUTH2_URL, options);
        return response.body;
    }

    download = async (station, ft, outfile) => {
        const url = format(this.#PROG_DAILY_URL, ft.substr(0, 8), station);
        const response = await got(url);
        let xmlString = await parseXml(response.body);
        let progs = xmlString['radiko']['stations'][0]['station'][0]['progs'][0];
        for await (const prog of progs['prog']) {
            if (prog.$['ft'] == ft) {
                let to = prog.$['to'];
                let title = prog['title'][0];
                let pfm = prog['pfm'][0];
                let img = prog['img'][0];
                // fail if img is set on Volumio
                this.#download(station, ft, to, outfile, null, title, pfm);
            }
        }
    }

    #download = async (station, ft, to, outfile, mAlbumArt = null, mTitle = null, mArtist = null) => {
        let url = format('https://radiko.jp/v2/api/ts/playlist.m3u8?station_id=%s&l=15&ft=%s&to=%s', station, ft, to);
        let m3u8 = await this.#genTempChunkM3u8URL(url, this.token);
        let param = new Map();
        param['album'] = '-metadata album="Radikoタイムフリー"';
        param['album_artist'] = '-metadata album_artist="various"';
        param['genre'] = '-metadata genre="Broadcast"';
        param['albumart'] = '';
        if (mAlbumArt != null) {
            param['albumart'] = format('-i "%s" -map 0:a -map 1:v -disposition:1 attached_pic', mAlbumArt);
        }
        param['title'] = '';
        if (mTitle != null) {
            param['title'] = format('-metadata title="%s"', mTitle);
        }
        param['artist'] = '';
        if (mArtist != null) {
            param['artist'] = format('-metadata artist="%s"', mArtist);
        }

        let cmd = format('ffmpeg -y -headers "X-Radiko-Authtoken:%s" -i "%s" %s %s %s %s %s %s -codec copy -bsf:a aac_adtstoasc -loglevel error "%s"', this.token, m3u8, param['albumart'], param['album'], param['album_artist'], param['genre'], param['title'], param['artist'], outfile);
        let proc = spawn(cmd, {
            shell: true,
        });
        proc.stderr.setEncoding("utf8");

        proc.stdout.on('data', (data) => {
            console.log(data);
        });

        proc.stderr.on('data', (data) => {
            console.log(data);
        });
    }

    #getStations = async () => {
        this.areaData = new Map();
        this.stations = new Map();

        const response = await got(this.#CHANNEL_FULL_URL);

        let stationsInfo = await parseXml(response.body);

        let stationData = [];

        for await (const stationsTemp of stationsInfo['region']['stations']) {
            let data = {};
            data['region'] = new Map();
            data['stations'] = [];

            data['region'] = stationsTemp.$

            for await (const stationTemp of stationsTemp['station']) {
                data['stations'].push({
                    'id': stationTemp['id'][0],
                    'name': stationTemp['name'][0],
                    'ascii_name': stationTemp['ascii_name'][0],
                    'areafree': stationTemp['areafree'][0],
                    'timefree': stationTemp['timefree'][0],
                    'banner': stationTemp['banner'][0],
                    'area_id': stationTemp['area_id'][0],
                });
            }
            stationData.push(data);
        }
        this.stationData = stationData;

        for (let i = 1; i <= 47; i++) {
            let areaID = format('JP%d', i);
            let url = format(this.#CHANNEL_AREA_URL, areaID);
            const response = await got(url);
            let xmlDataArea = await parseXml(response.body);

            let stations = [];
            for await (const stationInfo of xmlDataArea['stations']['station']) {
                stations.push(stationInfo['id'][0]);
            };

            this.areaData.set(areaID, { areaName: xmlDataArea['stations'].$['area_name'], stations: stations });
        }
        let stations = new Map();
        for await (const region of this.stationData) {
            let regionData = region['region'];
            for await (const s of region['stations']) {
                let stationID = s['id'];
                let regionName = regionData['region_name'];
                let bannerURL = s['banner'];
                let areaID = s['area_id'];
                let areaName = this.areaData.get(s['area_id'])['areaName'].replace(' JAPAN', '');
                let name = s['name'];
                let asciiName = s['ascii_name'];

                if (this.loginState || this.areaData.get(this.areaID)['stations'].includes(stationID)) {
                    stations.set(stationID, {
                        RegionName: regionName,
                        BannerURL: bannerURL,
                        AreaID: areaID,
                        AreaName: areaName,
                        Name: name,
                        AsciiName: asciiName,
                    });
                }
            }
        }
        this.stations = stations;
    }

    getStationAsciiName = async (station) => {
        let stationName = '';
        if (this.stations.has(station)) {
            stationName = this.stations.get(station).AsciiName;
        }
        return stationName;
    }

    play = async (station) => {
        this.logger.info(format('playing %s', station));
        if (this.stations.has(station)) {
            let url = format(this.#PLAY_URL, station);
            let m3u8 = null;

            for (let i = 0; i < this.#MAX_RETRY_COUNT; i++) {
                m3u8 = await this.#genTempChunkM3u8URL(url, this.token);
                if (m3u8) {
                    break;
                }
                this.logger.info('getting new token');
                let [authToken, areaID] = await this.#getToken();
                this.token = authToken;
                this.areaID = areaID;
            }

            if (!m3u8) {
                this.logger.error('gen temp chunk m3u8 url fail');
                return null
            } else {
                let cmd = format('ffmpeg -y -headers X-Radiko-Authtoken:%s -i %s -acodec copy -f adts -loglevel error pipe:1', this.token, m3u8);
                let proc = spawn(cmd, {
                    shell: true,
                    stdio: [null, process.pipe, null, 'ipc'],
                    detached: true,
                    maxBuffer: 1024 * 1024 * 2
                });
                let pid = proc.pid;
                this.logger.debug(format('started subprocess: group id %s', pid));

                proc.on('exit', (code) => {
                    this.logger.info(format('stop playing %s', station));
                    this.logger.debug(format('killing process group %s', pid));
                });
                return proc;
            }
        } else {
            this.logger.error(format('%s not in available stations', station));
        }
        return null
    }

    #genTempChunkM3u8URL = async (url, authToken) => {
        const options = {
            method: 'GET',
            headers: {
                'X-Radiko-AuthToken': authToken,
            }
        }
        try {
            const response = await got(url, options);
            const lines = response.body.match(/^https?:\/\/.+m3u8$/gm);
            return lines[0];
        } catch (err) {
            if (err.statusCode == 403) {
                return null;
            }

            return null;
        }
    }

    #genPlaylistMpd = async (urlTemplate, outfile) => {
        var m3u = writer.M3U.create();

        for (let station of this.stations.keys()) {
            m3u.addPlaylistItem({
                duration: -1,
                uri: urlTemplate + station
            });
        }

        fs.writeFileSync(outfile, m3u.toString());
        this.logger.info(format('writing playlist: %s', outfile));
    }

    #genPlayListVolumio = async (urlTemplate, outfile) => {
        let radikoPlayLists = [];
        for (let station of this.stations.keys()) {
            let temp = this.stations.get(station);
            let title = format('%s / %s', capitalize(this.stations.get(station).AreaName), temp['Name']);

            radikoPlayLists.push({
                service: 'webradio',
                title: title,
                uri: urlTemplate + station,
                albumart: temp['BannerURL']
            });
        }

        fs.writeFileSync(outfile, JSON.stringify(radikoPlayLists));
        this.logger.info(format('writing playlist: %s', outfile));
    }

    checkFfmpeg = async () => {
        let cmd = 'ffmpeg -version';
        let proc = exec(cmd, {
            shell: true,
            stdio: [null, process.pipe, null],
        });
        proc.on('exit', function (code, signal) {
            if (code > 0) {
                console.error(`Exit because FFMPEG is not available.`);
                process.exit(1);
            }
        });
    }

    del = async () => {
        this.#instCtr -= 1;
        this.logger.debug(format('Radiko destructor: %s'), this.#instCtr);
        if (this.#instCtr == 0) {
            let res = this.#logout();
            this.logger.debug(res);
        }
    }
}

export { Radiko };