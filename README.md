# volumio_jpradio
Japanese radio relay server for Volumio

## Description
Volumio2でRadikoを聞く場合、[こちらの記事](https://monoworks.co.jp/post/2019-05-05-listen-to-radiko-on-volumio/)
の方法で可能ですが、いちいちLogitech Media Serverなるものに切り替えるので使い勝手が
いまひとつよくありません。
そんな折、[burroさんの投稿](#acknowledgments)と[Trunkeneさんの投稿](#acknowledgments)を見つけ、node.jsとデーモン(サービス)で動くように手を加えてみました。
基本、処理は丸パクリです<(_ _)>

+ 2022/10/09 初期

## Requirement
* Volumio3

以下も必要ですが導入方法は後述の[Install](#install)で説明。
* Node.js
* npm
* ffmpeg

## Usage
### Radikoの拝聴方法
下記インストール後、raspberry-piを再起動し、Volumio3の「Playlist」>「Radiko」から選局。
### Radikoのログインについて
下記インストール後、「/home/volumio/radio/config.yaml」の以下のように「#」を削除。
変更前
```
  account :
    #mail : xxx@yyy.zzz
    #pass : foobarhogehoge
```
変更後
```
  account :
    mail : xxx@yyy.zzz
    pass : foobarhogehoge
```
## Install
※ あくまで、私のやった方法です。
Volumio3が普通に動作している状態で、sshログインし作業。
この際のユーザはvolumioを使用。

### 環境
* Raspberry Pi 4 Model B
* Volumio3(Ver:3.378)
* Node.js(Ver:14.15.4)
* npm(Ver:8.19.2)
* Python3(Ver:3.7.3)
* Python(Ver:2.7.16)
* ffmpeg(Ver:4.1.9-0+deb10u1)

### 日本時間にするためTimezoneを変更
```bash
$ sudo dpkg-reconfigure tzdata
# Asia→Tokyoを選択
```

### プロジェクトのクローン
```bash
$ git clone https://github.com/mOqOm/volumio_jpradio ./radio
$ cd radio
```

### パッケージのインストール
```bash
$ sudo apt-get update
$ sudo apt-get install -y build-essential
# npmのアップデート
$ sudo npm install -g npm
# パッケージのインストール
$ sudo npm install express sqlite3 node-yaml-config date-utils xml2js log4js got capitalize m3u-file-parser icy-metadata cron tough-cookie
```

### 動作確認
```bash
$ node /home/volumio/radio/app.js
# Volumio3の「Playlist」>「Radiko」から選局
```

### 自動起動(サービス化)
サービスの作成
```bash
sudo mkdir /usr/lib/systemd/system
sudo nano /usr/lib/systemd/system/radio.service
```
radio.serviceの書込み内容
```bash
[Unit]
Description=radio
After=network.target

[Service]
ExecStart=/usr/bin/node /home/volumio/radio/app.js
Restart=always
User=volumio
Group=volumio
KillMode=process
WorkingDirectory=/home/volumio/radio

[Install]
WantedBy=multi-user.target
```
デーモンのリロードと自動起動設定
```bash
sudo systemctl daemon-reload
sudo systemctl start radio.service

sudo systemctl status radio.service
sudo systemctl enable radio.service
```

## Acknowledgments
* [NanoPi NEOにインストールしたMPDでradikoを聞く](http://burro.hatenablog.com/entry/2019/02/16/175836)
* [Github for Streaming server for relaying "radiko" radio stream to Music Player Daemon (MPD)](https://github.com/burrocargado/RadioRelayServer)
* [Trunkene/volumio_jpradio: Japanese radio relay server for Volumio](https://github.com/Trunkene/volumio_jpradio)
