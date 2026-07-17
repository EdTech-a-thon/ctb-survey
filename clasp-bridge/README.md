# edtechathon OAuth broker (Google → clasp)

Authorize a Google account for `clasp` **from the browser**, through one central
service, and deliver the resulting credentials to whichever project asked for
them — via a pluggable hook.

## Why a central broker

Google OAuth "Web application" clients require an **exact** redirect URI to be
pre-registered. Registering one per project subdomain does not scale. Instead,
one broker at `oauth.edtechathon.com` uses **one** client with **one** redirect
URI and serves every `*.edtechathon.com` project. The `state`/`origin` param
remembers which subdomain started each flow.

A Google **refresh token is portable** — not bound to a host or IP — so it is
safe to mint centrally and deliver to a project VM.

## Flow

```
 widget @ ctb-survey.dev.edtechathon.com
   → GET https://oauth.edtechathon.com/oauth/start?origin=ctb-survey.dev.edtechathon.com
   → Google consent  (single fixed redirect_uri)
   → GET https://oauth.edtechathon.com/oauth/callback?code&state
   → broker exchanges code → writes clasp-v3 creds file
   → HOOK <credsFilePath> <originSubdomain>      ← your delivery logic
   → success page (“Back to your project”)
```

## The hook contract

The broker calls:

```
<hook> <credsFilePath> <originSubdomain>
```

- **`credsFilePath`** — a freshly written, `chmod 600` clasp-v3 credentials file:
  ```json
  { "tokens": { "default": {
      "client_id": "...", "client_secret": "...",
      "type": "authorized_user",
      "refresh_token": "...", "access_token": "...", "expiry_date": 0
  } } }
  ```
  It is a temp file; move/consume it.
- **`originSubdomain`** — the host that started the flow, e.g.
  `ctb-survey.dev.edtechathon.com`. Derive the project slug from the first
  label.
- **Exit 0** → user sees “Google connected”. **Non-zero + stderr** → user sees
  the error and the temp file is left for retry.

`hooks/on-authed.sh` is a reference implementation that copies the file to a
destination `~/.clasprc.json` (override with `CLASPRC_DEST`). Replace its
delivery logic (scp to project VM, platform API, secrets manager, etc.).

## Deploy the broker (central host)

1. Create a **Web application** OAuth client in the Google Cloud project; add
   redirect URI **`https://oauth.edtechathon.com/oauth/callback`**. Download the
   JSON to `/opt/oauth-broker/creds.json`.
2. Copy `broker.js` + `hooks/` to `/opt/oauth-broker/`.
3. `nginx-oauth-broker.conf` → serve `oauth.edtechathon.com` → `127.0.0.1:4747`.
4. `oauth-broker.service` → `/etc/systemd/system/`, then
   `systemctl enable --now oauth-broker`.

### Config (env vars)

| var | default | meaning |
|-----|---------|---------|
| `BROKER_PORT` | `4747` | loopback port |
| `BROKER_PUBLIC_ORIGIN` | `https://oauth.edtechathon.com` | must match redirect URI host |
| `BROKER_ALLOWED_SUFFIXES` | `.edtechathon.com` | comma-separated allow-list |
| `BROKER_CREDS` | `~/.config/clasp-agent/creds.json` | OAuth client JSON |
| `BROKER_HOOK` | `hooks/on-authed.sh` | delivery hook |
| `BROKER_OUT_DIR` | `/tmp/oauth-broker` | scratch dir for creds files |

## Widget

The project-nav widget shows a **“Connect Google (clasp)”** row on the `dev`
(“Edit”) service that links to
`https://oauth.edtechathon.com/oauth/start?origin=<current host>`.

## Files

- `broker.js` — the central broker (zero deps, Node 22).
- `hooks/on-authed.sh` — reference delivery hook.
- `oauth-broker.service` — systemd unit for the central host.
- `nginx-oauth-broker.conf` — nginx server block for `oauth.edtechathon.com`.
- `server.js` — earlier single-VM "bridge" (superseded by `broker.js`; kept for
  reference).
