import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConversationBenchmarkSection } from "@/components/admin/ConversationBenchmarkSection";
import { DirectInputMappingSection } from "@/components/admin/DirectInputMappingSection";
import { EvolutionSection } from "@/components/admin/EvolutionSection";
import { FeatureMenu } from "@/components/admin/FeatureMenu";
import { MarketSection } from "@/components/admin/MarketSection";
import { MessagesSection } from "@/components/admin/MessagesSection";
import { SystemSection } from "@/components/admin/SystemSection";
import { TopicSummarySection } from "@/components/admin/TopicSummarySection";
import { WeComMenuSection } from "@/components/admin/WeComMenuSection";
import { WritingOrganizerSection } from "@/components/admin/WritingOrganizerSection";
import { request } from "@/components/admin/hooks/adminApi";
import { useAdminPageState } from "@/components/admin/hooks/useAdminPageState";
import { buildEvolutionQueueRows } from "@/lib/evolutionQueueRows";
import type { ConversationBenchmarkResponse } from "@/types/admin";

export default function App() {
  const page = useAdminPageState();
  const [activeMenu, setActiveMenu] = useState("system" as "system" | "conversation" | "evolution" | "market" | "topic" | "writing" | "messages" | "direct_input" | "wecom" | "runtime" | "memory");
  const [conversationBenchmarkResult, setConversationBenchmarkResult] = useState<ConversationBenchmarkResponse | null>(null);
  const [runningConversationBenchmark, setRunningConversationBenchmark] = useState(false);

  useEffect(() => {
    void page.bootstrap();
  }, []);

  useEffect(() => {
    if (activeMenu !== "evolution") {
      return;
    }

    void page.loadEvolutionState({ silent: true });
    const timer = window.setInterval(() => {
      void page.loadEvolutionState({ silent: true });
    }, 8000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeMenu]);

  const currentEvolutionGoal = useMemo(() => {
    if (!page.evolutionSnapshot?.state.currentGoalId) {
      return null;
    }
    return page.evolutionSnapshot.state.goals.find((goal) => goal.id === page.evolutionSnapshot.state.currentGoalId) ?? null;
  }, [page.evolutionSnapshot]);

  const evolutionQueueRows = useMemo(() => {
    return buildEvolutionQueueRows({
      goals: page.evolutionSnapshot?.state.goals,
      history: page.evolutionSnapshot?.state.history,
      retryItems: page.evolutionSnapshot?.retryQueue.items
    });
  }, [page.evolutionSnapshot]);

  async function handleRunConversationBenchmark(input: {
    turns: string[];
    repeatCount: number;
    modes: Array<"classic" | "windowed-agent">;
  }): Promise<void> {
    setRunningConversationBenchmark(true);
    try {
      const payload = await request<ConversationBenchmarkResponse>("/admin/api/conversation/benchmark", {
        method: "POST",
        body: JSON.stringify(input)
      });
      setConversationBenchmarkResult(payload);
      page.setNotice({ type: "success", title: "对话 Benchmark 已完成" });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      page.setNotice({ type: "error", title: "运行对话 Benchmark 失败", text });
    } finally {
      setRunningConversationBenchmark(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Paimon Admin</h1>
        <p className="text-sm text-muted-foreground">在一个页面中管理模型、消息任务、Market/Topic/Writing 模块与 Evolution 引擎</p>
      </header>

      {page.notice ? (
        <Alert variant={page.notice.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{page.notice.title}</AlertTitle>
          {page.notice.text ? <AlertDescription>{page.notice.text}</AlertDescription> : null}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <FeatureMenu activeMenu={activeMenu} onChange={setActiveMenu} />

        <section className="min-w-0 space-y-4">
          {activeMenu === "system" ? (
            <SystemSection
              config={page.config}
              models={page.models}
              llmProviderStore={page.llmProviderStore}
              searchEngineStore={page.marketSearchEngineStore}
              savingLLMProvider={page.savingLLMProvider}
              deletingLLMProviderId={page.deletingLLMProviderId}
              savingSearchEngine={page.savingMarketSearchEngine}
              deletingSearchEngineId={page.deletingMarketSearchEngineId}
              updatingMainFlowProviders={page.updatingMainFlowProviders}
              memoryDraft={page.memoryDraft}
              runtimeDraft={page.runtimeDraft}
              operationState={page.systemOperationState}
              savingMemoryConfig={page.savingMemoryConfig}
              savingRuntimeConfig={page.savingRuntimeConfig}
              onMemoryDraftChange={(key, value) => page.setMemoryDraft((prev) => ({ ...prev, [key]: value }))}
              onRuntimeDraftChange={(key, value) => page.setRuntimeDraft((prev) => ({ ...prev, [key]: value }))}
              onRefreshModels={() => void page.loadModels()}
              onRefreshConfig={() => void page.loadConfig()}
              onRefreshLLMProviders={() => void page.loadLLMProviders()}
              onRefreshSearchEngines={() => void page.loadSearchEngines()}
              onUpsertLLMProvider={(provider) => void page.handleUpsertLLMProvider(provider)}
              onDeleteLLMProvider={(providerId) => void page.handleDeleteLLMProvider(providerId)}
              onUpsertSearchEngine={(engine) => void page.handleUpsertMarketSearchEngine(engine)}
              onDeleteSearchEngine={(engineId) => void page.handleDeleteMarketSearchEngine(engineId)}
              onSetDefaultSearchEngine={(engineId) => void page.handleSetDefaultMarketSearchEngine(engineId)}
              onSetMainFlowProviders={(selection) => void page.handleSetMainFlowProviders(selection)}
              onSaveMemoryConfig={() => void page.handleSaveMemoryConfig()}
              onSaveRuntimeConfig={() => void page.handleSaveRuntimeConfig()}
              onRestartPm2={() => void page.handleRestartPm2()}
              onPullRepo={() => void page.handlePullRepo()}
              onBuildRepo={() => void page.handleBuildRepo()}
              onDeployRepo={() => void page.handleDeployRepo()}
            />
          ) : null}

          {activeMenu === "conversation" ? (
            <ConversationBenchmarkSection
              config={page.config}
              runningBenchmark={runningConversationBenchmark}
              benchmarkResult={conversationBenchmarkResult}
              onRunBenchmark={(input) => void handleRunConversationBenchmark(input)}
              onRefreshConfig={() => void page.loadConfig()}
            />
          ) : null}

          {activeMenu === "evolution" ? (
            <EvolutionSection
              evolutionSnapshot={page.evolutionSnapshot}
              currentEvolutionGoal={currentEvolutionGoal}
              evolutionQueueRows={evolutionQueueRows}
              loadingEvolution={page.loadingEvolution}
              evolutionGoalDraft={page.evolutionGoalDraft}
              evolutionCommitDraft={page.evolutionCommitDraft}
              submittingEvolutionGoal={page.submittingEvolutionGoal}
              triggeringEvolutionTick={page.triggeringEvolutionTick}
              codexModelDraft={page.codexDraft.model}
              codexReasoningEffortDraft={page.codexDraft.reasoningEffort}
              savingCodexConfig={page.savingCodexConfig}
              onGoalDraftChange={page.setEvolutionGoalDraft}
              onCommitDraftChange={page.setEvolutionCommitDraft}
              onCodexModelDraftChange={(value) => page.setCodexDraft((prev) => ({ ...prev, model: value }))}
              onCodexReasoningEffortDraftChange={(value) => page.setCodexDraft((prev) => ({ ...prev, reasoningEffort: value }))}
              onSubmitGoal={(event) => void page.handleSubmitEvolutionGoal(event)}
              onTriggerTick={() => void page.handleTriggerEvolutionTick()}
              onRefresh={() => void page.loadEvolutionState()}
              onSaveCodexConfig={() => void page.handleSaveCodexConfig()}
            />
          ) : null}

          {activeMenu === "market" ? (
            <MarketSection
              marketConfig={page.marketConfig}
              marketPortfolio={page.marketPortfolio}
              marketAnalysisConfig={page.marketAnalysisConfig}
              marketSearchEngines={page.marketSearchEngines}
              defaultMarketSearchEngineId={page.defaultMarketSearchEngineId}
              llmProviders={page.llmProviders}
              defaultLlmProviderId={page.defaultLlmProviderId}
              marketRuns={page.marketRuns}
              savingMarketPortfolio={page.savingMarketPortfolio}
              savingMarketAnalysisConfig={page.savingMarketAnalysisConfig}
              marketFundSaveStates={page.marketFundSaveStates}
              bootstrappingMarketTasks={page.bootstrappingMarketTasks}
              runningMarketOncePhase={page.runningMarketOncePhase}
              enabledUsers={page.enabledUsers}
              marketTaskUserId={page.marketTaskUserId}
              marketMiddayTime={page.marketMiddayTime}
              marketCloseTime={page.marketCloseTime}
              marketBatchCodesInput={page.marketBatchCodesInput}
              importingMarketCodes={page.importingMarketCodes}
              marketSearchInputs={page.marketSearchInputs}
              marketSearchResults={page.marketSearchResults}
              searchingMarketFundIndex={page.searchingMarketFundIndex}
              onCashChange={page.handleMarketCashChange}
              onMarketAnalysisEngineChange={page.handleMarketAnalysisEngineChange}
              onMarketSearchEngineChange={page.handleMarketSearchEngineChange}
              onMarketFundNewsQuerySuffixChange={page.handleMarketFundNewsQuerySuffixChange}
              onMarketGptPluginTimeoutMsChange={page.handleMarketGptPluginTimeoutMsChange}
              onMarketGptPluginFallbackToLocalChange={page.handleMarketGptPluginFallbackToLocalChange}
              onMarketFundEnabledChange={page.handleMarketFundEnabledChange}
              onMarketFundMaxAgeDaysChange={page.handleMarketFundMaxAgeDaysChange}
              onMarketFundFeatureLookbackDaysChange={page.handleMarketFundFeatureLookbackDaysChange}
              onMarketFundRiskLevelChange={page.handleMarketFundRiskLevelChange}
              onMarketFundLlmRetryMaxChange={page.handleMarketFundLlmRetryMaxChange}
              onMarketTaskUserIdChange={page.setMarketTaskUserId}
              onMarketMiddayTimeChange={page.setMarketMiddayTime}
              onMarketCloseTimeChange={page.setMarketCloseTime}
              onMarketBatchCodesInputChange={page.setMarketBatchCodesInput}
              onAddMarketFund={page.handleAddMarketFund}
              onRemoveMarketFund={page.handleRemoveMarketFund}
              onMarketFundChange={page.handleMarketFundChange}
              onMarketSearchInputChange={page.handleMarketSearchInputChange}
              onSearchMarketByName={(index) => void page.handleSearchMarketByName(index)}
              onApplyMarketSearchResult={page.handleApplyMarketSearchResult}
              onSaveMarketFund={(index) => void page.handleSaveMarketFund(index)}
              onSaveMarketPortfolio={() => void page.handleSaveMarketPortfolio()}
              onSaveMarketAnalysisConfig={() => void page.handleSaveMarketAnalysisConfig()}
              onImportMarketCodes={() => void page.handleImportMarketCodes()}
              onRefresh={() => void Promise.all([page.loadMarketConfig(), page.loadMarketRuns()])}
              onBootstrapMarketTasks={() => void page.handleBootstrapMarketTasks()}
              onRunMarketOnce={(phase) => void page.handleRunMarketOnce(phase)}
            />
          ) : null}

          {activeMenu === "topic" ? (
            <TopicSummarySection
              topicSummaryProfiles={page.topicSummaryProfiles}
              topicSummaryActiveProfileId={page.topicSummaryActiveProfileId}
              topicSummarySelectedProfileId={page.topicSummarySelectedProfileId}
              topicSummaryConfig={page.topicSummaryConfig}
              llmProviders={page.llmProviders}
              defaultLlmProviderId={page.defaultLlmProviderId}
              topicSummaryState={page.topicSummaryState}
              savingTopicSummaryProfileAction={page.savingTopicSummaryProfileAction}
              savingTopicSummaryConfig={page.savingTopicSummaryConfig}
              clearingTopicSummaryState={page.clearingTopicSummaryState}
              onSelectProfile={page.handleTopicProfileSelect}
              onAddProfile={() => void page.handleAddTopicProfile()}
              onRenameProfile={() => void page.handleRenameTopicProfile()}
              onUseProfile={() => void page.handleUseTopicProfile()}
              onDeleteProfile={() => void page.handleDeleteTopicProfile()}
              onSummaryEngineChange={page.handleTopicSummaryEngineChange}
              onDefaultLanguageChange={page.handleTopicDefaultLanguageChange}
              onSourceChange={page.handleTopicSourceChange}
              onAddSource={page.handleAddTopicSource}
              onRemoveSource={page.handleRemoveTopicSource}
              onSaveConfig={() => void page.handleSaveTopicSummaryConfig()}
              onRefresh={() => void page.loadTopicSummaryConfig()}
              onClearSentLog={() => void page.handleClearTopicSummaryState()}
            />
          ) : null}

          {activeMenu === "writing" ? (
            <WritingOrganizerSection
              topics={page.writingTopics}
              selectedTopicId={page.writingSelectedTopicId}
              topicIdDraft={page.writingTopicIdDraft}
              topicTitleDraft={page.writingTopicTitleDraft}
              appendDraft={page.writingAppendDraft}
              detail={page.writingTopicDetail}
              loadingTopics={page.loadingWritingTopics}
              loadingDetail={page.loadingWritingDetail}
              actionState={page.writingActionState}
              manualSection={page.writingManualSection}
              manualContent={page.writingManualContent}
              onSelectTopic={page.handleWritingTopicSelect}
              onTopicIdDraftChange={page.setWritingTopicIdDraft}
              onTopicTitleDraftChange={page.setWritingTopicTitleDraft}
              onAppendDraftChange={page.setWritingAppendDraft}
              onManualSectionChange={page.setWritingManualSection}
              onManualContentChange={page.setWritingManualContent}
              onRefresh={() => void page.loadWritingTopics()}
              onAppend={() => void page.handleAppendWritingTopic()}
              onSummarize={() => void page.handleSummarizeWritingTopic()}
              onRestore={() => void page.handleRestoreWritingTopic()}
              onSetState={() => void page.handleSetWritingTopicState()}
            />
          ) : null}

          {activeMenu === "messages" ? (
            <MessagesSection
              users={page.users}
              tasks={page.tasks}
              userMap={page.userMap}
              enabledUsers={page.enabledUsers}
              editingUserId={page.editingUserId}
              savingUser={page.savingUser}
              userForm={page.userForm}
              editingTaskId={page.editingTaskId}
              savingTask={page.savingTask}
              runningTaskId={page.runningTaskId}
              taskForm={page.taskForm}
              onUserFormChange={(patch) => page.setUserForm((prev) => ({ ...prev, ...patch }))}
              onBeginCreateUser={page.beginCreateUser}
              onBeginEditUser={page.beginEditUser}
              onSubmitUser={(event) => void page.handleSubmitUser(event)}
              onDeleteUser={(user) => void page.handleDeleteUser(user)}
              onTaskFormChange={(patch) => page.setTaskForm((prev) => ({ ...prev, ...patch }))}
              onBeginCreateTask={page.beginCreateTask}
              onBeginEditTask={page.beginEditTask}
              onSubmitTask={(event) => void page.handleSubmitTask(event)}
              onDeleteTask={(task) => void page.handleDeleteTask(task)}
              onRunTask={(task) => void page.handleRunTask(task)}
            />
          ) : null}

          {activeMenu === "direct_input" ? (
            <DirectInputMappingSection
              config={page.directInputMappingConfig}
              saving={page.savingDirectInputMappings}
              onConfigChange={page.setDirectInputMappingConfig}
              onRefresh={() => void page.loadDirectInputMappings()}
              onSave={() => void page.handleSaveDirectInputMappings()}
            />
          ) : null}

          {activeMenu === "wecom" ? (
            <WeComMenuSection
              config={page.wecomMenuConfig}
              recentEvents={page.wecomMenuEvents}
              publishPayload={page.wecomMenuPublishPayload}
              validationErrors={page.wecomMenuValidationErrors}
              saving={page.savingWecomMenu}
              publishing={page.publishingWecomMenu}
              onConfigChange={page.setWecomMenuConfig}
              onRefresh={() => void page.loadWeComMenu()}
              onSave={() => void page.handleSaveWeComMenu()}
              onPublish={() => void page.handlePublishWeComMenu()}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}
