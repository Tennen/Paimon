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
            price_or_nav_series: [
              { date: "2026-03-13", value: 4.05 },
              { date: "2026-03-14", value: 4.12 },
              { date: "2026-03-17", value: 4.28 }
            ],
            benchmark_series: [
              { date: "2026-03-13", value: 3988 },
              { date: "2026-03-14", value: 4002 },
              { date: "2026-03-17", value: 4015 }
            ],
            source_chain: ["serpapi:google_news"],
            errors: [],
            account_context: {
              current_position: 100,
              avg_cost: 4.2,
              budget: 1000,
              risk_preference: "balanced",
              holding_horizon: "medium_term"
            },
            events: {
              notices: ["披露季度报告"],
              manager_changes: ["基金经理分工调整"],
              subscription_redemption: ["暂停大额申购"],
              regulatory_risks: [],
              market_news: [{ title: "基金公告更新", source: "中证网" }]
            }
          },
          feature_context: {
            returns: {
              ret_1d: 0.45,
              ret_5d: 1.56,
              ret_20d: 1.23,
              ret_60d: 3.45,
              ret_120d: 6.78
            },
            risk: {
              max_drawdown: -2.8,
              volatility_annualized: 11.2,
              drawdown_recovery_days: 8
            },
            relative: {
              benchmark_excess_20d: 0.8,
              benchmark_excess_60d: 1.1,
              tracking_deviation: 0.9
            },
            trading: {
              ma5: 4.18,
              ma10: 4.12,
              ma20: 4.05,
              volume_change_rate: 5.4
            },
            stability: {
              excess_return_consistency: 1.2
            },
            nav: {
              sharpe: 1.1,
              sortino: 1.3,
              calmar: 0.9,
              nav_slope_20d: 0.01
            },
            warnings: ["subscription_redemption_event"]
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
          },
          rule_trace: {
            blocked_actions: ["buy"],
            rule_flags: ["subscription_redemption_restriction"]
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
  assert.match(text, /数据视角: 数据完整性=完整；最新值=基金 4\.28\/基准 4015；短线回报=1日\+0\.45%\/5日\+1\.56%；中期回报=20日\+1\.23%\/60日\+3\.45%\/120日\+6\.78%/);
  assert.match(text, /情报观察: 风险提示=波动率抬升；公告\/提示=披露季度报告；基金经理变化=基金经理分工调整；申赎约束=暂停大额申购；SerpAPI\(google_news\) 命中 1 条；样本=基金公告更新 \(中证网\)/);
  assert.match(text, /执行计划: 持仓者继续持有；未持仓者暂不追高；仓位处理=维持仓位；规则约束=禁止buy\/风控标记subscription_redemption_restriction；持仓背景=当前持仓100\/成本4\.2\/估算市值428\/估算盈亏\+1\.9%\/预算1000\/风险偏好均衡\/周期中期/);
  assert.match(text, /检查清单: /);
});
