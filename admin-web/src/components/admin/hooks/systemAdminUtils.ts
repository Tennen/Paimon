import type {
  DirectInputMappingConfig,
  DirectInputMappingRule,
  MainConversationMode,
  WeComMenuButton,
  WeComMenuConfig,
  WeComMenuEventRecord,
  WeComMenuLeafButton
} from "@/types/admin";
import { DEFAULT_DIRECT_INPUT_MAPPING_CONFIG, DEFAULT_WECOM_MENU_CONFIG } from "@/types/admin";

export function normalizeStorageDriver(raw: string): "json-file" | "sqlite" {
  return raw === "sqlite" ? "sqlite" : "json-file";
}

export function normalizeConversationMode(raw: string): MainConversationMode {
  return raw === "windowed-agent" ? "windowed-agent" : "classic";
}

export function normalizeDirectInputMappingConfig(
  config: DirectInputMappingConfig | null | undefined
): DirectInputMappingConfig {
  const source = config ?? DEFAULT_DIRECT_INPUT_MAPPING_CONFIG;
  const rawRules = Array.isArray(source.rules) ? source.rules : [];
  const rules: DirectInputMappingRule[] = [];
  const idSet = new Set<string>();

  for (let index = 0; index < rawRules.length; index += 1) {
    const rule = normalizeDirectInputMappingRule(rawRules[index], index);
    if (idSet.has(rule.id)) {
      continue;
    }
    idSet.add(rule.id);
    rules.push(rule);
  }

  return {
    version: 1,
    rules,
    updatedAt: String(source.updatedAt ?? "").trim()
  };
}

export function normalizeWeComMenuConfig(config: WeComMenuConfig | null | undefined): WeComMenuConfig {
  const source = config ?? DEFAULT_WECOM_MENU_CONFIG;
  const rawButtons = Array.isArray(source.buttons) ? source.buttons : [];
  const lastPublishedAt = String(source.lastPublishedAt ?? "").trim();

  return {
    version: 1,
    buttons: rawButtons.slice(0, 3).map((button, index) => normalizeWeComMenuButton(button, index)),
    updatedAt: String(source.updatedAt ?? "").trim(),
    ...(lastPublishedAt ? { lastPublishedAt } : {})
  };
}

export function normalizeWeComMenuEvents(input: unknown): WeComMenuEventRecord[] {
  const list = Array.isArray(input) ? input : [];
  return list
    .map((item) => normalizeWeComMenuEvent(item as Partial<WeComMenuEventRecord>))
    .filter((item): item is WeComMenuEventRecord => Boolean(item));
}

export function normalizeStringList(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

export function resolveConversationContextSelection(
  selected: string[] | null | undefined,
  availableNames: string[]
): string[] {
  const availableSet = new Set(availableNames.map((item) => String(item ?? "").trim()).filter(Boolean));
  if (selected === null || selected === undefined) {
    return availableNames.slice();
  }
  return normalizeStringList(selected).filter((item) => availableSet.has(item));
}

export function isLikelyRestartConnectionDrop(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("failed to fetch")
    || lower.includes("networkerror")
    || lower.includes("network request failed")
    || lower.includes("load failed");
}

function normalizeDirectInputMappingRule(
  input: Partial<DirectInputMappingRule> | null | undefined,
  index: number
): DirectInputMappingRule {
  return {
    id: normalizeAdminLocalId(String(input?.id ?? `mapping-${index + 1}`), `mapping-${index + 1}`),
    name: String(input?.name ?? "").trim(),
    pattern: String(input?.pattern ?? "").trim(),
    targetText: String(input?.targetText ?? "").trim(),
    matchMode: input?.matchMode === "fuzzy" ? "fuzzy" : "exact",
    enabled: typeof input?.enabled === "boolean" ? input.enabled : true
  };
}

function normalizeWeComMenuButton(input: Partial<WeComMenuButton> | null | undefined, index: number): WeComMenuButton {
  const rawSubButtons = Array.isArray(input?.subButtons) ? input.subButtons : [];
  return {
    id: normalizeAdminLocalId(String(input?.id ?? `root-${index + 1}`), `root-${index + 1}`),
    name: String(input?.name ?? "").trim(),
    key: String(input?.key ?? "").trim(),
    enabled: typeof input?.enabled === "boolean" ? input.enabled : true,
    dispatchText: String(input?.dispatchText ?? "").trim(),
    subButtons: rawSubButtons
      .slice(0, 5)
      .map((button, subIndex) => normalizeWeComMenuLeafButton(button, `${index + 1}-${subIndex + 1}`))
  };
}

function normalizeWeComMenuLeafButton(
  input: Partial<WeComMenuLeafButton> | null | undefined,
  fallbackId: string
): WeComMenuLeafButton {
  return {
    id: normalizeAdminLocalId(String(input?.id ?? `leaf-${fallbackId}`), `leaf-${fallbackId}`),
    name: String(input?.name ?? "").trim(),
    key: String(input?.key ?? "").trim(),
    enabled: typeof input?.enabled === "boolean" ? input.enabled : true,
    dispatchText: String(input?.dispatchText ?? "").trim()
  };
}

function normalizeWeComMenuEvent(input: Partial<WeComMenuEventRecord> | null | undefined): WeComMenuEventRecord | null {
  if (!input) {
    return null;
  }

  const status = normalizeWeComMenuEventStatus(input.status);
  const id = String(input.id ?? "").trim();
  if (!status || !id) {
    return null;
  }

  const agentId = String(input.agentId ?? "").trim();
  const matchedButtonId = String(input.matchedButtonId ?? "").trim();
  const matchedButtonName = String(input.matchedButtonName ?? "").trim();
  const dispatchText = String(input.dispatchText ?? "").trim();
  const error = String(input.error ?? "").trim();

  return {
    id,
    source: "wecom",
    eventType: "click",
    eventKey: String(input.eventKey ?? "").trim(),
    fromUser: String(input.fromUser ?? "").trim(),
    toUser: String(input.toUser ?? "").trim(),
    ...(agentId ? { agentId } : {}),
    ...(matchedButtonId ? { matchedButtonId } : {}),
    ...(matchedButtonName ? { matchedButtonName } : {}),
    ...(dispatchText ? { dispatchText } : {}),
    status,
    ...(error ? { error } : {}),
    receivedAt: String(input.receivedAt ?? "").trim()
  };
}

function normalizeWeComMenuEventStatus(raw: unknown): WeComMenuEventRecord["status"] | "" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "recorded" || value === "dispatched" || value === "ignored" || value === "failed") {
    return value;
  }
  return "";
}

function normalizeAdminLocalId(raw: string, fallback: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}
