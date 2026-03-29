export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function normalizeLimit(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.floor(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

export function normalizeOptionalIntegerString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  const raw = typeof value === "number"
    ? String(Math.floor(value))
    : typeof value === "string"
      ? value.trim()
      : "";

  if (!raw) {
    return "";
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return String(Math.floor(parsed));
}

export function writeOptionalEnvValue(
  envPath: string,
  envKey: string,
  value: string | null,
  originalInput: unknown,
  setEnvValue: (envPath: string, key: string, value: string) => void,
  unsetEnvValue: (envPath: string, key: string) => void
): void {
  if (value === null) {
    return;
  }
  if (value) {
    setEnvValue(envPath, envKey, value);
    return;
  }
  if (originalInput !== undefined) {
    unsetEnvValue(envPath, envKey);
  }
}

export function normalizeOptionalNumberString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return String(parsed);
}

export function normalizeOptionalString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export function normalizeOptionalJsonObjectString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}
