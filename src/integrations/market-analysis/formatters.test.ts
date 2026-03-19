import assert from "node:assert/strict";
import test from "node:test";
import { buildRunResponseText } from "./formatters";

test("buildRunResponseText should format fund output as dashboard-style sections", () => {
  const text = buildRunResponseText({
    marketData: {
      funds: [
        {
          identity: { fund_code: "510300" },
          raw_context: {
            source_chain: ["serpapi:google_news"],
            errors: [],
            events: {
              market_news: [{ title: "基金公告更新", source: "中证网" }]
            }
          }
        }
      ]
    },
    signalResult: {
      phase: "close",
      marketState: "MARKET_NEUTRAL",
      benchmark: "000300",
      assetType: "fund",
      fund_dashboards: [
        {
          fund_code: "510300",
          fund_name: "沪深300ETF",
          decision_type: "hold",
          sentiment_score: 61,
          confidence: 0.66,
          core_conclusion: { one_sentence: "保持仓位，等待趋势确认。" },
          risk_alerts: ["波动率抬升"],
          action_plan: { suggestion: "持仓者继续持有；未持仓者暂不追高", position_change: "维持仓位" },
          data_perspective: {
            return_metrics: { ret_20d: 1.23, ret_60d: 3.45 },
            risk_metrics: { max_drawdown: -2.8, volatility_annualized: 11.2 },
            relative_metrics: { benchmark_excess_20d: 0.8 },
            feature_coverage: "ok"
          }
        }
      ],
      portfolio_report: {
        brief: "组合以防守为主。",
        full: ""
      }
    }
  });

  assert.match(text, /核心结论: hold。保持仓位，等待趋势确认。/);
  assert.match(text, /数据视角: 数据完整性=完整；近20日回报=\+1.23%；近60日回报=\+3.45%/);
  assert.match(text, /情报观察: 波动率抬升；SerpAPI\(google_news\) 命中 1 条；样本=基金公告更新 \(中证网\)/);
  assert.match(text, /执行计划: 持仓者继续持有；未持仓者暂不追高；仓位处理=维持仓位/);
  assert.match(text, /检查清单: /);
});
