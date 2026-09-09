// iTunes 30-second preview clip fallback (Spotify's own preview_url is null
// for most tracks now). Ported verbatim from src/main/previewLookup.js —
// fetch() is a browser global here instead of Node's.
const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";

export function buildItunesSearchUrl({ title, artist }) {
  const params = new URLSearchParams({
    term: `${title} ${artist}`,
    media: "music",
    entity: "song",
    limit: "1",
  });
  return `${ITUNES_SEARCH_URL}?${params.toString()}`;
}

/**
 * Best-effort: looks up a 30-second preview clip on iTunes for a
 * title/artist. Returns null on no match, a non-OK response, or any error.
 */
export async function fetchItunesPreviewUrl(title, artist) {
  try {
    const res = await fetch(buildItunesSearchUrl({ title, artist }));
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0]?.previewUrl || null;
  } catch {
    return null;
  }
}
