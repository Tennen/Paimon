import { SkillInfo, SkillManager } from "../../skills/skillManager";
import { ToolRegistry, ToolRuntimeContext, ToolSchemaItem } from "../../tools/toolRegistry";

export type RoutingSkillContextEntry = {
  description?: string;
  command?: string;
  terminal?: boolean;
  tool?: string;
  action?: string;
  params?: string[];
  keywords?: string[];
};

export type ConversationSkillOption = RoutingSkillContextEntry & {
  name: string;
  source: "skill" | "builtin-tool";
};

export type ConversationToolOption = {
  name: string;
  description?: string;
  resource?: string;
  keywords?: string[];
  operations: Array<{ op: string; description?: string }>;
};

type BuiltinSkillDefinition = {
  name: "homeassistant" | "celestia";
  description: string;
  tool: string;
  action: string;
};

const BUILTIN_TOOL_SKILLS: BuiltinSkillDefinition[] = [
  {
    name: "homeassistant",
    description: "Control and query Home Assistant devices (services, state, snapshots).",
    tool: "homeassistant",
    action: "call_service"
  },
  {
    name: "celestia",
    description: "Control and query Celestia AI devices (semantic commands, raw actions).",
    tool: "celestia",
    action: "invoke_command"
  }
];

export function buildConversationSkillsContext(
  skillManager: SkillManager,
  toolRegistry: ToolRegistry,
  options: {
    onlyNames?: string[];
    allowedSkillNames?: string[] | null;
    allowedToolNames?: string[] | null;
  } = {}
): Record<string, RoutingSkillContextEntry> | null {
  const allowedSkillSet = toNameSet(options.allowedSkillNames);
  const allowedToolSet = toNameSet(options.allowedToolNames);
  const onlyNamesSet = toNameSet(options.onlyNames);
  const entries: Array<readonly [string, RoutingSkillContextEntry]> = [];

  for (const skill of skillManager.list()) {
    if (!shouldIncludeSkillOption(skill.name, onlyNamesSet, allowedSkillSet)) {
      continue;
    }
    if (!isToolAllowedForSkill(skill.tool, allowedToolSet)) {
      continue;
    }
    entries.push([
      skill.name,
      {
        description: skill.description
      }
    ]);
  }

  for (const [name, extra] of Object.entries(buildExtraSkillsContext(toolRegistry))) {
    if (!shouldIncludeSkillOption(name, onlyNamesSet, allowedSkillSet)) {
      continue;
    }
    if (!isToolAllowedForSkill(extra.tool, allowedToolSet)) {
      continue;
    }
    entries.push([name, extra]);
  }

  const merged = Object.fromEntries(entries);
  return Object.keys(merged).length > 0 ? merged : null;
}

export function buildExtraSkillsContext(
  toolRegistry: ToolRegistry
): Record<string, RoutingSkillContextEntry> {
  const extra: Record<string, RoutingSkillContextEntry> = {};

  for (const builtin of BUILTIN_TOOL_SKILLS) {
    const schema = toolRegistry.listSchema().find((tool) => tool.name === builtin.name);
    if (!schema) {
      continue;
    }
    extra[builtin.name] = {
      description: builtin.description,
      command: builtin.name,
      terminal: false,
      tool: builtin.name,
      action: builtin.action,
      ...(schema.keywords ? { keywords: schema.keywords } : {})
    };
  }

  return extra;
}

export function listConversationSkillOptions(
  skillManager: SkillManager,
  toolRegistry: ToolRegistry
): ConversationSkillOption[] {
  const items = new Map<string, ConversationSkillOption>();

  for (const skill of skillManager.list()) {
    items.set(skill.name, {
      name: skill.name,
      source: "skill",
      description: skill.description,
      ...(skill.metadata?.command ?? skill.command ? { command: skill.metadata?.command ?? skill.command } : {}),
      ...(typeof skill.terminal === "boolean" ? { terminal: skill.terminal } : {}),
      ...(skill.tool ? { tool: skill.tool } : {}),
      ...(skill.action ? { action: skill.action } : {}),
      ...(Array.isArray(skill.params) && skill.params.length > 0 ? { params: skill.params } : {}),
      ...(Array.isArray(skill.keywords) && skill.keywords.length > 0 ? { keywords: skill.keywords } : {})
    });
  }

  for (const builtin of BUILTIN_TOOL_SKILLS) {
    const schema = toolRegistry.listSchema().find((tool) => tool.name === builtin.tool);
    if (!schema) {
      continue;
    }
    items.set(builtin.name, {
      name: builtin.name,
      source: "builtin-tool",
      description: builtin.description,
      command: builtin.name,
      terminal: false,
      tool: builtin.tool,
      action: builtin.action,
      ...(schema.keywords ? { keywords: schema.keywords } : {})
    });
  }

  return Array.from(items.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function listConversationToolOptions(toolRegistry: ToolRegistry): ConversationToolOption[] {
  return toolRegistry.listSchema()
    .map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.resource ? { resource: tool.resource } : {}),
      ...(tool.keywords ? { keywords: tool.keywords } : {}),
      operations: (tool.operations ?? []).map((operation) => ({
        op: operation.op,
        ...(operation.description ? { description: operation.description } : {})
      }))
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function filterToolRuntimeContextByAllowedNames(
  toolContext: Record<string, ToolRuntimeContext>,
  allowedToolNames: string[] | null
): Record<string, ToolRuntimeContext> | null {
  if (allowedToolNames === null) {
    return toolContext;
  }

  const allowed = new Set(allowedToolNames);
  const result: Record<string, ToolRuntimeContext> = {};
  for (const [name, value] of Object.entries(toolContext)) {
    if (name === "_tools") {
      continue;
    }
    if (!allowed.has(name)) {
      continue;
    }
    result[name] = value;
  }

  const schema = Array.isArray(toolContext._tools?.schema)
    ? toolContext._tools.schema.filter((item) => item && typeof item.name === "string" && allowed.has(item.name))
    : [];
  if (schema.length > 0) {
    result._tools = { schema };
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function resolveConversationSkillAvailability(
  skillName: string,
  skillManager: SkillManager,
  toolRegistry: ToolRegistry,
  options: {
    allowedSkillNames?: string[] | null;
    allowedToolNames?: string[] | null;
  } = {}
): { enabled: boolean; skill?: SkillInfo } {
  const available = buildConversationSkillsContext(skillManager, toolRegistry, {
    onlyNames: [skillName],
    allowedSkillNames: options.allowedSkillNames ?? null,
    allowedToolNames: options.allowedToolNames ?? null
  });
  if (!available || !available[skillName]) {
    return { enabled: false };
  }
  const skill = skillManager.get(skillName);
  return skill ? { enabled: true, skill } : { enabled: true };
}

function shouldIncludeSkillOption(
  name: string,
  onlyNamesSet: Set<string> | null,
  allowedSkillSet: Set<string> | null
): boolean {
  if (onlyNamesSet && !onlyNamesSet.has(name)) {
    return false;
  }
  if (allowedSkillSet && !allowedSkillSet.has(name)) {
    return false;
  }
  return true;
}

function isToolAllowedForSkill(toolName: string | undefined, allowedToolSet: Set<string> | null): boolean {
  if (!toolName || !allowedToolSet) {
    return true;
  }
  return allowedToolSet.has(toolName);
}

function toNameSet(input: string[] | null | undefined): Set<string> | null {
  if (!Array.isArray(input)) {
    return null;
  }
  return new Set(input.map((item) => String(item ?? "").trim()).filter(Boolean));
}
