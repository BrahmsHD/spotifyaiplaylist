// Pure validation/normalisation for the LLM settings the Settings panel
// edits. Ported verbatim from src/main/settingsValidation.js.
const VALID_PROVIDERS = ["claude", "local", "mistral"];

export function normalizeSettings(raw) {
  const requestedProvider = String(raw?.llmProvider || "claude").trim().toLowerCase();
  const errors = [];
  if (!VALID_PROVIDERS.includes(requestedProvider)) {
    errors.push(`Unknown provider "${raw?.llmProvider}" — expected "claude", "local" or "mistral".`);
  }

  const settings = {
    // Spotify's OAuth client id — not a secret (it's a PKCE public-client
    // id that appears in the redirect URL), so unlike the API keys below
    // it's stored in the clear.
    spotifyClientId: String(raw?.spotifyClientId ?? "").trim(),
    llmProvider: VALID_PROVIDERS.includes(requestedProvider) ? requestedProvider : "claude",
    anthropicApiKey: String(raw?.anthropicApiKey ?? "").trim(),
    localLlmBaseUrl: String(raw?.localLlmBaseUrl ?? "").trim(),
    localLlmModel: String(raw?.localLlmModel ?? "").trim(),
    mistralApiKey: String(raw?.mistralApiKey ?? "").trim(),
    mistralModel: String(raw?.mistralModel ?? "").trim(),
  };

  if (settings.llmProvider === "claude" && !settings.anthropicApiKey) {
    errors.push("An Anthropic API key is required to use Claude.");
  }
  if (settings.llmProvider === "local" && !settings.localLlmModel) {
    errors.push("A model identifier is required to use a local LLM.");
  }
  if (settings.llmProvider === "mistral" && !settings.mistralApiKey) {
    errors.push("A Mistral API key is required to use Mistral.");
  }
  if (settings.llmProvider === "mistral" && !settings.mistralModel) {
    errors.push("Select a Mistral model — click Load next to the model list.");
  }

  return { settings, errors };
}

export { VALID_PROVIDERS };
