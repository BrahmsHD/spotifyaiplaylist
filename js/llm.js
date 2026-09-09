// Picks which LLM backend turns prompts into track lists, based on the
// current settings object (loaded from localStorage — see settingsStore.js).
// Ported from src/main/llm.js; the desktop version read process.env, this
// one takes the settings object directly since a browser has no env vars.
import * as claude from "./claude.js";
import * as localLlm from "./localLlm.js";

export const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

/**
 * Lists the chat-capable model ids available to this API key, for the
 * Settings panel's model dropdown (Mistral's ids are dated and churn, so
 * nothing is hardcoded here).
 */
export async function listMistralModels(apiKey) {
  if (!apiKey) throw new Error("Enter a Mistral API key first, then load the model list.");

  let response;
  try {
    response = await fetch(`${MISTRAL_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    throw new Error(`Could not reach the Mistral API (${err.message}).`);
  }

  if (response.status === 401) throw new Error("Mistral rejected that API key (HTTP 401).");
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Mistral API returned HTTP ${response.status}: ${body}`);
  }

  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : [];

  return models
    .filter((m) => {
      if (m?.capabilities && typeof m.capabilities.completion_chat === "boolean") {
        return m.capabilities.completion_chat;
      }
      return !/embed|ocr|moderation|tts|transcribe|shieldstral/i.test(m?.id || "");
    })
    .map((m) => m.id)
    .filter(Boolean)
    .sort();
}

export async function interpretPrompt(userPrompt, settings) {
  const provider = (settings.llmProvider || "claude").trim().toLowerCase();

  if (provider === "local") {
    return localLlm.interpretPrompt(userPrompt, {
      baseUrl: settings.localLlmBaseUrl,
      model: settings.localLlmModel,
      label: "Local LLM server",
    });
  }

  if (provider === "mistral") {
    if (!settings.mistralApiKey) {
      throw new Error("No Mistral API key set — add one in Settings.");
    }
    if (!settings.mistralModel) {
      throw new Error("No Mistral model selected — open Settings, load the model list, and pick one.");
    }
    return localLlm.interpretPrompt(userPrompt, {
      baseUrl: MISTRAL_BASE_URL,
      model: settings.mistralModel,
      apiKey: settings.mistralApiKey,
      label: "Mistral API",
    });
  }

  if (provider !== "claude") {
    throw new Error(`Unknown LLM provider "${provider}" — expected "claude", "local", or "mistral".`);
  }

  return claude.interpretPrompt(userPrompt, { apiKey: settings.anthropicApiKey });
}
