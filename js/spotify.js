// Thin wrapper around the bits of the Spotify Web API this app actually
// uses. Ported verbatim from src/main/spotify.js — fetch() was already the
// HTTP client there (Electron's main process has a global fetch), so this
// file barely changed at all going to the browser.
import { fetchItunesPreviewUrl } from "./previewLookup.js";

const API_BASE = "https://api.spotify.com/v1";

async function spotifyFetch(accessToken, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.error?.message || res.statusText;
    console.error(`[spotify] ${options.method || "GET"} ${path} -> ${res.status}`, JSON.stringify(body));
    const err = new Error(`Spotify API error ${res.status}: ${message}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function getCurrentUser(accessToken) {
  return spotifyFetch(accessToken, "/me");
}

export function buildSearchQueries({ title, artist }) {
  return [`track:"${title}" artist:"${artist}"`, `${title} ${artist}`];
}

export async function searchTrack(accessToken, candidate) {
  for (const q of buildSearchQueries(candidate)) {
    const params = new URLSearchParams({ q, type: "track", limit: "10" });
    const data = await spotifyFetch(accessToken, `/search?${params.toString()}`);
    const items = data?.tracks?.items || [];
    if (items.length > 0) {
      const best = [...items].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
      return {
        uri: best.uri,
        id: best.id,
        name: best.name,
        artists: best.artists.map((a) => a.name).join(", "),
        popularity: best.popularity,
        durationMs: best.duration_ms,
        previewUrl: best.preview_url || null,
      };
    }
  }
  return null;
}

export async function resolveTracks(accessToken, candidates) {
  const resolved = [];
  const misses = [];
  const seenIds = new Set();
  for (const candidate of candidates) {
    const match = await searchTrack(accessToken, candidate);
    if (!match) {
      misses.push(candidate);
    } else if (!seenIds.has(match.id)) {
      seenIds.add(match.id);
      resolved.push(match);
    }
  }
  return { resolved, misses };
}

// Feb/Mar 2026 Spotify Web API migration: POST /me/playlists replaces
// POST /users/{user_id}/playlists for Development Mode apps.
export async function createPlaylist(accessToken, name, description) {
  return spotifyFetch(accessToken, "/me/playlists", {
    method: "POST",
    body: JSON.stringify({ name, description, public: false }),
  });
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

// Same migration: /playlists/{id}/items replaces /playlists/{id}/tracks.
export async function addTracksToPlaylist(accessToken, playlistId, uris) {
  for (const batch of chunk(uris, 100)) {
    await spotifyFetch(accessToken, `/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: batch }),
    });
  }
}

/**
 * Interprets an LLM tracklist against Spotify search and returns the
 * resolved/missed tracks — does NOT touch the user's account.
 */
export async function resolveCandidates(accessToken, { tracks }) {
  await getCurrentUser(accessToken);
  const { resolved, misses } = await resolveTracks(accessToken, tracks);
  await attachPreviewUrls(resolved);
  return { resolved, misses };
}

export async function attachPreviewUrls(resolvedTracks) {
  for (const track of resolvedTracks) {
    if (track.previewUrl) continue;
    const primaryArtist = track.artists.split(",")[0].trim();
    track.previewUrl = await fetchItunesPreviewUrl(track.name, primaryArtist);
  }
}

export async function savePlaylist(accessToken, playlistName, resolvedTracks) {
  if (!resolvedTracks || resolvedTracks.length === 0) {
    throw new Error("No tracks to save.");
  }
  const playlist = await createPlaylist(accessToken, playlistName, "Created by Spotify AI Playlist");
  await addTracksToPlaylist(
    accessToken,
    playlist.id,
    resolvedTracks.map((t) => t.uri)
  );
  return playlist;
}

// --- Spotify Connect playback control. The PWA has no Web Playback SDK
// path (Spotify's SDK is not supported in mobile browsers at all — see
// README) — this Connect-device control plus 30s preview clips is the
// *only* playback path, matching what the native iOS build converged on. ---

export async function getDevices(accessToken) {
  const data = await spotifyFetch(accessToken, "/me/player/devices");
  return data?.devices || [];
}

export async function transferPlayback(accessToken, deviceId, play = true) {
  await spotifyFetch(accessToken, "/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}

export async function startPlayback(accessToken, deviceId, uris, offsetIndex) {
  const body = { uris };
  if (typeof offsetIndex === "number" && offsetIndex >= 0) {
    body.offset = { position: offsetIndex };
  }
  await spotifyFetch(accessToken, `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Retries briefly on 404 because a device transfer doesn't register instantly. */
export async function startPlaybackWithRetry(accessToken, deviceId, uris, offsetIndex) {
  let lastErr;
  for (const delayMs of [0, 400, 1200]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await startPlayback(accessToken, deviceId, uris, offsetIndex);
      return;
    } catch (err) {
      lastErr = err;
      if (err.status !== 404) throw err;
    }
  }
  throw lastErr;
}

export async function pausePlayback(accessToken, deviceId) {
  await spotifyFetch(accessToken, `/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
  });
}

export async function nextTrack(accessToken, deviceId) {
  await spotifyFetch(accessToken, `/me/player/next?device_id=${encodeURIComponent(deviceId)}`, {
    method: "POST",
  });
}

export async function previousTrack(accessToken, deviceId) {
  await spotifyFetch(accessToken, `/me/player/previous?device_id=${encodeURIComponent(deviceId)}`, {
    method: "POST",
  });
}
