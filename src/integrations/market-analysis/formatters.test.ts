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
            source_chain: ["serpapi:google_news"],
            errors: [],
            reference_context: {
              comparison_reference: "同类基金百分位",
              estimated_nav: 4.3,
              estimated_nav_date: "2026-03-17",
              estimated_nav_time: "14:35:00",
              estimated_change_pct: 0.47,
              peer_percentile: 88.2,
              peer_rank_position: 18,
              peer_rank_total: 240,
              peer_percentile_series: [
                { date: "2026-03-13", value: 84.5 },
                { date: "2026-03-14", value: 86.1 },
                { date: "2026-03-17", value: 88.2 }
              ],
              current_managers: ["张三", "李四"]
            },
            holdings_style: {
              top_holdings: ["贵州茅台(9.80%)", "宁德时代(8.12%)"],
              sector_exposure: {},
              style_factor_exposure: {},
              duration_credit_profile: {}
            },
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
              peer_percentile: 88.2,
              peer_percentile_change_20d: 6.4,
              peer_percentile_change_60d: 10.8,
              peer_rank_position: 18,
              peer_rank_total: 240
            },
            trading: {
              ma5: 4.18,
              ma10: 4.12,
              ma20: 4.05,
              premium_discount: "not_supported"
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
      comparisonReference: "同类基金百分位",
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
            relative_metrics: {
              peer_percentile: 88.2,
              peer_percentile_change_20d: 6.4,
              peer_percentile_change_60d: 10.8,
              peer_rank_position: 18,
              peer_rank_total: 240
            },
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
  assert.match(text, /数据视角: 数据完整性=完整；最新值=基金 4\.28；短线回报=1日\+0\.45%\/5日\+1\.56%；中期回报=20日\+1\.23%\/60日\+3\.45%\/120日\+6\.78%；风险=回撤-2\.8%\/波动11\.2%\/修复8天；相对表现=同类分位88\.2\/20日分位变化\+6\.4\/60日分位变化\+10\.8\/同类排名18\/240/);
  assert.match(text, /情报观察: 风险提示=波动率抬升；公告\/提示=披露季度报告；基金经理变化=基金经理分工调整；现任基金经理=张三；李四；重仓参考=贵州茅台\(9\.80%\)；宁德时代\(8\.12%\)/);
  assert.match(text, /执行计划: 持仓者继续持有；未持仓者暂不追高；仓位处理=维持仓位；规则约束=禁止buy\/风控标记subscription_redemption_restriction；持仓背景=当前持仓100\/成本4\.2\/估算市值428\/估算盈亏\+1\.9%\/预算1000\/风险偏好均衡\/周期中期/);
  assert.match(text, /检查清单: /);
});
