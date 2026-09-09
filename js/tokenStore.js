// Persists the Spotify token set. Ported from src/main/secureStore.js —
// the desktop app used Electron's safeStorage (OS Keychain-backed); a PWA
// has no equivalent, so this uses localStorage instead. That's the one
// real security tradeoff of going PWA over native: tokens sit in the
// browser's storage for this origin rather than the OS Keychain. See the
// README's "Security notes" section.
const KEY = "spotify_ai_playlist.tokens";

export function saveTokens(tokens) {
  localStorage.setItem(KEY, JSON.stringify(tokens));
}

export function loadTokens() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearTokens() {
  localStorage.removeItem(KEY);
}
