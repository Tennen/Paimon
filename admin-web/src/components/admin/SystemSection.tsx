import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import {
  AdminConfig,
  LLMProviderProfile,
  LLMProviderStore,
  LLMProviderType,
  SearchEngineProfile,
  SearchEngineStore
} from "@/types/admin";

export type SystemMemoryDraft = {
  memoryCompactEveryRounds: string;
  memoryCompactMaxBatchSize: string;
  memorySummaryTopK: string;
  memoryRawRefLimit: string;
  memoryRawRecordLimit: string;
  memoryRagSummaryTopK: string;
};

export type SystemOperationState = {
  restarting: boolean;
  pullingRepo: boolean;
  buildingRepo: boolean;
  deployingRepo: boolean;
};

export type MainFlowProviderSelectionDraft = {
  defaultProviderId: string;
  routingProviderId: string;
  planningProviderId: string;
};

type SystemProviderDraft = {
  id: string;
  name: string;
  type: LLMProviderType;
  baseUrl: string;
  apiKey: string;
  chatCompletionsPath: string;
  model: string;
  planningModel: string;
  timeoutMs: string;
  planningTimeoutMs: string;
  maxRetries: string;
  strictJson: boolean;
  thinkingBudgetEnabled: boolean;
  thinkingBudget: string;
  thinkingMaxNewTokens: string;
  selectionOptions: string;
  planningOptions: string;
  chatTemplateKwargs: string;
  planningChatTemplateKwargs: string;
  extraBody: string;
  planningExtraBody: string;
  fallbackToChatgptBridge: boolean;
  forceBridge: boolean;
  costInputPer1M: string;
  costOutputPer1M: string;
  quotaResetDay: string;
  quotaMonthlyTokenLimit: string;
  quotaMonthlyBudgetUsdLimit: string;
};

type SystemSectionProps = {
  config: AdminConfig | null;
  models: string[];
  llmProviderStore: LLMProviderStore | null;
  searchEngineStore: SearchEngineStore | null;
  savingLLMProvider: boolean;
  deletingLLMProviderId: string;
  savingSearchEngine: boolean;
  deletingSearchEngineId: string;
  updatingMainFlowProviders: boolean;
  memoryDraft: SystemMemoryDraft;
  operationState: SystemOperationState;
  savingMemoryConfig: boolean;
  onMemoryDraftChange: <K extends keyof SystemMemoryDraft>(key: K, value: SystemMemoryDraft[K]) => void;
  onRefreshModels: () => void;
  onRefreshConfig: () => void;
  onRefreshLLMProviders: () => void;
  onRefreshSearchEngines: () => void;
  onUpsertLLMProvider: (provider: LLMProviderProfile) => void;
  onDeleteLLMProvider: (providerId: string) => void;
  onUpsertSearchEngine: (engine: SearchEngineProfile) => void;
  onDeleteSearchEngine: (engineId: string) => void;
  onSetDefaultSearchEngine: (engineId: string) => void;
  onSetMainFlowProviders: (selection: MainFlowProviderSelectionDraft) => void;
  onSaveMemoryConfig: () => void;
  onRestartPm2: () => void;
  onPullRepo: () => void;
  onBuildRepo: () => void;
  onDeployRepo: () => void;
};

type SystemModule = "operations" | "llm" | "search" | "memory" | "runtime";

const MODULE_ITEMS: Array<{ key: SystemModule; label: string }> = [
  { key: "operations", label: "运维操作" },
  { key: "llm", label: "LLM Providers" },
  { key: "search", label: "Search Engines" },
  { key: "memory", label: "Memory" },
  { key: "runtime", label: "运行时" }
];

type SystemSearchEngineDraft = {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  engine: string;
  hl: string;
  gl: string;
  num: string;
  enabled: boolean;
};

const EMPTY_SEARCH_ENGINE_DRAFT: SystemSearchEngineDraft = {
  id: "",
  name: "",
  endpoint: "https://serpapi.com/search.json",
  apiKey: "",
  engine: "google_news",
  hl: "zh-cn",
  gl: "cn",
  num: "10",
  enabled: true
};

const EMPTY_PROVIDER_DRAFT: SystemProviderDraft = {
  id: "",
  name: "",
  type: "ollama",
  baseUrl: "",
  apiKey: "",
  chatCompletionsPath: "",
  model: "",
  planningModel: "",
  timeoutMs: "",
  planningTimeoutMs: "",
  maxRetries: "",
  strictJson: false,
  thinkingBudgetEnabled: false,
  thinkingBudget: "",
  thinkingMaxNewTokens: "",
  selectionOptions: "",
  planningOptions: "",
  chatTemplateKwargs: "",
  planningChatTemplateKwargs: "",
  extraBody: "",
  planningExtraBody: "",
  fallbackToChatgptBridge: true,
  forceBridge: false,
  costInputPer1M: "",
  costOutputPer1M: "",
  quotaResetDay: "",
  quotaMonthlyTokenLimit: "",
  quotaMonthlyBudgetUsdLimit: ""
};

export function SystemSection(props: SystemSectionProps) {
  const [activeModule, setActiveModule] = useState<SystemModule>("operations");
  const [editingProviderId, setEditingProviderId] = useState("");
  const [providerDraft, setProviderDraft] = useState<SystemProviderDraft>(EMPTY_PROVIDER_DRAFT);
  const [providerDraftError, setProviderDraftError] = useState("");
  const [editingSearchEngineId, setEditingSearchEngineId] = useState("");
  const [searchEngineDraft, setSearchEngineDraft] = useState<SystemSearchEngineDraft>(EMPTY_SEARCH_ENGINE_DRAFT);
  const [searchEngineDraftError, setSearchEngineDraftError] = useState("");
  const [mainFlowDraft, setMainFlowDraft] = useState<MainFlowProviderSelectionDraft>({
    defaultProviderId: "",
    routingProviderId: "",
    planningProviderId: ""
  });

  const providerStore = props.llmProviderStore;
  const providerItems = providerStore?.providers ?? [];
  const searchEngineStore = props.searchEngineStore;
  const searchEngineItems = searchEngineStore?.engines ?? [];
  const defaultSearchEngineId = searchEngineStore?.defaultEngineId
    && searchEngineItems.some((item) => item.id === searchEngineStore.defaultEngineId)
    ? searchEngineStore.defaultEngineId
    : (searchEngineItems[0]?.id ?? "");

  useEffect(() => {
    if (!providerStore) {
      return;
    }
    setMainFlowDraft({
      defaultProviderId: providerStore.defaultProviderId,
      routingProviderId: providerStore.routingProviderId,
      planningProviderId: providerStore.planningProviderId
    });
  }, [
    providerStore?.defaultProviderId,
    providerStore?.routingProviderId,
    providerStore?.planningProviderId
  ]);

  const providerMap = useMemo(() => {
    return new Map(providerItems.map((item) => [item.id, item]));
  }, [providerItems]);

  function updateProviderDraft<K extends keyof SystemProviderDraft>(key: K, value: SystemProviderDraft[K]): void {
    setProviderDraft((prev) => ({ ...prev, [key]: value }));
  }

  function startCreateProvider(type: LLMProviderType = "ollama"): void {
    setEditingProviderId("");
    setProviderDraft({ ...EMPTY_PROVIDER_DRAFT, type });
    setProviderDraftError("");
  }

  function startEditProvider(profile: LLMProviderProfile): void {
    setEditingProviderId(profile.id);
    setProviderDraft(convertProviderToDraft(profile));
    setProviderDraftError("");
  }

  function handleSaveProvider(): void {
    const built = buildProviderProfileFromDraft(providerDraft, editingProviderId);
    if (!built.provider) {
      setProviderDraftError(built.error ?? "provider 配置无效");
      return;
    }
    setProviderDraftError("");
    props.onUpsertLLMProvider(built.provider);
  }

  function handleApplyMainFlowProviders(): void {
    if (!mainFlowDraft.defaultProviderId || !mainFlowDraft.routingProviderId || !mainFlowDraft.planningProviderId) {
      setProviderDraftError("default/routing/planning provider 都必须选择");
      return;
    }
    if (!providerMap.has(mainFlowDraft.defaultProviderId)) {
      setProviderDraftError("default provider 不存在");
      return;
    }
    if (!providerMap.has(mainFlowDraft.routingProviderId)) {
      setProviderDraftError("routing provider 不存在");
      return;
    }
    if (!providerMap.has(mainFlowDraft.planningProviderId)) {
      setProviderDraftError("planning provider 不存在");
      return;
    }
    setProviderDraftError("");
    props.onSetMainFlowProviders(mainFlowDraft);
  }

  function handleQuickSetDefault(providerId: string): void {
    const next: MainFlowProviderSelectionDraft = {
      ...mainFlowDraft,
      defaultProviderId: providerId
    };
    setMainFlowDraft(next);
    props.onSetMainFlowProviders(next);
  }

  function handleTypeChange(nextType: string): void {
    const providerType = normalizeProviderType(nextType);
    setProviderDraft((prev) => ({
      ...EMPTY_PROVIDER_DRAFT,
      id: prev.id,
      name: prev.name,
      type: providerType
    }));
  }

  function updateSearchEngineDraft<K extends keyof SystemSearchEngineDraft>(
    key: K,
    value: SystemSearchEngineDraft[K]
  ): void {
    setSearchEngineDraft((prev) => ({ ...prev, [key]: value }));
  }

  function startCreateSearchEngine(): void {
    setEditingSearchEngineId("");
    setSearchEngineDraft({
      ...EMPTY_SEARCH_ENGINE_DRAFT,
      apiKey: searchEngineDraft.apiKey
    });
    setSearchEngineDraftError("");
  }

  function startEditSearchEngine(engine: SearchEngineProfile): void {
    setEditingSearchEngineId(engine.id);
    setSearchEngineDraft({
      id: engine.id,
      name: engine.name,
      endpoint: engine.config.endpoint,
      apiKey: engine.config.apiKey,
      engine: engine.config.engine,
      hl: engine.config.hl,
      gl: engine.config.gl,
      num: String(engine.config.num),
      enabled: engine.enabled
    });
    setSearchEngineDraftError("");
  }

  function handleSaveSearchEngine(): void {
    const normalizedId = normalizeSearchEngineId(searchEngineDraft.id);
    const normalizedName = searchEngineDraft.name.trim();
    const num = Number(searchEngineDraft.num);
    if (!normalizedId) {
      setSearchEngineDraftError("Search Engine id 不能为空");
      return;
    }
    if (!normalizedName) {
      setSearchEngineDraftError("Search Engine 名称不能为空");
      return;
    }
    if (!Number.isFinite(num) || num <= 0) {
      setSearchEngineDraftError("num 必须是正整数");
      return;
    }

    setSearchEngineDraftError("");
    props.onUpsertSearchEngine({
      id: normalizedId,
      name: normalizedName,
      type: "serpapi",
      enabled: searchEngineDraft.enabled,
      config: {
        endpoint: searchEngineDraft.endpoint.trim() || "https://serpapi.com/search.json",
        apiKey: searchEngineDraft.apiKey.trim(),
        engine: searchEngineDraft.engine.trim() || "google_news",
        hl: searchEngineDraft.hl.trim() || "zh-cn",
        gl: searchEngineDraft.gl.trim() || "cn",
        num: Math.max(1, Math.min(20, Math.floor(num)))
      }
    });
  }

  function handleDeleteSearchEngine(engineId: string): void {
    const confirmed = window.confirm(`确认删除 Search Engine \"${engineId}\" 吗？`);
    if (!confirmed) {
      return;
    }
    props.onDeleteSearchEngine(engineId);
    if (editingSearchEngineId === engineId) {
      startCreateSearchEngine();
    }
  }

  const selectedRoutingLabel = providerMap.get(mainFlowDraft.routingProviderId)?.name ?? "-";
  const selectedPlanningLabel = providerMap.get(mainFlowDraft.planningProviderId)?.name ?? "-";

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

      {activeModule === "llm" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Main Flow Provider 选择</CardTitle>
              <CardDescription>主流程路由与规划可独立绑定 provider</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Default Provider</Label>
                  <Select
                    value={mainFlowDraft.defaultProviderId}
                    onValueChange={(value) => setMainFlowDraft((prev) => ({ ...prev, defaultProviderId: value }))}
                    disabled={providerItems.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择默认 provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerItems.map((item) => (
                        <SelectItem key={`default-${item.id}`} value={item.id}>
                          {item.name} ({item.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Routing Provider</Label>
                  <Select
                    value={mainFlowDraft.routingProviderId}
                    onValueChange={(value) => setMainFlowDraft((prev) => ({ ...prev, routingProviderId: value }))}
                    disabled={providerItems.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择 routing provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerItems.map((item) => (
                        <SelectItem key={`routing-${item.id}`} value={item.id}>
                          {item.name} ({item.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Planning Provider</Label>
                  <Select
                    value={mainFlowDraft.planningProviderId}
                    onValueChange={(value) => setMainFlowDraft((prev) => ({ ...prev, planningProviderId: value }))}
                    disabled={providerItems.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择 planning provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerItems.map((item) => (
                        <SelectItem key={`planning-${item.id}`} value={item.id}>
                          {item.name} ({item.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleApplyMainFlowProviders} disabled={props.updatingMainFlowProviders}>
                  {props.updatingMainFlowProviders ? "保存中..." : "保存主流程 provider 选择"}
                </Button>
                <Button type="button" variant="outline" onClick={props.onRefreshLLMProviders}>
                  刷新 provider 列表
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider 列表</CardTitle>
              <CardDescription>支持多条 OpenAI-like / Gemini-like / Ollama / llama-server，gpt-plugin 仅允许一条</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {providerItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">当前无 provider，请先新增。</div>
              ) : (
                providerItems.map((item) => {
                  const isDefault = item.id === mainFlowDraft.defaultProviderId;
                  const isRouting = item.id === mainFlowDraft.routingProviderId;
                  const isPlanning = item.id === mainFlowDraft.planningProviderId;
                  return (
                    <div key={item.id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{item.name}</span>
                            <Badge variant="outline">{item.type}</Badge>
                            <Badge variant="secondary">{item.id}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                            {isDefault ? <Badge variant="default">default</Badge> : null}
                            {isRouting ? <Badge variant="secondary">routing</Badge> : null}
                            {isPlanning ? <Badge variant="secondary">planning</Badge> : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => startEditProvider(item)}>
                            编辑
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => handleQuickSetDefault(item.id)}>
                            设为默认
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={providerItems.length <= 1 || props.deletingLLMProviderId === item.id}
                            onClick={() => props.onDeleteLLMProvider(item.id)}
                          >
                            {props.deletingLLMProviderId === item.id ? "删除中..." : "删除"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{editingProviderId ? `编辑 Provider: ${editingProviderId}` : "新增 Provider"}</CardTitle>
              <CardDescription>
                支持配置各引擎可用参数；JSON 字段请输入 JSON 对象。Ollama 可通过“刷新模型列表”查看本地模型。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => startCreateProvider()}>
                  新建 Provider
                </Button>
                <Button type="button" variant="outline" onClick={props.onRefreshModels}>
                  刷新 Ollama 模型列表
                </Button>
                <Button type="button" onClick={handleSaveProvider} disabled={props.savingLLMProvider}>
                  {props.savingLLMProvider ? "保存中..." : "保存 Provider"}
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Provider ID</Label>
                  <Input
                    value={providerDraft.id}
                    onChange={(event) => updateProviderDraft("id", event.target.value)}
                    disabled={Boolean(editingProviderId)}
                    placeholder="例如: local-ollama / openai-main"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Provider 名称</Label>
                  <Input
                    value={providerDraft.name}
                    onChange={(event) => updateProviderDraft("name", event.target.value)}
                    placeholder="用于 UI 展示"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Provider 类型</Label>
                  <Select value={providerDraft.type} onValueChange={handleTypeChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ollama">ollama</SelectItem>
                      <SelectItem value="openai">openai-like</SelectItem>
                      <SelectItem value="gemini">gemini-like</SelectItem>
                      <SelectItem value="llama-server">llama-server</SelectItem>
                      <SelectItem value="gpt-plugin">gpt-plugin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>模型列表提示</Label>
                  <div className="min-h-10 rounded-md border px-3 py-2 text-xs text-muted-foreground">
                    {props.models.length > 0
                      ? props.models.join(", ")
                      : "未读取到 Ollama 模型，可点击“刷新 Ollama 模型列表”"}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="grid gap-3 md:grid-cols-2">
                {providerDraft.type !== "gpt-plugin" ? (
                  <div className="space-y-2">
                    <Label>baseUrl</Label>
                    <Input
                      value={providerDraft.baseUrl}
                      onChange={(event) => updateProviderDraft("baseUrl", event.target.value)}
                      placeholder="例如: http://127.0.0.1:11434 或 https://api.openai.com/v1"
                    />
                  </div>
                ) : null}

                {providerDraft.type === "openai" || providerDraft.type === "llama-server" || providerDraft.type === "gemini" ? (
                  <div className="space-y-2">
                    <Label>apiKey</Label>
                    <Input
                      type="password"
                      value={providerDraft.apiKey}
                      onChange={(event) => updateProviderDraft("apiKey", event.target.value)}
                      placeholder="sk-..."
                    />
                  </div>
                ) : null}

                {providerDraft.type === "openai" ? (
                  <div className="space-y-2">
                    <Label>chatCompletionsPath（可选）</Label>
                    <Input
                      value={providerDraft.chatCompletionsPath}
                      onChange={(event) => updateProviderDraft("chatCompletionsPath", event.target.value)}
                      placeholder="/chat/completions"
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>model</Label>
                  <Input
                    value={providerDraft.model}
                    onChange={(event) => updateProviderDraft("model", event.target.value)}
                    placeholder="主模型"
                  />
                </div>
                <div className="space-y-2">
                  <Label>planningModel（可选）</Label>
                  <Input
                    value={providerDraft.planningModel}
                    onChange={(event) => updateProviderDraft("planningModel", event.target.value)}
                    placeholder="留空则跟随 model"
                  />
                </div>
                <div className="space-y-2">
                  <Label>timeoutMs（可选）</Label>
                  <Input
                    type="number"
                    min={1}
                    value={providerDraft.timeoutMs}
                    onChange={(event) => updateProviderDraft("timeoutMs", event.target.value)}
                    placeholder="正整数"
                  />
                </div>
                <div className="space-y-2">
                  <Label>planningTimeoutMs（可选）</Label>
                  <Input
                    type="number"
                    min={1}
                    value={providerDraft.planningTimeoutMs}
                    onChange={(event) => updateProviderDraft("planningTimeoutMs", event.target.value)}
                    placeholder="正整数"
                  />
                </div>
                <div className="space-y-2">
                  <Label>maxRetries（可选）</Label>
                  <Input
                    type="number"
                    min={1}
                    value={providerDraft.maxRetries}
                    onChange={(event) => updateProviderDraft("maxRetries", event.target.value)}
                    placeholder="正整数"
                  />
                </div>
                <div className="space-y-2">
                  <Label>strictJson</Label>
                  <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
                    <span className="text-sm text-muted-foreground">启用严格 JSON 输出约束</span>
                    <Switch
                      checked={providerDraft.strictJson}
                      onCheckedChange={(value) => updateProviderDraft("strictJson", value)}
                    />
                  </div>
                </div>

                {providerDraft.type === "ollama" ? (
                  <>
                    <div className="space-y-2">
                      <Label>thinkingBudgetEnabled</Label>
                      <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
                        <span className="text-sm text-muted-foreground">是否启用 thinking budget</span>
                        <Switch
                          checked={providerDraft.thinkingBudgetEnabled}
                          onCheckedChange={(value) => updateProviderDraft("thinkingBudgetEnabled", value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>thinkingBudget（可选）</Label>
                      <Input
                        type="number"
                        min={1}
                        value={providerDraft.thinkingBudget}
                        onChange={(event) => updateProviderDraft("thinkingBudget", event.target.value)}
                        placeholder="正整数"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>thinkingMaxNewTokens（可选）</Label>
                      <Input
                        type="number"
                        min={1}
                        value={providerDraft.thinkingMaxNewTokens}
                        onChange={(event) => updateProviderDraft("thinkingMaxNewTokens", event.target.value)}
                        placeholder="正整数"
                      />
                    </div>
                  </>
                ) : null}

                {providerDraft.type === "openai" || providerDraft.type === "llama-server" || providerDraft.type === "gemini" ? (
                  <>
                    <div className="space-y-2 md:col-span-2">
                      <Label>selectionOptions（JSON，可选）</Label>
                      <Textarea
                        value={providerDraft.selectionOptions}
                        onChange={(event) => updateProviderDraft("selectionOptions", event.target.value)}
                        placeholder='例如: {"temperature":0.2}'
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>planningOptions（JSON，可选）</Label>
                      <Textarea
                        value={providerDraft.planningOptions}
                        onChange={(event) => updateProviderDraft("planningOptions", event.target.value)}
                        placeholder='例如: {"temperature":0.1}'
                      />
                    </div>
                  </>
                ) : null}

                {providerDraft.type === "openai" || providerDraft.type === "llama-server" ? (
                  <>
                    <div className="space-y-2 md:col-span-2">
                      <Label>chatTemplateKwargs（JSON，可选）</Label>
                      <Textarea
                        value={providerDraft.chatTemplateKwargs}
                        onChange={(event) => updateProviderDraft("chatTemplateKwargs", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>planningChatTemplateKwargs（JSON，可选）</Label>
                      <Textarea
                        value={providerDraft.planningChatTemplateKwargs}
                        onChange={(event) => updateProviderDraft("planningChatTemplateKwargs", event.target.value)}
                      />
                    </div>
                  </>
                ) : null}

                {providerDraft.type === "llama-server" ? (
                  <>
                    <div className="space-y-2 md:col-span-2">
                      <Label>extraBody（JSON，可选）</Label>
                      <Textarea
                        value={providerDraft.extraBody}
                        onChange={(event) => updateProviderDraft("extraBody", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>planningExtraBody（JSON，可选）</Label>
                      <Textarea
                        value={providerDraft.planningExtraBody}
                        onChange={(event) => updateProviderDraft("planningExtraBody", event.target.value)}
                      />
                    </div>
                  </>
                ) : null}

                {providerDraft.type === "openai" ? (
                  <>
                    <div className="space-y-2">
                      <Label>fallbackToChatgptBridge</Label>
                      <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
                        <span className="text-sm text-muted-foreground">额度异常时回退 bridge</span>
                        <Switch
                          checked={providerDraft.fallbackToChatgptBridge}
                          onCheckedChange={(value) => updateProviderDraft("fallbackToChatgptBridge", value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>forceBridge</Label>
                      <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
                        <span className="text-sm text-muted-foreground">强制走 bridge</span>
                        <Switch
                          checked={providerDraft.forceBridge}
                          onCheckedChange={(value) => updateProviderDraft("forceBridge", value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>costInputPer1M（可选）</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.0001"
                        value={providerDraft.costInputPer1M}
                        onChange={(event) => updateProviderDraft("costInputPer1M", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>costOutputPer1M（可选）</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.0001"
                        value={providerDraft.costOutputPer1M}
                        onChange={(event) => updateProviderDraft("costOutputPer1M", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>quota.resetDay（可选）</Label>
                      <Input
                        type="number"
                        min={1}
                        value={providerDraft.quotaResetDay}
                        onChange={(event) => updateProviderDraft("quotaResetDay", event.target.value)}
                        placeholder="1-28"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>quota.monthlyTokenLimit（可选）</Label>
                      <Input
                        type="number"
                        min={1}
                        value={providerDraft.quotaMonthlyTokenLimit}
                        onChange={(event) => updateProviderDraft("quotaMonthlyTokenLimit", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>quota.monthlyBudgetUsdLimit（可选）</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={providerDraft.quotaMonthlyBudgetUsdLimit}
                        onChange={(event) => updateProviderDraft("quotaMonthlyBudgetUsdLimit", event.target.value)}
                      />
                    </div>
                  </>
                ) : null}
              </div>

              {providerDraftError ? <div className="text-sm text-red-500">{providerDraftError}</div> : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeModule === "search" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Search Engine Profiles</CardTitle>
              <CardDescription>全局搜索引擎配置（当前支持 SerpAPI），供各业务模块复用。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {searchEngineItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">当前无 Search Engine 配置。</div>
              ) : (
                searchEngineItems.map((engine) => (
                  <div key={engine.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{engine.name}</span>
                          <Badge variant="outline">{engine.type}</Badge>
                          <Badge variant="secondary">{engine.id}</Badge>
                          {engine.id === defaultSearchEngineId ? <Badge>default</Badge> : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          endpoint={engine.config.endpoint} | enabled={String(engine.enabled)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => startEditSearchEngine(engine)}>
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={engine.id === defaultSearchEngineId || props.savingSearchEngine}
                          onClick={() => props.onSetDefaultSearchEngine(engine.id)}
                        >
                          设为默认
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={searchEngineItems.length <= 1 || props.deletingSearchEngineId === engine.id}
                          onClick={() => handleDeleteSearchEngine(engine.id)}
                        >
                          {props.deletingSearchEngineId === engine.id ? "删除中..." : "删除"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{editingSearchEngineId ? `编辑 Search Engine: ${editingSearchEngineId}` : "新增 Search Engine"}</CardTitle>
              <CardDescription>业务特定检索词（如基金 querySuffix）请在业务配置中维护，不放在全局 profile。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={startCreateSearchEngine}>
                  新建 Search Engine
                </Button>
                <Button type="button" variant="outline" onClick={props.onRefreshSearchEngines}>
                  刷新 Search Engine 列表
                </Button>
                <Button type="button" onClick={handleSaveSearchEngine} disabled={props.savingSearchEngine}>
                  {props.savingSearchEngine ? "保存中..." : "保存 Search Engine"}
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Search Engine ID</Label>
                  <Input
                    value={searchEngineDraft.id}
                    onChange={(event) => updateSearchEngineDraft("id", event.target.value)}
                    disabled={Boolean(editingSearchEngineId)}
                    placeholder="例如: serpapi-main"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Search Engine 名称</Label>
                  <Input
                    value={searchEngineDraft.name}
                    onChange={(event) => updateSearchEngineDraft("name", event.target.value)}
                    placeholder="用于 UI 展示"
                  />
                </div>
                <div className="space-y-2">
                  <Label>endpoint</Label>
                  <Input
                    value={searchEngineDraft.endpoint}
                    onChange={(event) => updateSearchEngineDraft("endpoint", event.target.value)}
                    placeholder="https://serpapi.com/search.json"
                  />
                </div>
                <div className="space-y-2">
                  <Label>apiKey</Label>
                  <Input
                    type="password"
                    value={searchEngineDraft.apiKey}
                    onChange={(event) => updateSearchEngineDraft("apiKey", event.target.value)}
                    placeholder="serpapi key"
                  />
                </div>
                <div className="space-y-2">
                  <Label>engine</Label>
                  <Input
                    value={searchEngineDraft.engine}
                    onChange={(event) => updateSearchEngineDraft("engine", event.target.value)}
                    placeholder="google_news"
                  />
                </div>
                <div className="space-y-2">
                  <Label>num</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={searchEngineDraft.num}
                    onChange={(event) => updateSearchEngineDraft("num", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>hl</Label>
                  <Input
                    value={searchEngineDraft.hl}
                    onChange={(event) => updateSearchEngineDraft("hl", event.target.value)}
                    placeholder="zh-cn"
                  />
                </div>
                <div className="space-y-2">
                  <Label>gl</Label>
                  <Input
                    value={searchEngineDraft.gl}
                    onChange={(event) => updateSearchEngineDraft("gl", event.target.value)}
                    placeholder="cn"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>enabled</Label>
                  <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
                    <span className="text-sm text-muted-foreground">禁用后业务会自动回退到其他数据源</span>
                    <Switch
                      checked={searchEngineDraft.enabled}
                      onCheckedChange={(value) => updateSearchEngineDraft("enabled", value)}
                    />
                  </div>
                </div>
              </div>

              {searchEngineDraftError ? <div className="text-sm text-red-500">{searchEngineDraftError}</div> : null}
            </CardContent>
          </Card>
        </div>
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
              <div className="mono">defaultProvider: {mainFlowDraft.defaultProviderId || "-"}</div>
              <div className="mono">routingProvider: {mainFlowDraft.routingProviderId || "-"}</div>
              <div className="mono">planningProvider: {mainFlowDraft.planningProviderId || "-"}</div>
              <div className="mono">routingProviderName: {selectedRoutingLabel}</div>
              <div className="mono">planningProviderName: {selectedPlanningLabel}</div>
              <div className="mono">providerCount: {providerItems.length}</div>
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

function normalizeProviderType(raw: string): LLMProviderType {
  if (raw === "openai" || raw === "gemini" || raw === "llama-server" || raw === "gpt-plugin") {
    return raw;
  }
  return "ollama";
}

function normalizeSearchEngineId(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function convertProviderToDraft(profile: LLMProviderProfile): SystemProviderDraft {
  const config = profile.config as Record<string, unknown>;
  const quotaPolicy = asRecord(config.quotaPolicy);
  return {
    ...EMPTY_PROVIDER_DRAFT,
    id: profile.id,
    name: profile.name,
    type: profile.type,
    baseUrl: toText(config.baseUrl),
    apiKey: toText(config.apiKey),
    chatCompletionsPath: toText(config.chatCompletionsPath),
    model: toText(config.model),
    planningModel: toText(config.planningModel),
    timeoutMs: toNumberText(config.timeoutMs),
    planningTimeoutMs: toNumberText(config.planningTimeoutMs),
    maxRetries: toNumberText(config.maxRetries),
    strictJson: toBoolean(config.strictJson),
    thinkingBudgetEnabled: toBoolean(config.thinkingBudgetEnabled),
    thinkingBudget: toNumberText(config.thinkingBudget),
    thinkingMaxNewTokens: toNumberText(config.thinkingMaxNewTokens),
    selectionOptions: toJsonText(config.selectionOptions),
    planningOptions: toJsonText(config.planningOptions),
    chatTemplateKwargs: toJsonText(config.chatTemplateKwargs),
    planningChatTemplateKwargs: toJsonText(config.planningChatTemplateKwargs),
    extraBody: toJsonText(config.extraBody),
    planningExtraBody: toJsonText(config.planningExtraBody),
    fallbackToChatgptBridge: config.fallbackToChatgptBridge === undefined ? true : toBoolean(config.fallbackToChatgptBridge),
    forceBridge: toBoolean(config.forceBridge),
    costInputPer1M: toNumberText(config.costInputPer1M),
    costOutputPer1M: toNumberText(config.costOutputPer1M),
    quotaResetDay: toNumberText(quotaPolicy?.resetDay),
    quotaMonthlyTokenLimit: toNumberText(quotaPolicy?.monthlyTokenLimit),
    quotaMonthlyBudgetUsdLimit: toNumberText(quotaPolicy?.monthlyBudgetUsdLimit)
  };
}

function buildProviderProfileFromDraft(
  draft: SystemProviderDraft,
  editingProviderId: string
): { provider?: LLMProviderProfile; error?: string } {
  const id = draft.id.trim();
  const name = draft.name.trim();
  if (!id) {
    return { error: "provider id 不能为空" };
  }
  if (!name) {
    return { error: "provider name 不能为空" };
  }
  if (editingProviderId && editingProviderId !== id) {
    return { error: "编辑已有 provider 时不允许修改 id，请新建后保存" };
  }

  const timeoutMs = parseOptionalPositiveInteger(draft.timeoutMs, "timeoutMs");
  if (timeoutMs.error) {
    return timeoutMs;
  }
  const planningTimeoutMs = parseOptionalPositiveInteger(draft.planningTimeoutMs, "planningTimeoutMs");
  if (planningTimeoutMs.error) {
    return planningTimeoutMs;
  }
  const maxRetries = parseOptionalPositiveInteger(draft.maxRetries, "maxRetries");
  if (maxRetries.error) {
    return maxRetries;
  }

  const selectionOptions = parseOptionalJSONObject(draft.selectionOptions, "selectionOptions");
  if (selectionOptions.error) {
    return selectionOptions;
  }
  const planningOptions = parseOptionalJSONObject(draft.planningOptions, "planningOptions");
  if (planningOptions.error) {
    return planningOptions;
  }
  const chatTemplateKwargs = parseOptionalJSONObject(draft.chatTemplateKwargs, "chatTemplateKwargs");
  if (chatTemplateKwargs.error) {
    return chatTemplateKwargs;
  }
  const planningChatTemplateKwargs = parseOptionalJSONObject(
    draft.planningChatTemplateKwargs,
    "planningChatTemplateKwargs"
  );
  if (planningChatTemplateKwargs.error) {
    return planningChatTemplateKwargs;
  }
  const extraBody = parseOptionalJSONObject(draft.extraBody, "extraBody");
  if (extraBody.error) {
    return extraBody;
  }
  const planningExtraBody = parseOptionalJSONObject(draft.planningExtraBody, "planningExtraBody");
  if (planningExtraBody.error) {
    return planningExtraBody;
  }

  const costInputPer1M = parseOptionalPositiveNumber(draft.costInputPer1M, "costInputPer1M");
  if (costInputPer1M.error) {
    return costInputPer1M;
  }
  const costOutputPer1M = parseOptionalPositiveNumber(draft.costOutputPer1M, "costOutputPer1M");
  if (costOutputPer1M.error) {
    return costOutputPer1M;
  }
  const quotaResetDay = parseOptionalPositiveInteger(draft.quotaResetDay, "quota.resetDay");
  if (quotaResetDay.error) {
    return quotaResetDay;
  }
  const quotaMonthlyTokenLimit = parseOptionalPositiveInteger(draft.quotaMonthlyTokenLimit, "quota.monthlyTokenLimit");
  if (quotaMonthlyTokenLimit.error) {
    return quotaMonthlyTokenLimit;
  }
  const quotaMonthlyBudgetUsdLimit = parseOptionalPositiveNumber(
    draft.quotaMonthlyBudgetUsdLimit,
    "quota.monthlyBudgetUsdLimit"
  );
  if (quotaMonthlyBudgetUsdLimit.error) {
    return quotaMonthlyBudgetUsdLimit;
  }
  const thinkingBudget = parseOptionalPositiveInteger(draft.thinkingBudget, "thinkingBudget");
  if (thinkingBudget.error) {
    return thinkingBudget;
  }
  const thinkingMaxNewTokens = parseOptionalPositiveInteger(draft.thinkingMaxNewTokens, "thinkingMaxNewTokens");
  if (thinkingMaxNewTokens.error) {
    return thinkingMaxNewTokens;
  }

  const type = normalizeProviderType(draft.type);
  const model = normalizeOptionalText(draft.model);
  const planningModel = normalizeOptionalText(draft.planningModel);
  const baseUrl = normalizeOptionalText(draft.baseUrl);
  const apiKey = normalizeOptionalText(draft.apiKey);
  const chatCompletionsPath = normalizeOptionalText(draft.chatCompletionsPath);

  const commonConfig = {
    model,
    planningModel,
    timeoutMs: timeoutMs.value,
    planningTimeoutMs: planningTimeoutMs.value,
    maxRetries: maxRetries.value,
    strictJson: draft.strictJson
  };

  if (type === "ollama") {
    return {
      provider: {
        id,
        name,
        type,
        config: {
          ...commonConfig,
          baseUrl,
          thinkingBudgetEnabled: draft.thinkingBudgetEnabled,
          thinkingBudget: thinkingBudget.value,
          thinkingMaxNewTokens: thinkingMaxNewTokens.value
        }
      }
    };
  }

  if (type === "llama-server") {
    return {
      provider: {
        id,
        name,
        type,
        config: {
          ...commonConfig,
          baseUrl,
          apiKey,
          selectionOptions: selectionOptions.value,
          planningOptions: planningOptions.value,
          chatTemplateKwargs: chatTemplateKwargs.value,
          planningChatTemplateKwargs: planningChatTemplateKwargs.value,
          extraBody: extraBody.value,
          planningExtraBody: planningExtraBody.value
        }
      }
    };
  }

  if (type === "openai") {
    const hasQuotaPolicy = quotaResetDay.value !== undefined
      || quotaMonthlyTokenLimit.value !== undefined
      || quotaMonthlyBudgetUsdLimit.value !== undefined;

    return {
      provider: {
        id,
        name,
        type,
        config: {
          ...commonConfig,
          baseUrl,
          apiKey,
          chatCompletionsPath,
          selectionOptions: selectionOptions.value,
          planningOptions: planningOptions.value,
          chatTemplateKwargs: chatTemplateKwargs.value,
          planningChatTemplateKwargs: planningChatTemplateKwargs.value,
          fallbackToChatgptBridge: draft.fallbackToChatgptBridge,
          forceBridge: draft.forceBridge,
          costInputPer1M: costInputPer1M.value,
          costOutputPer1M: costOutputPer1M.value,
          quotaPolicy: hasQuotaPolicy
            ? {
                resetDay: quotaResetDay.value ?? 1,
                monthlyTokenLimit: quotaMonthlyTokenLimit.value ?? null,
                monthlyBudgetUsdLimit: quotaMonthlyBudgetUsdLimit.value ?? null
              }
            : undefined
        }
      }
    };
  }

  if (type === "gemini") {
    return {
      provider: {
        id,
        name,
        type,
        config: {
          ...commonConfig,
          baseUrl,
          apiKey,
          selectionOptions: selectionOptions.value,
          planningOptions: planningOptions.value
        }
      }
    };
  }

  return {
    provider: {
      id,
      name,
      type: "gpt-plugin",
      config: {
        ...commonConfig
      }
    }
  };
}

function parseOptionalPositiveInteger(raw: string, fieldName: string): { value?: number; error?: string } {
  const text = raw.trim();
  if (!text) {
    return {};
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `${fieldName} 必须是正整数` };
  }
  return { value: Math.floor(parsed) };
}

function parseOptionalPositiveNumber(raw: string, fieldName: string): { value?: number; error?: string } {
  const text = raw.trim();
  if (!text) {
    return {};
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `${fieldName} 必须是正数` };
  }
  return { value: parsed };
}

function parseOptionalJSONObject(
  raw: string,
  fieldName: string
): { value?: Record<string, unknown>; error?: string } {
  const text = raw.trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: `${fieldName} 必须是 JSON 对象` };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (_error) {
    return { error: `${fieldName} 不是合法 JSON` };
  }
}

function normalizeOptionalText(raw: string): string | undefined {
  const text = raw.trim();
  return text || undefined;
}

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function toNumberText(raw: unknown): string {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return "";
  }
  return String(raw);
}

function toBoolean(raw: unknown): boolean {
  return raw === true;
}

function toJsonText(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "";
  }
  return JSON.stringify(raw, null, 2);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}
