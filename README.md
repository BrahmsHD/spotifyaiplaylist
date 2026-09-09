# Spotify AI Playlist — PWA

A free, install-once, no-expiry version of the app for your iPhone. No Xcode,
no Apple Developer account, no 7-day reinstall — you host these static
files anywhere over HTTPS, open the URL once in Safari, and add it to your
Home Screen.

It reuses the exact same business logic as the desktop app and the native
iOS build (PKCE auth math, Spotify search/resolve/dedup, the LLM prompt and
schema, token-expiry logic) — see the file-by-file mapping at the bottom.

## 1. Host it somewhere with HTTPS

Any static host works. GitHub Pages is the easiest if you don't already have
a preference:

1. Push this `pwa/` folder's contents to a GitHub repo (or a `docs/` folder,
   or a `gh-pages` branch — whatever GitHub Pages is pointed at).
2. Repo Settings → Pages → enable it for that folder/branch.
3. You'll get a URL like `https://<your-username>.github.io/<repo>/`.

Netlify or Vercel work too (drag-and-drop the `pwa/` folder in Netlify's
dashboard, or `vercel deploy` from inside it) — either gives you an HTTPS URL
in under a minute, no GitHub required.

Whichever you pick, the URL must be **HTTPS** (all of the above give you
that automatically) — Spotify's OAuth won't redirect to a plain `http://`
URL except `127.0.0.1` for local testing (see step 3).

## 2. Create/reuse a Spotify Developer app

If you already have a Client ID from the desktop or iOS build, you can reuse
it — just add one more Redirect URI to it.

1. https://developer.spotify.com/dashboard → your app → Settings.
2. Under **Redirect URIs**, add the exact URL your app is hosted at, e.g.
   `https://your-username.github.io/spotify-ai-playlist/index.html`
   (must match character-for-character, including `index.html` if that's
   part of the URL you actually load).
3. Save.

Once the app is running, open its **Settings ⚙ → Redirect URI** field — it
shows you the exact URL it computed at runtime, so you can copy it straight
into the Dashboard instead of guessing.

## 3. Configure the app

1. Open your hosted URL in Safari (iPhone) or any browser.
2. Tap ⚙ Settings.
3. Paste your **Spotify Client ID**.
4. Pick an **LLM provider** and add its key:
   - **Claude** — an Anthropic API key (console.anthropic.com).
   - **Mistral** — a Mistral API key, then tap **Load** to fetch your
     account's current model list and pick one.
   - **Local** — see "Local LLM" below; not usable from a phone in most
     setups.
5. Save.

## 4. Install it on your iPhone

1. Open the hosted URL in **Safari** (must be Safari, not Chrome — iOS only
   lets Safari add a page as a standalone Home Screen app).
2. Tap the Share icon → **Add to Home Screen** → Add.
3. Launch it from the Home Screen icon from now on — it opens full-screen,
   no browser bar, and never expires or needs reinstalling.

## 5. Sign in with Spotify

Tap **Sign in with Spotify** — this redirects the whole page to Spotify's
sign-in, then back to the app once you approve it. This is a full-page
redirect (not a popup), which is what makes it work reliably inside an
installed standalone PWA.

## Local testing before you deploy

Spotify allows `http://127.0.0.1:<port>` (not `localhost`) as a redirect URI
for local dev. From this folder:

```
python3 -m http.server 5500
```

Open `http://127.0.0.1:5500/`, add that exact URL as a Redirect URI in the
Spotify Dashboard too, and test there before deploying.

## Security notes (the real tradeoffs vs. native)

- **Tokens and API keys live in this browser's localStorage**, not the iOS
  Keychain. Anyone with access to your unlocked phone and Safari's site data
  for this origin could read them — same category of risk as any other
  website that keeps you signed in. Signing out clears them
  (`localStorage.clear()` for this origin does too, if you ever need to wipe
  it by hand).
- **The Anthropic API call happens directly from your phone's browser** to
  `api.anthropic.com`, using the `anthropic-dangerous-direct-browser-access`
  header — Anthropic's documented, supported way to let a user's own browser
  call the API with their own key, no backend needed. Your key never leaves
  your device except to Anthropic itself.
- Nothing here is more exposed than the native iOS app was — it's the same
  "your own key, on your own device" model, just in browser storage instead
  of Keychain.

## Local LLM on a phone — the one real limitation

`localhost` on your iPhone means *the iPhone itself*, not your Mac — so
LM Studio/Ollama running on your Mac isn't reachable at
`http://localhost:1234` from the PWA. Two ways around it, if you want this:

1. Run the local server on your Mac, find your Mac's LAN IP
   (`ipconfig getifaddr en0`), and point the app's **Local server base URL**
   at `http://<mac-ip>:1234/v1` — works only while both devices are on the
   same Wi-Fi, and only if that local server itself doesn't require HTTPS
   (iOS Safari blocks a plain `http://` call from this `https://` page
   otherwise — "mixed content").
2. Put a tunnel (e.g. `ngrok http 1234`) in front of it for an HTTPS URL.

Claude and Mistral aren't affected by any of this — both are already HTTPS.

## Updating the app later

Edit the files, redeploy to the same host (push to the same repo/branch, or
re-run `vercel deploy` / re-drag the folder in Netlify). The installed
Home Screen icon keeps working — it just loads the new files next time it's
opened. Bump `CACHE_NAME` in `sw.js` when you change any shell file, so
already-installed copies pick up the update instead of serving a stale
cached version.

## File-by-file mapping (Electron → PWA)

| Desktop (`src/main/*.js`, `src/renderer/*`) | PWA (`pwa/js/*`) | What changed |
|---|---|---|
| `spotify.js` | `spotify.js` | Nothing — `fetch` was already the HTTP client. |
| `oauth.js` | `pkce.js` | Node's `crypto` → Web Crypto (`crypto.subtle`, `crypto.getRandomValues`); the loopback HTTP server is gone — Spotify redirects straight back to this page's own URL instead. |
| `llmSchema.js` | `llmSchema.js` | Nothing but `module.exports` → `export`. |
| `claude.js` | `claude.js` | `@anthropic-ai/sdk` → direct `fetch` to the Messages API with the browser-access header (no bundler available client-side). |
| `localLlm.js` | `localLlm.js` | Nothing but export syntax. |
| `llm.js` | `llm.js` | Reads a passed-in settings object instead of `process.env` (no env vars in a browser). |
| `previewLookup.js` | `previewLookup.js` | Nothing. |
| `tokenLogic.js` | `tokenLogic.js` | Nothing — already pure. |
| `tokenManager.js` | `tokenManager.js` | Nothing but export syntax. |
| `secureStore.js` (Keychain via `safeStorage`) | `tokenStore.js` (`localStorage`) | No Keychain in a browser — see "Security notes" above. |
| `settingsStore.js` + `settingsValidation.js` | `settingsStore.js` + `settingsValidation.js` | Same split; `localStorage` instead of a JSON file + `safeStorage` encryption. |
| `main.js`'s auth/prompt/save/play IPC handlers | `app.js` | No IPC needed — the UI calls the modules directly. |
| `renderer/*` (Web Playback SDK + preview fallback) | `app.js` (preview + Spotify Connect only) | Web Playback SDK dropped entirely — Spotify's SDK doesn't run in mobile browsers at all, so there's no "full in-app playback" branch to keep; same fallback design the desktop app converged on for Widevine failures. |
