import assert from "node:assert/strict";
import test from "node:test";
import { buildFundNewsSearchPlans, normalizeFundNewsQuerySuffix } from "./search_adapter";

test("normalizeFundNewsQuerySuffix should expand shorthand and inject fund-specific keywords", () => {
  const etfSuffix = normalizeFundNewsQuerySuffix("基金 公告 经理 申赎 风险", "沪深300ETF", "etf", "index");
  assert.match(etfSuffix, /基金经理/);
  assert.match(etfSuffix, /申购/);
  assert.match(etfSuffix, /赎回/);
  assert.match(etfSuffix, /份额/);
  assert.match(etfSuffix, /折溢价/);
  assert.match(etfSuffix, /跟踪误差/);

  const activeFundSuffix = normalizeFundNewsQuerySuffix("", "易方达蓝筹精选混合", "otc_public", "mixed");
  assert.match(activeFundSuffix, /净值/);
  assert.match(activeFundSuffix, /赎回/);
});

test("normalizeFundNewsQuerySuffix should switch keywords for bond and qdii funds", () => {
  const bondSuffix = normalizeFundNewsQuerySuffix("", "广发纯债债券A", "otc_public", "bond");
  assert.match(bondSuffix, /久期/);
  assert.match(bondSuffix, /信用/);

  const qdiiSuffix = normalizeFundNewsQuerySuffix("", "纳斯达克100QDII", "otc_public", "qdii");
  assert.match(qdiiSuffix, /海外/);
  assert.match(qdiiSuffix, /汇率/);
});

test("buildFundNewsSearchPlans should include relaxed chinese fund queries and site-focused fallback", () => {
  const plans = buildFundNewsSearchPlans({
    fundCode: "510300",
    fundName: "沪深300ETF",
    fundType: "etf",
    strategyType: "index",
    querySuffix: "基金 公告 经理 申赎 风险"
  });

  assert.ok(plans.length >= 4);
  assert.equal(plans[0].label, "name_keywords");
  assert.match(plans[0].query, /沪深300ETF/);
  assert.doesNotMatch(plans[0].query, /510300/);
  assert.match(plans[0].query, /基金经理/);
  assert.match(plans[0].query, /申购/);
  assert.match(plans[0].query, /赎回/);
  assert.equal(plans[0].recency, "month");

  const codePlan = plans.find((item) => item.label === "name_code_keywords");
  assert.ok(codePlan);
  assert.match(codePlan?.query || "", /510300/);

  const eastmoneyPlan = plans.find((item) => item.label === "eastmoney_focus");
  assert.ok(eastmoneyPlan);
  assert.deepEqual(eastmoneyPlan?.sites, ["eastmoney.com"]);
  assert.doesNotMatch(eastmoneyPlan?.query || "", /site:eastmoney\.com/);
});
