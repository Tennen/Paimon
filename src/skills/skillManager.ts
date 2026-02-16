import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export type SkillInfo = {
  name: string;
  description: string;
  terminal?: boolean;
  command?: string;
  keywords?: string[];
  directCommands?: string[];
  directAsync?: boolean;
  directAcceptedText?: string;
  hasHandler?: boolean;
  preferToolResult?: boolean;
  detail?: string;
  install?: string;
  metadata?: {
    command?: string;
    install?: string;
    keywords?: string[];
    directCommands?: string[];
    directAsync?: boolean;
    directAcceptedText?: string;
    preferToolResult?: boolean;
    [key: string]: any;
  };
};

export type SkillInvokeResult = {
  text: string;
  data?: unknown;
};

type SkillHandler = (input: string, context: Record<string, unknown>) => Promise<SkillInvokeResult> | SkillInvokeResult;

export class SkillManager {
  private readonly baseDirs: string[];
  private skills: SkillInfo[] = [];
  private skillMap = new Map<string, SkillInfo>();
  private handlers = new Map<string, SkillHandler>();

  constructor(baseDir?: string) {
    const defaultDirs = [
      path.resolve(process.cwd(), "skills"),
      path.resolve(process.cwd(), "src", "skills")
    ];
    this.baseDirs = baseDir ? [baseDir] : defaultDirs;
    this.refresh();
  }

  refresh(): void {
    this.skills = [];
    this.skillMap.clear();
    this.handlers.clear();

    for (const baseDir of this.baseDirs) {
      if (!fs.existsSync(baseDir)) {
        continue;
      }

      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirName = entry.name;
        const skillDir = path.join(baseDir, dirName);
        const skillPath = path.join(skillDir, "SKILL.md");
        if (!fs.existsSync(skillPath)) continue;

        const content = fs.readFileSync(skillPath, "utf-8");
        const frontmetadata = extractFrontmatter(content);
        const name = frontmetadata.name ?? dirName;
        const description = frontmetadata.description ?? extractDescription(content);
        const handlerPath = path.join(skillDir, "handler.js");
        const handlerDeclared = fs.existsSync(handlerPath);
        const info: SkillInfo = {
          name,
          description,
          terminal: frontmetadata.terminal,
          command: frontmetadata.command,
          keywords: frontmetadata.keywords,
          hasHandler: false,
          preferToolResult: frontmetadata.preferToolResult,
          install: frontmetadata.install,
          metadata: frontmetadata,
          detail: content
        };
        if (!this.skillMap.has(name)) {
          this.skills.push(info);
          this.skillMap.set(name, info);
        }

        if (handlerDeclared && !this.handlers.has(name)) {
          try {
            const mod = require(handlerPath) as {
              execute?: SkillHandler;
              directCommands?: unknown;
              directAsync?: unknown;
              directAcceptedText?: unknown;
            };
            if (mod.execute) {
              this.handlers.set(name, mod.execute);
              const existing = this.skillMap.get(name);
              if (existing) {
                existing.hasHandler = true;
                const directCommands = parseDirectCommands(mod.directCommands);
                if (directCommands.length > 0) {
                  existing.directCommands = directCommands;
                  if (existing.metadata) {
                    existing.metadata.directCommands = directCommands;
                  }
                }
                const directAsync = parseMaybeBoolean(mod.directAsync);
                if (directAsync !== undefined) {
                  existing.directAsync = directAsync;
                  if (existing.metadata) {
                    existing.metadata.directAsync = directAsync;
                  }
                }
                const directAcceptedText = parseMaybeString(mod.directAcceptedText);
                if (directAcceptedText) {
                  existing.directAcceptedText = directAcceptedText;
                  if (existing.metadata) {
                    existing.metadata.directAcceptedText = directAcceptedText;
                  }
                }
              }
            }
          } catch {
            // ignore load errors
          }
        }
      }
    }
  }

  list(): SkillInfo[] {
    return this.skills.slice();
  }

  get(name: string): SkillInfo | undefined {
    return this.skillMap.get(name);
  }

  getDetail(name: string): string {
    return this.skillMap.get(name)?.detail ?? "";
  }

  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  async invoke(name: string, input: string, context: Record<string, unknown>): Promise<SkillInvokeResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error("no handler");
    }
    const result = await handler(input, context);
    return result ?? { text: "" };
  }

  async installSkill(skillName: string): Promise<void> {
    const skill = this.get(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    if (!skill.install) {
      return;
    }

    console.log(`Installing dependencies for skill: ${skillName}`);

    try {
      // Check if the command is available
      const command = skill.install.trim();

      if (command.startsWith("brew install")) {
        const packageName = command.replace("brew install", "").trim();
        console.log(`Checking if ${packageName} is installed...`);

        try {
          await execAsync(`brew list --versions ${packageName}`);
          console.log(`${packageName} is already installed`);
        } catch {
          console.log(`Installing ${packageName} via Homebrew...`);
          await execAsync(command);
          console.log(`Successfully installed ${packageName}`);
        }
      } else if (command.startsWith("npm install")) {
        const packageSpec = command.replace("npm install", "").trim();
        console.log(`Installing ${packageSpec}...`);
        await execAsync(command);
        console.log(`Successfully installed ${packageSpec}`);
      } else {
        // Custom command
        console.log(`Running install command: ${command}`);
        await execAsync(command);
        console.log(`Successfully ran install command`);
      }
    } catch (error) {
      console.error(`Failed to install dependencies for skill ${skillName}:`, error);
      throw error;
    }
  }

  async checkSkillDependencies(skillName: string): Promise<{ installed: boolean; message: string }> {
    const skill = this.get(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    if (!skill.install) {
      return { installed: true, message: "No dependencies to install" };
    }

    try {
      const command = skill.install.trim();

      if (command.startsWith("brew install")) {
        const packageName = command.replace("brew install", "").trim();
        await execAsync(`brew list --versions ${packageName}`);
        return { installed: true, message: `${packageName} is installed` };
      } else if (command.startsWith("npm install")) {
        const packageName = extractNpmInstallPackage(command);
        if (!packageName) {
          await execAsync("npm --version");
          return { installed: true, message: "npm is available" };
        }
        await execAsync(`npm list --depth=0 ${packageName}`);
        return { installed: true, message: `${packageName} is installed` };
      } else {
        // For custom commands, try to run a dry run version if possible
        // This is a simple check - you might want more sophisticated checks
        return { installed: true, message: "Custom command assumed available" };
      }
    } catch (error) {
      return {
        installed: false,
        message: `Dependency not installed: ${(error as Error).message}`
      };
    }
  }

  async ensureSkillsInstalled(): Promise<void> {
    const skillsToCheck = this.list();
    const failedSkills: string[] = [];

    for (const skill of skillsToCheck) {
      if (!skill.install) continue;

      const { installed, message } = await this.checkSkillDependencies(skill.name);
      if (!installed) {
        console.log(`Skill ${skill.name} needs installation: ${message}`);
        try {
          await this.installSkill(skill.name);
        } catch (error) {
          console.error(`Failed to install ${skill.name}:`, error);
          failedSkills.push(skill.name);
        }
      } else {
        console.log(`Skill ${skill.name} dependencies OK: ${message}`);
      }
    }

    if (failedSkills.length > 0) {
      console.warn(`Failed to install dependencies for: ${failedSkills.join(", ")}`);
    }
  }
}

function extractDescription(content: string): string {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  const first = lines.find((l) => !l.startsWith("#")) ?? lines[0];
  return first.replace(/^#+\s*/, "");
}

function extractFrontmatter(content: string): {
  name?: string;
  description?: string;
  terminal?: boolean;
  command?: string;
  install?: string;
  keywords?: string[];
  preferToolResult?: boolean;
} {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end === -1) return {};
  const fmLines = lines.slice(1, end);
  let name: string | undefined;
  let description: string | undefined;
  let terminal: boolean | undefined;
  let command: string | undefined;
  let install: string | undefined;
  let keywords: string[] | undefined;
  let preferToolResult: boolean | undefined;

  for (const line of fmLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("name:")) {
      name = trimmed.slice("name:".length).trim();
    } else if (trimmed.startsWith("description:")) {
      description = trimmed.slice("description:".length).trim();
    } else if (trimmed.startsWith("terminal:")) {
      terminal = trimmed.slice("terminal:".length).trim() === "true";
    } else if (trimmed.startsWith("command:")) {
      command = trimmed.slice("command:".length).trim();
    } else if (trimmed.startsWith("install:")) {
      install = trimmed.slice("install:".length).trim();
    } else if (trimmed.startsWith("prefer_tool_result:") || trimmed.startsWith("preferToolResult:")) {
      const raw = trimmed
        .replace(/^prefer_tool_result:/i, "")
        .replace(/^preferToolResult:/i, "")
        .trim();
      const parsed = parseFrontmatterBoolean(raw);
      if (parsed !== undefined) {
        preferToolResult = parsed;
      }
    } else if (trimmed.startsWith("keywords:") || trimmed.startsWith("aliases:")) {
      const raw = trimmed.replace(/^(keywords|aliases):/i, "").trim();
      const list = parseFrontmatterList(raw);
      if (list.length > 0) {
        keywords = keywords ? Array.from(new Set([...keywords, ...list])) : list;
      }
    }
  }

  return { name, description, terminal, command, install, keywords, preferToolResult };
}

function parseFrontmatterList(raw: string): string[] {
  if (!raw) return [];
  const text = raw.trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1);
    return inner
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return text
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseFrontmatterBoolean(raw: string): boolean | undefined {
  const text = raw.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!text) return undefined;
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return undefined;
}

function parseDirectCommands(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: string[] = [];
  for (const item of input) {
    const text = String(item ?? "").trim().toLowerCase();
    if (!text || !text.startsWith("/")) {
      continue;
    }
    const command = text.split(/\s+/, 1)[0];
    if (!out.includes(command)) {
      out.push(command);
    }
  }
  return out;
}

function parseMaybeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(text)) return true;
    if (["false", "0", "no", "off"].includes(text)) return false;
  }
  return undefined;
}

function parseMaybeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function extractNpmInstallPackage(command: string): string | undefined {
  const tokens = command.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  const installIndex = tokens.indexOf("install");
  if (installIndex < 0) return undefined;

  for (let i = installIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.startsWith("-")) continue;
    const normalized = normalizeNpmPackageSpecifier(token);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeNpmPackageSpecifier(specifier: string): string | undefined {
  const raw = specifier.replace(/^["']|["']$/g, "");
  if (!raw) return undefined;
  if (/^(file:|git\+|https?:)/i.test(raw)) return undefined;

  let name = raw;
  if (raw.startsWith("@")) {
    const secondAt = raw.indexOf("@", 1);
    name = secondAt === -1 ? raw : raw.slice(0, secondAt);
  } else {
    const versionIndex = raw.indexOf("@");
    name = versionIndex === -1 ? raw : raw.slice(0, versionIndex);
  }
  return /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ? name : undefined;
}
