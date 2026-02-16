import fs from "fs";
import path from "path";
import dotenv from "dotenv";

export class EnvConfigStore {
  private readonly envPath: string;

  constructor(envPath?: string) {
    this.envPath = path.resolve(process.cwd(), envPath ?? process.env.ENV_FILE ?? ".env");
  }

  getPath(): string {
    return this.envPath;
  }

  getModel(): string {
    const values = this.readAll();
    return values.OLLAMA_MODEL ?? process.env.OLLAMA_MODEL ?? "";
  }

  setModel(model: string): void {
    const value = model.trim();
    if (!value) {
      throw new Error("OLLAMA_MODEL cannot be empty");
    }
    this.setValue("OLLAMA_MODEL", value);
  }

  private readAll(): Record<string, string> {
    if (!fs.existsSync(this.envPath)) {
      return {};
    }
    const content = fs.readFileSync(this.envPath, "utf-8");
    return dotenv.parse(content);
  }

  private setValue(key: string, value: string): void {
    const dir = path.dirname(this.envPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const lines = fs.existsSync(this.envPath)
      ? fs.readFileSync(this.envPath, "utf-8").split(/\r?\n/)
      : [];

    const escapedValue = formatEnvValue(value);
    const targetPrefix = `${key}=`;
    let replaced = false;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || /^\s*#/.test(line)) {
        continue;
      }
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match?.[1] === key) {
        lines[i] = `${targetPrefix}${escapedValue}`;
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`${targetPrefix}${escapedValue}`);
    }

    fs.writeFileSync(this.envPath, `${lines.join("\n").replace(/\n+$/, "\n")}`, "utf-8");
    process.env[key] = value;
  }
}

function formatEnvValue(value: string): string {
  if (/[\s#"'`]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
