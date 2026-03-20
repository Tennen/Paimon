import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { remarkBlockPlugin } from "./plugins/remarkBlockPlugin";
import { rehypeBlockAttrPlugin } from "./plugins/rehypeBlockAttrPlugin";
import { getMobileCss } from "../styles/mobileCss";

type ProcessorLike = {
  use: (plugin: unknown, options?: unknown) => ProcessorLike;
  process: (value: string) => Promise<{ toString: () => string } | string>;
};

type UnifiedModule = {
  unified?: () => ProcessorLike;
  default?: {
    unified?: () => ProcessorLike;
  };
};

type PluginModule = {
  default?: unknown;
};

type ModuleRequireCandidate = {
  requireFn: NodeRequire;
};

export type BuiltHtmlDocument = {
  html: string;
  blockHtmlById: Map<string, string>;
  orderedBlockIds: string[];
};

const PACKAGE_ROOT = resolvePackageRoot(__dirname);
const dynamicImport = new Function("specifier", "return import(specifier);") as (
  specifier: string
) => Promise<unknown>;

export async function buildHtml(markdown: string): Promise<BuiltHtmlDocument> {
  const source = String(markdown || "").trim();
  if (!source) {
    throw new Error("markdown is empty");
  }

  const runtime = await loadMarkdownRuntime();
  const processor = runtime.unified()
    .use(runtime.remarkParse)
    .use(runtime.remarkGfm)
    .use(remarkBlockPlugin)
    .use(runtime.remarkRehype)
    .use(rehypeBlockAttrPlugin)
    .use(runtime.rehypeStringify);
  const rendered = await processor.process(source);
  const blockHtml = String(rendered);
  const blockHtmlById = extractBlockHtmlById(blockHtml);

  if (blockHtmlById.size === 0) {
    throw new Error("md2img produced no block sections");
  }

  return {
    html: buildHtmlDocument(`
<main class="render-root">
  <article class="mobile-canvas">
    ${blockHtml}
  </article>
</main>
`.trim()),
    blockHtmlById,
    orderedBlockIds: [...blockHtmlById.keys()]
  };
}

export function buildHtmlDocument(bodyHtml: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "  <style>",
    getMobileCss(),
    "  </style>",
    "</head>",
    "<body>",
    bodyHtml,
    "</body>",
    "</html>"
  ].join("\n");
}

function extractBlockHtmlById(blockHtml: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matcher = /<section\b[^>]*data-block-id="([^"]+)"[^>]*>[\s\S]*?<\/section>/g;
  let match: RegExpExecArray | null = matcher.exec(blockHtml);

  while (match) {
    const id = match[1];
    const html = match[0];
    sections.set(id, html);
    match = matcher.exec(blockHtml);
  }

  return sections;
}

async function loadMarkdownRuntime(): Promise<{
  unified: () => ProcessorLike;
  remarkParse: unknown;
  remarkGfm: unknown;
  remarkRehype: unknown;
  rehypeStringify: unknown;
}> {
  const unifiedModule = await loadModuleDynamically<UnifiedModule>("unified");
  const unified = unifiedModule.unified || unifiedModule.default?.unified;
  if (!unified) {
    throw new Error("invalid unified export");
  }

  return {
    unified,
    remarkParse: await loadDefaultPlugin("remark-parse"),
    remarkGfm: await loadDefaultPlugin("remark-gfm"),
    remarkRehype: await loadDefaultPlugin("remark-rehype"),
    rehypeStringify: await loadDefaultPlugin("rehype-stringify")
  };
}

async function loadDefaultPlugin(moduleName: string): Promise<unknown> {
  const mod = await loadModuleDynamically<PluginModule | unknown>(moduleName);
  if (mod && typeof mod === "object" && "default" in mod) {
    const defaultExport = (mod as PluginModule).default;
    if (defaultExport !== undefined) {
      return defaultExport;
    }
  }
  return mod;
}

async function loadModuleDynamically<T>(moduleName: string): Promise<T> {
  const installCwd = resolveInstallCwd();
  try {
    return await loadModuleFromCandidates<T>(moduleName);
  } catch (error) {
    const resolvePath = resolvePathFromError(error);
    if (isMissingTopLevelModuleError(error, moduleName)) {
      throw buildModuleLoadError(
        `Missing dependency ${moduleName}. Run npm install to install project dependencies`,
        moduleName,
        installCwd,
        resolvePath,
        error
      );
    }

    throw buildModuleLoadError(
      `Failed to load dependency ${moduleName}`,
      moduleName,
      installCwd,
      resolvePath,
      error
    );
  }
}

async function loadModuleFromCandidates<T>(moduleName: string): Promise<T> {
  const candidates = buildRequireCandidates();
  let lastMissingError: unknown = null;
  let lastResolvePath: string | null = null;

  for (const candidate of candidates) {
    const resolvePath = resolveWithRequire(candidate.requireFn, moduleName);
    if (resolvePath) {
      lastResolvePath = resolvePath;
    }

    try {
      return candidate.requireFn(moduleName) as T;
    } catch (error) {
      if (isRequireEsmError(error)) {
        try {
          return (await importModule(moduleName, resolvePath)) as T;
        } catch (importError) {
          throw attachModuleErrorContext(importError, moduleName, resolvePath);
        }
      }

      if (isMissingTopLevelModuleError(error, moduleName)) {
        lastMissingError = attachModuleErrorContext(error, moduleName, resolvePath);
        continue;
      }

      throw attachModuleErrorContext(error, moduleName, resolvePath);
    }
  }

  if (lastMissingError) {
    throw attachModuleErrorContext(lastMissingError, moduleName, lastResolvePath);
  }

  throw attachModuleErrorContext(new Error(`Unable to load dependency ${moduleName}`), moduleName, lastResolvePath);
}

function buildRequireCandidates(): ModuleRequireCandidate[] {
  const candidates: ModuleRequireCandidate[] = [];
  const seen = new Set<string>();
  const cwdPackageRoot = resolvePackageRoot(process.cwd());
  const dirs = [PACKAGE_ROOT, cwdPackageRoot, process.cwd()];

  for (const dir of dirs) {
    if (!dir || seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    try {
      candidates.push({
        requireFn: createRequire(path.join(dir, "package.json"))
      });
    } catch {
      // Ignore invalid candidate roots.
    }
  }

  if (!seen.has(__dirname)) {
    candidates.push({ requireFn: require });
  }

  return candidates;
}

function resolveInstallCwd(): string {
  return PACKAGE_ROOT || process.cwd();
}

function resolveWithRequire(requireFn: NodeRequire, moduleName: string): string | null {
  try {
    return requireFn.resolve(moduleName);
  } catch {
    return null;
  }
}

function attachModuleErrorContext(error: unknown, moduleName: string, resolvePath: string | null): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const detail = normalized as Error & { moduleName?: string; resolvePath?: string | null };
  detail.moduleName = moduleName;
  detail.resolvePath = resolvePath;
  return normalized;
}

function resolvePathFromError(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const resolvePath = (error as { resolvePath?: unknown }).resolvePath;
  return typeof resolvePath === "string" ? resolvePath : null;
}

function buildModuleLoadError(
  message: string,
  moduleName: string,
  installCwd: string,
  resolvePath: string | null,
  cause?: unknown
): Error {
  const suffix = `moduleName=${moduleName} installCwd=${installCwd} resolvePath=${resolvePath || "unresolved"}`;
  const causeMessage = formatCauseMessage(cause);
  return new Error(causeMessage ? `${message} (${suffix}) cause=${causeMessage}` : `${message} (${suffix})`);
}

function formatCauseMessage(error: unknown): string {
  if (!error) {
    return "";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRequireEsmError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as NodeJS.ErrnoException).code === "ERR_REQUIRE_ESM";
}

async function importModule(moduleName: string, resolvePath: string | null): Promise<unknown> {
  if (resolvePath) {
    try {
      return await dynamicImport(pathToFileURL(resolvePath).href);
    } catch {
      // Fall through to bare specifier import.
    }
  }

  return dynamicImport(moduleName);
}

function isMissingTopLevelModuleError(error: unknown, moduleName: string): boolean {
  if (!isMissingDependencyError(error)) {
    return false;
  }

  const targetTopLevel = toTopLevelPackageName(moduleName);
  if (!targetTopLevel) {
    return false;
  }

  const missingSpecifier = extractMissingSpecifierFromError(error);
  if (!missingSpecifier) {
    return false;
  }

  const missingTopLevel = toTopLevelPackageName(missingSpecifier);
  return Boolean(missingTopLevel && missingTopLevel === targetTopLevel);
}

function isMissingDependencyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as NodeJS.ErrnoException;
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
    return true;
  }
  return /Cannot find (?:package|module)\s+/i.test(String(maybeError.message || ""));
}

function extractMissingSpecifierFromError(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const message = String((error as NodeJS.ErrnoException).message || "");
  const quotedMatch = message.match(/Cannot find (?:package|module)\s+['"`]([^'"`]+)['"`]/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const bareMatch = message.match(/Cannot find (?:package|module)\s+([^\s]+)/i);
  return bareMatch?.[1] ? bareMatch[1].replace(/[.,;:)\]}]+$/, "").trim() : null;
}

function toTopLevelPackageName(specifier: string): string | null {
  const normalized = String(specifier || "").trim();
  if (!normalized || isPathLikeSpecifier(normalized)) {
    return null;
  }

  if (normalized.startsWith("@")) {
    const parts = normalized.split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return null;
    }
    return `${parts[0]}/${parts[1]}`;
  }

  const [topLevel] = normalized.split("/");
  return topLevel || null;
}

function isPathLikeSpecifier(specifier: string): boolean {
  if (
    specifier.startsWith(".")
    || specifier.startsWith("/")
    || specifier.startsWith("\\")
    || specifier.startsWith("node:")
    || specifier.startsWith("file:")
  ) {
    return true;
  }

  if (/^[a-zA-Z]:[\\/]/.test(specifier)) {
    return true;
  }

  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);
}

function resolvePackageRoot(startDir: string): string | null {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
