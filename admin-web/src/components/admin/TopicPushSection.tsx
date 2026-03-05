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
  TopicPushCategory,
  TopicPushConfig,
  TopicPushProfile,
  TopicPushSource,
  TopicPushState
} from "@/types/admin";

type TopicPushSectionProps = {
  topicPushProfiles: TopicPushProfile[];
  topicPushActiveProfileId: string;
  topicPushSelectedProfileId: string;
  topicPushConfig: TopicPushConfig;
  topicPushState: TopicPushState;
  savingTopicPushProfileAction: boolean;
  savingTopicPushConfig: boolean;
  clearingTopicPushState: boolean;
  onSelectProfile: (id: string) => void;
  onAddProfile: () => void;
  onRenameProfile: () => void;
  onUseProfile: () => void;
  onDeleteProfile: () => void;
  onSourceChange: (index: number, patch: Partial<TopicPushSource>) => void;
  onAddSource: () => void;
  onRemoveSource: (index: number) => void;
  onSaveConfig: () => void;
  onRefresh: () => void;
  onClearSentLog: () => void;
};

const CATEGORY_OPTIONS: Array<{ value: TopicPushCategory; label: string }> = [
  { value: "engineering", label: "engineering" },
  { value: "news", label: "news" },
  { value: "ecosystem", label: "ecosystem" }
];

export function TopicPushSection(props: TopicPushSectionProps) {
  const enabledCount = props.topicPushConfig.sources.filter((item) => item.enabled).length;
  const selectedProfile = props.topicPushProfiles.find((item) => item.id === props.topicPushSelectedProfileId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Push</CardTitle>
        <CardDescription>配置 RSS 源并管理去重推送状态（定时任务消息建议填写 /topic run）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Profile</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={props.topicPushSelectedProfileId} onValueChange={props.onSelectProfile}>
              <SelectTrigger className="w-[320px]">
                <SelectValue placeholder="选择 profile" />
              </SelectTrigger>
              <SelectContent>
                {props.topicPushProfiles.length === 0 ? (
                  <SelectItem value="__empty__" disabled>
                    (empty)
                  </SelectItem>
                ) : (
                  props.topicPushProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.id}{profile.isActive ? " (active)" : ""} - {profile.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" disabled={props.savingTopicPushProfileAction} onClick={props.onAddProfile}>
              新增 profile
            </Button>
            <Button type="button" variant="outline" disabled={props.savingTopicPushProfileAction || !selectedProfile} onClick={props.onRenameProfile}>
              重命名
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={props.savingTopicPushProfileAction || !selectedProfile || selectedProfile.id === props.topicPushActiveProfileId}
              onClick={props.onUseProfile}
            >
              设为 active
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={props.savingTopicPushProfileAction || !selectedProfile || props.topicPushProfiles.length <= 1}
              onClick={props.onDeleteProfile}
            >
              删除 profile
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            active_profile: {props.topicPushActiveProfileId || "-"} | 当前编辑: {selectedProfile ? `${selectedProfile.id} (${selectedProfile.name})` : "-"}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>配额</Label>
            <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              total={props.topicPushConfig.dailyQuota.total}, engineering={props.topicPushConfig.dailyQuota.engineering}, news={props.topicPushConfig.dailyQuota.news}, ecosystem={props.topicPushConfig.dailyQuota.ecosystem}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>过滤</Label>
            <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              window={props.topicPushConfig.filters.timeWindowHours}h, minTitleLength={props.topicPushConfig.filters.minTitleLength}, maxPerDomain={props.topicPushConfig.filters.maxPerDomain}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={props.onAddSource}>
            新增 RSS 源
          </Button>
          <Button type="button" disabled={props.savingTopicPushConfig} onClick={props.onSaveConfig}>
            {props.savingTopicPushConfig ? "保存中..." : "保存 Topic Push 配置"}
          </Button>
          <Button type="button" variant="secondary" onClick={props.onRefresh}>
            刷新
          </Button>
          <Button type="button" variant="destructive" disabled={props.clearingTopicPushState} onClick={props.onClearSentLog}>
            {props.clearingTopicPushState ? "清理中..." : "清空 sent log"}
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
            {props.topicPushConfig.sources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  暂无 RSS 源，请先新增后保存
                </TableCell>
              </TableRow>
            ) : (
              props.topicPushConfig.sources.map((source, index) => (
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
                      onValueChange={(value) => props.onSourceChange(index, { category: value as TopicPushCategory })}
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

        <Separator />

        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <div>sources: {props.topicPushConfig.sources.length} (enabled={enabledCount})</div>
          <div>sent_log_size: {props.topicPushState.sentLog.length}</div>
          <div>state updated: {formatDateTime(props.topicPushState.updatedAt)}</div>
          <div>
            latest sent: {props.topicPushState.sentLog[0]?.title ? `${formatDateTime(props.topicPushState.sentLog[0].sentAt)} | ${props.topicPushState.sentLog[0].title}` : "-"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
