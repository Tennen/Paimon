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
  MarketSectionProps
} from "@/types/admin";

export function MarketSection(props: MarketSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Analysis</CardTitle>
        <CardDescription>管理持仓、查看最近分析结果，并快速生成盘中/收盘任务</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="market-cash">现金</Label>
            <Input
              id="market-cash"
              type="number"
              min={0}
              step="0.01"
              value={props.marketPortfolio.cash}
              onChange={(event) => {
                const value = Number(event.target.value);
                props.onCashChange(Number.isFinite(value) ? value : 0);
              }}
              placeholder="可选现金余额"
            />
          </div>
          <div className="flex items-end justify-start gap-2">
            <Button type="button" variant="outline" onClick={props.onAddMarketFund}>
              添加持仓
            </Button>
            <Button type="button" disabled={props.savingMarketPortfolio} onClick={props.onSaveMarketPortfolio}>
              {props.savingMarketPortfolio ? "保存中..." : "保存 Market 配置"}
            </Button>
            <Button type="button" variant="secondary" onClick={props.onRefresh}>
              刷新
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">代码</TableHead>
              <TableHead className="w-[340px]">名称查 code</TableHead>
              <TableHead className="w-[160px]">持仓数量</TableHead>
              <TableHead className="w-[160px]">平均成本</TableHead>
              <TableHead className="w-[120px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.marketPortfolio.funds.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  暂无持仓，点击“添加持仓”开始配置
                </TableCell>
              </TableRow>
            ) : (
              props.marketPortfolio.funds.map((fund, index) => (
                <TableRow key={`market-fund-${index}`}>
                  <TableCell>
                    <Input
                      className="mono"
                      value={fund.code}
                      onChange={(event) => props.onMarketFundChange(index, "code", event.target.value)}
                      placeholder="例如 510300"
                    />
                  </TableCell>
                  <TableCell className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={props.marketSearchInputs[index] ?? ""}
                        onChange={(event) => props.onMarketSearchInputChange(index, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            props.onSearchMarketByName(index);
                          }
                        }}
                        placeholder="输入名称/拼音，例如 沪深300ETF"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={props.searchingMarketFundIndex === index}
                        onClick={() => props.onSearchMarketByName(index)}
                      >
                        {props.searchingMarketFundIndex === index ? "查找中" : "查找"}
                      </Button>
                    </div>
                    {props.marketSearchResults[index] && props.marketSearchResults[index].length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {props.marketSearchResults[index].map((item, suggestionIndex) => (
                          <Button
                            key={`market-suggest-${index}-${item.code}-${suggestionIndex}`}
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 text-xs"
                            onClick={() => props.onApplyMarketSearchResult(index, item)}
                          >
                            {item.name} ({item.code}{item.market ? `.${item.market}` : ""})
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step="0.0001"
                      value={fund.quantity}
                      onChange={(event) => props.onMarketFundChange(index, "quantity", event.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step="0.0001"
                      value={fund.avgCost}
                      onChange={(event) => props.onMarketFundChange(index, "avgCost", event.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button type="button" size="sm" variant="destructive" onClick={() => props.onRemoveMarketFund(index)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <Separator />

        <div className="space-y-3">
          <h3 className="text-sm font-medium">快速创建每日两次任务</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label>推送用户</Label>
              <Select
                value={props.marketTaskUserId || undefined}
                onValueChange={props.onMarketTaskUserIdChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder={props.enabledUsers.length > 0 ? "选择用户" : "请先创建启用用户"} />
                </SelectTrigger>
                <SelectContent>
                  {props.enabledUsers.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      暂无启用用户
                    </SelectItem>
                  ) : (
                    props.enabledUsers.map((user) => (
                      <SelectItem key={`market-user-${user.id}`} value={user.id}>
                        {user.name} ({user.wecomUserId})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="market-midday-time">盘中时间</Label>
              <Input
                id="market-midday-time"
                type="time"
                value={props.marketMiddayTime}
                onChange={(event) => props.onMarketMiddayTimeChange(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="market-close-time">收盘时间</Label>
              <Input
                id="market-close-time"
                type="time"
                value={props.marketCloseTime}
                onChange={(event) => props.onMarketCloseTimeChange(event.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={props.bootstrappingMarketTasks || props.enabledUsers.length === 0}
              onClick={props.onBootstrapMarketTasks}
            >
              {props.bootstrappingMarketTasks ? "处理中..." : "生成 / 更新 Market 定时任务"}
            </Button>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <h3 className="text-sm font-medium">手动生成一次报告</h3>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="market-with-explanation">是否生成 LLM 解释</Label>
            <Switch
              id="market-with-explanation"
              checked={props.marketRunOnceWithExplanation}
              onCheckedChange={props.onMarketRunOnceWithExplanationChange}
              disabled={props.runningMarketOncePhase !== null}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!props.marketTaskUserId || props.runningMarketOncePhase !== null}
              onClick={() => props.onRunMarketOnce("midday", props.marketRunOnceWithExplanation)}
            >
              {props.runningMarketOncePhase === "midday" ? "盘中生成中..." : "立即生成盘中报告"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!props.marketTaskUserId || props.runningMarketOncePhase !== null}
              onClick={() => props.onRunMarketOnce("close", props.marketRunOnceWithExplanation)}
            >
              {props.runningMarketOncePhase === "close" ? "收盘生成中..." : "立即生成收盘报告"}
            </Button>
          </div>
          {!props.marketTaskUserId ? (
            <p className="text-xs text-destructive">请先选择推送用户后再手动生成报告</p>
          ) : null}
        </div>

        <Separator />

        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <div className="mono">portfolio: {props.marketConfig?.portfolioPath ?? "-"}</div>
          <div className="mono">state: {props.marketConfig?.statePath ?? "-"}</div>
          <div className="mono">runs: {props.marketConfig?.runsDir ?? "-"}</div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>阶段</TableHead>
              <TableHead>市场状态</TableHead>
              <TableHead>资产信号</TableHead>
              <TableHead>说明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.marketRuns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  暂无运行记录
                </TableCell>
              </TableRow>
            ) : (
              props.marketRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(run.createdAt)}</TableCell>
                  <TableCell>{run.phase === "close" ? "收盘" : "盘中"}</TableCell>
                  <TableCell>
                    <div>{run.marketState || "-"}</div>
                    <div className="mono text-xs text-muted-foreground">{run.benchmark || "-"}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {run.signals.length > 0
                      ? run.signals.map((signal) => `${signal.code}:${signal.signal}`).join(", ")
                      : "-"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {run.explanationSummary || "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
