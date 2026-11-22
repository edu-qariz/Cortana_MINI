# CORTANA MINI — reference

Long-form manual: panel endpoints, every environment variable, command behaviour, resource
limits, deployment notes, security and troubleshooting. The short start guide lives in
[../README.md](../README.md).

---

## Panel

| Endpoint | Purpose |
|---|---|
| `GET /` | dark control panel: status, pairing code, menu, live console |
| `GET /health` | unauthenticated health probe |
| `GET /api/status` | runtime status JSON |
| `GET /api/menu` | current text menu |
| `POST /api/pair` | `{ "phone": "254712345678" }` → pairing code |
| `POST /api/restart` | reconnect the socket |
| `POST /api/logout` | clear the session and re-pair |
| `GET /api/events` | server-sent event stream used by the live console |

If `PANEL_TOKEN` is set, every `/api/*` call needs the token (header `x-panel-token` or `?token=`).

**Do not expose the panel publicly without `PANEL_TOKEN`.** The panel can pair and restart the bot.

---

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `BOT_NAME` | `CORTANA MINI` | name shown in the menu |
| `PREFIX` | `.` | command prefix |
| `OWNER_NUMBERS` | empty | comma-separated international numbers without `+`; when empty, only messages sent from the bot's own account count as owner |
| `PAIRING_CODE` | `CORTANA2` | fixed 8-character pairing code; hyphens/spaces are stripped, then the code is used as-is |
| `PAIR_PROMPT` | on | `off` disables the terminal pairing prompt (panel-only pairing) |
| `PORT` | `8099` | panel port |
| `PANEL_TOKEN` | empty | protects panel actions |
| `MENU_IMAGE` | empty | optional image URL for the menu |
| `GROQ_API_KEY` / `GROQ_MODEL` | empty / `llama-3.3-70b-versatile` | Groq AI |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | empty / `gpt-4o-mini` | ChatGPT + text-to-speech |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | empty / `deepseek-chat` | DeepSeek |
| `GNEWS_API_KEY` | empty | optional worldwide/tech headlines with images; falls back to BBC World + Engadget RSS without a key |
| `KNIGHTBOT_API_KEY` | `knight` | media backend key; the public default is rate-limited, so set your own for heavy use |
| `RATE_LIMIT_PER_10S` | `8` | command limit per user |
| `MAX_MEDIA_MB` | `48` | downloaded/processed media cap |
| `AI_MEMORY_TURNS` | `8` | conversation turns kept per chat |
| `LOG_LEVEL` | `info` | `debug`, `info`, `silent` |
| `HTML_UI_VARIANT` | `forwarded` | in-chat HTML game wrapper: `forwarded`, `clean`, `bare` |
| `CORTANA_API` | empty | licence service base URL — provided with your copy |
| `LICENCE_KEY` | empty | licence key for this install — provided with your copy |
| `CHANNEL` | `stable` | release channel used by `update` |
| `API_TIMEOUT_MS` | `15000` | timeout for licence requests |
| `CORTANA_HOME` | OS-specific | state folder override (`%LOCALAPPDATA%\CortanaMini` by default) |

---

## Command behavior

### Usage replies

Commands that need arguments or modes answer with a usage card instead of failing silently:

```text
.antilink            → shows kick / warn / off usage
.antilink kick on    → delete + kick
.antilink warn on    → 3 warnings, then kick
.antilink off        → disabled
```

The same pattern applies to `antimention`, `antileft`, `antispam`, `welcome`, `antidelete`, `mode`, `setprefix`, `chatbot`, `hijacknum`, `fast`, `slow`, `tosticker`, `toimg`, `play`, `video`, `lyrics`, `apk`, AI commands and TTS.

### Ping

`.ping` (aliases `.latency`, `.alive`) is listed in the **ALL** section. It replies with:

- online & responding status
- round-trip latency
- process uptime
- RSS memory
- loaded command count
- current time
- `©2026 t.me/techdepro`

### Downloaders

`play` and `video` now mirror the main bot’s display flow:

1. Search YouTube and send the **thumbnail image card** with title, duration, channel and views.
2. Download through **yt-dlp (`youtube-dl-exec`)** first.
3. Fall back to the **KnightBot media API**, then GiftedTech / Maher / Vreden, then `ytdl-core`.
4. Send the audio or video as a separate message.

`npm install` downloads the yt-dlp binary used by `youtube-dl-exec`.

### AI fallback

`cortana`, `deepseek`, `chatgpt` and the chatbot use the configured Groq/OpenAI/DeepSeek key when present. Without a key they fall back to the keyless **Pollinations** OpenAI-compatible endpoint, so the chatbot still answers instead of showing a setup message.

### News

`trending` and `technews` return a picture card plus a short headline list, with branded context:

- `trending` — worldwide breaking/world news. Uses **GNews** when `GNEWS_API_KEY` is set; otherwise BBC World RSS.
- `technews` — technology news. Uses **GNews** when configured; otherwise Engadget RSS, then Wired.
- Each result sends a loading message that is edited into a compact status, then the image card with the lead story, description, source, date, link and four more headlines.
- No API key is required for the RSS fallbacks.

### Status flows

`togroupstatus` posts inside the group, never to the owner's personal status:

- Text gets a rotating `backgroundColor` and font (0–8) so it is not the dark default.
- Media is uploaded once and relayed directly to the group JID with `contextInfo.isGroupStatus` and the correct `GROUP_STATUS` attribution (`type: 5` with `groupStatus.authorJid`).
- The `statusSourceType` matches the media kind, and text statuses keep the rotating background/font.
- This is the route that renders group-status media. WhatsApp also shows the same message in the group chat; that chat entry is the group-status message itself, not a separate copy.
- `status@broadcast` and `groupStatusMessageV2` media routes were tested and either showed on the personal status or failed to render media.

`toallstatus` mirrors the main bot:

1. Reply to media/text with `.toallstatus` — or send `.toallstatus <text>`.
2. The selection card follows immediately: **all groups** or one group.
3. Text uses the same rotating gradient backgrounds; media uses the group-status context.
4. `.toallstatus all` posts everywhere with 1.2s pacing and reports posted/failed counts.

### Games

- `.slot` — 3-reel spin with a jackpot / pair verdict
- `.wheel` — spins a set of options, or numbers when none are given
- `.wheel option1 | option2 | option3` — custom segments
- `.truth` `.dare` — prompt cards
- `.math` — arithmetic challenge with a spoiler answer
- `.tictactoe` — plays in this chat; move with `.tictactoe 5` (1–9)

### Silent reaction commands

- `v2` — reply to a view-once message. The media is sent to the requester's DM. The bot reacts `✅` on success or `❌` on failure and sends no text.
- `vv` — reply to a view-once message. The media is sent in place with a caption.

### Prank commands

- `hackall` — group-only fake "group compromise" sequence.
- `hijacknum <@user|number>` — fake "number hijack" sequence.

Both are intentionally harmless: they only send WhatsApp messages, never touch external systems. They are rate-limited per chat.

### Group guards

`antilink`, `antimention`, `antispam` and `antileft` run on incoming group messages. They need the bot to be a group admin to delete or remove members.

### Welcome

```text
.welcome on
.welcome set 👋 Welcome {name} to *{group}*!
.welcome off
```

---

## File layout

```text
C:\Cortana_Mini\
  start.js                 entry point
  src/
    bot.js                 socket, pairing, routing, anti-delete, reconnect
    panel.js               express panel
    panel.html             panel UI
    config.js              env + paths
    paths.js               app folder vs state folder + one-time state move
    logger.js              branded console + error capture + SSE events
    cache.js               TTL maps, rate limiter, pruning
    store.js               persistent JSON state
    guards.js              group protection
    helpers.js             jid/media/status utilities
    media.js               ffmpeg conversions + uploads
    menu.js                compact text menu
    registry.js            command registry
    commands/              owner, group, downloader, sticker, ai, general, games, pranks
  docs/
    reference.md           this manual
  app.json                 Heroku manifest (worker dyno)
  Procfile                 worker: node start.js
  .env.example             every supported setting
  package.json             dependencies and scripts

%LOCALAPPDATA%\CortanaMini\        state folder, created on first start
  .env                     your settings (wins over an app-folder .env)
  auth\                    WhatsApp session (sensitive, never published)
  data\                    state.json, menu image, temp files
  logs\                    rotating error log
```

---

## Resource management

- TTL caches are capped and pruned every 60 seconds.
- Temporary conversion files older than 15 minutes are deleted every minute.
- `syncFullHistory` is disabled and link previews are off to reduce traffic.
- The AI conversation memory is capped per chat and expires after 20 minutes.
- Error logs rotate at 2 MB.
- The process starts with `--max-old-space-size=512`.
- Shutdown flushes state and closes the socket cleanly.

---

## Deploying on a panel

1. Upload this folder (zip) or connect the repository.
2. Set the startup command: `node start.js` (or `npm start`).
3. Add environment variables from `.env.example`.
4. Open the panel port and pair the number.
5. Keep the state folder across restarts — it holds the session and settings.

Never publish `auth/` or `.env` in a release zip. `.gitignore` already excludes them.

---

## Updating

1. Stop the bot, or press **restart** after the files are replaced.
2. Replace the program files (`start.js`, `src/`, `docs/`, `package.json`, `package-lock.json`).
3. Leave the state folder alone — `%LOCALAPPDATA%\CortanaMini` holds `auth\`, `data\`, `logs\` and `.env`.
4. Run `npm install` if dependencies changed.
5. Start the bot. The panel and the startup banner show the new version.

Older installs that still keep `auth\`, `data\`, `logs\` or `.env` inside this folder are moved to
the state folder on the next start, and `.migrated-from-code-dir` records what was moved. See
[docs/updater-contract.md](docs/updater-contract.md) for the full swap and rollback sequence.

---

## Security notes

- `auth/` in the state folder contains live WhatsApp credentials. Treat it like a password.
- Do not commit `.env`, `auth/`, `data/` or `logs/`.
- This bot uses Baileys, an unofficial WhatsApp client. WhatsApp does not support it and can ban
  the number — run it on a dedicated number, not a personal one.
- Set `PANEL_TOKEN` before exposing the panel.
- API keys belong in `.env`, never in the distributable source.
- Obfuscation does not protect secrets in a self-hosted bot; keep master keys server-side.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pairing code fails | check internet access; wait for `socket ready for pairing-code requests`, then generate again |
| Code expired | press **generate code** again and type the new code immediately |
| `not admin` replies from guards | promote the bot to group admin |
| AI commands reply with setup text | add a provider key to `.env` and restart |
| ffmpeg errors | ensure `ffmpeg-static` installed (`npm install`) |
| Session logged out | panel → logout / re-pair |
