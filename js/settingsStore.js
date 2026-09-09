// Persists the user-editable settings (Spotify Client ID, LLM provider
// choice, API keys). Ported from src/main/settingsStore.js — the desktop
// app encrypted API keys with Electron's safeStorage; a PWA has no OS
// Keychain to call into, so this uses localStorage in the clear, same
// tradeoff as tokenStore.js. See the README's "Security notes" section.
import { normalizeSettings } from "./settingsValidation.js";

const KEY = "spotify_ai_playlist.settings";

function defaults() {
  return {
    spotifyClientId: "",
    llmProvider: "claude",
    anthropicApiKey: "",
    localLlmBaseUrl: "",
    localLlmModel: "",
    mistralApiKey: "",
    mistralModel: "",
  };
}

export function loadSettings() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return normalizeSettings(defaults()).settings;
  try {
    return normalizeSettings({ ...defaults(), ...JSON.parse(raw) }).settings;
  } catch {
    return normalizeSettings(defaults()).settings;
  }
}

export function saveSettings(raw) {
  const { settings, errors } = normalizeSettings(raw);
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
  localStorage.setItem(KEY, JSON.stringify(settings));
  return settings;
}
