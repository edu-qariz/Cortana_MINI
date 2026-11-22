# Updater contract (Phase 0)

The client ships as an **app folder** that can be replaced wholesale and a **state folder**
that is never touched by an update. Everything below follows from that one rule.

## 1. Two directories, two owners

| | App folder (`paths.root`) | State folder (`paths.home`) |
|---|---|---|
| Owner | the release pipeline | the running bot |
| Contents | `start.js`, `src/`, `package.json`, `package-lock.json`, `.env.example`, `README.md`, `docs/` | `auth/`, `data/`, `logs/`, `.env`, `update/`, `.migrated-from-code-dir` |
| Written by bot | never | always |
| Replaced by update | entirely | never |

`paths.home` resolution (`src/paths.js`):

1. `CORTANA_HOME` if set (absolute, or resolved against the current working directory)
2. `%LOCALAPPDATA%\CortanaMini` on Windows
3. `~/.cortana-mini` everywhere else

`%LOCALAPPDATA%` is deliberately chosen over `%APPDATA%`: Roaming profiles and OneDrive Known
Folder Move replicate `%APPDATA%`, which would copy live WhatsApp credentials and the licence
token to other machines and break device binding.

Legacy installs that still keep `auth/`, `data/`, `logs/` or `.env` inside the app folder are
migrated once at startup by `migrateFromCodeDir()`: entries are **moved** (rename, falling back
to copy+delete across volumes) and a `.migrated-from-code-dir` marker is written in the state
folder. An entry is left in place, with a startup warning, when the destination already exists.

The bot must never add a new write target inside the app folder. Anything that writes state and
is not listed above is a bug against this contract.

## 2. Manifest

Served by the Worker (`GET /v1/release/manifest?channel=<channel>`), cached client-side in
`<home>/update/manifest.json`. The artifact itself is **not** served by the Worker; it comes from
GitHub Releases, because Workers caps subrequests at 50 per request and the free plan is not a CDN.

```json
{
  "schema": 1,
  "version": "2.4.0",
  "channel": "stable",
  "minClient": "2.3.0",
  "publishedAt": "2026-12-01T09:00:00Z",
  "notes": "one-line changelog shown in the panel",
  "artifact": {
    "url": "https://github.com/<org>/<repo>/releases/download/v2.4.0/cortana-mini-2.4.0.zip",
    "size": 1832491,
    "sha256": "9f1c...64 hex chars...",
    "files": 42
  },
  "deps": { "changed": true, "lockHash": "sha256 of package-lock.json" },
  "signature": { "alg": "ed25519", "keyId": "release-2026", "value": "base64 detached signature" }
}
```

Rules:

- `version` is semver and must differ from `config.version`; the client refuses to "update" to
  its own version.
- `minClient` is the oldest client allowed to jump straight to this version. Below it, the client
  reports "manual reinstall required" instead of updating.
- `deps.changed` decides whether `npm ci` runs after the swap.
- Unknown top-level keys are ignored, so the schema can grow.

## 3. Signature

**Ed25519, detached, over a canonical JSON encoding of the manifest without the `signature` key.**

- Canonical form: keys sorted recursively, no insignificant whitespace, UTF-8 bytes. `JSON.stringify`
  with a sorted-key replacer is enough; the exact bytes are what get signed, so the canonicalisation
  helper ships with the release tooling.
- Signing happens **off the client only** — a maintainer machine or CI, with the private key in a
  CI secret. The Worker holds no private key and only serves bytes; it never needs to sign or
  verify.
- Clients verify with Node's built in `crypto.verify(null, bytes, publicKey, signature)`, with the
  public key compiled into `src/release-key.js`. Verification needs no dependency and works on
  Node 20 with no flags.
- `keyId` allows a key rotation window: the client may carry the current and the next public key.
- A manifest that fails verification is treated as no manifest. Signature failure is never
  downgraded to a warning.

Verification order in the client: TLS → `schema === 1` → signature → `version > config.version` →
`minClient <= config.version` → artifact size/hash. Never download the artifact before the
signature and metadata checks pass.

## 4. Artifact

- A `.zip` of the app folder contents **without** `node_modules/`, `auth/`, `data/`, `logs/`,
  `.env`, or any `*-watch.html` scratch file. Release archives carry program files only.
- Downloaded to `<home>/update/<version>.zip`, verified against `artifact.size` and
  `artifact.sha256` before anything is extracted.
- Extracted to `<app>.update-staging` — a **sibling** of the app folder, not inside it and not
  inside the state folder. The final activation is a directory rename, and a rename across volumes
  fails with `EXDEV`; keeping the staging folder on the same volume as the app folder is what makes
  the swap atomic.

## 5. Swap sequence

1. **Refuse to start** if `<home>/data/instance.lock` holds a live PID or `/health` answers on
   `PORT`. A running bot holds file handles and `rename()` on Windows fails with `EPERM`/`EBUSY`.
2. Fetch manifest, verify (§3), decide.
3. Download artifact, verify size + sha256.
4. Extract to `<app>.update-staging`; delete any `auth/`, `data/`, `logs/`, `.env` that slipped in.
5. Smoke test inside the staging folder with a throwaway home so the real state is untouched:
   `node --check start.js`, then `CORTANA_HOME=<staging>/smoke node -e "require('./src/config')"`.
   Drop the `smoke` folder afterwards.
6. Activate: `rename(<app>, <app>.old-<version>)`, then `rename(<app>.update-staging, <app>)`.
7. If `deps.changed`, run `npm ci --omit=dev` inside the new app folder. Failure → rollback.
8. Restart through the supervisor (`npm start` / panel restart), wait for `/health` to return
   `ok: true`, then keep `<app>.old-<version>` for at least one successful boot.
9. Delete `<app>.old-<version>`, the staged zip and the staging folder.

Rollback = rename `<app>` → `<app>.failed-<version>` and `<app>.old-<version>` → `<app>`, then
restart. Rollback must work with the network down, so the old folder is kept on disk until the new
one has booted.

## 6. Failure modes to handle explicitly

| Failure | Handling |
|---|---|
| Bot running during update | refuse; report "restart me from the panel first" |
| `EPERM`/`EBUSY` on rename (AV, open handle) | 3 retries with 500 ms backoff, then abort with the folder untouched |
| `EXDEV` | staging must be a sibling of the app folder; if it still occurs, abort |
| Corrupt or truncated download | hash mismatch → delete, abort, no state written |
| Bad signature | abort, keep the cached manifest, surface a panel warning |
| `npm ci` fails | rollback to `<app>.old-<version>` |
| Process killed mid-swap | on boot, if `<app>` is missing but `<app>.old-*` exists, restore the newest one |
| Update to a version requiring newer state schema | never migrate state backwards; refuse downgrade |

## 7. What the updater must never do

- Delete or rewrite anything under `paths.home`.
- Write into the app folder before activation.
- Activate an artifact that has not passed signature and hash checks.
- Leave two public folders behind: exactly one of `<app>`, `<app>.old-*` is live at a time.
- Touch `node_modules/` of the currently running app while it is running.

## 8. Not in Phase 0

Delta updates, multiple channels installed side by side, self-update while the bot is connected,
and licence/entitlement gating of the manifest (the Worker adds an entitlement check to
`GET /v1/release/manifest` before the first paid release).
