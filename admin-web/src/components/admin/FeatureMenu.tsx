import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { MenuKey } from "@/types/admin";

type FeatureMenuProps = {
  activeMenu: MenuKey;
  onChange: (menu: MenuKey) => void;
};

export function FeatureMenu(props: FeatureMenuProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>功能菜单</CardTitle>
        <CardDescription>按功能切换，避免一次展示全部设置</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={props.activeMenu === "system" ? "default" : "outline"}
            onClick={() => props.onChange("system")}
          >
            系统设置
          </Button>
          <Button
            type="button"
            variant={props.activeMenu === "messages" ? "default" : "outline"}
            onClick={() => props.onChange("messages")}
          >
            消息任务
          </Button>
          <Button
            type="button"
            variant={props.activeMenu === "market" ? "default" : "outline"}
            onClick={() => props.onChange("market")}
          >
            Market Analysis
          </Button>
          <Button
            type="button"
            variant={props.activeMenu === "evolution" ? "default" : "outline"}
            onClick={() => props.onChange("evolution")}
          >
            Evolution Engine
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
