// Main UI wiring for the PWA. Replaces src/renderer/renderer.js (the DOM
// logic) and the parts of src/main/main.js that used to run behind IPC
// (prompt:submit, playlist:save, player:play-in-spotify) — there's no
// Electron main/renderer split in a PWA, so this calls spotify.js/llm.js
// directly.
//
// No Spotify Web Playback SDK here — Spotify's SDK does not run in mobile
// browsers at all (Spotify's own docs), so unlike the desktop app there's
// no "full in-app playback" mode to branch on. Playback is always: 30-second
// preview clips in-app, or "Play in Spotify app" via Spotify Connect. Same
// fallback design the desktop app converged on after fighting Widevine, and
// the same one the native iOS build used — see the project's
// ios-native-implementation-plan.md §2.
import * as pkce from "./pkce.js";
import * as tokenManager from "./tokenManager.js";
import * as spotify from "./spotify.js";
import * as llm from "./llm.js";
import * as settingsStore from "./settingsStore.js";

const REDIRECT_URI = window.location.origin + window.location.pathname;

const els = {
  loginBtn: document.getElementById("login-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  authStatus: document.getElementById("auth-status"),
  promptSection: document.getElementById("prompt-section"),
  promptForm: document.getElementById("prompt-form"),
  promptInput: document.getElementById("prompt-input"),
  promptSubmit: document.getElementById("prompt-submit"),
  promptStatus: document.getElementById("prompt-status"),
  playlistSection: document.getElementById("playlist-section"),
  playlistName: document.getElementById("playlist-name"),
  trackList: document.getElementById("track-list"),
  missesNote: document.getElementById("misses-note"),
  saveBtn: document.getElementById("save-btn"),
  playInSpotifyBtn: document.getElementById("play-in-spotify-btn"),
  playlistLink: document.getElementById("playlist-link"),
  saveStatus: document.getElementById("save-status"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsOverlay: document.getElementById("settings-overlay"),
  settingsRedirectUri: document.getElementById("settings-redirect-uri"),
  settingsSpotifyClientId: document.getElementById("settings-spotify-client-id"),
  settingsProvider: document.getElementById("settings-provider"),
  settingsClaudeFields: document.getElementById("settings-claude-fields"),
  settingsLocalFields: document.getElementById("settings-local-fields"),
  settingsAnthropicKey: document.getElementById("settings-anthropic-key"),
  settingsLocalBaseUrl: document.getElementById("settings-local-base-url"),
  settingsLocalModel: document.getElementById("settings-local-model"),
  settingsMistralFields: document.getElementById("settings-mistral-fields"),
  settingsMistralKey: document.getElementById("settings-mistral-key"),
  settingsMistralModel: document.getElementById("settings-mistral-model"),
  settingsMistralLoadBtn: document.getElementById("settings-mistral-load-btn"),
  settingsStatus: document.getElementById("settings-status"),
  settingsCancelBtn: document.getElementById("settings-cancel-btn"),
  settingsSaveBtn: document.getElementById("settings-save-btn"),
};

// The currently-rendered, resolved-but-not-yet-saved track list.
let currentTracks = [];
let currentPlaylistName = "";
let rowButtons = [];
let selectedIndex = 0; // last row tapped — "Play in Spotify app" starts from here

let previewAudio = null;
let previewPlayingIndex = null;

// ------------------------------------------------------------------- auth

async function refreshAuthUi() {
  const settings = settingsStore.loadSettings();
  const loggedIn = tokenManager.isLoggedIn();
  els.loginBtn.hidden = loggedIn;
  els.logoutBtn.hidden = !loggedIn;
  els.promptSection.hidden = !loggedIn;
  if (!settings.spotifyClientId) {
    els.authStatus.textContent = "Add your Spotify Client ID in Settings to sign in.";
  } else {
    els.authStatus.textContent = loggedIn ? "Signed in" : "";
  }
  return loggedIn;
}

/** Handles the redirect back from Spotify (?code=&state=), if this load is one. */
async function completeLoginIfRedirected() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  if (!code && !error) return;

  // Strip the query string immediately so a page refresh doesn't replay it.
  window.history.replaceState({}, document.title, window.location.pathname);

  if (error) {
    els.authStatus.textContent = `Spotify sign-in failed: ${error}`;
    return;
  }

  const expectedState = sessionStorage.getItem("pkce_state");
  const verifier = sessionStorage.getItem("pkce_verifier");
  sessionStorage.removeItem("pkce_state");
  sessionStorage.removeItem("pkce_verifier");

  if (!verifier || !state || state !== expectedState) {
    els.authStatus.textContent = "Sign-in failed: state mismatch — please try signing in again.";
    return;
  }

  const settings = settingsStore.loadSettings();
  try {
    els.authStatus.textContent = "Finishing sign-in…";
    await tokenManager.completeLogin({ clientId: settings.spotifyClientId, redirectUri: REDIRECT_URI, code, verifier });
  } catch (err) {
    els.authStatus.textContent = `Sign-in failed: ${err.message}`;
  }
}

els.loginBtn.addEventListener("click", async () => {
  const settings = settingsStore.loadSettings();
  if (!settings.spotifyClientId) {
    els.authStatus.textContent = "Add your Spotify Client ID in Settings first.";
    openSettingsPanel();
    return;
  }
  els.loginBtn.disabled = true;
  els.authStatus.textContent = "Redirecting to Spotify sign-in…";
  try {
    const { verifier, challenge } = await pkce.generatePkce();
    const state = pkce.generateState();
    sessionStorage.setItem("pkce_verifier", verifier);
    sessionStorage.setItem("pkce_state", state);
    const authUrl = pkce.buildAuthUrl({ clientId: settings.spotifyClientId, redirectUri: REDIRECT_URI, challenge, state });
    window.location.href = authUrl; // full-page redirect — no popup, works inside an installed standalone PWA
  } catch (err) {
    els.authStatus.textContent = `Couldn't start sign-in: ${err.message}`;
    els.loginBtn.disabled = false;
  }
});

els.logoutBtn.addEventListener("click", async () => {
  tokenManager.logout();
  await refreshAuthUi();
});

// ------------------------------------------------------------ prompt / AI

els.promptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = els.promptInput.value.trim();
  if (!prompt) return;

  els.promptInput.blur(); // dismiss the keyboard
  els.promptSubmit.disabled = true;
  els.promptStatus.textContent = "Asking the AI, then looking up tracks on Spotify…";
  els.playlistSection.hidden = true;
  stopAnyPlayback();

  try {
    const settings = settingsStore.loadSettings();
    const accessToken = await tokenManager.getValidAccessToken(settings.spotifyClientId);
    if (!accessToken) throw new Error("Not signed in to Spotify yet.");

    // Just resolves candidates against Spotify search — nothing is written
    // to your Spotify account yet. That only happens on "Save to Spotify".
    const tracklist = await llm.interpretPrompt(prompt, settings);
    const { resolved, misses } = await spotify.resolveCandidates(accessToken, tracklist);
    if (resolved.length === 0) {
      throw new Error("Couldn't find any of the suggested tracks on Spotify.");
    }

    renderPlaylist({ playlistName: tracklist.playlistName, tracks: resolved, misses });
    els.promptStatus.textContent = `Found ${resolved.length} track(s) for "${tracklist.playlistName}". Preview them below, then save to Spotify if you want to keep it.`;
  } catch (err) {
    els.promptStatus.textContent = `Couldn't build that playlist: ${err.message}`;
  } finally {
    els.promptSubmit.disabled = false;
  }
});

function formatDuration(durationMs) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return "";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderPlaylist({ playlistName, tracks, misses }) {
  currentTracks = tracks;
  currentPlaylistName = playlistName;
  rowButtons = [];
  selectedIndex = 0;

  els.playlistSection.hidden = false;
  els.playlistName.textContent = playlistName;

  els.trackList.innerHTML = "";
  tracks.forEach((t, index) => {
    const li = document.createElement("li");
    li.className = "track-row";

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "track-play-btn";
    const canPreview = Boolean(t.previewUrl);
    playBtn.textContent = "▶";
    if (!canPreview) playBtn.classList.add("track-play-btn-no-preview");
    playBtn.title = canPreview
      ? "Play 30s preview"
      : "No preview available — use \"Play in Spotify app\" to hear this track";
    playBtn.addEventListener("click", () => {
      selectedIndex = index;
      togglePreviewAt(index, t);
    });
    rowButtons.push(playBtn);

    const info = document.createElement("span");
    info.className = "track-info";
    const duration = formatDuration(t.durationMs);
    info.textContent = duration ? `${t.name} — ${t.artists} (${duration})` : `${t.name} — ${t.artists}`;

    li.appendChild(playBtn);
    li.appendChild(info);
    els.trackList.appendChild(li);
  });

  if (misses && misses.length > 0) {
    els.missesNote.hidden = false;
    els.missesNote.textContent = `Couldn't find on Spotify: ${misses.map((m) => `${m.title} (${m.artist})`).join(", ")}`;
  } else {
    els.missesNote.hidden = true;
  }

  els.saveBtn.hidden = false;
  els.saveBtn.disabled = false;
  els.saveBtn.textContent = "Save to Spotify";
  els.playInSpotifyBtn.hidden = false;
  els.playInSpotifyBtn.disabled = false;
  els.playlistLink.hidden = true;
  els.saveStatus.textContent = "";
}

// ----------------------------------------------------------- save/play

els.saveBtn.addEventListener("click", async () => {
  if (currentTracks.length === 0) return;
  els.saveBtn.disabled = true;
  els.saveStatus.textContent = "Saving to Spotify…";
  try {
    const settings = settingsStore.loadSettings();
    const accessToken = await tokenManager.getValidAccessToken(settings.spotifyClientId);
    if (!accessToken) throw new Error("Not signed in to Spotify yet.");

    const playlist = await spotify.savePlaylist(accessToken, currentPlaylistName, currentTracks);
    els.saveStatus.textContent = "Saved.";
    els.saveBtn.textContent = "Saved ✓";
    const playlistUrl = playlist.external_urls?.spotify;
    if (playlistUrl) {
      els.playlistLink.href = playlistUrl;
      els.playlistLink.textContent = "Open in Spotify";
      els.playlistLink.hidden = false;
    }
  } catch (err) {
    els.saveStatus.textContent = `Couldn't save: ${err.message}`;
    els.saveBtn.disabled = false;
  }
});

async function listUsableDevices(accessToken) {
  const devices = await spotify.getDevices(accessToken);
  return devices.filter((d) => !d.is_restricted);
}

/** Best-effort deep link into the Spotify app. No feedback either way —
 * if Spotify isn't installed this just does nothing, and the device poll
 * below times out with a clear message. */
function tryLaunchSpotifyApp() {
  window.location.href = "spotify:";
}

async function waitForSpotifyDevice(accessToken, { timeoutMs = 25000, intervalMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const usable = await listUsableDevices(accessToken);
    if (usable.length > 0) return usable;
  }
  return [];
}

async function playInSpotifyFrom(offsetIndex) {
  if (currentTracks.length === 0) return;
  els.playInSpotifyBtn.disabled = true;
  els.saveStatus.textContent = "Looking for a Spotify device (opening the Spotify app if needed)…";
  try {
    const settings = settingsStore.loadSettings();
    const accessToken = await tokenManager.getValidAccessToken(settings.spotifyClientId);
    if (!accessToken) throw new Error("Not signed in to Spotify yet.");

    let usable = await listUsableDevices(accessToken);
    if (usable.length === 0) {
      tryLaunchSpotifyApp();
      usable = await waitForSpotifyDevice(accessToken);
    }
    if (usable.length === 0) {
      throw new Error(
        "No Spotify device found. Open the Spotify app, play anything for a second so it's active, then try again."
      );
    }

    const target = usable.find((d) => d.is_active) || usable[0];
    const uris = currentTracks.map((t) => t.uri);
    await spotify.transferPlayback(accessToken, target.id, false);
    await spotify.startPlaybackWithRetry(accessToken, target.id, uris, offsetIndex);
    els.saveStatus.textContent = `Playing on ${target.name} — nothing saved to your library.`;
  } catch (err) {
    els.saveStatus.textContent = err.message;
  } finally {
    els.playInSpotifyBtn.disabled = false;
  }
}

els.playInSpotifyBtn.addEventListener("click", () => playInSpotifyFrom(selectedIndex));

// --------------------------------------------------------- preview playback

function stopAnyPlayback() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
  previewPlayingIndex = null;
  updateRowIcons();
}

function updateRowIcons(activeIndex, isPaused) {
  rowButtons.forEach((btn, i) => {
    if (!btn) return;
    btn.textContent = i === activeIndex && !isPaused ? "⏸" : "▶";
  });
}

function togglePreviewAt(index, track) {
  if (previewPlayingIndex === index && previewAudio) {
    if (previewAudio.paused) {
      previewAudio.play();
      updateRowIcons(index, false);
    } else {
      previewAudio.pause();
      updateRowIcons(index, true);
    }
    return;
  }

  if (!track.previewUrl) return;

  if (previewAudio) previewAudio.pause();
  previewAudio = new Audio(track.previewUrl);
  previewPlayingIndex = index;
  previewAudio.addEventListener("ended", () => {
    previewPlayingIndex = null;
    updateRowIcons();
  });
  previewAudio.play();
  updateRowIcons(index, false);
}

// ------------------------------------------------------------- settings UI

function updateSettingsFieldVisibility() {
  const provider = els.settingsProvider.value;
  els.settingsClaudeFields.hidden = provider !== "claude";
  els.settingsLocalFields.hidden = provider !== "local";
  els.settingsMistralFields.hidden = provider !== "mistral";
}

function openSettingsPanel() {
  els.settingsStatus.textContent = "";
  const settings = settingsStore.loadSettings();
  els.settingsRedirectUri.value = REDIRECT_URI;
  els.settingsSpotifyClientId.value = settings.spotifyClientId || "";
  els.settingsProvider.value = settings.llmProvider || "claude";
  els.settingsAnthropicKey.value = settings.anthropicApiKey || "";
  els.settingsLocalBaseUrl.value = settings.localLlmBaseUrl || "";
  els.settingsLocalModel.value = settings.localLlmModel || "";
  els.settingsMistralKey.value = settings.mistralApiKey || "";
  setMistralModelOptions(settings.mistralModel ? [settings.mistralModel] : [], settings.mistralModel);
  updateSettingsFieldVisibility();
  els.settingsOverlay.hidden = false;
}

function closeSettingsPanel() {
  els.settingsOverlay.hidden = true;
  els.settingsStatus.textContent = "";
}

function setMistralModelOptions(modelIds, selected) {
  els.settingsMistralModel.innerHTML = "";
  if (modelIds.length === 0) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— load the list to choose —";
    els.settingsMistralModel.appendChild(placeholder);
    return;
  }
  for (const id of modelIds) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    els.settingsMistralModel.appendChild(option);
  }
  if (selected && modelIds.includes(selected)) els.settingsMistralModel.value = selected;
}

els.settingsMistralLoadBtn.addEventListener("click", async () => {
  const key = els.settingsMistralKey.value.trim();
  els.settingsMistralLoadBtn.disabled = true;
  els.settingsStatus.textContent = "Loading models from Mistral…";
  try {
    const previous = els.settingsMistralModel.value;
    const models = await llm.listMistralModels(key);
    if (models.length === 0) {
      els.settingsStatus.textContent = "That key works, but no chat-capable models came back.";
    } else {
      setMistralModelOptions(models, previous);
      els.settingsStatus.textContent = `Loaded ${models.length} model(s) — pick one, then Save.`;
    }
  } catch (err) {
    els.settingsStatus.textContent = err.message;
  } finally {
    els.settingsMistralLoadBtn.disabled = false;
  }
});

els.settingsBtn.addEventListener("click", openSettingsPanel);
els.settingsCancelBtn.addEventListener("click", closeSettingsPanel);
els.settingsProvider.addEventListener("change", updateSettingsFieldVisibility);
els.settingsOverlay.addEventListener("click", (event) => {
  if (event.target === els.settingsOverlay) closeSettingsPanel();
});

els.settingsSaveBtn.addEventListener("click", async () => {
  const settings = {
    spotifyClientId: els.settingsSpotifyClientId.value.trim(),
    llmProvider: els.settingsProvider.value,
    anthropicApiKey: els.settingsAnthropicKey.value.trim(),
    localLlmBaseUrl: els.settingsLocalBaseUrl.value.trim(),
    localLlmModel: els.settingsLocalModel.value.trim(),
    mistralApiKey: els.settingsMistralKey.value.trim(),
    mistralModel: els.settingsMistralModel.value.trim(),
  };
  els.settingsSaveBtn.disabled = true;
  els.settingsStatus.textContent = "Saving…";
  try {
    settingsStore.saveSettings(settings);
    await refreshAuthUi();
    els.settingsStatus.textContent = "Saved.";
    setTimeout(closeSettingsPanel, 500);
  } catch (err) {
    els.settingsStatus.textContent = err.message;
  } finally {
    els.settingsSaveBtn.disabled = false;
  }
});

// ---------------------------------------------------------------- startup

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

completeLoginIfRedirected().then(refreshAuthUi);
