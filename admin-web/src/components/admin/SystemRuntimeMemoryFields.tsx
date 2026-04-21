import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AdminConfig, SystemRuntimeDraft } from "@/types/admin";

type SystemRuntimeMemoryFieldsProps = {
  runtimeDraft: SystemRuntimeDraft;
  onRuntimeDraftChange: <K extends keyof SystemRuntimeDraft>(key: K, value: SystemRuntimeDraft[K]) => void;
};

type SystemRuntimeMemoryStatusProps = {
  config: AdminConfig | null;
};

export function SystemRuntimeMemoryFields(props: SystemRuntimeMemoryFieldsProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="space-y-1">
          <Label>LLM_MEMORY_CONTEXT_ENABLED</Label>
        </div>
        <Switch
          checked={props.runtimeDraft.llmMemoryContextEnabled}
          onCheckedChange={(value) => props.onRuntimeDraftChange("llmMemoryContextEnabled", value)}
        />
      </div>
      <div className="space-y-2">
        <Label>MEMORY_COMPACT_EVERY_ROUNDS</Label>
        <Input
          type="number"
          min={1}
          value={props.runtimeDraft.memoryCompactEveryRounds}
          onChange={(event) => props.onRuntimeDraftChange("memoryCompactEveryRounds", event.target.value)}
          placeholder="4"
        />
      </div>
      <div className="space-y-2">
        <Label>MEMORY_COMPACT_MAX_BATCH_SIZE</Label>
        <Input
          type="number"
          min={1}
          value={props.runtimeDraft.memoryCompactMaxBatchSize}
          onChange={(event) => props.onRuntimeDraftChange("memoryCompactMaxBatchSize", event.target.value)}
          placeholder="8"
        />
      </div>
      <div className="space-y-2">
        <Label>MEMORY_SUMMARY_TOP_K</Label>
        <Input
          type="number"
          min={1}
          value={props.runtimeDraft.memorySummaryTopK}
          onChange={(event) => props.onRuntimeDraftChange("memorySummaryTopK", event.target.value)}
          placeholder="4"
        />
      </div>
      <div className="space-y-2">
        <Label>MEMORY_RAW_REF_LIMIT</Label>
        <Input
          type="number"
          min={1}
          value={props.runtimeDraft.memoryRawRefLimit}
          onChange={(event) => props.onRuntimeDraftChange("memoryRawRefLimit", event.target.value)}
          placeholder="8"
        />
      </div>
      <div className="space-y-2">
        <Label>MEMORY_RAW_RECORD_LIMIT</Label>
        <Input
          type="number"
          min={1}
          value={props.runtimeDraft.memoryRawRecordLimit}
          onChange={(event) => props.onRuntimeDraftChange("memoryRawRecordLimit", event.target.value)}
          placeholder="3"
        />
      </div>
    </>
  );
}

export function SystemRuntimeMemoryStatus(props: SystemRuntimeMemoryStatusProps) {
  return (
    <>
      <div className="mono">LLM_MEMORY_CONTEXT_ENABLED: {String(props.config?.llmMemoryContextEnabled ?? true)}</div>
      <div className="mono">MEMORY_COMPACT_EVERY_ROUNDS: {props.config?.memoryCompactEveryRounds || "(default 4)"}</div>
      <div className="mono">MEMORY_COMPACT_MAX_BATCH_SIZE: {props.config?.memoryCompactMaxBatchSize || "(default 8)"}</div>
      <div className="mono">MEMORY_SUMMARY_TOP_K: {props.config?.memorySummaryTopK || "(default 4)"}</div>
      <div className="mono">MEMORY_RAW_REF_LIMIT: {props.config?.memoryRawRefLimit || "(default 8)"}</div>
      <div className="mono">MEMORY_RAW_RECORD_LIMIT: {props.config?.memoryRawRecordLimit || "(default 3)"}</div>
    </>
  );
}
