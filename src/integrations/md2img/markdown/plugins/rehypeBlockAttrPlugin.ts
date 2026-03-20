import { BlockMeta } from "./remarkBlockPlugin";

type HastNode = {
  type?: unknown;
  tagName?: unknown;
  properties?: Record<string, unknown>;
  children?: unknown;
};

type HastParent = HastNode & {
  children?: HastNode[];
};

type HastTransformer = (tree: HastParent) => void;

export function rehypeBlockAttrPlugin(): HastTransformer {
  return (tree: HastParent) => {
    visitParent(tree);
  };
}

function visitParent(parent: HastParent): void {
  const children = asNodeList(parent.children);
  if (children.length === 0) {
    return;
  }

  const nextChildren = children.map((child) => wrapBlockNode(child));
  parent.children = nextChildren;

  for (const child of nextChildren) {
    visitParent(child as HastParent);
  }
}

function wrapBlockNode(node: HastNode): HastNode {
  const properties = ensureRecord(node.properties);
  const meta = readBlockMeta(properties.__blockMeta);
  if (!meta || normalizeNodeType(node.type) !== "element") {
    return {
      ...node,
      properties
    };
  }

  delete properties.__blockMeta;

  return {
    type: "element",
    tagName: "section",
    properties: {
      "data-block-id": meta.id,
      "data-block-type": meta.type,
      "data-break-inside": meta.breakInside,
      "data-keep-with-next": String(meta.keepWithNext)
    },
    children: [
      {
        ...node,
        properties
      }
    ]
  };
}

function readBlockMeta(value: unknown): BlockMeta | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const meta = value as Partial<BlockMeta>;
  if (
    typeof meta.id !== "string"
    || typeof meta.type !== "string"
    || (meta.breakInside !== "avoid" && meta.breakInside !== "auto")
    || typeof meta.keepWithNext !== "boolean"
  ) {
    return null;
  }

  return {
    id: meta.id,
    type: meta.type,
    breakInside: meta.breakInside,
    keepWithNext: meta.keepWithNext
  };
}

function normalizeNodeType(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNodeList(value: unknown): HastNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => Boolean(item) && typeof item === "object") as HastNode[];
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}
