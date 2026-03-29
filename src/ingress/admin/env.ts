import dotenv from "dotenv";
import { DATA_STORE, getStore, registerStore, setStore } from "../../storage/persistence";

export function readEnvValues(envPath: string): Record<string, string> {
  const content = readEnvText(envPath);
  return dotenv.parse(content);
}

export function getEnvValue(envPath: string, key: string): string {
  const values = readEnvValues(envPath);
  return values[key] ?? process.env[key] ?? "";
}

export function setEnvValue(envPath: string, key: string, value: string): void {
  const text = value.trim();
  if (!text) {
    throw new Error(`${key} cannot be empty`);
  }

  const lines = readEnvText(envPath).split(/\r?\n/);
  const escapedValue = formatEnvValue(text);
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

  writeEnvText(envPath, `${lines.join("\n").replace(/\n+$/, "\n")}`);
  process.env[key] = text;
}

export function unsetEnvValue(envPath: string, key: string): void {
  const lines = readEnvText(envPath).split(/\r?\n/);
  const nextLines = lines.filter((line) => {
    if (!line || /^\s*#/.test(line)) {
      return true;
    }
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return match?.[1] !== key;
  });
  writeEnvText(envPath, `${nextLines.join("\n").replace(/\n+$/, "\n")}`);
  delete process.env[key];
}

function readEnvText(envPath: string): string {
  registerStore(DATA_STORE.ENV_CONFIG, {
    init: () => "",
    codec: "text",
    filePath: envPath
  });
  return getStore<string>(DATA_STORE.ENV_CONFIG);
}

function writeEnvText(envPath: string, content: string): void {
  registerStore(DATA_STORE.ENV_CONFIG, {
    init: () => "",
    codec: "text",
    filePath: envPath
  });
  setStore(DATA_STORE.ENV_CONFIG, content);
}

function formatEnvValue(value: string): string {
  if (/[\s#"'`]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
