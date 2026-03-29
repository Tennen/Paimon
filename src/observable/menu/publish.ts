import {
  WeComMenuPublishGroupButton,
  WeComMenuPublishLeafButton,
  WeComMenuPublishPayload
} from "../../integrations/wecom/menuClient";
import {
  MAX_EVENT_LOG_ITEMS,
  MAX_ROOT_BUTTONS,
  MAX_SUB_BUTTONS
} from "./constants";
import { validateLeafButton } from "./normalize";
import {
  ObservableMenuConfig,
  ObservableMenuEventRecord,
  ObservableMenuSnapshot
} from "./types";

export function validateObservableMenuConfig(config: ObservableMenuConfig): string[] {
  const errors: string[] = [];
  const rootButtons = Array.isArray(config.buttons) ? config.buttons : [];

  if (rootButtons.length > MAX_ROOT_BUTTONS) {
    errors.push(`一级菜单最多只能配置 ${MAX_ROOT_BUTTONS} 个`);
  }

  const enabledKeys = new Map<string, string>();

  rootButtons.forEach((button, index) => {
    if (button.subButtons.length > MAX_SUB_BUTTONS) {
      errors.push(`一级菜单“${button.name || `按钮 ${index + 1}`}”最多只能配置 ${MAX_SUB_BUTTONS} 个二级菜单`);
    }

    if (!button.enabled) {
      return;
    }

    const subButtons = button.subButtons.filter((item) => item.enabled);
    if (subButtons.length > 0) {
      if (!button.name) {
        errors.push(`一级菜单 ${index + 1} 缺少名称`);
      }
      subButtons.forEach((subButton, subIndex) => {
        validateLeafButton(subButton, errors, enabledKeys, `二级菜单 ${index + 1}.${subIndex + 1}`);
      });
      return;
    }

    validateLeafButton(button, errors, enabledKeys, `一级菜单 ${index + 1}`);
  });

  if (enabledKeys.size === 0) {
    errors.push("至少需要 1 个启用的 click 菜单");
  }

  return errors;
}

export function buildWeComMenuPublishPayload(config: ObservableMenuConfig): WeComMenuPublishPayload {
  const validationErrors = validateObservableMenuConfig(config);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors[0]);
  }

  const buttons: Array<WeComMenuPublishLeafButton | WeComMenuPublishGroupButton> = [];

  for (const button of config.buttons) {
    if (!button.enabled) {
      continue;
    }

    const enabledSubButtons = button.subButtons.filter((item) => item.enabled);
    if (enabledSubButtons.length > 0) {
      buttons.push({
        name: button.name,
        sub_button: enabledSubButtons.map((item) => ({
          type: "click",
          name: item.name,
          key: item.key
        }))
      });
      continue;
    }

    buttons.push({
      type: "click",
      name: button.name,
      key: button.key
    });
  }

  return {
    button: buttons
  };
}

export function buildSnapshot(
  config: ObservableMenuConfig,
  events: ObservableMenuEventRecord[]
): ObservableMenuSnapshot {
  const validationErrors = validateObservableMenuConfig(config);
  return {
    config,
    recentEvents: events.slice(0, MAX_EVENT_LOG_ITEMS),
    publishPayload: validationErrors.length === 0 ? buildWeComMenuPublishPayload(config) : null,
    validationErrors
  };
}
