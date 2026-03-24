import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketReportSourceMarkdown,
  buildMarketReportSystemPrompt
} from "./llm_report_adapter";

test("buildMarketReportSystemPrompt should require dashboard-style markdown report", () => {
  const prompt = buildMarketReportSystemPrompt();
  assert.match(prompt, /持仓逐项建议/);
  assert.match(prompt, /手机端阅读/);
  assert.match(prompt, /自然语言/);
  assert.match(prompt, /短 bullet/);
  assert.match(prompt, /中文表达一致/);
  assert.match(prompt, /宽表最多 4 列/);
  assert.match(prompt, /素材包/);
  assert.match(prompt, /核心结论 \/ 数据视角 \/ 情报观察 \/ 执行计划/);
  assert.match(prompt, /不要为了简短主动省略/);
  assert.match(prompt, /内部校准口径/);
});

test("buildMarketReportSourceMarkdown should include fund dashboard context", () => {
  const sourceMarkdown = buildMarketReportSourceMarkdown({
    phase: "close",
    analysisEngine: "codex",
    portfolio: {
      cash: 1000,
      funds: [{ code: "510300", name: "沪深300ETF", quantity: 100, avgCost: 4.2 }]
    },
    marketData: {
      assetType: "fund",
      generatedAt: "2026-03-17T00:00:00.000Z",
      errors: [],
      source_chain: ["unit_test"],
      funds: [
        {
          identity: {
            fund_code: "510300",
            fund_name: "沪深300ETF",
            market: "sh",
            currency: "CNY",
            account_position: {
              quantity: 100,
              avg_cost: 4.2
            },
            fund_type: "etf",
            strategy_type: "index",
            tradable: "intraday",
            source_chain: ["unit_test"],
            errors: []
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
              nav_slope_20d: 0.01,
              sharpe: 1.1,
              sortino: 1.3,
              calmar: 0.9
            },
            coverage: "ok",
            confidence: 0.66,
            warnings: ["subscription_redemption_event"]
          },
          rule_context: {
            rule_flags: ["subscription_redemption_restriction"],
            rule_adjusted_score: 61,
            blocked_actions: ["buy"],
            hard_blocked: false
          },
          raw_llm_text: "",
          llm_provider: "unit_test",
          llm_errors: [],
          raw_context: {
            identity: {
              fund_code: "510300",
              fund_name: "沪深300ETF",
              market: "sh",
              currency: "CNY",
              account_position: {
                quantity: 100,
                avg_cost: 4.2
              },
              fund_type: "etf",
              strategy_type: "index",
              tradable: "intraday",
              source_chain: ["unit_test"],
              errors: []
            },
            as_of_date: "2026-03-17",
            price_or_nav_series: [
              { date: "2026-03-13", value: 4.05 },
              { date: "2026-03-14", value: 4.12 },
              { date: "2026-03-17", value: 4.28 }
            ],
            holdings_style: {
              top_holdings: ["贵州茅台(9.80%)", "宁德时代(8.12%)"],
              sector_exposure: {},
              style_factor_exposure: {},
              duration_credit_profile: {}
            },
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
            source_chain: [
              "search_provider:serpapi",
              "search_provider_variant:serpapi:google_news",
              "search_status:hit"
            ],
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
              regulatory_risks: ["收到例行监管问询"],
              market_news: [{ title: "基金公告更新", source: "中证网" }]
            }
          }
        }
      ]
    },
    signalResult: {
      phase: "close",
      marketState: "MARKET_NEUTRAL",
      comparisonReference: "同类基金百分位",
      generatedAt: "2026-03-17T00:00:00.000Z",
      assetSignals: [{ code: "510300", signal: "HOLD" }],
      assetType: "fund",
      fund_dashboards: [
        {
          fund_code: "510300",
          fund_name: "沪深300ETF",
          as_of_date: "2026-03-17",
          decision_type: "hold",
          sentiment_score: 61,
          confidence: 0.66,
          core_conclusion: {
            one_sentence: "保持仓位，等待趋势确认。",
            thesis: ["短线动能仍在", "申赎约束限制追高"]
          },
          risk_alerts: ["波动率抬升"],
          action_plan: {
            suggestion: "保持持有",
            position_change: "维持仓位",
            execution_conditions: ["回撤不再扩大"],
            stop_conditions: ["跌破关键均线"]
          },
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
            rule_flags: ["subscription_redemption_restriction"],
            adjusted_score: 61
          },
          insufficient_data: {
            is_insufficient: false,
            missing_fields: []
          }
        }
      ],
      portfolio_report: {
        brief: "组合以防守为主，仓位不做激进调整。",
        full: ""
      },
      audit: {
        steps: [],
        errors: ["sample_audit_error"]
      }
    },
    optionalNewsContext: {
      funds: [
        {
          fund_code: "510300",
          fund_name: "沪深300ETF",
          market_news: [],
          source_chain: [],
          errors: []
        }
      ]
    }
  });

  assert.match(sourceMarkdown, /## 持仓逐项建议/);
  assert.match(sourceMarkdown, /### 沪深300ETF\(510300\)/);
  assert.match(sourceMarkdown, /#### 核心结论/);
  assert.match(sourceMarkdown, /当前动作: 持有/);
  assert.match(sourceMarkdown, /一句话判断: 保持仓位，等待趋势确认。/);
  assert.match(sourceMarkdown, /信号概览: 信号偏积极，证据支撑尚可/);
  assert.match(sourceMarkdown, /#### 数据视角/);
  assert.match(sourceMarkdown, /净值快照: 基金最新值 4\.28 \(2026-03-17\)；同类百分位 88\.2 \(2026-03-17\)；基金近60日区间 4\.05 - 4\.28/);
  assert.match(sourceMarkdown, /收益表现: 近1日回报\+0\.45%；近5日回报\+1\.56%；近20日回报\+1\.23%；近60日回报\+3\.45%；近120日回报\+6\.78%/);
  assert.match(sourceMarkdown, /风险刻画: 最大回撤-2\.8%；年化波动11\.2%；回撤修复8天/);
  assert.match(sourceMarkdown, /相对表现: 同类分位88\.2；20日分位变化\+6\.4；60日分位变化\+10\.8；同类排名18\/240/);
  assert.match(sourceMarkdown, /交易结构: MA5 4\.18；MA10 4\.12；MA20 4\.05/);
  assert.match(sourceMarkdown, /#### 情报观察/);
  assert.match(sourceMarkdown, /公告\/提示: 披露季度报告/);
  assert.match(sourceMarkdown, /基金经理变化: 基金经理分工调整/);
  assert.match(sourceMarkdown, /现任基金经理: 张三；李四/);
  assert.match(sourceMarkdown, /十大重仓参考: 贵州茅台\(9\.80%\)；宁德时代\(8\.12%\)/);
  assert.match(sourceMarkdown, /申购赎回约束: 暂停大额申购/);
  assert.match(sourceMarkdown, /新闻检索: SerpAPI\(google_news\) 命中 1 条/);
  assert.match(sourceMarkdown, /#### 执行计划/);
  assert.match(sourceMarkdown, /操作建议: 保持持有/);
  assert.match(sourceMarkdown, /规则约束: 当前不宜做 买入；需要留意 存在申购赎回限制；规则倾向 偏稳健/);
  assert.match(sourceMarkdown, /持仓背景: 当前持仓 100；持仓成本 4\.2；估算市值 428；浮动盈亏 \+1\.9%；可用预算 1000；风险偏好 均衡；持有周期 中期/);
  assert.match(sourceMarkdown, /检查清单: /);
  assert.match(sourceMarkdown, /### 组合层判断/);
  assert.match(sourceMarkdown, /### 运行中需要注意/);
});
