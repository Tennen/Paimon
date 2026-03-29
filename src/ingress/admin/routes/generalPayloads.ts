export function parseWeComMenuConfigPayload(
  rawBody: unknown,
  options: { allowEmpty?: boolean } = {}
): unknown | null | undefined {
  if (rawBody === undefined || rawBody === null) {
    return options.allowEmpty ? undefined : null;
  }

  if (typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  if (options.allowEmpty && Object.keys(body).length === 0) {
    return undefined;
  }

  return "config" in body ? body.config : rawBody;
}

export function parseDirectInputMappingConfigPayload(rawBody: unknown): unknown | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  return "config" in body ? body.config : rawBody;
}

export function parseEvolutionGoalInput(rawBody: unknown): { goal: string; commitMessage?: string } | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) {
    return null;
  }
  const commitMessage = typeof body.commitMessage === "string" ? body.commitMessage.trim() : "";
  return commitMessage ? { goal, commitMessage } : { goal };
}
