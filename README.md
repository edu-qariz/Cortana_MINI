<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=32&pause=900&color=22D3EE&center=true&vCenter=true&width=560&height=64&lines=CORTANA+MINI" alt="CORTANA MINI">

**A WhatsApp mini bot.**

Manage groups, pull music and video, make stickers, play games and talk to AI — all from chat.
One process, no database, built to run quietly on the smallest host you can find.

</div>

## Before you start

⭐ **Star this repo** — it helps more people find it.
🍴 **Fork it** — you deploy your own copy, so the fork is what you connect to your host.

## Hosting

| Platform | Type | Get started |
|---|---|---|
| Bot-Hosting | panel | [open](https://bot-hosting.net/?aff=1240477149576826890) |
| Katabump | panel | [open](https://dashboard.katabump.com/auth/login#629473) |
| Heroku | worker dyno | [![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/edu-qariz/Cortana_MINI) |
| Render | web service | [render.com](https://render.com) |
| Replit | repl | [replit.com](https://replit.com) |

On hosts that wipe the disk on restart, set `CORTANA_HOME` to a persistent path.

## Termux

```bash
pkg update -y && pkg install -y nodejs-lts git
git clone https://github.com/edu-qariz/Cortana_MINI.git
cd Cortana_MINI
npm install
npm start
```

## Linux / VPS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
git clone https://github.com/edu-qariz/Cortana_MINI.git
cd Cortana_MINI
npm install
npm i -g pm2
pm2 start start.js --name cortana
```

## Windows

```bash
git clone https://github.com/edu-qariz/Cortana_MINI.git
cd Cortana_MINI
npm install
npm start
```

<div align="center">

<sub>©2026 <a href="https://t.me/techdepro">t.me/techdepro</a></sub>

</div>
