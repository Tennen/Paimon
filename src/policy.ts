import { ToolExecution } from "./types";

export async function policyCheck(input: { type: string; params: ToolExecution }): Promise<{ allowed: boolean; reason?: string }> {
  return { allowed: true };
}
