import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSearchEngineStorePayload,
  resolveSearchEngineSelectorFromStore
} from "./store";

test("resolveSearchEngineSelectorFromStore should not silently fall back from explicit qianfan to serpapi", () => {
  const store = normalizeSearchEngineStorePayload({
    version: 1,
    defaultEngineId: "serpapi-default",
    engines: [
      {
        id: "custom-serpapi",
        name: "Custom SerpAPI",
        type: "serpapi",
        enabled: true,
        config: {
          endpoint: "https://serpapi.com/search.json",
          apiKey: "test",
          engine: "google_news",
          hl: "zh-cn",
          gl: "cn",
          num: 10
        }
      }
    ]
  });

  assert.equal(resolveSearchEngineSelectorFromStore("qianfan", store), "qianfan");
  assert.equal(resolveSearchEngineSelectorFromStore("serpapi", store), "custom-serpapi");
});

test("normalizeSearchEngineStorePayload should backfill qianfan default for legacy single serpapi store", () => {
  const store = normalizeSearchEngineStorePayload({
    version: 1,
    defaultEngineId: "serpapi-default",
    engines: [
      {
        id: "serpapi-default",
        name: "SerpAPI Default",
        type: "serpapi",
        enabled: true,
        config: {
          endpoint: "https://serpapi.com/search.json",
          apiKey: "",
          engine: "google_news",
          hl: "zh-cn",
          gl: "cn",
          num: 10
        }
      }
    ]
  });

  assert.ok(store.engines.some((item) => item.id === "serpapi-default" && item.type === "serpapi"));
  assert.ok(store.engines.some((item) => item.id === "qianfan-default" && item.type === "qianfan"));
});
