# Command primitive spec (Phase 0)

The Worker decides **what** to send; the client decides **how** to touch WhatsApp. Every command
plan is expressed with the twelve primitives below, so adding or editing a command is a Worker
deploy rather than a client release.

## 1. What runs where

**Server-side steps** (Worker, no primitive): AI provider calls with pooled keys, licence and
quota checks, menu text, static copy, HTML game payloads from KV, random flips for games,
news/advice text assembly.

**Client primitives** (this document): anything that needs the WhatsApp socket, the local
filesystem, ffmpeg, or the process itself.

**Guards are not primitives.** `antilink`, `antimention`, `antispam`, `antileft`, `antidelete`,
`welcome` and `chatbot` are evaluated on-device against every inbound message *before* a plan is
requested. A plan can never bypass a guard.

## 2. Plan envelope

```json
{
  "schema": 1,
  "planId": "uuid",
  "messageId": "inbound WA message id",
  "expiresAt": "2026-12-01T09:00:30Z",
  "steps": [
    { "id": "s1", "use": "react", "args": { "emoji": "🌸" } },
    { "id": "s2", "use": "say", "args": { "text": "…" } }
  ]
}
```

- Steps run in order, sequentially. A step may read earlier output with `{{s1.body}}`.
- `expiresAt` is absolute; the client drops the plan if it is already past.
- Default step budget is 8; the client rejects longer plans.
- A plan is charged **one** quota unit, not one per step.
- Re-delivered plans with the same `planId` are executed once; the client keeps a short-lived set
  of seen ids.
- The client refuses any `media`/`recall` argument that resolves outside `paths.home` (`..`,
  absolute paths elsewhere, UNC paths).

## 3. The twelve primitives

### 3.1 `say` — text reply

```json
{ "text": "…", "replyTo": "optional message id", "mentions": ["…@s.whatsapp.net"], "trim": 4096 }
```

Falls back to plain text when the reply target no longer exists.

### 3.2 `react` — reaction only

```json
{ "emoji": "🏓", "target": "optional message id, defaults to the inbound one" }
```

### 3.3 `media` — media message

```json
{
  "kind": "image|video|audio|document|sticker",
  "source": { "url": "https://…" } ,
  "caption": "optional",
  "mimetype": "optional override",
  "fileName": "optional",
  "maxBytes": 50331648
}
```

`source` is exactly one of `{ "url" }`, `{ "path" }` (must resolve under `paths.home`), or
`{ "step": "s1" }` (a `http`/`transform` buffer from the same plan). Enforces
`config.maxMediaBytes`.

### 3.4 `http` — outbound request

```json
{
  "method": "GET",
  "url": "https://…",
  "headers": { "optional": "object" },
  "body": "optional string",
  "timeoutMs": 15000,
  "expect": "json|text|buffer",
  "pick": ["optional", "dot", "paths"],
  "saveAs": "optional path under paths.home"
}
```

Runs on the client so downloads do not consume Worker request budget. `pick` reduces the response
to the fields the next step needs, which keeps memory flat. `saveAs` is how multi-MB media lands
in `paths.home/data/tmp` before a `media` step references it.

### 3.5 `prompt` — await a user reply

```json
{
  "expect": "text|number|choice",
  "choices": ["optional"],
  "ttlMs": 60000,
  "onReply": [ { "id": "p1", "use": "say", "args": { "text": "…" } } ],
  "onTimeout": [ ]
}
```

Used where state spans two messages (`math` answers, `tictactoe` moves, pairing). The pending prompt
is stored in `paths.home/data/state.json`, one per chat, and cleared on match, timeout or cancel.

### 3.6 `query` — read WhatsApp metadata

```json
{ "what": "group|participants|profilePic|messageMedia|contact", "jid": "…", "messageId": "optional" }
```

`messageMedia` is how `vv`, `v2` and `antidelete` obtain the original payload (including view-once
media) before re-sending it with `media`.

### 3.7 `mutate` — WhatsApp mutation

```json
{ "op": "kick|add|promote|demote|subject|description|picture|inviteReset|poll|tag|status|presence", "…": "op-specific fields" }
```

Admin-gated ops fail with a structured `not_admin` error the Worker can turn into a friendly reply.
`tag` covers `tagall`, `tagadmins` and `hidetag` through `mentionAll`/`mentionAdmins` flags.
`status` covers `tomystatus`, `toallstatus` and `togroupstatus`.

### 3.8 `transform` — local media processing

```json
{ "from": { "step": "s1" }, "to": "sticker|image|audio|video", "options": { "duration": 6, "fps": 12, "quality": 60 } }
```

Backed by the existing `ffmpeg-static` path in `src/media.js`. Output is a buffer reference usable
by `media`, discarded when the plan ends.

### 3.9 `remember` — persistent write

```json
{ "scope": "settings|chat|contact|stats|prompt", "key": "prefix", "value": "!", "jid": "optional chat" }
```

Goes through `store.js` so debounced saves, the 5000-chat cap and the 5000-contact cap stay in
force. Never writes outside `paths.home`.

### 3.10 `recall` — persistent read

```json
{ "scope": "settings|chat|contact|stats|prompt", "key": "optional", "jid": "optional chat" }
```

### 3.11 `runtime` — process control and metrics

```json
{ "op": "metrics|restart" }
```

`metrics` returns uptime, RSS, latency, connection state, version and counters for `ping`.
`restart` is the only op that may exit, and only when the plan's `messageId` belongs to an owner.

### 3.12 `schedule` — deferred follow-up

```json
{ "inMs": 5000, "cancelKey": "optional", "steps": [ ] }
```

Cancellable, capped at 30 minutes, at most 16 outstanding per chat. Used by anti-delete notices,
anti-leave messages and prank sequences. `update` (Phase 2) is a `runtime` op backed by the
updater contract, not a scheduled step.

## 4. Command coverage

Every registered command maps to primitives only — nothing needs a new primitive.

| Command(s) | Primitives |
|---|---|
| `menu`, `usage` | `media` (local menu image) / `say` |
| `ping` | `runtime{metrics}`, `say` |
| `cortana`, `deepseek`, `chatgpt` | `recall`+`remember` (chat memory), `say`; the provider call is a server step |
| `play`, `video` | `http` (search + fetch), `transform` (mux), `media` |
| `waifu` | `http`, `media` |
| `lyrics`, `apk` | `http`, `say` (list results) |
| `slot`, `wheel`, `truth`, `dare` | `say`, `react`; the random pick is a server step |
| `tictactoe` | `say`, `prompt`, `remember` |
| `math` | `prompt`, `say` |
| `advise`, `technews`, `trending` | `http`, `say`, optional `media` (headline image) |
| `talknow`, `robot` | `http` (TTS), `transform`, `media` (voice note) |
| `kiss`, `gaycheck`, `fast`, `slow` | `say`, optional `media` |
| `antilink`, `antimention`, `antispam`, `antileft`, `welcome`, `chatbot`, `antidelete` | `remember` (toggle + text), `say` (confirmation) |
| `setdesc`, `setgp` | `mutate{description|picture}`, `say` |
| `hidetag`, `tagall`, `tagadmins` | `query{participants}`, `mutate{tag}` |
| `groupid`, `link` | `query{group}`, `say` / `mutate{inviteReset}` |
| `poll`, `togroupstatus`, `tomystatus`, `toallstatus` | `mutate`, `say` |
| `mode`, `botname`, `setprefix`, `downloadstatus` | `remember`, `say` |
| `setimage`, `menuimage` | `http`/`media` → `remember`, `media` (preview) |
| `getdp`, `getpp` | `query{profilePic}`, `media` |
| `tourl` | `http` (upload), `say` |
| `restart` | `runtime{restart}` (owner only) |
| `update` | `runtime{update}` via the updater contract |
| `vv`, `v2` | `query{messageMedia}`, `media`, `react` |
| `hackall`, `hijacknum` | `schedule` + `say` (theatre only, no network) |
| `tosticker`, `toimg` | `transform`, `media` |

## 5. Failure semantics

| Client failure | Plan effect |
|---|---|
| step error, `onError` absent | abort remaining steps; the Worker's fallback line is sent only if no step already sent something |
| `not_admin`, `not_group`, `missing_media` | structured error code, plan aborts; Worker maps it to usage text |
| step timeout (per-step default 20 s) | treated as an error; temp files from the plan are cleaned |
| plan expired | discarded silently; no reply |
| licence/quota rejection | no plan is ever built; the client shows the "not licensed" reply |

Logging: one line per plan (`planId`, command, step count, ms, outcome) via `logger.command()`,
so the panel's SSE stream shows plans without exposing provider names or keys.
