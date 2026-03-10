import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillPlanningResult, parseSkillSelectionResult } from "./json_guard";

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

test("parseSkillSelectionResult accepts use_planning decision", () => {
  const result = parseSkillSelectionResult(
    '{"decision":"use_planning","planning_thinking_budget":1024}'
  );

  assert.equal(result.decision, "use_planning");
  assert.equal(result.planning_thinking_budget, 1024);
});

test("parseSkillSelectionResult parses memory policy fields", () => {
  const result = parseSkillSelectionResult(
    '{"decision":"use_planning","memory_mode":"on","memory_query":"上周会议结论"}'
  );

  assert.equal(result.decision, "use_planning");
  assert.equal(result.memory_mode, "on");
  assert.equal(result.memory_query, "上周会议结论");
});

test("parseSkillSelectionResult rejects invalid memory_mode", () => {
  assert.throws(
    () => parseSkillSelectionResult('{"decision":"use_planning","memory_mode":"auto"}'),
    /Invalid memory_mode/
  );
});

test("parseSkillPlanningResult parses direct respond output", () => {
  const result = parseSkillPlanningResult(
    '{"decision":"respond","response_text":"本地思考后直接回复"}'
  );

  assert.equal(result.decision, "respond");
  assert.equal(result.response_text, "本地思考后直接回复");
});

test("parseSkillPlanningResult parses tool_call output", () => {
  const result = parseSkillPlanningResult(
    '{"decision":"tool_call","tool":"terminal","action":"run","params":{"command":"echo hi"}}'
  );

  assert.equal(result.decision, "tool_call");
  assert.equal(result.tool, "terminal");
  assert.equal(result.op, "run");
  assert.deepEqual(result.args, { command: "echo hi" });
});
