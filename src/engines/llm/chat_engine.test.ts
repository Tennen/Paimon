import assert from "node:assert/strict";
import test from "node:test";
import { resolveEngineSystemPrompt } from "./chat_engine";

test("resolveEngineSystemPrompt should keep default prompt when custom prompt is empty", () => {
  const output = resolveEngineSystemPrompt({
    defaultPrompt: "default prompt",
    customPrompt: ""
  });
  assert.equal(output, "default prompt");
});

test("resolveEngineSystemPrompt should replace default prompt when custom prompt is provided", () => {
  const output = resolveEngineSystemPrompt({
    defaultPrompt: "default prompt",
    customPrompt: "custom prompt"
  });
  assert.equal(output, "custom prompt");
});

test("resolveEngineSystemPrompt should append custom prompt in append mode", () => {
  const output = resolveEngineSystemPrompt({
    defaultPrompt: "default prompt",
    customPrompt: "custom prompt",
    mode: "append"
  });
  assert.equal(output, "default prompt\ncustom prompt");
});
