import assert from "node:assert/strict";
import test from "node:test";
import {
  DirectInputMappingConfig,
  normalizeDirectInputMappingConfig,
  resolveDirectInputMapping
} from "./directInputMappingService";

function createConfig(rules: DirectInputMappingConfig["rules"]): DirectInputMappingConfig {
  return normalizeDirectInputMappingConfig({
    version: 1,
    rules,
    updatedAt: "2026-03-20T00:00:00.000Z"
  });
}

test("resolveDirectInputMapping prefers exact matches", () => {
  const config = createConfig([
    {
      id: "fuzzy-market",
      name: "盘前分析",
      pattern: "分析",
      targetText: "/market open",
      matchMode: "fuzzy",
      enabled: true
    },
    {
      id: "exact-market",
      name: "开盘分析",
      pattern: "开盘分析",
      targetText: "/market open",
      matchMode: "exact",
      enabled: true
    }
  ]);

  const resolved = resolveDirectInputMapping("开盘分析", config);
  assert.deepEqual(resolved, {
    ruleId: "exact-market",
    ruleName: "开盘分析",
    pattern: "开盘分析",
    matchMode: "exact",
    targetText: "/market open"
  });
});

test("resolveDirectInputMapping supports fuzzy contains matching", () => {
  const config = createConfig([
    {
      id: "market-open",
      name: "开盘分析",
      pattern: "开盘分析",
      targetText: "/market open",
      matchMode: "fuzzy",
      enabled: true
    }
  ]);

  const resolved = resolveDirectInputMapping("帮我做一下开盘分析", config);
  assert.equal(resolved?.targetText, "/market open");
  assert.equal(resolved?.matchMode, "fuzzy");
});

test("resolveDirectInputMapping skips slash commands and invalid rules", () => {
  const config = createConfig([
    {
      id: "empty",
      name: "",
      pattern: "",
      targetText: "/market open",
      matchMode: "exact",
      enabled: true
    },
    {
      id: "disabled",
      name: "",
      pattern: "开盘分析",
      targetText: "/market open",
      matchMode: "exact",
      enabled: false
    }
  ]);

  assert.equal(resolveDirectInputMapping("/market close", config), null);
  assert.equal(resolveDirectInputMapping("开盘分析", config), null);
});
