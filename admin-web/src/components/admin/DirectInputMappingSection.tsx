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
import { useDirectInputMappingSectionState } from "@/components/admin/hooks/useDirectInputMappingSectionState";
import { formatDateTime } from "@/lib/adminFormat";
import {
  DirectInputMappingConfig,
  DirectInputMappingRule
} from "@/types/admin";

type DirectInputMappingSectionProps = {
  config: DirectInputMappingConfig;
  saving: boolean;
  onConfigChange: (config: DirectInputMappingConfig) => void;
  onRefresh: () => void;
  onSave: () => void;
};

export function DirectInputMappingSection() {
  const props = useDirectInputMappingSectionState();

  function updateRule(index: number, patch: Partial<DirectInputMappingRule>): void {
    props.onConfigChange({
      ...props.config,
      rules: props.config.rules.map((rule, ruleIndex) => {
        if (ruleIndex !== index) {
          return rule;
        }
        return {
          ...rule,
          ...patch
        };
      })
    });
  }

  function addRule(): void {
    props.onConfigChange({
      ...props.config,
      rules: props.config.rules.concat(buildRule(`mapping-${props.config.rules.length + 1}`))
    });
  }

  function removeRule(index: number): void {
    props.onConfigChange({
      ...props.config,
      rules: props.config.rules.filter((_, ruleIndex) => ruleIndex !== index)
    });
  }

  function moveRule(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= props.config.rules.length) {
      return;
    }
    const nextRules = props.config.rules.slice();
    const [current] = nextRules.splice(index, 1);
    nextRules.splice(nextIndex, 0, current);
    props.onConfigChange({
      ...props.config,
      rules: nextRules
    });
  }

  const enabledCount = props.config.rules.filter((rule) => rule.enabled).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Direct Input Mapping</CardTitle>
        <CardDescription>
          把固定文本直接改写成目标输入，再走现有 direct shortcut / direct toolcall。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>规则数：{props.config.rules.length}</span>
          <span>启用：{enabledCount}</span>
          <span>更新时间：{props.config.updatedAt ? formatDateTime(props.config.updatedAt) : "-"}</span>
        </div>

        <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          `exact` 表示标准化后完全相等，`fuzzy` 表示输入文本包含该片段。解析顺序为：先 exact，再 fuzzy；同模式下按列表顺序匹配。slash 命令本身不会被这层覆盖。
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={props.onRefresh}>
            刷新
          </Button>
          <Button type="button" variant="outline" onClick={addRule}>
            新增规则
          </Button>
          <Button type="button" onClick={props.onSave} disabled={props.saving}>
            {props.saving ? "保存中..." : "保存配置"}
          </Button>
        </div>

        {props.config.rules.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            还没有规则。示例：<code>盘中分析</code> -&gt; <code>/market midday</code>，或 <code>看看门口</code> -&gt; <code>/ha camera_snapshot camera.entryway</code>
          </div>
        ) : (
          <div className="space-y-4">
            {props.config.rules.map((rule, index) => (
              <Card key={rule.id} className="border border-border/80">
                <CardContent className="space-y-4 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">规则 {index + 1}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>启用</span>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(checked) => updateRule(index, { enabled: checked })}
                        />
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => moveRule(index, -1)} disabled={index === 0}>
                        上移
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => moveRule(index, 1)}
                        disabled={index === props.config.rules.length - 1}
                      >
                        下移
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => removeRule(index)}>
                        删除
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[220px_180px]">
                    <div className="space-y-1.5">
                      <Label htmlFor={`mapping-name-${rule.id}`}>规则名称（可选）</Label>
                      <Input
                        id={`mapping-name-${rule.id}`}
                        value={rule.name}
                        onChange={(event) => updateRule(index, { name: event.target.value })}
                        placeholder="例如：Market 盘中分析"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>匹配方式</Label>
                      <Select
                        value={rule.matchMode}
                        onValueChange={(value) => updateRule(index, { matchMode: value as DirectInputMappingRule["matchMode"] })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择匹配方式" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="exact">exact</SelectItem>
                          <SelectItem value="fuzzy">fuzzy</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`mapping-pattern-${rule.id}`}>匹配文本</Label>
                      <Textarea
                        id={`mapping-pattern-${rule.id}`}
                        value={rule.pattern}
                        onChange={(event) => updateRule(index, { pattern: event.target.value })}
                        placeholder="例如：盘中分析"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`mapping-target-${rule.id}`}>目标输入</Label>
                      <Textarea
                        id={`mapping-target-${rule.id}`}
                        value={rule.targetText}
                        onChange={(event) => updateRule(index, { targetText: event.target.value })}
                        placeholder="例如：/market midday 或 /ha call_service turn_on 客厅主灯"
                      />
                    </div>
                  </div>

                  <Separator />
                  <div className="text-xs text-muted-foreground">
                    空的匹配文本或目标输入不会生效。建议把高优先级规则放前面。
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function buildRule(id: string): DirectInputMappingRule {
  return {
    id,
    name: "",
    pattern: "",
    targetText: "",
    matchMode: "exact",
    enabled: true
  };
}
