// Shared between the Claude backend (claude.js) and the local-LLM backend
// (localLlm.js): the system prompt and the tracklist JSON schema both send
// to their respective model, plus the validation logic once a candidate
// tracklist object comes back. Ported verbatim from the desktop app's
// src/main/llmSchema.js (CommonJS -> ES module is the only change).

export const SYSTEM_PROMPT = `You curate Spotify playlists from a listener's request.
Given a request, pick real, specific, well-known recorded songs (title + performing artist)
that best satisfy it — favor songs you're confident actually exist and are on Spotify.
For "most famous / best of <artist>" style requests, list that artist's most popular,
well-known songs. For mood/genre/era requests, pick a well-curated mix of real songs
that fit. Always call propose_tracklist with your answer; never answer in plain text.`;

export const TRACKLIST_SCHEMA = {
  type: "object",
  properties: {
    playlist_name: {
      type: "string",
      description: "A short, human-friendly name for the playlist (e.g. \"Michael Jackson: Greatest Hits\").",
    },
    tracks: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          artist: { type: "string" },
        },
        required: ["title", "artist"],
        additionalProperties: false,
      },
    },
  },
  required: ["playlist_name", "tracks"],
  additionalProperties: false,
};

/**
 * Pure: validates an already-parsed candidate tracklist object. Throws a
 * descriptive error on any shape mismatch; returns the camelCased result on
 * success.
 */
export function validateTracklist(input) {
  const { playlist_name: playlistName, tracks } = input || {};
  if (typeof playlistName !== "string" || !playlistName.trim()) {
    throw new Error("Missing or empty playlist_name in the model's response.");
  }
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error("Model returned an empty track list.");
  }
  for (const t of tracks) {
    if (typeof t.title !== "string" || !t.title.trim() || typeof t.artist !== "string" || !t.artist.trim()) {
      throw new Error(`Malformed track entry: ${JSON.stringify(t)}`);
    }
  }
  return { playlistName, tracks };
}
