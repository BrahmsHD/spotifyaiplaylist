// Pure token-expiry math. Ported verbatim from src/main/tokenLogic.js.
export const REFRESH_SKEW_MS = 60 * 1000; // refresh a minute early rather than racing an expiry

export function isExpired(tokens, nowMs = Date.now()) {
  if (!tokens || !tokens.expiresAt) return true;
  return nowMs >= tokens.expiresAt - REFRESH_SKEW_MS;
}

export function fromTokenResponse(tokenResponse, previous) {
  return {
    accessToken: tokenResponse.access_token,
    // Spotify doesn't always reissue a refresh_token on refresh; keep the old one if so.
    refreshToken: tokenResponse.refresh_token || previous?.refreshToken,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
  };
}
