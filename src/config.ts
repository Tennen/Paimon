import fs from "fs";
import path from "path";

export type Config = {
  haEntityAllowlist?: string[];
  haEntityAllowlistPrefixes?: string[];
};

const DEFAULT_CONFIG: Config = {
  haEntityAllowlist: [],
  haEntityAllowlistPrefixes: []
};

export function loadConfig(): Config {
  const configPath = path.resolve(process.cwd(), "config.json");
  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Config;
    return {
      haEntityAllowlist: parsed.haEntityAllowlist ?? [],
      haEntityAllowlistPrefixes: parsed.haEntityAllowlistPrefixes ?? []
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
