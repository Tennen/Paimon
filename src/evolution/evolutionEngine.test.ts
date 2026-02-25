import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeterministicCommitMessage,
  resolvePushTargetFromInputs,
  selectCommitMessage
} from "./evolutionEngine";

test("commit message uses user input with highest priority", () => {
  const result = selectCommitMessage({
    commitMessageProvidedByUser: true,
    userCommitMessage: "  keep user text exactly  ",
    generatedCommitMessage: "feat: generated",
    fallbackCommitMessage: "chore: fallback"
  });
  assert.equal(result.source, "user");
  assert.equal(result.message, "  keep user text exactly  ");
});

test("commit message uses generated when user input not provided", () => {
  const result = selectCommitMessage({
    commitMessageProvidedByUser: false,
    userCommitMessage: "",
    generatedCommitMessage: "fix: handle edge case",
    fallbackCommitMessage: "chore: fallback"
  });
  assert.equal(result.source, "generated");
  assert.equal(result.message, "fix: handle edge case");
});

test("commit message falls back deterministically when generated is empty", () => {
  const fallbackA = buildDeterministicCommitMessage(
    "improve evolution checks",
    ["src/evolution/evolutionEngine.ts", "package.json"],
    "diff-content"
  );
  const fallbackB = buildDeterministicCommitMessage(
    "improve evolution checks",
    ["src/evolution/evolutionEngine.ts", "package.json"],
    "diff-content"
  );
  const selected = selectCommitMessage({
    commitMessageProvidedByUser: false,
    userCommitMessage: "",
    generatedCommitMessage: "",
    fallbackCommitMessage: fallbackA
  });
  assert.equal(selected.source, "fallback");
  assert.equal(selected.message, fallbackA);
  assert.equal(fallbackA, fallbackB);
  assert.match(fallbackA, /^chore\(evolution\): .+\[[0-9a-f]{8}\]$/);
});

test("push target resolution prefers env remote and branch over upstream", () => {
  const resolved = resolvePushTargetFromInputs({
    envRemote: "origin",
    envBranch: "feature/auto",
    upstreamRef: "upstream/main"
  });
  assert.deepEqual(resolved, { ok: true, remote: "origin", branch: "feature/auto" });
});

test("push target resolution combines partial env with upstream", () => {
  const resolved = resolvePushTargetFromInputs({
    envRemote: "origin",
    upstreamRef: "upstream/main"
  });
  assert.deepEqual(resolved, { ok: true, remote: "origin", branch: "main" });
});

test("push target resolution fails when neither env nor upstream is usable", () => {
  const resolved = resolvePushTargetFromInputs({
    envRemote: "",
    envBranch: "",
    upstreamRef: "invalid-upstream"
  });
  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail("expected failed resolution");
  }
  assert.match(resolved.error, /missing push remote and branch/);
});
