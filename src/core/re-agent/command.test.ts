import assert from "node:assert/strict";
import test from "node:test";
import {
  isReAgentCommandInput,
  parseReAgentCommand,
  withReAgentPrefix
} from "./command";

test("parseReAgentCommand keeps /re prefix for normal ask", () => {
  const parsed = parseReAgentCommand("/re 请帮我总结今天的任务");

  assert.equal(parsed.kind, "ask");
  assert.equal(parsed.rawInput, "/re 请帮我总结今天的任务");
  assert.equal(parsed.prefixedInput, "/re 请帮我总结今天的任务");
  assert.equal(parsed.content, "请帮我总结今天的任务");
});

test("parseReAgentCommand parses help and reset commands", () => {
  const help = parseReAgentCommand("/re help");
  const reset = parseReAgentCommand("/re reset");

  assert.equal(help.kind, "help");
  assert.equal(help.content, "help");
  assert.equal(reset.kind, "reset");
  assert.equal(reset.content, "reset");
});

test("parseReAgentCommand handles empty input as help", () => {
  const empty = parseReAgentCommand("   ");
  const prefixOnly = parseReAgentCommand("/re   ");

  assert.equal(empty.kind, "help");
  assert.equal(empty.prefixedInput, "/re");
  assert.equal(empty.content, "");

  assert.equal(prefixOnly.kind, "help");
  assert.equal(prefixOnly.prefixedInput, "/re");
  assert.equal(prefixOnly.content, "");
});

test("parseReAgentCommand adds /re prefix when missing", () => {
  const parsed = parseReAgentCommand("帮我规划下周计划");

  assert.equal(parsed.kind, "ask");
  assert.equal(parsed.prefixedInput, "/re 帮我规划下周计划");
  assert.equal(withReAgentPrefix(parsed.content), "/re 帮我规划下周计划");
});

test("isReAgentCommandInput detects prefixed command", () => {
  assert.equal(isReAgentCommandInput("/re help"), true);
  assert.equal(isReAgentCommandInput("/read file"), false);
  assert.equal(isReAgentCommandInput("hello"), false);
});
