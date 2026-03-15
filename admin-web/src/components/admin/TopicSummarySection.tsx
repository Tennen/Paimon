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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/adminFormat";
import {
  LLMProviderProfile,
  TopicSummaryCategory,
  TopicSummaryConfig,
  TopicSummaryDigestLanguage,
  TopicSummaryEngine,
  TopicSummaryProfile,
  TopicSummarySource,
  TopicSummaryState
} from "@/types/admin";

type TopicSummarySectionProps = {
  topicSummaryProfiles: TopicSummaryProfile[];
  topicSummaryActiveProfileId: string;
  topicSummarySelectedProfileId: string;
  topicSummaryConfig: TopicSummaryConfig;
  llmProviders: LLMProviderProfile[];
  defaultLlmProviderId: string;
  topicSummaryState: TopicSummaryState;
  savingTopicSummaryProfileAction: boolean;
  savingTopicSummaryConfig: boolean;
  clearingTopicSummaryState: boolean;
  onSelectProfile: (id: string) => void;
  onAddProfile: () => void;
  onRenameProfile: () => void;
  onUseProfile: () => void;
  onDeleteProfile: () => void;
  onSummaryEngineChange: (value: TopicSummaryEngine) => void;
  onDefaultLanguageChange: (value: TopicSummaryDigestLanguage) => void;
  onSourceChange: (index: number, patch: Partial<TopicSummarySource>) => void;
  onAddSource: () => void;
  onRemoveSource: (index: number) => void;
  onSaveConfig: () => void;
  onRefresh: () => void;
  onClearSentLog: () => void;
};

type TopicSummaryModule = "config" | "sources" | "state";

const MODULE_ITEMS: Array<{ key: TopicSummaryModule; label: string }> = [
  { key: "config", label: "配置" },
  { key: "sources", label: "源管理" },
  { key: "state", label: "状态" }
];

const CATEGORY_OPTIONS: Array<{ value: TopicSummaryCategory; label: string }> = [
  { value: "engineering", label: "engineering" },
  { value: "news", label: "news" },
  { value: "ecosystem", label: "ecosystem" }
];

const DEFAULT_LANGUAGE_OPTIONS: Array<{ value: TopicSummaryDigestLanguage; label: string }> = [
  { value: "auto", label: "auto（自动判断）" },
  { value: "zh-CN", label: "zh-CN（简体中文）" },
  { value: "en", label: "en（English）" }
];

export function TopicSummarySection(props: TopicSummarySectionProps) {
  const [activeModule, setActiveModule] = useState<TopicSummaryModule>("config");
  const enabledCount = props.topicSummaryConfig.sources.filter((item) => item.enabled).length;
  const selectedProfile = props.topicSummaryProfiles.find((item) => item.id === props.topicSummarySelectedProfileId) ?? null;
  const fallbackProviderId = props.defaultLlmProviderId || props.llmProviders[0]?.id || "";
  const summaryEngineValue = props.topicSummaryConfig.summaryEngine || fallbackProviderId;
  const summaryEngineSelectValue = summaryEngineValue || "__none__";
  const hasProviderOptions = props.llmProviders.length > 0;
  const isKnownSummaryProvider = props.llmProviders.some((item) => item.id === summaryEngineValue);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Summary</CardTitle>
        <CardDescription>主题摘要配置与状态管理（定时任务消息建议填写 /topic run）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {activeModule === "config" ? (
          <>
            <div className="space-y-1.5">
              <Label>Profile</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={props.topicSummarySelectedProfileId} onValueChange={props.onSelectProfile}>
                  <SelectTrigger className="w-[320px]">
                    <SelectValue placeholder="选择 profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.topicSummaryProfiles.length === 0 ? (
                      <SelectItem value="__empty__" disabled>
                        (empty)
                      </SelectItem>
                    ) : (
                      props.topicSummaryProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.id}{profile.isActive ? " (active)" : ""} - {profile.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" disabled={props.savingTopicSummaryProfileAction} onClick={props.onAddProfile}>
                  新增 profile
                </Button>
                <Button type="button" variant="outline" disabled={props.savingTopicSummaryProfileAction || !selectedProfile} onClick={props.onRenameProfile}>
                  重命名
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={props.savingTopicSummaryProfileAction || !selectedProfile || selectedProfile.id === props.topicSummaryActiveProfileId}
                  onClick={props.onUseProfile}
                >
                  设为 active
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={props.savingTopicSummaryProfileAction || !selectedProfile || props.topicSummaryProfiles.length <= 1}
                  onClick={props.onDeleteProfile}
                >
                  删除 profile
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                active_profile: {props.topicSummaryActiveProfileId || "-"} | 当前编辑: {selectedProfile ? `${selectedProfile.id} (${selectedProfile.name})` : "-"}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>摘要 Provider</Label>
                <Select
                  value={summaryEngineSelectValue}
                  onValueChange={(value) => props.onSummaryEngineChange(value as TopicSummaryEngine)}
                  disabled={!hasProviderOptions}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择 LLM provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.llmProviders.length === 0 ? (
                      <SelectItem value="__none__" disabled>暂无 provider，请先到 System 页面新增</SelectItem>
                    ) : (
                      props.llmProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}（{provider.id} / {provider.type}）
                        </SelectItem>
                      ))
                    )}
                    {!isKnownSummaryProvider && summaryEngineValue ? (
                      <SelectItem value={summaryEngineValue}>{summaryEngineValue}（legacy engine）</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                <div className="text-xs text-muted-foreground">
                  直接选择 LLM provider；旧配置值会显示为 legacy，可切换到 provider id 完成迁移。
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>默认语言</Label>
                <Select
                  value={props.topicSummaryConfig.defaultLanguage}
                  onValueChange={(value) => props.onDefaultLanguageChange(value as TopicSummaryDigestLanguage)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择默认语言" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_LANGUAGE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>配额</Label>
                <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  total={props.topicSummaryConfig.dailyQuota.total}, engineering={props.topicSummaryConfig.dailyQuota.engineering}, news={props.topicSummaryConfig.dailyQuota.news}, ecosystem={props.topicSummaryConfig.dailyQuota.ecosystem}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>过滤</Label>
                <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  window={props.topicSummaryConfig.filters.timeWindowHours}h, minTitleLength={props.topicSummaryConfig.filters.minTitleLength}, maxPerDomain={props.topicSummaryConfig.filters.maxPerDomain}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={props.savingTopicSummaryConfig} onClick={props.onSaveConfig}>
                {props.savingTopicSummaryConfig ? "保存中..." : "保存 Topic Summary 配置"}
              </Button>
              <Button type="button" variant="secondary" onClick={props.onRefresh}>
                刷新
              </Button>
            </div>
          </>
        ) : null}

        {activeModule === "sources" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={props.onAddSource}>
                新增 RSS 源
              </Button>
              <Button type="button" disabled={props.savingTopicSummaryConfig} onClick={props.onSaveConfig}>
                {props.savingTopicSummaryConfig ? "保存中..." : "保存 Topic Summary 配置"}
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">id</TableHead>
                  <TableHead className="w-[200px]">name</TableHead>
                  <TableHead className="w-[150px]">category</TableHead>
                  <TableHead>feedUrl</TableHead>
                  <TableHead className="w-[110px]">weight</TableHead>
                  <TableHead className="w-[100px]">enabled</TableHead>
                  <TableHead className="w-[90px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.topicSummaryConfig.sources.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      暂无 RSS 源，请先新增后保存
                    </TableCell>
                  </TableRow>
                ) : (
                  props.topicSummaryConfig.sources.map((source, index) => (
                    <TableRow key={`topic-source-${index}-${source.id}`}>
                      <TableCell>
                        <Input
                          className="mono"
                          value={source.id}
                          onChange={(event) => props.onSourceChange(index, { id: event.target.value })}
                          placeholder="openai-blog"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={source.name}
                          onChange={(event) => props.onSourceChange(index, { name: event.target.value })}
                          placeholder="OpenAI Blog"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={source.category}
                          onValueChange={(value) => props.onSourceChange(index, { category: value as TopicSummaryCategory })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="category" />
                          </SelectTrigger>
                          <SelectContent>
                            {CATEGORY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="mono"
                          value={source.feedUrl}
                          onChange={(event) => props.onSourceChange(index, { feedUrl: event.target.value })}
                          placeholder="https://example.com/feed.xml"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0.1}
                          max={5}
                          step={0.1}
                          value={source.weight}
                          onChange={(event) => props.onSourceChange(index, { weight: Number(event.target.value) })}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          <Switch
                            checked={source.enabled}
                            onCheckedChange={(checked) => props.onSourceChange(index, { enabled: checked })}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button type="button" size="sm" variant="destructive" onClick={() => props.onRemoveSource(index)}>
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </>
        ) : null}

        {activeModule === "state" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={props.onRefresh}>
                刷新
              </Button>
              <Button type="button" variant="destructive" disabled={props.clearingTopicSummaryState} onClick={props.onClearSentLog}>
                {props.clearingTopicSummaryState ? "清理中..." : "清空 sent log"}
              </Button>
            </div>

            <Separator />

            <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
              <div>sources: {props.topicSummaryConfig.sources.length} (enabled={enabledCount})</div>
              <div>sent_log_size: {props.topicSummaryState.sentLog.length}</div>
              <div>state updated: {formatDateTime(props.topicSummaryState.updatedAt)}</div>
              <div>
                latest sent: {props.topicSummaryState.sentLog[0]?.title ? `${formatDateTime(props.topicSummaryState.sentLog[0].sentAt)} | ${props.topicSummaryState.sentLog[0].title}` : "-"}
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
