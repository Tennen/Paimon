import assert from "node:assert/strict";
import test from "node:test";
import { CodexLLMEngine } from "./codex";
import { createLLMEngine, normalizeProvider } from "./engine_factory";
import { GeminiLLMEngine } from "./gemini";
import { GPTPluginLLMEngine } from "./gpt-plugin";
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

test("createLLMEngine creates GeminiLLMEngine for gemini provider aliases", () => {
  const engine = createLLMEngine("gemini-like");
  assert.ok(engine instanceof GeminiLLMEngine);
  assert.equal(engine.getProviderName(), "gemini");
  assert.equal(normalizeProvider("google-genai"), "gemini");
});

test("createLLMEngine creates GPTPluginLLMEngine for gpt-plugin aliases", () => {
  const engine = createLLMEngine("gpt_plugin");
  assert.ok(engine instanceof GPTPluginLLMEngine);
  assert.equal(engine.getProviderName(), "gpt-plugin");
  assert.equal(normalizeProvider("chatgpt-bridge"), "gpt-plugin");
});

test("createLLMEngine creates CodexLLMEngine for codex aliases", () => {
  const engine = createLLMEngine("codex");
  assert.ok(engine instanceof CodexLLMEngine);
  assert.equal(engine.getProviderName(), "codex");
  assert.equal(normalizeProvider("codex-cli"), "codex");
});
