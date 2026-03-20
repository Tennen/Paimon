import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildHtml } from "../markdown/buildHtml";
import { DEVICE_SCALE_FACTOR, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "../styles/mobileCss";

type ModuleRequireCandidate = {
  requireFn: NodeRequire;
};

type BrowserLike = {
  newPage: (options: {
    viewport: {
      width: number;
      height: number;
    };
    deviceScaleFactor: number;
  }) => Promise<PageLike>;
  close: () => Promise<void>;
};

type PageLike = {
  setContent: (html: string, options: { waitUntil: "load" }) => Promise<void>;
  evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
  waitForTimeout: (ms: number) => Promise<void>;
  locator: (selector: string) => LocatorLike | LocatorListLike;
};

type LocatorLike = {
  screenshot: (options: { type: "png" }) => Promise<Buffer | Uint8Array>;
};

type LocatorListLike = {
  count: () => Promise<number>;
  nth: (index: number) => LocatorLike;
};

type ChromiumModule = {
  chromium?: {
    launch: (options: { headless: boolean }) => Promise<BrowserLike>;
  };
  default?: {
    chromium?: {
      launch: (options: { headless: boolean }) => Promise<BrowserLike>;
    };
  };
};

const PACKAGE_ROOT = resolvePackageRoot(__dirname);
const dynamicImport = new Function("specifier", "return import(specifier);") as (
  specifier: string
) => Promise<unknown>;

export async function renderLongImage(markdown: string): Promise<{ images: Buffer[] }> {
  const document = await buildHtml(markdown);
  const { browser, page } = await openRenderPage();

  try {
    await page.setContent(document.html, { waitUntil: "load" });
    await waitForStableLayout(page);

    const locator = page.locator(".mobile-canvas") as LocatorLike;
    const image = toBuffer(await locator.screenshot({ type: "png" }));
    return { images: [image] };
  } finally {
    await browser.close();
  }
}

export async function openRenderPage(): Promise<{ browser: BrowserLike; page: PageLike }> {
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT
    },
    deviceScaleFactor: DEVICE_SCALE_FACTOR
  });
  return { browser, page };
}

export async function waitForStableLayout(page: PageLike): Promise<void> {
  await page.evaluate(async () => {
    const images = Array.from(document.images);
    await Promise.all(
      images.map((img) => {
        if (img.complete) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      })
    );

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });

  await page.waitForTimeout(100);
}

export function toBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

async function loadChromium(): Promise<{ launch: (options: { headless: boolean }) => Promise<BrowserLike> }> {
  const mod = await loadModuleDynamically<ChromiumModule>("playwright");
  const chromium = mod.chromium || mod.default?.chromium;
  if (!chromium) {
    throw new Error("invalid playwright export");
  }
  return chromium;
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
