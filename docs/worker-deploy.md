# Worker deploy runbook

Everything below happens once. After it, releases and licences are one command each.

## 0. What the machine needs

- Cloudflare **Account ID** and an **API token** with `Workers Scripts: Edit`, `Workers KV Storage: Edit`,
  `D1: Edit`, `Account Settings: Read`
- `workers.dev` enabled for the account (Workers & Pages → Settings → Subdomain)
- Provider keys for the plan endpoint: `GROQ_API_KEY` required, `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` optional

Secrets go in `worker/.dev.vars` (git-ignored). Never in the repo, never in the bot's `.env` except the licence key.

## 1. Create the database and namespace

```bash
cd worker
npm install

export CLOUDFLARE_API_TOKEN=...        # PowerShell: $env:CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID=...

npx wrangler d1 create cortana-mini     # prints database_id
npx wrangler kv namespace create CACHE  # prints id
```

Paste both ids into [wrangler.toml](wrangler.toml), then apply the schema:

```bash
npm run schema
```

## 2. Set the secrets

```bash
node ../tools/keygen.js secret          # copy the hex into worker/.dev.vars as LICENCE_SECRET
cp .dev.vars.example .dev.vars          # then fill GROQ_API_KEY etc.

npx wrangler secret put LICENCE_SECRET
npx wrangler secret put GROQ_API_KEY
# optional: DEEPSEEK_API_KEY, OPENAI_API_KEY, GNEWS_API_KEY
```

## 3. Deploy

```bash
npm run deploy
```

Note the URL it prints, e.g. `https://cortana-mini-api.<subdomain>.workers.dev`, and check it:

```bash
curl https://cortana-mini-api.<subdomain>.workers.dev/health
# {"ok":true,"service":"cortana-mini-api","channel":"stable",...}
```

## 4. Issue the first licence

```bash
node ../tools/issue-licence.js --note "first pilot" --days 365
```

That prints the licence key and the exact `wrangler d1 execute` line that inserts it. Run it, then put both
values in the client state folder (`%LOCALAPPDATA%\CortanaMini\.env`):

```ini
CORTANA_API=https://cortana-mini-api.<subdomain>.workers.dev
LICENCE_KEY=CM-XXXX-XXXX-XXXX
```

Restart the bot. `ping` should answer and the panel's `/api/status` shows `licence.plan`.

The licence binds to the first device that verifies it (`licences.device_id`). To move a licence, clear that
column in D1 and let the new device claim it.

## 5. Publish a release

```bash
# 1. build the artifact without runtime state
#    include: start.js src/ docs/ package.json package-lock.json .env.example README.md Procfile app.json
#    exclude: node_modules/ auth/ data/ logs/ .env
git archive --format=zip -o cortana-mini-2.4.0.zip HEAD

# 2. measure it
node -e "const c=require('crypto'),f=require('fs');const b=f.readFileSync('cortana-mini-2.4.0.zip');console.log(b.length, c.createHash('sha256').update(b).digest('hex'))"

# 3. write the manifest, sign it, upload the signature with the artifact to GitHub Releases
node ../tools/sign-manifest.js manifest.json ../tools/keys/release-private.pem

# 4. hand the signed manifest to the Worker
npx wrangler kv key put release:manifest:stable --path manifest.signed.json
```

The client only accepts a manifest whose Ed25519 signature verifies against the public key compiled into
[src/release-key.js](../src/release-key.js). Without that key the `update` command reports `no_release_key`
instead of downloading.

## Rotating keys

1. `node tools/keygen.js release` again.
2. Add the new PEM under a new `keyId` in `src/release-key.js`, keeping the old one.
3. Ship a client release that carries both keys.
4. Sign with the new `--key-id=`, then drop the old entry one release later.

## Rollback

`tools/apply-update.js` keeps the previous build at `<app>.old-<version>`. To roll back, stop the bot and
rename the folders back (`Cortana_Mini` → `Cortana_Mini.failed`, `Cortana_Mini.old-<version>` → `Cortana_Mini`).
State is untouched either way, because it lives in the state folder.
