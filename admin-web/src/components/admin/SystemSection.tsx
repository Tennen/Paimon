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
import { AdminConfig } from "@/types/admin";

type SystemSectionProps = {
  config: AdminConfig | null;
  models: string[];
  modelFromList?: string;
  planningModelFromList?: string;
  modelDraft: string;
  planningModelDraft: string;
  planningTimeoutDraft: string;
  savingModel: boolean;
  restarting: boolean;
  syncingRepoBuild: boolean;
  onModelSelect: (value: string) => void;
  onModelDraftChange: (value: string) => void;
  onPlanningModelSelect: (value: string) => void;
  onPlanningModelDraftChange: (value: string) => void;
  onPlanningTimeoutDraftChange: (value: string) => void;
  onRefreshModels: () => void;
  onSaveModel: (restartAfterSave: boolean) => void;
  onRestartPm2: () => void;
  onSyncRepoBuild: () => void;
};

export function SystemSection(props: SystemSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>模型与服务控制</CardTitle>
        <CardDescription>选择模型并保存，必要时可一键重启服务</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <Label>主模型列表（Ollama）</Label>
            <Select value={props.modelFromList} onValueChange={props.onModelSelect}>
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
              value={props.modelDraft}
              onChange={(event) => props.onModelDraftChange(event.target.value)}
              placeholder="例如：qwen3:8b"
            />
          </div>

          <div className="space-y-2">
            <Label>Planning 模型列表（可选）</Label>
            <Select value={props.planningModelFromList} onValueChange={props.onPlanningModelSelect}>
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
              value={props.planningModelDraft}
              onChange={(event) => props.onPlanningModelDraftChange(event.target.value)}
              placeholder="留空则跟随主模型"
            />
          </div>

          <div className="space-y-2">
            <Label>Planning 超时（毫秒，可选）</Label>
            <Input
              type="number"
              min={1}
              value={props.planningTimeoutDraft}
              onChange={(event) => props.onPlanningTimeoutDraftChange(event.target.value)}
              placeholder="留空则沿用 LLM_TIMEOUT_MS"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={props.onRefreshModels}>
            刷新模型列表
          </Button>
          <Button type="button" disabled={props.savingModel} onClick={() => props.onSaveModel(false)}>
            {props.savingModel ? "保存中..." : "保存模型"}
          </Button>
          <Button type="button" disabled={props.savingModel} variant="secondary" onClick={() => props.onSaveModel(true)}>
            {props.savingModel ? "处理中..." : "保存并重启"}
          </Button>
          <Button type="button" variant="destructive" disabled={props.restarting} onClick={props.onRestartPm2}>
            {props.restarting ? "重启中..." : "pm2 restart 0"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={props.syncingRepoBuild}
            onClick={props.onSyncRepoBuild}
          >
            {props.syncingRepoBuild ? "执行中..." : "gpr + npm run build"}
          </Button>
        </div>

        <Separator />

        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <div className="mono">env: {props.config?.envPath ?? "-"}</div>
          <div className="mono">planningModel: {props.config?.planningModel || "(follow OLLAMA_MODEL)"}</div>
          <div className="mono">timezone: {props.config?.timezone ?? "-"}</div>
          <div className="mono">planningTimeoutMs: {props.config?.planningTimeoutMs || "(follow LLM_TIMEOUT_MS)"}</div>
          <div className="mono">taskStore: {props.config?.taskStorePath ?? "-"}</div>
          <div className="mono">tickMs: {props.config?.tickMs ?? "-"}</div>
          <div className="mono md:col-span-2">userStore: {props.config?.userStorePath ?? "-"}</div>
        </div>
      </CardContent>
    </Card>
  );
}
