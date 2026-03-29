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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AdminConfig } from "@/types/admin";

type MemorySectionProps = {
  config: AdminConfig | null;
  llmMemoryContextEnabledDraft: boolean;
  memoryCompactEveryRoundsDraft: string;
  memoryCompactMaxBatchSizeDraft: string;
  memorySummaryTopKDraft: string;
  memoryRawRefLimitDraft: string;
  memoryRawRecordLimitDraft: string;
  savingMemoryConfig: boolean;
  onLlmMemoryContextEnabledDraftChange: (value: boolean) => void;
  onMemoryCompactEveryRoundsDraftChange: (value: string) => void;
  onMemoryCompactMaxBatchSizeDraftChange: (value: string) => void;
  onMemorySummaryTopKDraftChange: (value: string) => void;
  onMemoryRawRefLimitDraftChange: (value: string) => void;
  onMemoryRawRecordLimitDraftChange: (value: string) => void;
  onSaveMemoryConfig: () => void;
  onRefresh: () => void;
};

export function MemorySection(props: MemorySectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory 参数</CardTitle>
        <CardDescription>设置会话压缩与记忆召回参数（留空会移除该 env，回退代码默认值）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>LLM_MEMORY_CONTEXT_ENABLED</Label>
            <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
              <span className="text-sm text-muted-foreground">是否让主对话在 routing/planning 阶段检索 memory 并注入 prompt</span>
              <Switch
                checked={props.llmMemoryContextEnabledDraft}
                onCheckedChange={props.onLlmMemoryContextEnabledDraftChange}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>MEMORY_COMPACT_EVERY_ROUNDS</Label>
            <Input
              type="number"
              min={1}
              value={props.memoryCompactEveryRoundsDraft}
              onChange={(event) => props.onMemoryCompactEveryRoundsDraftChange(event.target.value)}
              placeholder="默认 4"
            />
          </div>
          <div className="space-y-2">
            <Label>MEMORY_COMPACT_MAX_BATCH_SIZE</Label>
            <Input
              type="number"
              min={1}
              value={props.memoryCompactMaxBatchSizeDraft}
              onChange={(event) => props.onMemoryCompactMaxBatchSizeDraftChange(event.target.value)}
              placeholder="默认 8"
            />
          </div>
          <div className="space-y-2">
            <Label>MEMORY_SUMMARY_TOP_K</Label>
            <Input
              type="number"
              min={1}
              value={props.memorySummaryTopKDraft}
              onChange={(event) => props.onMemorySummaryTopKDraftChange(event.target.value)}
              placeholder="默认 4"
            />
          </div>
          <div className="space-y-2">
            <Label>MEMORY_RAW_REF_LIMIT</Label>
            <Input
              type="number"
              min={1}
              value={props.memoryRawRefLimitDraft}
              onChange={(event) => props.onMemoryRawRefLimitDraftChange(event.target.value)}
              placeholder="默认 8"
            />
          </div>
          <div className="space-y-2">
            <Label>MEMORY_RAW_RECORD_LIMIT</Label>
            <Input
              type="number"
              min={1}
              value={props.memoryRawRecordLimitDraft}
              onChange={(event) => props.onMemoryRawRecordLimitDraftChange(event.target.value)}
              placeholder="默认 3"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={props.onRefresh}>
            刷新
          </Button>
          <Button type="button" onClick={props.onSaveMemoryConfig} disabled={props.savingMemoryConfig}>
            {props.savingMemoryConfig ? "保存中..." : "保存 Memory 配置"}
          </Button>
        </div>

        <Separator />

        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <div className="mono">env: {props.config?.envPath ?? "-"}</div>
          <div className="mono">LLM_MEMORY_CONTEXT_ENABLED: {String(props.config?.llmMemoryContextEnabled ?? true)}</div>
          <div className="mono">MEMORY_COMPACT_EVERY_ROUNDS: {props.config?.memoryCompactEveryRounds || "(default 4)"}</div>
          <div className="mono">MEMORY_COMPACT_MAX_BATCH_SIZE: {props.config?.memoryCompactMaxBatchSize || "(default 8)"}</div>
          <div className="mono">MEMORY_SUMMARY_TOP_K: {props.config?.memorySummaryTopK || "(default 4)"}</div>
          <div className="mono">MEMORY_RAW_REF_LIMIT: {props.config?.memoryRawRefLimit || "(default 8)"}</div>
          <div className="mono">MEMORY_RAW_RECORD_LIMIT: {props.config?.memoryRawRecordLimit || "(default 3)"}</div>
        </div>
      </CardContent>
    </Card>
  );
}
