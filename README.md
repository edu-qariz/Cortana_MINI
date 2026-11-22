<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=30&pause=900&color=22D3EE&center=true&vCenter=true&width=560&height=64&lines=CORTANA+MINI" alt="CORTANA MINI">

<br>

<img src="https://img.shields.io/badge/version-2.3.0-22D3EE?style=flat-square&labelColor=0b0f14" alt="version">
<img src="https://img.shields.io/badge/node-20%2B-818CF8?style=flat-square&labelColor=0b0f14" alt="node">

<br><br>

**A small WhatsApp bot.** One process, no database, fast and quiet.

</div>

## Run it

```bash
git clone https://github.com/edu-qariz/Cortana_MINI.git
cd Cortana_MINI
npm install
npm start
```

Type your number when asked — digits only, country code first — then enter the code it prints in
**WhatsApp → Linked devices → Link with phone number**.

## Set it up

Settings live in `%LOCALAPPDATA%\CortanaMini\.env` on Windows, `~/.cortana-mini/.env` elsewhere.
Not in this folder — updates replace this folder and never touch that one.

Two lines are required. Without them the bot pairs and then answers every command with
*"CORTANA IS OFFLINE"*, because commands are served, not built in.

```ini
CORTANA_API=https://api.thecortana.tech
LICENCE_KEY=CM-XXXX-XXXX-XXXX
```

Optional:

- `OWNER_NUMBERS` — only needed if you want to run owner commands from a number **other than** the
  paired one. Messages you send from the bot's own account already count as owner.
- `PANEL_TOKEN` — protects the web panel on port 8099.

## Hosting

| | |
|---|---|
| Bot-Hosting | [open](https://bot-hosting.net/?aff=1240477149576826890) |
| Katabump | [open](https://dashboard.katabump.com/auth/login#629473) |
| Heroku | [![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/edu-qariz/Cortana_MINI) |
| Render · Replit · Termux · VPS | see [the manual](docs/reference.md) |

On hosts that wipe the disk between restarts, point `CORTANA_HOME` at a persistent volume.

## Docs

- [Reference manual](docs/reference.md) — commands, environment variables, panel, limits
- [Updater contract](docs/updater-contract.md) — how updates are verified and applied
- [Command primitives](docs/command-primitives.md) — the twelve building blocks

<div align="center">

<sub>©2026 <a href="https://t.me/techdepro">t.me/techdepro</a> · unofficial Baileys client — use a dedicated number, bans happen</sub>

</div>
