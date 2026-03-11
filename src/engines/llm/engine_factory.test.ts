import assert from "node:assert/strict";
import test from "node:test";
import { createLLMEngine, normalizeProvider } from "./engine_factory";
import { OpenAILLMEngine } from "./openai";

test("normalizeProvider supports openai aliases", () => {
  assert.equal(normalizeProvider("openai"), "openai");
  assert.equal(normalizeProvider("chatgpt"), "openai");
  assert.equal(normalizeProvider("openai-api"), "openai");
  assert.equal(normalizeProvider("gpt"), "openai");
});

test("createLLMEngine creates OpenAILLMEngine for openai provider", () => {
  const engine = createLLMEngine("chatgpt");
  assert.ok(engine instanceof OpenAILLMEngine);
  assert.equal(engine.getProviderName(), "openai");
});
