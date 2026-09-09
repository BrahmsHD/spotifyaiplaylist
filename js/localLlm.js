// Alternative to claude.js: turns a prompt into a tracklist using any
// OpenAI-compatible chat-completions server (also reused for Mistral's
// hosted API — see llm.js). Ported verbatim from src/main/localLlm.js.
//
// Note (PWA-specific): "local" here means whatever machine the phone can
// actually reach over the network — on an iPhone, "localhost" is the
// phone itself, not your Mac. Running an LM Studio/Ollama server on your
// Mac and pointing this at its LAN IP can work, but Safari blocks a plain
// http:// request from this https:// page (mixed content) unless that
// server is also served over HTTPS. See the README's "Local LLM on the
// PWA" note. Mistral and Claude aren't affected — both are HTTPS already.
import { SYSTEM_PROMPT, TRACKLIST_SCHEMA, validateTracklist } from "./llmSchema.js";

export const DEFAULT_BASE_URL = "http://localhost:1234/v1";

export function extractTracklist(completion) {
  const message = completion?.choices?.[0]?.message || {};
  const content = firstNonEmptyString(message.content, message.reasoning_content);
  if (!content) {
    throw new Error("The model returned no content.");
  }

  const jsonText = stripCodeFence(content);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`The model did not return valid JSON (${err.message}). Raw content: ${content}`);
  }
  return validateTracklist(parsed);
}

function firstNonEmptyString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export async function interpretPrompt(userPrompt, { baseUrl, model, apiKey, label = "Local LLM server" } = {}) {
  let resolvedBaseUrl = baseUrl || DEFAULT_BASE_URL;
  while (resolvedBaseUrl.endsWith("/")) resolvedBaseUrl = resolvedBaseUrl.slice(0, -1);
  if (!model) throw new Error(`No model configured for ${label} — set one in Settings.`);

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response;
  try {
    response = await fetch(`${resolvedBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        response_format: {
          type: "json_schema",
          json_schema: { name: "tracklist", schema: TRACKLIST_SCHEMA, strict: true },
        },
      }),
    });
  } catch (err) {
    throw new Error(`Could not reach ${label} at ${resolvedBaseUrl} (${err.message}).`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label} returned HTTP ${response.status}: ${body}`);
  }

  const completion = await response.json();
  return extractTracklist(completion);
}
