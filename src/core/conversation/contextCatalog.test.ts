import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationSkillsContext,
  filterToolRuntimeContextByAllowedNames
} from "./contextCatalog";

test("buildConversationSkillsContext respects selected skills and required tools", () => {
  const skillManager = {
    list: () => [
      {
        name: "terminal-helper",
        description: "run terminal tool",
        tool: "terminal"
      },
      {
        name: "plain-skill",
        description: "plain skill"
      }
    ],
    get: () => undefined
  };
  const toolRegistry = {
    listSchema: () => [
      { name: "terminal", operations: [] },
      { name: "homeassistant", operations: [] }
    ]
  };

  const context = buildConversationSkillsContext(skillManager as any, toolRegistry as any, {
    allowedSkillNames: ["terminal-helper", "plain-skill", "homeassistant"],
    allowedToolNames: ["terminal"]
  });

  assert.deepEqual(Object.keys(context ?? {}).sort(), ["plain-skill", "terminal-helper"]);
  assert.equal(context?.homeassistant, undefined);
});

test("filterToolRuntimeContextByAllowedNames keeps only selected schemas and runtime context", () => {
  const context = filterToolRuntimeContextByAllowedNames({
    _tools: {
      schema: [
        { name: "terminal" },
        { name: "celestia" }
      ]
    },
    terminal: { system: "local" },
    celestia: { devices: [] }
  }, ["celestia"]);

  assert.deepEqual(context, {
    _tools: {
      schema: [{ name: "celestia" }]
    },
    celestia: { devices: [] }
  });
});
