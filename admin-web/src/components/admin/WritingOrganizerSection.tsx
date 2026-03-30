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
import { Textarea } from "@/components/ui/textarea";
import { useWritingOrganizerSectionState } from "@/components/admin/hooks/useWritingOrganizerSectionState";
import { formatDateTime } from "@/lib/adminFormat";
import { WritingOrganizerSectionProps, WritingStateSection } from "@/types/admin";

const STATE_SECTION_OPTIONS: Array<{ value: WritingStateSection; label: string }> = [
  { value: "summary", label: "summary" },
  { value: "outline", label: "outline" },
  { value: "draft", label: "draft" }
];

export function WritingOrganizerSection() {
  const props = useWritingOrganizerSectionState();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Writing Organizer</CardTitle>
        <CardDescription>增量写作主题管理（列表、详情、append、summarize、restore、手动 set）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={props.onRefresh}>
            {props.loadingTopics ? "刷新中..." : "刷新 topics"}
          </Button>
          <div className="text-xs text-muted-foreground">
            topics: {props.topics.length} {props.selectedTopicId ? `| selected: ${props.selectedTopicId}` : ""}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-2 rounded-md border border-border p-2">
            <div className="text-sm font-medium">Topic 列表</div>
            {props.topics.length === 0 ? (
              <div className="text-xs text-muted-foreground">暂无 topic，先在右侧 append 新内容创建</div>
            ) : (
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {props.topics.map((topic) => (
                  <button
                    key={topic.topicId}
                    type="button"
                    className={`w-full rounded-md border px-2 py-2 text-left text-xs transition ${
                      props.selectedTopicId === topic.topicId
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() => props.onSelectTopic(topic.topicId)}
                  >
                    <div className="font-medium">{topic.topicId}</div>
                    <div className="text-muted-foreground">{topic.title}</div>
                    <div className="text-muted-foreground">
                      raw: {topic.rawFileCount} files / {topic.rawLineCount} lines
                    </div>
                    <div className="text-muted-foreground">
                      summarized: {topic.lastSummarizedAt ? formatDateTime(topic.lastSummarizedAt) : "-"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-3 rounded-md border border-border p-3">
              <h3 className="text-sm font-medium">操作</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>topicId</Label>
                  <Input
                    className="mono"
                    value={props.topicIdDraft}
                    onChange={(event) => props.onTopicIdDraftChange(event.target.value)}
                    placeholder="relationship-boundaries"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>title (optional)</Label>
                  <Input
                    value={props.topicTitleDraft}
                    onChange={(event) => props.onTopicTitleDraftChange(event.target.value)}
                    placeholder="关系中的边界误判"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>append content</Label>
                <Textarea
                  rows={4}
                  value={props.appendDraft}
                  onChange={(event) => props.onAppendDraftChange(event.target.value)}
                  placeholder="输入一行或多行原始片段，每行会作为一个 fragment 追加"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={props.actionState !== null} onClick={props.onAppend}>
                  {props.actionState === "append" ? "追加中..." : "append"}
                </Button>
                <Button type="button" variant="secondary" disabled={props.actionState !== null} onClick={props.onSummarize}>
                  {props.actionState === "summarize" ? "整理中..." : "summarize"}
                </Button>
                <Button type="button" variant="outline" disabled={props.actionState !== null} onClick={props.onRestore}>
                  {props.actionState === "restore" ? "恢复中..." : "restore"}
                </Button>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>手动 set state</Label>
                <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)]">
                  <Select
                    value={props.manualSection}
                    onValueChange={(value) => props.onManualSectionChange(value as WritingStateSection)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择 section" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATE_SECTION_OPTIONS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" disabled={props.actionState !== null} onClick={props.onSetState}>
                    {props.actionState === "set" ? "保存中..." : "保存 section"}
                  </Button>
                </div>
                <Textarea
                  rows={6}
                  value={props.manualContent}
                  onChange={(event) => props.onManualContentChange(event.target.value)}
                  placeholder="手动整理后的内容"
                />
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <h3 className="text-sm font-medium">Topic 详情</h3>
              {props.loadingDetail ? (
                <div className="text-xs text-muted-foreground">加载详情中...</div>
              ) : !props.detail ? (
                <div className="text-xs text-muted-foreground">请选择 topic</div>
              ) : (
                <>
                  <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                    <div>topicId: {props.detail.meta.topicId}</div>
                    <div>title: {props.detail.meta.title}</div>
                    <div>status: {props.detail.meta.status}</div>
                    <div>raw: {props.detail.meta.rawFileCount} files / {props.detail.meta.rawLineCount} lines</div>
                    <div>created: {formatDateTime(props.detail.meta.createdAt)}</div>
                    <div>updated: {formatDateTime(props.detail.meta.updatedAt)}</div>
                    <div>summarized: {props.detail.meta.lastSummarizedAt ? formatDateTime(props.detail.meta.lastSummarizedAt) : "-"}</div>
                  </div>

                  <Separator />

                  <StateBlock title="state.summary" content={props.detail.state.summary} />
                  <StateBlock title="state.outline" content={props.detail.state.outline} />
                  <StateBlock title="state.draft" content={props.detail.state.draft} />

                  <Separator />

                  <StateBlock title="backup.summary.prev" content={props.detail.backup.summary} />
                  <StateBlock title="backup.outline.prev" content={props.detail.backup.outline} />
                  <StateBlock title="backup.draft.prev" content={props.detail.backup.draft} />

                  <Separator />

                  <div className="space-y-1.5">
                    <div className="text-xs font-medium">raw files</div>
                    {props.detail.rawFiles.length === 0 ? (
                      <div className="text-xs text-muted-foreground">(empty)</div>
                    ) : (
                      <div className="space-y-2">
                        {props.detail.rawFiles.map((file) => (
                          <div key={file.name} className="rounded-md border border-border p-2">
                            <div className="mb-1 text-xs text-muted-foreground">
                              {file.name} | {file.lineCount} lines
                            </div>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs leading-5">
                              {file.content || "(empty)"}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StateBlock(props: { title: string; content: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">{props.title}</div>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs leading-5">
        {props.content || "(empty)"}
      </pre>
    </div>
  );
}
