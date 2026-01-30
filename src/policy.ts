import { Action } from "./types";

export async function policyCheck(action: Action): Promise<{ allowed: boolean; reason?: string }> {
  return { allowed: true };
}
