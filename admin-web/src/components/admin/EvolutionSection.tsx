import { FormEvent } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatEvolutionStatus, getEvolutionStatusBadgeVariant } from "@/lib/adminFormat";
import { EvolutionQueueRow } from "@/lib/evolutionQueueRows";
import {
  EvolutionGoal,
  EvolutionStateSnapshot
} from "@/types/admin";

type EvolutionSectionProps = {
  evolutionSnapshot: EvolutionStateSnapshot | null;
  currentEvolutionGoal: EvolutionGoal | null;
  evolutionQueueRows: EvolutionQueueRow[];
  loadingEvolution: boolean;
  evolutionGoalDraft: string;
  evolutionCommitDraft: string;
  submittingEvolutionGoal: boolean;
  triggeringEvolutionTick: boolean;
  onGoalDraftChange: (value: string) => void;
  onCommitDraftChange: (value: string) => void;
  onSubmitGoal: (event: FormEvent<HTMLFormElement>) => void;
  onTriggerTick: () => void;
  onRefresh: () => void;
};

const EVOLUTION_QUEUE_SOURCE_LABEL: Record<EvolutionQueueRow["source"], string> = {
  goal: "goal",
  history: "history",
  retry: "retry",
  "goal+history": "goal+history",
  "goal+retry": "goal+retry",
  "history+retry": "history+retry",
  "goal+history+retry": "goal+history+retry"
};

function formatEvolutionQueueSource(source: EvolutionQueueRow["source"]): string {
  return EVOLUTION_QUEUE_SOURCE_LABEL[source] ?? source;
}

export function EvolutionSection(props: EvolutionSectionProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Evolution Goal</CardTitle>
            <CardDescription>提交一条需求，自动执行 计划 → 改码 → 自测 → 修复 → 提交</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={props.onSubmitGoal}>
              <div className="space-y-1.5">
                <Label htmlFor="evolution-goal">需求 Goal</Label>
                <Textarea
                  id="evolution-goal"
                  value={props.evolutionGoalDraft}
                  onChange={(event) => props.onGoalDraftChange(event.target.value)}
                  placeholder="例如：增加一个插件系统，支持动态加载工具模块"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evolution-commit-message">Commit Message（可选）</Label>
                <Input
                  id="evolution-commit-message"
                  value={props.evolutionCommitDraft}
                  onChange={(event) => props.onCommitDraftChange(event.target.value)}
                  placeholder="例如：feat: add dynamic plugin loader"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={props.submittingEvolutionGoal}>
                  {props.submittingEvolutionGoal ? "提交中..." : "提交 Goal"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={props.triggeringEvolutionTick}
                  onClick={props.onTriggerTick}
                >
                  {props.triggeringEvolutionTick ? "执行中..." : "立即 Tick 一次"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={props.loadingEvolution}
                  onClick={props.onRefresh}
                >
                  {props.loadingEvolution ? "刷新中..." : "刷新状态"}
                </Button>
              </div>
            </form>

            <Separator />

            <div className="space-y-1 text-xs text-muted-foreground">
              <div>WeCom 快捷指令：<span className="mono">/evolve &lt;goal&gt;</span>、<span className="mono">/coding &lt;goal&gt;</span></div>
              <div>状态指令：<span className="mono">/evolve status</span>、<span className="mono">/evolve status &lt;goalId&gt;</span></div>
              <div>触发执行：<span className="mono">/evolve tick</span></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Engine Runtime</CardTitle>
            <CardDescription>当前运行状态、重试队列与指标</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div>状态: <Badge variant={props.evolutionSnapshot?.state.status === "running" ? "default" : "secondary"}>{props.evolutionSnapshot?.state.status ?? "-"}</Badge></div>
              <div>tickMs: <span className="mono">{props.evolutionSnapshot?.tickMs ?? "-"}</span></div>
              <div>当前任务: <span className="mono">{props.currentEvolutionGoal?.id ?? "-"}</span></div>
              <div>当前阶段: <span className="mono">{props.currentEvolutionGoal?.stage ?? "-"}</span></div>
              <div>重试队列: <span className="mono">{props.evolutionSnapshot?.retryQueue.items.length ?? 0}</span></div>
              <div>总 Goals: <span className="mono">{props.evolutionSnapshot?.metrics.totalGoals ?? 0}</span></div>
              <div>总失败: <span className="mono">{props.evolutionSnapshot?.metrics.totalFailures ?? 0}</span></div>
              <div>总重试: <span className="mono">{props.evolutionSnapshot?.metrics.totalRetries ?? 0}</span></div>
              <div>平均重试: <span className="mono">{props.evolutionSnapshot?.metrics.avgRetries ?? 0}</span></div>
              <div>总步骤: <span className="mono">{props.evolutionSnapshot?.metrics.totalSteps ?? 0}</span></div>
              <div>平均步骤: <span className="mono">{props.evolutionSnapshot?.metrics.avgStepsPerGoal ?? 0}</span></div>
            </div>
            <Separator />
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="mono">state store: {props.evolutionSnapshot?.storage.stores.state.name ?? "-"}</div>
              <div className="mono">retry store: {props.evolutionSnapshot?.storage.stores.retryQueue.name ?? "-"}</div>
              <div className="mono">metrics store: {props.evolutionSnapshot?.storage.stores.metrics.name ?? "-"}</div>
              <div className="mono">codex dir: {props.evolutionSnapshot?.storage.artifacts.codexOutputDir ?? "-"}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unified Queue</CardTitle>
          <CardDescription>合并展示 active / retry / history 队列信息</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Goal ID</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>阶段</TableHead>
                <TableHead>步骤</TableHead>
                <TableHead>重试</TableHead>
                <TableHead>下一次重试</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead>完成时间</TableHead>
                <TableHead>来源</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.evolutionQueueRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    暂无 Goal
                  </TableCell>
                </TableRow>
              ) : (
                props.evolutionQueueRows.slice(0, 16).map((row) => (
                  <TableRow key={row.goalId}>
                    <TableCell>
                      <div className="mono text-xs">{row.goalId}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{row.goal}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getEvolutionStatusBadgeVariant(row.status)}>
                        {formatEvolutionStatus(row.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="mono">{row.stage || "-"}</span>
                    </TableCell>
                    <TableCell className="text-xs">{row.stepProgress || "-"}</TableCell>
                    <TableCell className="text-xs">{row.retrySummary || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.nextRetryAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.updatedAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.completedAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="mono">{formatEvolutionQueueSource(row.source)}</span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Goal Trace</CardTitle>
          <CardDescription>关键事件与最近输出（实时可观测）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!props.currentEvolutionGoal ? (
            <div className="text-sm text-muted-foreground">当前没有运行中的 Goal。</div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                <span className="mono">{props.currentEvolutionGoal.id}</span>
                {" · "}
                stage=<span className="mono">{props.currentEvolutionGoal.stage || "-"}</span>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium">关键节点</div>
                {(props.currentEvolutionGoal.events || []).length === 0 ? (
                  <div className="text-xs text-muted-foreground">暂无事件</div>
                ) : (
                  <div className="space-y-1">
                    {(props.currentEvolutionGoal.events || []).slice(-10).map((event) => (
                      <div key={`${event.at}-${event.stage}-${event.message}`} className="text-xs">
                        <span className="text-muted-foreground">[{formatDateTime(event.at)}]</span>
                        {" "}
                        <span className="mono">{event.stage}</span>
                        {": "}
                        {event.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Separator />
              <div className="space-y-1">
                <div className="text-xs font-medium">最近输出</div>
                {(props.currentEvolutionGoal.rawTail || []).length === 0 ? (
                  <div className="text-xs text-muted-foreground">暂无输出</div>
                ) : (
                  <div className="space-y-1">
                    {(props.currentEvolutionGoal.rawTail || []).slice(-14).map((item) => (
                      <div key={`${item.at}-${item.line}`} className="mono text-xs">
                        <span className="text-muted-foreground">[{formatDateTime(item.at)}]</span>
                        {" "}
                        {item.line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
