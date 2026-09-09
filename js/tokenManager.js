// Sits between pkce.js (the wire protocol) and tokenStore.js (localStorage),
// and is the single place that decides whether a stored token is still good
// or needs refreshing. Ported verbatim in structure from
// src/main/tokenManager.js.
import * as oauth from "./pkce.js";
import * as store from "./tokenStore.js";
import { isExpired, fromTokenResponse } from "./tokenLogic.js";

export async function completeLogin({ clientId, redirectUri, code, verifier }) {
  const tokenResponse = await oauth.exchangeCodeForTokens({ clientId, redirectUri, code, verifier });
  const tokens = fromTokenResponse(tokenResponse, null);
  store.saveTokens(tokens);
  return tokens;
}

/** Returns a valid access token, transparently refreshing (and persisting) if needed. */
export async function getValidAccessToken(clientId) {
  const tokens = store.loadTokens();
  if (!tokens) return null;
  if (!isExpired(tokens)) return tokens.accessToken;

  if (!tokens.refreshToken) {
    store.clearTokens();
    return null;
  }
  const refreshed = await oauth.refreshAccessToken({ clientId, refreshToken: tokens.refreshToken });
  const updated = fromTokenResponse(refreshed, tokens);
  store.saveTokens(updated);
  return updated.accessToken;
}

export function isLoggedIn() {
  return store.loadTokens() !== null;
}

export function logout() {
  store.clearTokens();
}
