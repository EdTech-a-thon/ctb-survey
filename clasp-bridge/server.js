// clasp-bridge: a tiny OAuth bridge that lets you authorize clasp from the
// browser (via the project-nav widget) instead of pasting codes in a terminal.
//
// Flow:
//   GET /clasp/oauth/start    -> redirect to Google's consent screen
//   GET /clasp/oauth/callback -> exchange the code for tokens, then write them
//                                into ~/.clasprc.json in the exact shape clasp
//                                v3 expects. After this, `clasp` "just works".
//   GET /clasp/status         -> JSON: is clasp currently authorized?
//
// No external dependencies (Node 22 has global fetch). See AGENTS.md.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// --- config -----------------------------------------------------------------

const PORT = Number(process.env.BRIDGE_PORT || 4747);

// Public origin where Google sends the browser back. Must EXACTLY match one of
// the "Authorized redirect URIs" registered on the OAuth client in Cloud
// Console. Override with BRIDGE_PUBLIC_ORIGIN if your host differs.
const PUBLIC_ORIGIN =
  process.env.BRIDGE_PUBLIC_ORIGIN || "https://ctb-survey.dev.edtechathon.com";
const REDIRECT_URI = `${PUBLIC_ORIGIN}/clasp/oauth/callback`;

// OAuth client (the "Web application" creds you downloaded from Cloud Console).
const CREDS_PATH =
  process.env.BRIDGE_CREDS ||
  path.join(os.homedir(), ".config", "clasp-agent", "creds.json");

// Where clasp reads its credentials.
const CLASPRC_PATH =
  process.env.CLASPRC || path.join(os.homedir(), ".clasprc.json");

// The exact scopes clasp v3 requests (hardcoded in clasp's auth.js). We must
// request the same set so the resulting token works for every clasp command.
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

// Pending login states: state -> expiry. Guards against CSRF / stray callbacks.
const pendingStates = new Map();
function newState() {
  const s = crypto.randomBytes(24).toString("hex");
  pendingStates.set(s, Date.now() + 10 * 60 * 1000); // valid 10 minutes
  return s;
}
function consumeState(s) {
  const exp = pendingStates.get(s);
  pendingStates.delete(s);
  return exp && exp > Date.now();
}

function readClasprc() {
  try {
    return JSON.parse(fs.readFileSync(CLASPRC_PATH, "utf8"));
  } catch {
    return { tokens: {} };
  }
}

// Write credentials in clasp v3's StoredCredential shape:
//   { tokens: { default: { type: "authorized_user", client_id, client_secret,
//                          refresh_token, access_token, expiry_date } } }
function writeClasprc(client, tokens) {
  const store = readClasprc();
  if (!store.tokens) store.tokens = {};
  store.tokens.default = {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    type: "authorized_user",
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
  };
  fs.writeFileSync(CLASPRC_PATH, JSON.stringify(store, null, 2));
  fs.chmodSync(CLASPRC_PATH, 0o600);
}

function html(res, code, body) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.25rem;color:#122126}h1{font-size:1.3rem}.ok{color:#2e5705}.err{color:#a11}.card{border:1px solid #81acbb;border-bottom-width:4px;border-radius:10px;padding:1.25rem 1.5rem;background:#fffdf8}code{background:#eef;padding:.1em .35em;border-radius:4px}</style>${body}`);
}

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

// --- routes -----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_ORIGIN);

  // Health/status: does clasp have a usable token?
  if (url.pathname === "/clasp/status") {
    const store = readClasprc();
    const cred = store.tokens && store.tokens.default;
    return json(res, 200, {
      authorized: Boolean(cred && cred.refresh_token),
    });
  }

  // Step 1: kick off consent.
  if (url.pathname === "/clasp/oauth/start") {
    let client;
    try {
      client = loadOAuthClient();
    } catch (e) {
      return html(res, 500, `<div class=card><h1 class=err>Setup error</h1><p>${e.message}</p></div>`);
    }
    const state = newState();
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", client.clientId);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent"); // force refresh_token every time
    authUrl.searchParams.set("state", state);
    res.writeHead(302, { location: authUrl.toString() });
    return res.end();
  }

  // Step 2: Google redirects here with ?code & ?state.
  if (url.pathname === "/clasp/oauth/callback") {
    const err = url.searchParams.get("error");
    if (err) {
      return html(res, 400, `<div class=card><h1 class=err>Authorization declined</h1><p><code>${err}</code></p></div>`);
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !consumeState(state)) {
      return html(res, 400, `<div class=card><h1 class=err>Invalid or expired request</h1><p>Please start again from the widget.</p></div>`);
    }

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
        return html(res, 502, `<div class=card><h1 class=err>No refresh token returned</h1><p>Revoke this app's access at <a href="https://myaccount.google.com/permissions">Google permissions</a> and try again (Google only issues a refresh token on first consent).</p></div>`);
      }
      const expiry_date = tok.expires_in
        ? Date.now() + tok.expires_in * 1000
        : undefined;
      writeClasprc(client, {
        refresh_token: tok.refresh_token,
        access_token: tok.access_token,
        expiry_date,
      });
      return html(res, 200, `<div class=card><h1 class=ok>\u2705 clasp is now connected</h1><p>Your Google account is linked. The agent can now create, push, deploy, and run Apps Script projects.</p><p>You can close this tab.</p></div>`);
    } catch (e) {
      return html(res, 500, `<div class=card><h1 class=err>Unexpected error</h1><p>${e.message}</p></div>`);
    }
  }

  // Fallback: a minimal landing page.
  if (url.pathname === "/clasp" || url.pathname === "/clasp/") {
    return html(res, 200, `<div class=card><h1>Connect Google for clasp</h1><p><a href="/clasp/oauth/start">Start authorization \u2192</a></p></div>`);
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`clasp-bridge listening on 127.0.0.1:${PORT}`);
  console.log(`  redirect_uri = ${REDIRECT_URI}`);
  console.log(`  creds        = ${CREDS_PATH}`);
  console.log(`  clasprc      = ${CLASPRC_PATH}`);
});
