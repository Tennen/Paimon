import fs from "fs";
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

export async function renderMarkdownAsLongImage(input: RenderMarkdownImageInput): Promise<Image> {
  const markdown = String(input.markdown || "").trim();
  if (!markdown) {
    throw new Error("markdown is empty");
  }

  const width = clampInt(input.width, MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH);
  const title = String(input.title || "Market Analysis 报告").trim() || "Market Analysis 报告";
  const blocks = await parseMarkdownBlocks(markdown);
  const height = estimateHeight(blocks, width);

  const satori = loadSatori();
  const Resvg = loadResvgCtor();
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
  const remark = loadRemark();
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

function loadSatori(): SatoriLike {
  try {
    const mod = require("satori") as { default?: SatoriLike } | SatoriLike;
    const fn = (typeof mod === "function" ? mod : mod.default) as SatoriLike | undefined;
    if (!fn) {
      throw new Error("invalid satori export");
    }
    return fn;
  } catch {
    throw new Error("Missing dependency satori. Run: npm install satori --no-save");
  }
}

function loadResvgCtor(): ResvgCtor {
  try {
    const mod = require("@resvg/resvg-js") as { Resvg?: ResvgCtor };
    if (!mod.Resvg) {
      throw new Error("invalid @resvg/resvg-js export");
    }
    return mod.Resvg;
  } catch {
    throw new Error("Missing dependency @resvg/resvg-js. Run: npm install @resvg/resvg-js --no-save");
  }
}

function loadRemark(): () => { parse: (markdown: string) => unknown } {
  try {
    const mod = require("remark") as { remark?: () => { parse: (markdown: string) => unknown } };
    if (!mod.remark) {
      throw new Error("invalid remark export");
    }
    return mod.remark;
  } catch {
    throw new Error("Missing dependency remark. Run: npm install remark --no-save");
  }
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
