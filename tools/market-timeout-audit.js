#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

function loadJson(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function toTimestamp(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

function pickLatestRunWithLlmSteps(runsMap) {
  const runs = Object.values(runsMap || {}).filter((run) => run && typeof run === "object");
  runs.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
  for (const run of runs) {
    const steps = run?.signalResult?.audit?.steps;
    if (!Array.isArray(steps)) {
      continue;
    }
    if (steps.some((step) => String(step?.step || "").startsWith("llm:"))) {
      return run;
    }
  }
  return null;
}

function collectLlmStepMetrics(steps) {
  const llmSteps = (Array.isArray(steps) ? steps : []).filter((step) =>
    String(step?.step || "").startsWith("llm:")
  );
  const totalDuration = llmSteps.reduce((sum, step) => {
    const duration = Number(step?.duration_ms);
    return sum + (Number.isFinite(duration) ? duration : 0);
  }, 0);

  let timeoutCount = 0;
  for (const step of llmSteps) {
    const errors = Array.isArray(step?.errors) ? step.errors : [];
    for (const err of errors) {
      if (String(err).includes("codex timeout after 15000ms")) {
        timeoutCount += 1;
      }
    }
  }

  const llmStepCount = llmSteps.length;
  const avgDuration = llmStepCount > 0 ? totalDuration / llmStepCount : 0;
  const timeoutPerStep = llmStepCount > 0 ? timeoutCount / llmStepCount : 0;

  return {
    llmStepCount,
    avgDuration,
    timeoutCount,
    timeoutPerStep,
  };
}

function main() {
  const marketConfig = loadJson("data/market-analysis/config.json");
  const providersConfig = loadJson("data/llm/providers.json");
  const runsConfig = loadJson("data/market-analysis/runs.json");

  const analysisEngine = String(marketConfig?.analysisEngine || "");
  const llmRetryMax = marketConfig?.fund?.llmRetryMax;
  const provider = (providersConfig?.providers || []).find((item) => item?.id === analysisEngine);
  const providerTimeoutMs = provider?.config?.timeoutMs;

  const run = pickLatestRunWithLlmSteps(runsConfig?.runs);
  if (!run) {
    console.log(`analysisEngine=${analysisEngine}`);
    console.log(`fund.llmRetryMax=${llmRetryMax ?? ""}`);
    console.log("run.id=");
    console.log("run.createdAt=");
    console.log("llm_step_count=0");
    console.log("llm_avg_duration_ms=0");
    console.log("codex_timeout_after_15000ms_count=0");
    console.log("codex_timeout_after_15000ms_per_llm_step=0");
    console.log(`analysisEngine.providerTimeoutMs=${providerTimeoutMs ?? ""}`);
    process.exit(0);
  }

  const metrics = collectLlmStepMetrics(run?.signalResult?.audit?.steps);

  console.log(`analysisEngine=${analysisEngine}`);
  console.log(`fund.llmRetryMax=${llmRetryMax ?? ""}`);
  console.log(`run.id=${run.id || ""}`);
  console.log(`run.createdAt=${run.createdAt || ""}`);
  console.log(`llm_step_count=${metrics.llmStepCount}`);
  console.log(`llm_avg_duration_ms=${metrics.avgDuration.toFixed(2)}`);
  console.log(`codex_timeout_after_15000ms_count=${metrics.timeoutCount}`);
  console.log(`codex_timeout_after_15000ms_per_llm_step=${metrics.timeoutPerStep.toFixed(2)}`);
  console.log(`analysisEngine.providerTimeoutMs=${providerTimeoutMs ?? ""}`);
}

main();
