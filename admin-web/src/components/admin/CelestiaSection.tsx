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
import { useCelestiaSectionState } from "@/components/admin/hooks/useCelestiaSectionState";
import type { CelestiaCommandParam } from "@/types/admin";

export function CelestiaSection() {
  const props = useCelestiaSectionState();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Celestia Gateway</CardTitle>
          <CardDescription>查看 Celestia AI 设备目录、可用命令、底层 action 与参数定义。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label>plugin_id</Label>
              <Input
                value={props.filters.pluginId}
                onChange={(event) => props.onFilterChange("pluginId", event.target.value)}
                placeholder="petkit / xiaomi / haier"
              />
            </div>
            <div className="space-y-2">
              <Label>kind</Label>
              <Input
                value={props.filters.kind}
                onChange={(event) => props.onFilterChange("kind", event.target.value)}
                placeholder="feeder / light / camera"
              />
            </div>
            <div className="space-y-2">
              <Label>q</Label>
              <Input
                value={props.filters.query}
                onChange={(event) => props.onFilterChange("query", event.target.value)}
                placeholder="设备名、房间、alias"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={props.onRefresh} disabled={props.loading}>
              {props.loading ? "加载中..." : "刷新设备"}
            </Button>
            <Badge variant={props.configured ? "default" : "secondary"}>
              {props.configured ? "已配置" : "未配置"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {props.baseUrl ? `baseUrl: ${props.baseUrl}` : "请先在 System -> 运行时配置 CELESTIA_BASE_URL / CELESTIA_TOKEN"}
            </span>
          </div>

          {props.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {props.error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>设备列表</CardTitle>
            <CardDescription>{props.devices.length} 个设备，点击查看命令详情</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {props.devices.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {props.configured ? "没有匹配设备。" : "Celestia 尚未配置。"}
              </div>
            ) : props.devices.map((device) => (
              <button
                key={device.id}
                type="button"
                className={[
                  "w-full rounded-md border p-3 text-left transition-colors",
                  props.selectedDeviceId === device.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                ].join(" ")}
                onClick={() => props.onSelectDevice(device.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{device.name}</div>
                    <div className="mono mt-1 truncate text-xs text-muted-foreground">{device.id}</div>
                  </div>
                  <Badge variant="secondary">{device.commands.length}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {device.plugin_id ? <Badge variant="outline">{device.plugin_id}</Badge> : null}
                  {device.kind ? <Badge variant="outline">{device.kind}</Badge> : null}
                  {device.aliases.slice(0, 3).map((alias) => (
                    <Badge key={alias} variant="outline">{alias}</Badge>
                  ))}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{props.selectedDevice ? props.selectedDevice.name : "设备详情"}</CardTitle>
            <CardDescription>
              {props.selectedDevice ? props.selectedDevice.id : "从左侧选择一个设备查看 commands/actions"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!props.selectedDevice ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                当前没有选中设备。
              </div>
            ) : (
              <>
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <div><span className="text-muted-foreground">plugin_id:</span> <span className="mono">{props.selectedDevice.plugin_id || "-"}</span></div>
                  <div><span className="text-muted-foreground">kind:</span> <span className="mono">{props.selectedDevice.kind || "-"}</span></div>
                  <div className="md:col-span-2">
                    <span className="text-muted-foreground">aliases:</span>{" "}
                    {props.selectedDevice.aliases.length > 0 ? props.selectedDevice.aliases.join(", ") : "-"}
                  </div>
                </div>
                <Separator />
                <div className="space-y-3">
                  {props.selectedDevice.commands.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      该设备没有暴露 AI command。
                    </div>
                  ) : props.selectedDevice.commands.map((command) => (
                    <div key={`${command.name}-${command.action}`} className="rounded-md border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{command.name}</div>
                          <div className="mono mt-1 text-xs text-muted-foreground">action: {command.action}</div>
                        </div>
                        <Badge variant={command.params.length > 0 ? "default" : "secondary"}>
                          {command.params.length} params
                        </Badge>
                      </div>
                      {command.aliases.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {command.aliases.map((alias) => (
                            <Badge key={alias} variant="outline">{alias}</Badge>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 space-y-2">
                        {command.params.length === 0 ? (
                          <div className="text-xs text-muted-foreground">无需用户参数。</div>
                        ) : command.params.map((param) => (
                          <ParamRow key={param.name} param={param} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ParamRow({ param }: { param: CelestiaCommandParam }) {
  const constraints = [
    param.required ? "required" : "",
    typeof param.min === "number" ? `min=${param.min}` : "",
    typeof param.max === "number" ? `max=${param.max}` : "",
    typeof param.step === "number" ? `step=${param.step}` : "",
    param.default !== undefined ? `default=${formatParamValue(param.default)}` : ""
  ].filter(Boolean);

  return (
    <div className="rounded-md bg-muted/40 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{param.name}</span>
        {param.type ? <Badge variant="secondary">{param.type}</Badge> : null}
        {constraints.map((item) => (
          <Badge key={item} variant="outline">{item}</Badge>
        ))}
      </div>
    </div>
  );
}

function formatParamValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
