// oauth-broker: a CENTRAL OAuth broker meant to run behind
// https://oauth.edtechathon.com. It authorizes a Google account ONCE, using a
// single fixed redirect URI, on behalf of any project subdomain. When done it
// invokes a delivery HOOK, handing off (credsFilePath, originSubdomain) so the
// platform can route the credentials to the right place (e.g. a project VM's
// ~/.clasprc.json). The broker itself stays generic and clasp-agnostic.
//
// Routes:
//   GET /oauth/start?origin=<subdomain>  -> 302 to Google consent
//   GET /oauth/callback?code&state       -> exchange, write file, run hook
//   GET /healthz                         -> 200 ok
//
// Design notes:
//   * ONE Google "Web application" client, ONE redirect URI:
//       https://oauth.edtechathon.com/oauth/callback
//     works for every *.edtechathon.com project. `state` carries the origin.
//   * A Google refresh_token is portable (not bound to host/IP), so it is safe
//     to mint here and deliver elsewhere.
//   * The origin is allow-listed to *.edtechathon.com so this can't be abused
//     as an open redirector / token-exfil endpoint.
//
// No external dependencies (Node 22 global fetch). See AGENTS.md.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

// --- config -----------------------------------------------------------------

const PORT = Number(process.env.BROKER_PORT || 4747);

// Public origin Google redirects back to. Must EXACTLY match the redirect URI
// registered on the OAuth client.
const PUBLIC_ORIGIN =
  process.env.BROKER_PUBLIC_ORIGIN || "https://oauth.edtechathon.com";
const REDIRECT_URI = `${PUBLIC_ORIGIN}/oauth/callback`;

// Which origin subdomains are allowed to request authorization. Comma-separated
// list of suffixes. Anything not ending in one of these is rejected.
const ALLOWED_ORIGIN_SUFFIXES = (
  process.env.BROKER_ALLOWED_SUFFIXES || ".edtechathon.com"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// OAuth client ("Web application" creds downloaded from Cloud Console).
const CREDS_PATH =
  process.env.BROKER_CREDS ||
  path.join(os.homedir(), ".config", "clasp-agent", "creds.json");

// Delivery hook. Invoked as:  HOOK_CMD <credsFilePath> <originSubdomain>
// It is responsible for getting the credentials file to the right place.
const HOOK_CMD =
  process.env.BROKER_HOOK ||
  path.join(path.dirname(new URL(import.meta.url).pathname), "hooks", "on-authed.sh");

// Where the broker writes the freshly-minted credentials before calling the
// hook. One temp file per login; the hook may move/consume it.
const OUT_DIR = process.env.BROKER_OUT_DIR || "/tmp/oauth-broker";

// The exact scopes clasp v3 requests. Requesting the same set means the
// delivered token works for every clasp command.
const SCOPES = [
  "https://www.googleapis.com/auth/script.deployments",
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.webapp.deploy",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/service.management",
  "https://www.googleapis.com/auth/logging.read",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cloud-platform",
];

// --- helpers ----------------------------------------------------------------

function loadOAuthClient() {
  const raw = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8"));
  const c = raw.web || raw.installed;
  if (!c || !c.client_id || !c.client_secret) {
    throw new Error(`No web/installed client in ${CREDS_PATH}`);
  }
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

function originAllowed(origin) {
  if (!origin) return false;
  // origin is a bare host like "ctb-survey.dev.edtechathon.com"
  if (!/^[a-z0-9.-]+$/i.test(origin)) return false;
  return ALLOWED_ORIGIN_SUFFIXES.some((suf) => origin.endsWith(suf));
}

// Pending logins: state -> { origin, expiry }. Guards CSRF / stray callbacks.
const pending = new Map();
function newState(origin) {
  const s = crypto.randomBytes(24).toString("hex");
  pending.set(s, { origin, expiry: Date.now() + 10 * 60 * 1000 });
  return s;
}
function consumeState(s) {
  const rec = pending.get(s);
  pending.delete(s);
  if (!rec || rec.expiry < Date.now()) return null;
  return rec;
}

// Build a clasp v3 StoredCredential file: the exact shape clasp reads from
// ~/.clasprc.json. The hook decides where it ultimately lands.
function writeCredsFile(client, tokens) {
  fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(OUT_DIR, `clasprc-${crypto.randomBytes(8).toString("hex")}.json`);
  const body = {
    tokens: {
      default: {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        type: "authorized_user",
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        expiry_date: tokens.expiry_date,
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2), { mode: 0o600 });
  return file;
}

function runHook(credsFile, origin) {
  return new Promise((resolve) => {
    execFile(HOOK_CMD, [credsFile, origin], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[hook] FAILED for ${origin}:`, err.message);
        if (stderr) console.error(`[hook] stderr:`, stderr.trim());
        return resolve({ ok: false, error: err.message, stderr });
      }
      console.log(`[hook] ok for ${origin}${stdout ? ": " + stdout.trim() : ""}`);
      resolve({ ok: true, stdout });
    });
  });
}

function html(res, code, body) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Connect Google</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.25rem;color:#122126}h1{font-size:1.3rem}.ok{color:#2e5705}.err{color:#a11}.card{border:1px solid #81acbb;border-bottom-width:4px;border-radius:10px;padding:1.25rem 1.5rem;background:#fffdf8}code{background:#eef;padding:.1em .35em;border-radius:4px}a.btn{display:inline-block;margin-top:.5rem}</style>${body}`);
}

// --- routes -----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_ORIGIN);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  // Step 1: begin consent on behalf of an origin subdomain.
  if (url.pathname === "/oauth/start") {
    // Prefer explicit ?origin=, fall back to the Referer host.
    let origin = url.searchParams.get("origin");
    if (!origin && req.headers.referer) {
      try {
        origin = new URL(req.headers.referer).host;
      } catch {}
    }
    if (!originAllowed(origin)) {
      return html(res, 400, `<div class=card><h1 class=err>Unrecognized origin</h1><p>This broker only authorizes <code>*.edtechathon.com</code> projects. Got: <code>${origin || "(none)"}</code></p></div>`);
    }
    let client;
    try {
      client = loadOAuthClient();
    } catch (e) {
      return html(res, 500, `<div class=card><h1 class=err>Setup error</h1><p>${e.message}</p></div>`);
    }
    const state = newState(origin);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", client.clientId);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent"); // always return a refresh_token
    authUrl.searchParams.set("state", state);
    res.writeHead(302, { location: authUrl.toString() });
    return res.end();
  }

  // Step 2: Google redirects here with ?code & ?state.
  if (url.pathname === "/oauth/callback") {
    const err = url.searchParams.get("error");
    if (err) {
      return html(res, 400, `<div class=card><h1 class=err>Authorization declined</h1><p><code>${err}</code></p></div>`);
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const rec = state && consumeState(state);
    if (!code || !rec) {
      return html(res, 400, `<div class=card><h1 class=err>Invalid or expired request</h1><p>Please start again from the widget.</p></div>`);
    }
    const origin = rec.origin;

    let client;
    try {
      client = loadOAuthClient();
    } catch (e) {
      return html(res, 500, `<div class=card><h1 class=err>Setup error</h1><p>${e.message}</p></div>`);
    }

    try {
      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: client.clientId,
          client_secret: client.clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      const tok = await resp.json();
      if (!resp.ok) {
        return html(res, 502, `<div class=card><h1 class=err>Token exchange failed</h1><p><code>${tok.error || resp.status}</code>: ${tok.error_description || ""}</p></div>`);
      }
      if (!tok.refresh_token) {
        return html(res, 502, `<div class=card><h1 class=err>No refresh token returned</h1><p>Revoke access at <a href="https://myaccount.google.com/permissions">Google permissions</a> and try again.</p></div>`);
      }
      const expiry_date = tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined;
      const credsFile = writeCredsFile(client, {
        refresh_token: tok.refresh_token,
        access_token: tok.access_token,
        expiry_date,
      });

      const hookResult = await runHook(credsFile, origin);
      if (!hookResult.ok) {
        return html(res, 500, `<div class=card><h1 class=err>Authorized, but delivery failed</h1><p>The Google authorization succeeded, but the delivery hook errored:</p><p><code>${(hookResult.error || "").slice(0, 300)}</code></p></div>`);
      }

      const back = `https://${origin}/`;
      return html(res, 200, `<div class=card><h1 class=ok>\u2705 Google connected</h1><p><b>${origin}</b> is now linked. The agent can create, push, deploy, and run Apps Script projects.</p><p><a class=btn href="${back}">\u2190 Back to your project</a></p></div>`);
    } catch (e) {
      return html(res, 500, `<div class=card><h1 class=err>Unexpected error</h1><p>${e.message}</p></div>`);
    }
  }

  if (url.pathname === "/" || url.pathname === "/oauth") {
    return html(res, 200, `<div class=card><h1>edtechathon Google OAuth broker</h1><p>Start authorization from your project's widget.</p></div>`);
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`oauth-broker listening on 127.0.0.1:${PORT}`);
  console.log(`  public origin = ${PUBLIC_ORIGIN}`);
  console.log(`  redirect_uri  = ${REDIRECT_URI}`);
  console.log(`  creds         = ${CREDS_PATH}`);
  console.log(`  hook          = ${HOOK_CMD}`);
  console.log(`  allowed       = ${ALLOWED_ORIGIN_SUFFIXES.join(", ")}`);
});
