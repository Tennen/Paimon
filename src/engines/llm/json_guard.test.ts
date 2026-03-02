import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillSelectionResult } from "./json_guard";

test("parseSkillSelectionResult parses planning_thinking_budget when valid", () => {
  const result = parseSkillSelectionResult(
    '{"decision":"use_skill","skill_name":"homeassistant","planning_thinking_budget":2048}'
  );

  assert.equal(result.decision, "use_skill");
  assert.equal(result.skill_name, "homeassistant");
  assert.equal(result.planning_thinking_budget, 2048);
});

test("parseSkillSelectionResult keeps planning_thinking_budget undefined when missing", () => {
  const result = parseSkillSelectionResult(
    '{"decision":"use_skill","skill_name":"homeassistant"}'
  );

  assert.equal(result.decision, "use_skill");
  assert.equal(result.skill_name, "homeassistant");
  assert.equal(result.planning_thinking_budget, undefined);
});

test("parseSkillSelectionResult rejects invalid planning_thinking_budget", () => {
  const invalidCases = [
    '{"decision":"use_skill","skill_name":"homeassistant","planning_thinking_budget":"1024"}',
    '{"decision":"use_skill","skill_name":"homeassistant","planning_thinking_budget":0}',
    '{"decision":"use_skill","skill_name":"homeassistant","planning_thinking_budget":12.5}'
  ];

  for (const raw of invalidCases) {
    assert.throws(
      () => parseSkillSelectionResult(raw),
      /Invalid planning_thinking_budget/
    );
  }
});
