import { useMemo, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConversationBenchmarkSectionState } from "@/components/admin/hooks/useConversationBenchmarkSectionState";
import {
  AdminConfig,
  ConversationBenchmarkResponse,
  MainConversationMode
} from "@/types/admin";

type ConversationBenchmarkSectionProps = {
  config: AdminConfig | null;
  runningBenchmark: boolean;
  benchmarkResult: ConversationBenchmarkResponse | null;
  onRunBenchmark: (input: { turns: string[]; repeatCount: number; modes: MainConversationMode[] }) => void;
  onRefreshConfig: () => void;
};

const DEFAULT_TURNS = [
  "帮我看看今天市场有没有需要关注的变化",
  "继续，如果我要更保守一点呢",
  "那再总结成三条建议"
].join("\n");

export function ConversationBenchmarkSection() {
  const props = useConversationBenchmarkSectionState();
  const [turnsDraft, setTurnsDraft] = useState(DEFAULT_TURNS);
  const [repeatCountDraft, setRepeatCountDraft] = useState("2");
  const [includeClassic, setIncludeClassic] = useState(true);
  const [includeWindowedAgent, setIncludeWindowedAgent] = useState(true);

  const parsedTurns = useMemo(() => {
    return turnsDraft
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }, [turnsDraft]);

  function handleRun(): void {
    const repeatCount = Math.max(1, Math.min(10, Number.parseInt(repeatCountDraft || "1", 10) || 1));
    const modes: MainConversationMode[] = [];
    if (includeClassic) {
      modes.push("classic");
    }
    if (includeWindowedAgent) {
      modes.push("windowed-agent");
    }
    if (parsedTurns.length === 0 || modes.length === 0) {
      return;
    }
    props.onRunBenchmark({
      turns: parsedTurns,
      repeatCount,
      modes
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Conversation Runtime Benchmark</CardTitle>
          <CardDescription>对比 classic route/planning 与 windowed-agent 两种主对话机制的实际耗时。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>当前生效模式</Label>
              <div className="flex min-h-10 items-center gap-2 rounded-md border px-3">
                <Badge>{props.config?.mainConversationMode ?? "classic"}</Badge>
                <span className="text-sm text-muted-foreground">System - 运行时 中可切换默认模式</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>repeatCount</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={repeatCountDraft}
                onChange={(event) => setRepeatCountDraft(event.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>多轮输入（每行一轮用户消息）</Label>
              <Textarea
                value={turnsDraft}
                onChange={(event) => setTurnsDraft(event.target.value)}
                placeholder="每行一轮消息"
                className="min-h-[160px]"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
              <span className="text-sm">classic</span>
              <Switch checked={includeClassic} onCheckedChange={setIncludeClassic} />
            </div>
            <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
              <span className="text-sm">windowed-agent</span>
              <Switch checked={includeWindowedAgent} onCheckedChange={setIncludeWindowedAgent} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={props.runningBenchmark || parsedTurns.length === 0 || (!includeClassic && !includeWindowedAgent)}
              onClick={handleRun}
            >
              {props.runningBenchmark ? "Benchmark 中..." : "开始 Benchmark"}
            </Button>
            <Button type="button" variant="outline" onClick={props.onRefreshConfig}>
              刷新配置
            </Button>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <div className="mono">turns: {parsedTurns.length}</div>
            <div className="mono">windowTimeout: {props.config?.conversationWindowTimeoutSeconds ?? "180"}s</div>
            <div className="mono">windowMaxTurns: {props.config?.conversationWindowMaxTurns ?? "6"}</div>
            <div className="mono">agentMaxSteps: {props.config?.conversationAgentMaxSteps ?? "4"}</div>
          </div>
        </CardContent>
      </Card>

      {props.benchmarkResult ? (
        <div className="space-y-4">
          {props.benchmarkResult.summaries.map((summary) => (
            <Card key={summary.mode}>
              <CardHeader>
                <CardTitle>{summary.mode}</CardTitle>
                <CardDescription>
                  avg turn {summary.avgTurnMs} ms, p95 turn {summary.p95TurnMs} ms, avg conversation {summary.avgConversationMs} ms
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-4">
                  <div className="mono">repeatCount: {summary.repeatCount}</div>
                  <div className="mono">turnCount: {summary.turnCount}</div>
                  <div className="mono">totalMs: {summary.totalMs}</div>
                  <div className="mono">avgTurnMs: {summary.avgTurnMs}</div>
                </div>
                <Separator />
                <div className="space-y-3">
                  {summary.conversations.map((conversation) => (
                    <div key={`${summary.mode}-${conversation.repeat}`} className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">Repeat #{conversation.repeat}</div>
                        <Badge variant="outline">{conversation.totalMs} ms</Badge>
                      </div>
                      <div className="space-y-2">
                        {conversation.turns.map((turn) => (
                          <div key={`${summary.mode}-${conversation.repeat}-${turn.turnIndex}`} className="rounded bg-muted/40 p-2">
                            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>Turn {turn.turnIndex}</span>
                              <span>{turn.latencyMs} ms</span>
                            </div>
                            <div className="text-sm">{turn.prompt}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{turn.responseText || "(empty response)"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
