import fs from "fs";
import path from "path";

export type SkillInfo = {
  name: string;
  description: string;
  terminal?: boolean;
  command?: string;
  detail?: string;
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
        const frontmatter = extractFrontmatter(content);
        const name = frontmatter.name ?? dirName;
        const description = frontmatter.description ?? extractDescription(content);
        const info: SkillInfo = {
          name,
          description,
          terminal: frontmatter.terminal,
          command: frontmatter.command,
          detail: content
        };
        if (!this.skillMap.has(name)) {
          this.skills.push(info);
          this.skillMap.set(name, info);
        }

        const handlerPath = path.join(skillDir, "handler.js");
        if (fs.existsSync(handlerPath) && !this.handlers.has(name)) {
          try {
            const mod = require(handlerPath) as { execute?: SkillHandler };
            if (mod.execute) {
              this.handlers.set(name, mod.execute);
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

  async invoke(name: string, input: string, context: Record<string, unknown>): Promise<SkillInvokeResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error("no handler");
    }
    const result = await handler(input, context);
    return result ?? { text: "" };
  }
}

function extractDescription(content: string): string {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  const first = lines.find((l) => !l.startsWith("#")) ?? lines[0];
  return first.replace(/^#+\s*/, "");
}

function extractFrontmatter(content: string): { name?: string; description?: string; terminal?: boolean; command?: string } {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end === -1) return {};
  const fmLines = lines.slice(1, end);
  let name: string | undefined;
  let description: string | undefined;
  let terminal: boolean | undefined;
  let command: string | undefined;
  const metadataBlock = fmLines.join("\n");
  for (const line of fmLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("name:")) {
      name = trimmed.slice("name:".length).trim();
    } else if (trimmed.startsWith("description:")) {
      description = trimmed.slice("description:".length).trim();
    } else if (trimmed.startsWith("terminal:")) {
      terminal = trimmed.slice("terminal:".length).trim() === "true";
    }
  }
  if (!command) {
    command = extractFirstBin(metadataBlock);
  }
  return { name, description, terminal, command };
}

function extractFirstBin(metadata: string): string | undefined {
  const match = metadata.match(/\"bins\"\\s*:\\s*\\[(.*?)\\]/s);
  if (!match) return undefined;
  const inner = match[1];
  const binMatch = inner.match(/\"([^\"]+)\"/);
  return binMatch ? binMatch[1] : undefined;
}
