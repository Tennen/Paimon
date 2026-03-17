import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { Image } from "../../types";

type RenderMarkdownImageInput = {
  markdown: string;
  title?: string;
  width?: number;
  filenamePrefix?: string;
};

type MarkdownAstNode = {
  type?: unknown;
  depth?: unknown;
  value?: unknown;
  children?: unknown;
};

type RenderBlockKind = "h1" | "h2" | "h3" | "p" | "li" | "quote" | "code" | "hr";

type RenderBlock = {
  kind: RenderBlockKind;
  text: string;
};

type SatoriFont = {
  name: string;
  data: Buffer;
  weight?: number;
  style?: "normal" | "italic";
};

type SatoriLike = (
  element: unknown,
  options: {
    width: number;
    height: number;
    fonts: SatoriFont[];
  }
) => Promise<string>;

type ResvgCtor = new (
  svg: string,
  options?: {
    fitTo?: {
      mode: "width";
      value: number;
    };
  }
) => {
  render: () => {
    asPng: () => Buffer | Uint8Array;
  };
};

const DEFAULT_WIDTH = 1080;
const MIN_WIDTH = 720;
const MAX_WIDTH = 1800;
const MIN_HEIGHT = 640;
const MAX_HEIGHT = 16000;
const CARD_HORIZONTAL_PADDING = 40;
const CARD_VERTICAL_PADDING = 44;

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
];
const AUTO_INSTALL_ATTEMPTED = new Set<string>();
const ADAPTER_PACKAGE_ROOT = resolvePackageRoot(__dirname);
const dynamicImport = new Function(
  "specifier",
  "return import(specifier);"
) as (specifier: string) => Promise<unknown>;

export async function renderMarkdownAsLongImage(input: RenderMarkdownImageInput): Promise<Image> {
  const markdown = String(input.markdown || "").trim();
  if (!markdown) {
    throw new Error("markdown is empty");
  }

  const width = clampInt(input.width, MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH);
  const title = String(input.title || "Market Analysis 报告").trim() || "Market Analysis 报告";
  const blocks = await parseMarkdownBlocks(markdown);
  const height = estimateHeight(blocks, width);

  const satori = await loadSatori();
  const Resvg = await loadResvgCtor();
  const fontData = loadFontData();

  const element = buildCardElement(title, blocks, width, height);
  const svg = await satori(element, {
    width,
    height,
    fonts: [
      { name: "Sans", data: fontData, weight: 400, style: "normal" },
      { name: "Sans", data: fontData, weight: 700, style: "normal" }
    ]
  });

  const renderer = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: width
    }
  });
  const png = renderer.render().asPng();
  const pngBuffer = Buffer.isBuffer(png) ? png : Buffer.from(png);

  const fileStem = normalizeFileStem(input.filenamePrefix) || "market-analysis-report";
  return {
    data: pngBuffer.toString("base64"),
    contentType: "image/png",
    filename: `${fileStem}-${Date.now()}.png`
  };
}

async function parseMarkdownBlocks(markdown: string): Promise<RenderBlock[]> {
  const remark = await loadRemark();
  const tree = remark().parse(markdown) as MarkdownAstNode;
  const blocks: RenderBlock[] = [];
  visitNodeAsBlocks(tree, blocks);
  return blocks.length > 0 ? blocks : [{ kind: "p", text: markdown }];
}

function visitNodeAsBlocks(node: MarkdownAstNode, blocks: RenderBlock[]): void {
  const type = String(node.type || "");
  const children = asNodes(node.children);

  if (type === "root") {
    for (const child of children) {
      visitNodeAsBlocks(child, blocks);
    }
    return;
  }

  if (type === "heading") {
    const depth = toHeadingDepth(node.depth);
    const text = collapseWhitespace(collectText(node));
    if (text) {
      blocks.push({ kind: depth === 1 ? "h1" : depth === 2 ? "h2" : "h3", text });
    }
    return;
  }

  if (type === "paragraph") {
    const text = collapseWhitespace(collectText(node));
    if (text) {
      blocks.push({ kind: "p", text });
    }
    return;
  }

  if (type === "list") {
    for (const item of children) {
      const line = collapseWhitespace(collectText(item));
      if (line) {
        blocks.push({ kind: "li", text: line });
      }
    }
    return;
  }

  if (type === "blockquote") {
    const text = collapseWhitespace(collectText(node));
    if (text) {
      blocks.push({ kind: "quote", text });
    }
    return;
  }

  if (type === "code") {
    const codeText = String(node.value || "").trim();
    if (codeText) {
      blocks.push({ kind: "code", text: codeText });
    }
    return;
  }

  if (type === "thematicBreak") {
    blocks.push({ kind: "hr", text: "" });
    return;
  }

  if (children.length > 0) {
    for (const child of children) {
      visitNodeAsBlocks(child, blocks);
    }
    return;
  }

  const fallbackText = collapseWhitespace(collectText(node));
  if (fallbackText) {
    blocks.push({ kind: "p", text: fallbackText });
  }
}

function collectText(node: MarkdownAstNode): string {
  const type = String(node.type || "");
  const value = typeof node.value === "string" ? node.value : "";
  const children = asNodes(node.children);

  if (type === "inlineCode") {
    return `\`${value}\``;
  }
  if (type === "text") {
    return value;
  }
  if (type === "break") {
    return "\n";
  }

  if (children.length === 0) {
    return value;
  }
  return children.map((item) => collectText(item)).join("");
}

function buildCardElement(
  title: string,
  blocks: RenderBlock[],
  width: number,
  height: number
): unknown {
  const contentWidth = width - CARD_HORIZONTAL_PADDING * 2;
  const bodyChildren = blocks.map((block, index) => buildBlockElement(block, index));

  return h(
    "div",
    {
      style: {
        width,
        height,
        background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
        display: "flex",
        padding: 22,
        boxSizing: "border-box"
      }
    },
    h(
      "div",
      {
        style: {
          width: contentWidth + CARD_HORIZONTAL_PADDING * 2 - 44,
          minHeight: height - 44,
          background: "#ffffff",
          border: "1px solid #dbeafe",
          borderRadius: 18,
          boxSizing: "border-box",
          paddingLeft: CARD_HORIZONTAL_PADDING,
          paddingRight: CARD_HORIZONTAL_PADDING,
          paddingTop: CARD_VERTICAL_PADDING,
          paddingBottom: CARD_VERTICAL_PADDING
        }
      },
      h(
        "div",
        {
          style: {
            fontSize: 34,
            lineHeight: 1.28,
            fontWeight: 700,
            color: "#111827",
            marginBottom: 14
          }
        },
        title
      ),
      h(
        "div",
        {
          style: {
            fontSize: 13,
            color: "#475569",
            marginBottom: 20
          }
        },
        `Generated at ${new Date().toISOString()}`
      ),
      ...bodyChildren
    )
  );
}

function buildBlockElement(block: RenderBlock, index: number): unknown {
  if (block.kind === "hr") {
    return h("div", {
      key: `b-${index}`,
      style: {
        marginTop: 12,
        marginBottom: 16,
        borderTop: "1px solid #e5e7eb"
      }
    });
  }

  if (block.kind === "h1") {
    return h(
      "div",
      {
        key: `b-${index}`,
        style: {
          fontSize: 28,
          lineHeight: 1.34,
          fontWeight: 700,
          color: "#0f172a",
          marginTop: 8,
          marginBottom: 10
        }
      },
      block.text
    );
  }

  if (block.kind === "h2") {
    return h(
      "div",
      {
        key: `b-${index}`,
        style: {
          fontSize: 23,
          lineHeight: 1.38,
          fontWeight: 700,
          color: "#1e3a8a",
          marginTop: 14,
          marginBottom: 8
        }
      },
      block.text
    );
  }

  if (block.kind === "h3") {
    return h(
      "div",
      {
        key: `b-${index}`,
        style: {
          fontSize: 19,
          lineHeight: 1.45,
          fontWeight: 700,
          color: "#1d4ed8",
          marginTop: 10,
          marginBottom: 7
        }
      },
      block.text
    );
  }

  if (block.kind === "li") {
    return h(
      "div",
      {
        key: `b-${index}`,
        style: {
          fontSize: 16,
          lineHeight: 1.76,
          color: "#111827",
          marginBottom: 8
        }
      },
      `• ${block.text}`
    );
  }

  if (block.kind === "quote") {
    return h(
      "div",
      {
        key: `b-${index}`,
        style: {
          fontSize: 16,
          lineHeight: 1.76,
          color: "#1f2937",
          marginTop: 6,
          marginBottom: 10,
          borderLeft: "4px solid #bfdbfe",
          paddingLeft: 10
        }
      },
      block.text
    );
  }

  if (block.kind === "code") {
    return h(
      "div",
      {
        key: `b-${index}`,
        style: {
          fontSize: 14,
          lineHeight: 1.7,
          color: "#0f172a",
          background: "#f8fafc",
          border: "1px solid #d1d5db",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 12,
          whiteSpace: "pre-wrap"
        }
      },
      block.text
    );
  }

  return h(
    "div",
    {
      key: `b-${index}`,
      style: {
        fontSize: 16,
        lineHeight: 1.76,
        color: "#111827",
        marginBottom: 10
      }
    },
    block.text
  );
}

function h(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown {
  const normalizedChildren = children
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .filter((item) => item !== undefined && item !== null);

  return {
    type,
    props: {
      ...props,
      ...(normalizedChildren.length === 0
        ? {}
        : normalizedChildren.length === 1
          ? { children: normalizedChildren[0] }
          : { children: normalizedChildren })
    }
  };
}

function estimateHeight(blocks: RenderBlock[], width: number): number {
  const contentWidth = width - CARD_HORIZONTAL_PADDING * 2;
  let total = CARD_VERTICAL_PADDING * 2 + 100;

  for (const block of blocks) {
    if (block.kind === "hr") {
      total += 24;
      continue;
    }

    const metric = getBlockMetric(block.kind);
    const charsPerLine = Math.max(8, Math.floor(contentWidth / (metric.fontSize * 0.56)));
    const normalizedLength = normalizeRenderLength(block.text);
    const lines = Math.max(1, Math.ceil(normalizedLength / charsPerLine));
    total += Math.ceil(lines * metric.lineHeight + metric.marginBottom);
  }

  return clampInt(total + 44, MIN_HEIGHT, MAX_HEIGHT, 1400);
}

function getBlockMetric(kind: RenderBlockKind): { fontSize: number; lineHeight: number; marginBottom: number } {
  if (kind === "h1") {
    return { fontSize: 28, lineHeight: 38, marginBottom: 12 };
  }
  if (kind === "h2") {
    return { fontSize: 23, lineHeight: 33, marginBottom: 10 };
  }
  if (kind === "h3") {
    return { fontSize: 19, lineHeight: 29, marginBottom: 9 };
  }
  if (kind === "code") {
    return { fontSize: 14, lineHeight: 24, marginBottom: 14 };
  }
  return { fontSize: 16, lineHeight: 28, marginBottom: 10 };
}

function normalizeRenderLength(text: string): number {
  const normalized = String(text || "");
  let total = 0;
  for (const ch of normalized) {
    total += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
  }
  return Math.max(1, total);
}

function toHeadingDepth(raw: unknown): 1 | 2 | 3 {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 1) {
    return 1;
  }
  if (value >= 3) {
    return 3;
  }
  return 2;
}

function collapseWhitespace(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function asNodes(input: unknown): MarkdownAstNode[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((item) => Boolean(item && typeof item === "object")) as MarkdownAstNode[];
}

function clampInt(raw: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const value = Math.floor(raw);
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeFileStem(raw: string | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

type ModuleRequireCandidate = {
  requireFn: NodeRequire;
};

async function loadModuleWithAutoInstall<T>(moduleName: string): Promise<T> {
  const installCwd = resolveInstallCwd();
  try {
    return await loadModuleFromCandidates<T>(moduleName);
  } catch (error) {
    const resolvePath = resolvePathFromError(error);
    if (!isMissingTopLevelModuleError(error, moduleName)) {
      throw buildModuleLoadError(
        `Failed to load dependency ${moduleName}`,
        moduleName,
        installCwd,
        resolvePath,
        error
      );
    }

    installDependencyOnce(moduleName, installCwd);

    try {
      return await loadModuleFromCandidates<T>(moduleName);
    } catch (retryError) {
      throw buildModuleLoadError(
        `Missing dependency ${moduleName}. Auto-install attempted but module is still unavailable. Run: npm install ${moduleName} --no-save`,
        moduleName,
        installCwd,
        resolvePathFromError(retryError),
        retryError
      );
    }
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
  const dirs = [ADAPTER_PACKAGE_ROOT, cwdPackageRoot, process.cwd()];

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
      // ignore invalid base dir and continue with next candidate
    }
  }

  if (!seen.has(__dirname)) {
    candidates.push({ requireFn: require });
  }

  return candidates;
}

function resolveInstallCwd(): string {
  return ADAPTER_PACKAGE_ROOT || process.cwd();
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
  if (typeof resolvePath === "string") {
    return resolvePath;
  }
  return null;
}

function buildModuleLoadError(
  message: string,
  moduleName: string,
  installCwd: string,
  resolvePath: string | null,
  cause?: unknown
): Error {
  const suffix = formatModuleContext(moduleName, installCwd, resolvePath);
  const causeMessage = formatCauseMessage(cause);
  return new Error(causeMessage ? `${message} (${suffix}) cause=${causeMessage}` : `${message} (${suffix})`);
}

function formatModuleContext(moduleName: string, installCwd: string, resolvePath: string | null): string {
  return `moduleName=${moduleName} installCwd=${installCwd} resolvePath=${resolvePath || "unresolved"}`;
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
  const maybeError = error as NodeJS.ErrnoException;
  return maybeError.code === "ERR_REQUIRE_ESM";
}

async function importModule(moduleName: string, resolvePath: string | null): Promise<unknown> {
  if (resolvePath) {
    try {
      return await dynamicImport(pathToFileURL(resolvePath).href);
    } catch {
      // fallback to bare specifier import below
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
  const message = String(maybeError.message || "");
  return /Cannot find (?:package|module)\s+/i.test(message);
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
  if (!bareMatch?.[1]) {
    return null;
  }
  return bareMatch[1].replace(/[.,;:)\]}]+$/, "").trim();
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
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("\\") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("file:")
  ) {
    return true;
  }
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) {
    return true;
  }
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);
}

function installDependencyOnce(moduleName: string, installCwd: string): void {
  const installKey = `${moduleName}@${installCwd}`;
  if (AUTO_INSTALL_ATTEMPTED.has(installKey)) {
    return;
  }
  AUTO_INSTALL_ATTEMPTED.add(installKey);

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["install", moduleName, "--no-save"], {
    cwd: installCwd,
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    throw buildModuleLoadError(
      `Missing dependency ${moduleName}. Auto-install failed. Run: npm install ${moduleName} --no-save`,
      moduleName,
      installCwd,
      null,
      result.error
    );
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw buildModuleLoadError(
      `Missing dependency ${moduleName}. Auto-install failed with exit code ${result.status}. Run: npm install ${moduleName} --no-save`,
      moduleName,
      installCwd,
      null
    );
  }
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

async function loadSatori(): Promise<SatoriLike> {
  const mod = await loadModuleWithAutoInstall<{ default?: SatoriLike } | SatoriLike>("satori");
  const fn = (typeof mod === "function" ? mod : mod.default) as SatoriLike | undefined;
  if (!fn) {
    throw new Error("invalid satori export");
  }
  return fn;
}

async function loadResvgCtor(): Promise<ResvgCtor> {
  const mod = await loadModuleWithAutoInstall<{
    Resvg?: ResvgCtor;
    default?: {
      Resvg?: ResvgCtor;
    };
  }>("@resvg/resvg-js");
  const ctor = mod.Resvg || mod.default?.Resvg;
  if (!ctor) {
    throw new Error("invalid @resvg/resvg-js export");
  }
  return ctor;
}

async function loadRemark(): Promise<() => { parse: (markdown: string) => unknown }> {
  const mod = await loadModuleWithAutoInstall<{
    remark?: () => { parse: (markdown: string) => unknown };
    default?: {
      remark?: () => { parse: (markdown: string) => unknown };
    };
  }>("remark");
  const remarkFn = mod.remark || mod.default?.remark;
  if (!remarkFn) {
    throw new Error("invalid remark export");
  }
  return remarkFn;
}

function loadFontData(): Buffer {
  for (const candidate of FONT_CANDIDATES) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const data = fs.readFileSync(candidate);
      if (data.length > 0) {
        return data;
      }
    } catch {
      // ignore and continue to next candidate
    }
  }

  throw new Error(`No usable font file found for satori. Checked: ${FONT_CANDIDATES.join(", ")}`);
}
