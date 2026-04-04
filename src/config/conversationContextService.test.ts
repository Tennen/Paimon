import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConversationContextConfig } from "./conversationContextService";

test("normalizeConversationContextConfig keeps null as select-all and filters unknown names", () => {
  const config = normalizeConversationContextConfig({
    version: 1,
    selectedSkillNames: ["homeassistant", "missing", "homeassistant", ""],
    selectedToolNames: null,
    updatedAt: "2026-04-04T00:00:00.000Z"
  }, {
    availableSkillNames: ["homeassistant", "celestia"],
    availableToolNames: ["homeassistant", "terminal"]
  });

  assert.deepEqual(config.selectedSkillNames, ["homeassistant"]);
  assert.equal(config.selectedToolNames, null);
  assert.equal(config.updatedAt, "2026-04-04T00:00:00.000Z");
});

test("normalizeConversationContextConfig accepts explicit empty arrays", () => {
  const config = normalizeConversationContextConfig({
    version: 1,
    selectedSkillNames: [],
    selectedToolNames: [],
    updatedAt: ""
  });

  assert.deepEqual(config.selectedSkillNames, []);
  assert.deepEqual(config.selectedToolNames, []);
  assert.match(config.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
