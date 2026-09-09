// App-shell cache only — never caches API calls (Spotify, Anthropic,
// Mistral, iTunes, or a local LLM server), so playlist data, sign-in state,
// and AI responses are always fetched fresh. Bump CACHE_NAME whenever a
// shell file changes so installed clients pick up the new version.
const CACHE_NAME = "spotify-ai-playlist-shell-v1";
const SHELL_FILES = [
  "./",
  "index.html",
  "manifest.json",
  "css/styles.css",
  "js/app.js",
  "js/pkce.js",
  "js/spotify.js",
  "js/llm.js",
  "js/claude.js",
  "js/localLlm.js",
  "js/llmSchema.js",
  "js/previewLookup.js",
  "js/settingsStore.js",
  "js/settingsValidation.js",
  "js/tokenLogic.js",
  "js/tokenManager.js",
  "js/tokenStore.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests for the app shell. Everything
  // cross-origin (api.spotify.com, api.anthropic.com, api.mistral.ai,
  // itunes.apple.com, accounts.spotify.com, or a local LLM server) goes
  // straight to the network, untouched.
  if (url.origin !== self.location.origin || event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
