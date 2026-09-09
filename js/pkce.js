// Spotify Authorization Code + PKCE flow, browser edition.
//
// Ported from src/main/oauth.js. The pure math (verifier/challenge, state,
// buildAuthUrl) is unchanged in spirit but uses the Web Crypto API
// (crypto.getRandomValues / crypto.subtle.digest) instead of Node's
// `crypto` module. The loopback HTTP server (waitForRedirect) is gone
// entirely — a PWA has no way to listen on a port, and doesn't need one:
// Spotify redirects straight back to this same page's own HTTPS URL, and
// app.js reads `code`/`state` off the URL on load. See app.js's
// completeLoginIfRedirected().
//
// Scopes trimmed to only what this app uses (same trim applied during the
// native iOS build's security review): no user-read-email (never used —
// only the user id, via /me, is needed) and no playlist-modify-public
// (playlists are always created private).
const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";

export const SCOPES = [
  "streaming",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-modify-private",
];

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

/** Generates a PKCE verifier/challenge pair. */
export async function generatePkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge };
}

/** A random opaque value for the OAuth `state` param (CSRF protection). */
export function generateState() {
  return base64url(randomBytes(32));
}

/** Builds the URL the browser should be sent to. */
export function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SCOPES.join(" "),
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForTokens({ clientId, redirectUri, code, verifier }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

export async function refreshAccessToken({ clientId, refreshToken }) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // note: refresh_token is only sometimes reissued
}
