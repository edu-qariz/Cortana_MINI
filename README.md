<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=30&pause=900&color=22D3EE&center=true&vCenter=true&width=620&height=72&lines=CORTANA+MINI;powered+by+Eduqariz;fast+%C2%B7+tiny+%C2%B7+quiet" alt="CORTANA MINI">

<br>

<img src="https://img.shields.io/badge/version-2.3.0-22D3EE?style=flat-square&labelColor=0b0f14" alt="version">
<img src="https://img.shields.io/badge/node-20%2B-818CF8?style=flat-square&labelColor=0b0f14" alt="node">
<img src="https://img.shields.io/badge/commands-61-A78BFA?style=flat-square&labelColor=0b0f14" alt="commands">
<img src="https://img.shields.io/badge/licence-MIT-F472B6?style=flat-square&labelColor=0b0f14" alt="licence">

<br><br>

**The MD bot's little sister** — same brain, fewer parts, faster heartbeat.

</div>

## ✨ What it is

61 commands, a compact text grid, silent media actions and one small panel for pairing and
monitoring. No database, no build step, one process — built to sit quietly on the smallest host
you can find.

- **fast** — nothing heavy on the message path, media work never blocks a reply
- **tiny** — capped caches, rotating logs, temp files swept every minute
- **quiet** — silent media sends, reactions instead of noise

## 🚀 Run it

```bash
git clone https://github.com/edu-qariz/Cortana_MINI.git
cd Cortana_MINI
npm install
npm start
```

First start looks like this — the wordmark flickers in, then settles in colour:

```text
  █▀▀ █▀█ █▀▄ ▀█▀ █▀█ █▄░█ █▀█
  █▄▄ █▄█ █▀▄ ░█░ █▀█ █░▀█ █▀█
         █▀▄▀█ █ █▄░█ █
         █░▀░█ █ █░▀█ █
  ──────────────────────────────────────────────
  Powered by CORTANA · Eduqariz
```

Nothing to configure to boot. Add a `.env` in the state folder (below) when you want owner numbers, an AI key
or a menu image. Commands need a licence: set `CORTANA_API` and `LICENCE_KEY` there too — without them the bot
runs ungated in local mode, which is only meant for development.

## 🔗 Pair in 30 seconds

Type your number when it asks — digits only, country code first:

```text
  Enter your number to pair

  NB// no + · start with country code · 254712345678

  ▸ 
```

The code comes back big, red and centred:

```text
  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔

               YOUR PAIRING CODE IS

                 C O R T A N A 2

  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁

  WhatsApp → Linked devices → Link with phone number
  enter the code there · expires in 60s
  number +254712721414
```

1. Open **WhatsApp → Linked devices → Link with phone number**
2. Type the code exactly as shown, no spaces, within 60 seconds
3. That's it — the menu is one message away: `.menu`

> No QR, ever. Prefer a browser? Run the bot and open `http://localhost:8099` — the panel shows
> the same code. Set `PANEL_TOKEN` before exposing that port.

## 🗂️ Where your data lives

Runtime state sits **outside** the program folder, so updates never touch your session:

| What | Where |
|---|---|
| session, settings, logs, `.env` | `%LOCALAPPDATA%\CortanaMini` on Windows, `~/.cortana-mini` elsewhere |
| program files | this folder — replaceable at any time |
| custom location | set `CORTANA_HOME` to any folder |

Old installs that still keep `auth/`, `data/` or `.env` here are moved across automatically on the
next start.

## 🌍 24/7 hosting

| Host | Get a server |
|---|---|
| 🟣 **Bot-Hosting** — panel | [**open**](https://bot-hosting.net/?aff=1240477149576826890) |
| 🟠 **Katabump** — panel | [**open**](https://dashboard.katabump.com/auth/login#629473) |
| 🟪 **Heroku** — worker dyno | [![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/edu-qariz/Cortana_MINI) |
| ⚫ **Render** | [render.com](https://render.com) |
| 🟢 **Replit** | [replit.com](https://replit.com) |
| 📱 **Termux** · 🐧 **VPS** | see below |

<details>
<summary><b>Termux &amp; Linux commands</b></summary>

```bash
# Termux
pkg update -y && pkg install -y nodejs-lts git
git clone https://github.com/edu-qariz/Cortana_MINI.git && cd Cortana_MINI
npm install && npm start
```

```bash
# Ubuntu / Debian VPS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
git clone https://github.com/edu-qariz/Cortana_MINI.git && cd Cortana_MINI
npm install && pm2 start start.js --name cortana-mini
```

</details>

> On hosts that wipe the disk between restarts, point `CORTANA_HOME` at a persistent volume —
> otherwise you pair again after every deploy.

## ⌨️ Commands

Prefix is `.` by default. Anything that needs arguments replies with its own usage card.

| | |
|---|---|
| 🧠 **core** | `menu` `ping` |
| 🎵 **media pulls** | `play` `video` `waifu` `lyrics` `apk` |
| 🎮 **games** | `slot` `wheel` `tictactoe` `truth` `dare` `math` |
| 💬 **general** | `advise` `technews` `trending` `talknow` `robot` `kiss` `gaycheck` `fast` `slow` |
| 🛡️ **group** | `antilink` `antimention` `antileft` `antispam` `setdesc` `setgp` `hidetag` `tagall` `tagadmins` `groupid` `link` `welcome` `poll` `togroupstatus` |
| 👑 **owner** | `mode` `setimage` `menuimage` `botname` `getdp` `getpp` `tomystatus` `toallstatus` `downloadstatus` `antidelete` `setprefix` `tourl` `chatbot` `restart` `update` `vv` `v2` |
| 🤖 **ai** | `cortana` `chatgpt` `deepseek` |
| 🎨 **stickers** | `tosticker` `toimg` |
| 🃏 **pranks** | `hackall` `hijacknum` |

## 📚 Docs

- [Reference manual](docs/reference.md) — every env var, panel endpoint, guard and limit
- [Worker deploy guide](docs/worker-deploy.md) — D1, KV, secrets, first licence, publishing a release
- [Updater contract](docs/updater-contract.md) — app/state split, signed releases, rollback
- [Command primitives](docs/command-primitives.md) — the twelve building blocks of a plan

<div align="center">

✧ ─────────────────────── ✧

<sub>©2026 <a href="https://t.me/techdepro">t.me/techdepro</a> · powered by CORTANA · Eduqariz</sub>

</div>
