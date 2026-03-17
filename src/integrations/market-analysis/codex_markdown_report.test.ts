import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexMarketReportSourceMarkdown,
  buildCodexMarketReportSystemPrompt
} from "./codex_markdown_report";

test("buildCodexMarketReportSystemPrompt should require legacy coverage in markdown report", () => {
  const prompt = buildCodexMarketReportSystemPrompt();
  assert.match(prompt, /旧链路补充信息（必须吸收）/);
  assert.match(prompt, /持仓逐项建议/);
  assert.match(prompt, /自然语言/);
  assert.match(prompt, /中文表达一致/);
  assert.match(prompt, /markdown 表格/);
});

test("buildCodexMarketReportSourceMarkdown should include legacy fund fields", () => {
  const sourceMarkdown = buildCodexMarketReportSourceMarkdown({
    phase: "close",
    analysisEngine: "codex",
    portfolio: {
      cash: 1000,
      funds: [{ code: "510300", name: "沪深300ETF", quantity: 100, avgCost: 4.2 }]
    },
    marketData: {
      assetType: "fund",
      errors: [],
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
      generatedAt: "2026-03-17T00:00:00.000Z",
      assetType: "fund",
      assetSignals: [{ code: "510300", signal: "HOLD" }],
      fund_dashboards: [
        {
          fund_code: "510300",
          fund_name: "沪深300ETF",
          decision_type: "hold",
          sentiment_score: 61,
          confidence: 0.66,
          core_conclusion: { one_sentence: "保持仓位，等待趋势确认。" },
          risk_alerts: ["波动率抬升"],
          action_plan: { suggestion: "保持持有", position_change: "维持仓位" },
          data_perspective: {
            return_metrics: { ret_20d: 1.23, ret_60d: 3.45 },
            risk_metrics: { max_drawdown: -2.8, volatility_annualized: 11.2 },
            relative_metrics: { benchmark_excess_20d: 0.8 },
            feature_coverage: "ok"
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
        errors: ["sample_audit_error"]
      }
    },
    optionalNewsContext: {
      funds: [
        {
          fund_code: "510300",
          fund_name: "沪深300ETF",
          market_news: []
        }
      ]
    }
  });

  assert.match(sourceMarkdown, /## 基金分析要点（自然语言）/);
  assert.match(sourceMarkdown, /当前建议: 持有。保持仓位，等待趋势确认。/);
  assert.match(sourceMarkdown, /关键数据: 特征覆盖: 完整；近20日收益: \+1.23%；近60日收益: \+3.45%/);
  assert.match(sourceMarkdown, /## 结构化数据附录（来自旧链路）/);
  assert.match(sourceMarkdown, /\| 基金 \| 建议动作 \| 信号强度 \| 关键数据速览 \| 数据完整性 \| 新闻检索 \|/);
  assert.match(sourceMarkdown, /### 附录补充字段（结构化）/);
  assert.match(sourceMarkdown, /数据完整性: 数据较完整。/);
  assert.match(sourceMarkdown, /新闻检索: SerpAPI\(google_news\) 命中 1 条/);
  assert.match(sourceMarkdown, /### 组合摘要/);
  assert.match(sourceMarkdown, /### 审计错误/);
});
