import assert from "node:assert/strict";
import test from "node:test";
import { buildQianfanRequestBody } from "./qianfan";
import { readSearchProviderDescriptor } from "./types";
import type { QianfanSearchEngineProfile } from "./types";

function buildProfile(): QianfanSearchEngineProfile {
  return {
    id: "qianfan-default",
    name: "Qianfan Default",
    type: "qianfan",
    enabled: true,
    config: {
      endpoint: "https://qianfan.baidubce.com/v2/ai_search/web_search",
      apiKey: "test-key",
      searchSource: "baidu_search_v2",
      edition: "standard",
      topK: 12,
      recencyFilter: "month",
      safeSearch: true
    }
  };
}

test("buildQianfanRequestBody should map generic plans to qianfan request schema", () => {
  const body = buildQianfanRequestBody(buildProfile(), {
    label: "eastmoney_focus",
    query: "沪深300ETF 公告 风险".repeat(10),
    sites: ["eastmoney.com"],
    recency: "week"
  }, 18);

  assert.equal(body.search_source, "baidu_search_v2");
  assert.equal(body.edition, "standard");
  assert.equal(body.resource_type_filter[0]?.type, "web");
  assert.equal(body.resource_type_filter[0]?.top_k, 18);
  assert.equal(body.search_recency_filter, "week");
  assert.deepEqual(body.search_filter?.match?.site, ["eastmoney.com"]);
  assert.equal(body.safe_search, true);
  assert.ok(body.messages[0]?.content.length > 0);
  assert.ok(body.messages[0]?.content.length <= 72);
});

test("readSearchProviderDescriptor should expose provider label from source chain", () => {
  const descriptor = readSearchProviderDescriptor([
    "search_provider:qianfan",
    "search_provider_variant:qianfan:baidu_search_v2",
    "search_status:hit"
  ]);

  assert.deepEqual(descriptor, {
    type: "qianfan",
    variant: "baidu_search_v2",
    label: "百度搜索"
  });
});
