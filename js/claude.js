// Turns a loose natural-language request into a concrete list of tracks,
// using Claude's tool-use to force a structured response.
//
// Ported from src/main/claude.js. The desktop app used @anthropic-ai/sdk;
// a browser has no bundler here to pull that package in, so this calls the
// Messages API directly via fetch — the same approach the native iOS build
// used (ClaudeClient.swift). The
// "anthropic-dangerous-direct-browser-access" header is Anthropic's
// documented opt-in for exactly this case: a client-side app calling the
// API with a key the user supplies themselves, no server in between.
import { SYSTEM_PROMPT, TRACKLIST_SCHEMA, validateTracklist } from "./llmSchema.js";

const MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const MODEL = "claude-sonnet-4-5";

export const TRACKLIST_TOOL = {
  name: "propose_tracklist",
  description: "Return the concrete list of tracks that best satisfies the user's playlist request.",
  input_schema: TRACKLIST_SCHEMA,
};

/** Pure: extracts and validates the tracklist out of an Anthropic API response object. */
export function extractTracklist(message) {
  const toolUse = (message.content || []).find(
    (block) => block.type === "tool_use" && block.name === "propose_tracklist"
  );
  if (!toolUse) {
    throw new Error("Claude did not return a propose_tracklist tool call.");
  }
  return validateTracklist(toolUse.input);
}

export async function interpretPrompt(userPrompt, { apiKey }) {
  if (!apiKey) throw new Error("No Anthropic API key set — add one in Settings.");

  let res;
  try {
    res = await fetch(MESSAGES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [TRACKLIST_TOOL],
        tool_choice: { type: "tool", name: "propose_tracklist" },
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (err) {
    throw new Error(`Could not reach the Anthropic API (${err.message}).`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API returned HTTP ${res.status}: ${body}`);
  }

  const message = await res.json();
  return extractTracklist(message);
}
