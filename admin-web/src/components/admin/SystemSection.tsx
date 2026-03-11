import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MemorySection } from "@/components/admin/MemorySection";
import { AdminConfig } from "@/types/admin";

export type SystemOllamaDraft = {
  model: string;
  planningModel: string;
  planningTimeoutMs: string;
  thinkingBudgetEnabled: boolean;
  thinkingBudgetDefault: string;
};

export type SystemOpenAIDraft = {
  baseUrl: string;
  apiKey: string;
  model: string;
  planningModel: string;
  chatOptions: string;
  planningChatOptions: string;
  fallbackToChatgptBridge: boolean;
  forceBridge: boolean;
  quotaResetDay: string;
  monthlyTokenLimit: string;
  monthlyBudgetUsd: string;
  costInputPer1M: string;
  costOutputPer1M: string;
};

export type SystemMemoryDraft = {
  memoryCompactEveryRounds: string;
  memoryCompactMaxBatchSize: string;
  memorySummaryTopK: string;
  memoryRawRefLimit: string;
  memoryRawRecordLimit: string;
  memoryRagSummaryTopK: string;
};

export type SystemOperationState = {
  savingModel: boolean;
  restarting: boolean;
  pullingRepo: boolean;
  buildingRepo: boolean;
  deployingRepo: boolean;
};

type SystemSectionProps = {
  config: AdminConfig | null;
  models: string[];
  modelFromList?: string;
  planningModelFromList?: string;
  ollamaDraft: SystemOllamaDraft;
  openaiDraft: SystemOpenAIDraft;
  memoryDraft: SystemMemoryDraft;
  operationState: SystemOperationState;
  savingMemoryConfig: boolean;
  onOllamaDraftChange: <K extends keyof SystemOllamaDraft>(key: K, value: SystemOllamaDraft[K]) => void;
  onOpenAIDraftChange: <K extends keyof SystemOpenAIDraft>(key: K, value: SystemOpenAIDraft[K]) => void;
  onMemoryDraftChange: <K extends keyof SystemMemoryDraft>(key: K, value: SystemMemoryDraft[K]) => void;
  onRefreshModels: () => void;
  onRefreshConfig: () => void;
  onSaveModel: (restartAfterSave: boolean) => void;
  onSaveMemoryConfig: () => void;
  onRestartPm2: () => void;
  onPullRepo: () => void;
  onBuildRepo: () => void;
  onDeployRepo: () => void;
};

type SystemModule = "operations" | "ollama" | "openai" | "memory" | "runtime";

const MODULE_ITEMS: Array<{ key: SystemModule; label: string }> = [
  { key: "operations", label: "运维操作" },
  { key: "ollama", label: "Ollama / Planning" },
  { key: "openai", label: "OpenAI" },
  { key: "memory", label: "Memory" },
  { key: "runtime", label: "运行时" }
];

export function SystemSection(props: SystemSectionProps) {
  const [activeModule, setActiveModule] = useState<SystemModule>("operations");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>系统设置模块</CardTitle>
          <CardDescription>使用页内 Tab 切换系统配置模块</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {MODULE_ITEMS.map((item) => (
              <Button
                key={item.key}
                type="button"
                variant={activeModule === item.key ? "default" : "outline"}
                onClick={() => setActiveModule(item.key)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {activeModule === "operations" ? (
        <Card>
          <CardHeader>
            <CardTitle>系统运维操作</CardTitle>
            <CardDescription>先执行一键部署，或按需拆分执行同步、构建、重启</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" disabled={props.operationState.deployingRepo} onClick={props.onDeployRepo}>
              {props.operationState.deployingRepo ? "部署中..." : "一键部署（gpr + build + pm2 restart）"}
            </Button>
            <Button type="button" variant="outline" disabled={props.operationState.pullingRepo} onClick={props.onPullRepo}>
              {props.operationState.pullingRepo ? "同步中..." : "同步远端代码（gpr）"}
            </Button>
            <Button type="button" variant="secondary" disabled={props.operationState.buildingRepo} onClick={props.onBuildRepo}>
              {props.operationState.buildingRepo ? "构建中..." : "执行项目构建（npm run build）"}
            </Button>
            <Button type="button" variant="destructive" disabled={props.operationState.restarting} onClick={props.onRestartPm2}>
              {props.operationState.restarting ? "重启中..." : "重启应用进程（pm2）"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {activeModule === "ollama" ? (
        <Card>
          <CardHeader>
            <CardTitle>Ollama 与 Planning</CardTitle>
            <CardDescription>本地模型与规划调用参数</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>主模型列表（Ollama）</Label>
                <Select value={props.modelFromList} onValueChange={(value) => props.onOllamaDraftChange("model", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="从本地模型中选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.models.length === 0 ? (
                      <SelectItem value="__empty__" disabled>
                        未读取到模型
                      </SelectItem>
                    ) : (
                      props.models.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>主模型</Label>
                <Input
                  value={props.ollamaDraft.model}
                  onChange={(event) => props.onOllamaDraftChange("model", event.target.value)}
                  placeholder="例如：qwen3:8b"
                />
              </div>

              <div className="space-y-2">
                <Label>Planning 模型列表（可选）</Label>
                <Select
                  value={props.planningModelFromList}
                  onValueChange={(value) => props.onOllamaDraftChange("planningModel", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="可选：单独选择 Planning 模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.models.length === 0 ? (
                      <SelectItem value="__empty__" disabled>
                        未读取到模型
                      </SelectItem>
                    ) : (
                      props.models.map((model) => (
                        <SelectItem key={`planning-${model}`} value={model}>
                          {model}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Planning 模型（可选）</Label>
                <Input
                  value={props.ollamaDraft.planningModel}
                  onChange={(event) => props.onOllamaDraftChange("planningModel", event.target.value)}
                  placeholder="留空则跟随主模型"
                />
              </div>

              <div className="space-y-2">
                <Label>Planning 超时（毫秒，可选）</Label>
                <Input
                  type="number"
                  min={1}
                  value={props.ollamaDraft.planningTimeoutMs}
                  onChange={(event) => props.onOllamaDraftChange("planningTimeoutMs", event.target.value)}
                  placeholder="留空则沿用 LLM_TIMEOUT_MS"
                />
              </div>

              <div className="space-y-2">
                <Label>Planning Thinking Budget 默认值</Label>
                <Input
                  type="number"
                  min={1}
                  value={props.ollamaDraft.thinkingBudgetDefault}
                  onChange={(event) => props.onOllamaDraftChange("thinkingBudgetDefault", event.target.value)}
                  placeholder="tokens，建议 >= 1024"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Qwen Thinking Budget 开关</Label>
                <div className="flex min-h-10 items-center gap-3 rounded-md border px-3">
                  <Switch
                    checked={props.ollamaDraft.thinkingBudgetEnabled}
                    onCheckedChange={(value) => props.onOllamaDraftChange("thinkingBudgetEnabled", value)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {props.ollamaDraft.thinkingBudgetEnabled ? "已开启：按预算截断思考后续写" : "已关闭：按常规方式调用 LLM"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={props.onRefreshModels}>
                刷新模型列表
              </Button>
              <Button type="button" disabled={props.operationState.savingModel} onClick={() => props.onSaveModel(false)}>
                {props.operationState.savingModel ? "保存中..." : "保存模型配置"}
              </Button>
              <Button
                type="button"
                disabled={props.operationState.savingModel}
                variant="secondary"
                onClick={() => props.onSaveModel(true)}
              >
                {props.operationState.savingModel ? "处理中..." : "保存并重启"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeModule === "openai" ? (
        <Card>
          <CardHeader>
            <CardTitle>OpenAI 与 Bridge 回退</CardTitle>
            <CardDescription>可配置 API 调用、配额阈值和 bridge 回退策略</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>OPENAI_BASE_URL</Label>
                <Input
                  value={props.openaiDraft.baseUrl}
                  onChange={(event) => props.onOpenAIDraftChange("baseUrl", event.target.value)}
                  placeholder="留空使用默认 https://api.openai.com/v1"
                />
              </div>
              <div className="space-y-2">
                <Label>OPENAI_API_KEY</Label>
                <Input
                  type="password"
                  value={props.openaiDraft.apiKey}
                  onChange={(event) => props.onOpenAIDraftChange("apiKey", event.target.value)}
                  placeholder="sk-..."
                />
              </div>
              <div className="space-y-2">
                <Label>OPENAI_MODEL</Label>
                <Input
                  value={props.openaiDraft.model}
                  onChange={(event) => props.onOpenAIDraftChange("model", event.target.value)}
                  placeholder="例如：gpt-5"
                />
              </div>
              <div className="space-y-2">
                <Label>OPENAI_PLANNING_MODEL（可选）</Label>
                <Input
                  value={props.openaiDraft.planningModel}
                  onChange={(event) => props.onOpenAIDraftChange("planningModel", event.target.value)}
                  placeholder="留空则跟随 OPENAI_MODEL"
                />
              </div>
              <div className="space-y-2">
                <Label>OPENAI_QUOTA_RESET_DAY</Label>
                <Input
                  type="number"
                  min={1}
                  value={props.openaiDraft.quotaResetDay}
                  onChange={(event) => props.onOpenAIDraftChange("quotaResetDay", event.target.value)}
                  placeholder="例如：1"
                />
              </div>
              <div className="space-y-2">
                <Label>OPENAI_MONTHLY_TOKEN_LIMIT</Label>
                <Input
                  type="number"
                  min={1}
                  value={props.openaiDraft.monthlyTokenLimit}
                  onChange={(event) => props.onOpenAIDraftChange("monthlyTokenLimit", event.target.value)}
                  placeholder="月度 token 上限"
                />
              </div>
              <div className="space-y-2">
                <Label>OPENAI_MONTHLY_BUDGET_USD</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={props.openaiDraft.monthlyBudgetUsd}
                  onChange={(event) => props.onOpenAIDraftChange("monthlyBudgetUsd", event.target.value)}
                  placeholder="月度预算（USD）"
                />
              </div>
              <div className="space-y-2">
                <Label>OPENAI_COST_INPUT_PER_1M</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={props.openaiDraft.costInputPer1M}
                  onChange={(event) => props.onOpenAIDraftChange("costInputPer1M", event.target.value)}
                  placeholder="每百万输入 tokens 成本（USD）"
                />
              </div>
              <div className="space-y-2">
                <Label>OPENAI_COST_OUTPUT_PER_1M</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={props.openaiDraft.costOutputPer1M}
                  onChange={(event) => props.onOpenAIDraftChange("costOutputPer1M", event.target.value)}
                  placeholder="每百万输出 tokens 成本（USD）"
                />
              </div>
              <div className="space-y-2">
                <Label>OpenAI 额度用尽回退 bridge</Label>
                <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
                  <span className="text-sm text-muted-foreground">OPENAI_FALLBACK_TO_CHATGPT_BRIDGE</span>
                  <Switch
                    checked={props.openaiDraft.fallbackToChatgptBridge}
                    onCheckedChange={(value) => props.onOpenAIDraftChange("fallbackToChatgptBridge", value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>强制走 bridge</Label>
                <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
                  <span className="text-sm text-muted-foreground">OPENAI_FORCE_BRIDGE</span>
                  <Switch
                    checked={props.openaiDraft.forceBridge}
                    onCheckedChange={(value) => props.onOpenAIDraftChange("forceBridge", value)}
                  />
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>OPENAI_CHAT_OPTIONS（JSON）</Label>
                <Textarea
                  value={props.openaiDraft.chatOptions}
                  onChange={(event) => props.onOpenAIDraftChange("chatOptions", event.target.value)}
                  placeholder='例如：{"temperature":0.2}'
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>OPENAI_PLANNING_CHAT_OPTIONS（JSON）</Label>
                <Textarea
                  value={props.openaiDraft.planningChatOptions}
                  onChange={(event) => props.onOpenAIDraftChange("planningChatOptions", event.target.value)}
                  placeholder='例如：{"temperature":0.1}'
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={props.operationState.savingModel} onClick={() => props.onSaveModel(false)}>
                {props.operationState.savingModel ? "保存中..." : "保存模型配置"}
              </Button>
              <Button
                type="button"
                disabled={props.operationState.savingModel}
                variant="secondary"
                onClick={() => props.onSaveModel(true)}
              >
                {props.operationState.savingModel ? "处理中..." : "保存并重启"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              OpenAI 字段与 Ollama 字段共用“保存模型配置”按钮，留空会清理对应环境变量。
            </p>
          </CardContent>
        </Card>
      ) : null}

      {activeModule === "memory" ? (
        <MemorySection
          config={props.config}
          memoryCompactEveryRoundsDraft={props.memoryDraft.memoryCompactEveryRounds}
          memoryCompactMaxBatchSizeDraft={props.memoryDraft.memoryCompactMaxBatchSize}
          memorySummaryTopKDraft={props.memoryDraft.memorySummaryTopK}
          memoryRawRefLimitDraft={props.memoryDraft.memoryRawRefLimit}
          memoryRawRecordLimitDraft={props.memoryDraft.memoryRawRecordLimit}
          memoryRagSummaryTopKDraft={props.memoryDraft.memoryRagSummaryTopK}
          savingMemoryConfig={props.savingMemoryConfig}
          onMemoryCompactEveryRoundsDraftChange={(value) => props.onMemoryDraftChange("memoryCompactEveryRounds", value)}
          onMemoryCompactMaxBatchSizeDraftChange={(value) => props.onMemoryDraftChange("memoryCompactMaxBatchSize", value)}
          onMemorySummaryTopKDraftChange={(value) => props.onMemoryDraftChange("memorySummaryTopK", value)}
          onMemoryRawRefLimitDraftChange={(value) => props.onMemoryDraftChange("memoryRawRefLimit", value)}
          onMemoryRawRecordLimitDraftChange={(value) => props.onMemoryDraftChange("memoryRawRecordLimit", value)}
          onMemoryRagSummaryTopKDraftChange={(value) => props.onMemoryDraftChange("memoryRagSummaryTopK", value)}
          onSaveMemoryConfig={props.onSaveMemoryConfig}
          onRefresh={props.onRefreshConfig}
        />
      ) : null}

      {activeModule === "runtime" ? (
        <Card>
          <CardHeader>
            <CardTitle>运行时信息</CardTitle>
            <CardDescription>当前生效配置快照</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
              <div className="mono">env: {props.config?.envPath ?? "-"}</div>
              <div className="mono">timezone: {props.config?.timezone ?? "-"}</div>
              <div className="mono">ollamaModel: {props.config?.model || "-"}</div>
              <div className="mono">planningModel: {props.config?.planningModel || "(follow OLLAMA_MODEL)"}</div>
              <div className="mono">planningTimeoutMs: {props.config?.planningTimeoutMs || "(follow LLM_TIMEOUT_MS)"}</div>
              <div className="mono">thinkingBudgetEnabled: {props.config?.thinkingBudgetEnabled ? "true" : "false"}</div>
              <div className="mono">
                planningThinkingBudgetDefault: {props.config?.thinkingBudgetDefault || props.config?.thinkingBudget || "(default 1024)"}
              </div>
              <div className="mono">openaiModel: {props.config?.openaiModel || "(disabled)"}</div>
              <div className="mono">openaiPlanningModel: {props.config?.openaiPlanningModel || "(follow OPENAI_MODEL)"}</div>
              <div className="mono">openaiFallbackToBridge: {props.config?.openaiFallbackToChatgptBridge ? "true" : "false"}</div>
              <div className="mono">openaiForceBridge: {props.config?.openaiForceBridge ? "true" : "false"}</div>
              <div className="mono">codexModel: {props.config?.codexModel || "(follow Codex default)"}</div>
              <div className="mono">codexReasoningEffort: {props.config?.codexReasoningEffort || "(follow Codex default)"}</div>
              <div className="mono">taskStore: {props.config?.taskStore?.name ?? "-"}</div>
              <div className="mono">tickMs: {props.config?.tickMs ?? "-"}</div>
              <div className="mono md:col-span-2">
                userStore: {props.config?.userStore?.name ?? "-"} ({props.config?.userStore?.driver ?? "-"})
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
