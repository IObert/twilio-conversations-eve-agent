// agent/agent.ts
import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

export default defineAgent({
  model: openai("gpt-5.6-luna"),
  modelContextWindowTokens: 400_000,
  modelOptions: { providerOptions: { openai: { store: false } } },
});
