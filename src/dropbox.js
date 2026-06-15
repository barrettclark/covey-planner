// ─── Dropbox PKCE OAuth and file sync ────────────────────────────────────────

const DBX_APP_KEY    = import.meta.env.VITE_DROPBOX_APP_KEY;
const DBX_FILE_PATH  = "/Apps/Obsidian/v1/todo.todotxt";
const DBX_REDIRECT   = window.location.origin + window.location.pathname;
const DBX_AUTH_URL   = "https://www.dropbox.com/oauth2/authorize";
const DBX_TOKEN_URL  = "https://api.dropboxapi.com/oauth2/token";
const DBX_UPLOAD_URL   = "https://content.dropboxapi.com/2/files/upload";
const DBX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const DBX_LIST_URL     = "https://api.dropboxapi.com/2/files/list_folder";
const DBX_LONGPOLL_URL = "https://notify.dropboxapi.com/2/files/list_folder/longpoll";

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest   = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

export async function startDropboxAuth() {
  const { verifier, challenge } = await pkceChallenge();
  sessionStorage.setItem("dbx_verifier", verifier);
  const params = new URLSearchParams({
    client_id: DBX_APP_KEY, response_type: "code", redirect_uri: DBX_REDIRECT,
    code_challenge: challenge, code_challenge_method: "S256", token_access_type: "offline",
  });
  window.location.href = `${DBX_AUTH_URL}?${params}`;
}

export async function exchangeCode(code) {
  const verifier = sessionStorage.getItem("dbx_verifier");
  sessionStorage.removeItem("dbx_verifier");
  const res = await fetch(DBX_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code",
      client_id: DBX_APP_KEY, redirect_uri: DBX_REDIRECT, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function refreshToken(refresh_token) {
  const res = await fetch(DBX_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id: DBX_APP_KEY }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function loadTokens() {
  try { return JSON.parse(localStorage.getItem("dbx_tokens") || "null"); } catch { return null; }
}

export function saveTokens(tokens) {
  localStorage.setItem("dbx_tokens", JSON.stringify(tokens));
}

export async function getAccessToken() {
  let tokens = loadTokens();
  if (!tokens) return null;
  if (tokens.expires_at && Date.now() > tokens.expires_at - 60000) {
    try {
      const fresh = await refreshToken(tokens.refresh_token);
      tokens = { ...tokens, access_token: fresh.access_token,
        expires_at: Date.now() + (fresh.expires_in || 14400) * 1000 };
      saveTokens(tokens);
    } catch { return null; }
  }
  return tokens.access_token;
}

export async function dbxGetCursor(accessToken) {
  const folder = DBX_FILE_PATH.split("/").slice(0, -1).join("/") || "";
  const res = await fetch(DBX_LIST_URL + "/get_latest_cursor", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: folder, recursive: false }),
  });
  if (!res.ok) throw new Error(`cursor failed: ${res.status}`);
  const data = await res.json();
  return data.cursor;
}

export async function dbxLongpoll(cursor) {
  const res = await fetch(DBX_LONGPOLL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cursor, timeout: 30 }),
  });
  if (!res.ok) throw new Error(`longpoll failed: ${res.status}`);
  return res.json();
}

export async function dbxDownload(accessToken) {
  const res = await fetch(DBX_DOWNLOAD_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: DBX_FILE_PATH }) },
  });
  if (!res.ok) throw new Error(`Dropbox download failed: ${res.status}`);
  // The file revision is returned in the Dropbox-API-Result response header.
  let rev = null;
  try {
    const meta = JSON.parse(res.headers.get("Dropbox-API-Result") || "{}");
    rev = meta.rev || null;
  } catch {}
  const text = await res.text();
  return { text, rev };
}

// Upload a file to Dropbox.
//
// If `rev` is provided the upload uses mode:'update' — Dropbox will return
// HTTP 409 if the file was modified since that rev was fetched.  Pass null to
// fall back to the old mode:'overwrite' behaviour (first upload after connect).
//
// Returns { result: <Dropbox metadata>, rev: <new rev string> }.
// Throws a `DropboxConflictError` on HTTP 409 so callers can merge and retry.

export class DropboxConflictError extends Error {
  constructor() { super("Dropbox conflict: file was modified by another client"); this.name = "DropboxConflictError"; }
}

export async function dbxUpload(accessToken, content, rev = null) {
  const mode = rev
    ? { ".tag": "update", update: rev }
    : { ".tag": "overwrite" };

  const res = await fetch(DBX_UPLOAD_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: DBX_FILE_PATH, mode, autorename: false, mute: true }),
      "Content-Type": "application/octet-stream",
    },
    body: content,
  });

  if (res.status === 409) throw new DropboxConflictError();
  if (!res.ok) throw new Error(`Dropbox upload failed: ${res.status}`);

  const result = await res.json();
  return { result, rev: result.rev || null };
}
