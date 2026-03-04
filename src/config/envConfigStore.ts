import path from "path";
import dotenv from "dotenv";
import { DATA_STORE, getStore, registerStore, setStore } from "../storage/persistence";

export class EnvConfigStore {
  private readonly envPath: string;
  private readonly storeName = DATA_STORE.ENV_CONFIG;

  constructor(envPath?: string) {
    this.envPath = path.resolve(process.cwd(), envPath ?? process.env.ENV_FILE ?? ".env");
    registerStore(this.storeName, {
      init: () => "",
      codec: "text",
      filePath: this.envPath
    });
  }

  getPath(): string {
    return this.envPath;
  }

  getModel(): string {
    const values = this.getAll();
    return values.OLLAMA_MODEL ?? process.env.OLLAMA_MODEL ?? "";
  }

  setModel(model: string): void {
    const value = model.trim();
    if (!value) {
      throw new Error("OLLAMA_MODEL cannot be empty");
    }
    this.setValue("OLLAMA_MODEL", value);
  }

  getAll(): Record<string, string> {
    const content = getStore<string>(this.storeName);
    return dotenv.parse(content);
  }

  getValue(key: string): string {
    const values = this.getAll();
    return values[key] ?? process.env[key] ?? "";
  }

  setValue(key: string, value: string): void {
    const raw = getStore<string>(this.storeName);
    const lines = raw.split(/\r?\n/);

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

    setStore(this.storeName, `${lines.join("\n").replace(/\n+$/, "\n")}`);
    process.env[key] = value;
  }

  unsetValue(key: string): void {
    const raw = getStore<string>(this.storeName);
    const lines = raw.split(/\r?\n/);
    const nextLines = lines.filter((line) => {
      if (!line || /^\s*#/.test(line)) {
        return true;
      }
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return match?.[1] !== key;
    });
    setStore(this.storeName, `${nextLines.join("\n").replace(/\n+$/, "\n")}`);
    delete process.env[key];
  }
}

function formatEnvValue(value: string): string {
  if (/[\s#"'`]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
