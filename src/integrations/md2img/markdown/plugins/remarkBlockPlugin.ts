export type BlockType = "heading" | "paragraph" | "list" | "blockquote" | "code" | "image" | "divider";

export type BlockMeta = {
  id: string;
  type: BlockType;
  breakInside: "avoid" | "auto";
  keepWithNext: boolean;
};

type MdastNode = {
  type?: unknown;
  data?: Record<string, unknown>;
  children?: unknown;
};

type MdastTree = MdastNode & {
  children?: MdastNode[];
};

type MdastTransformer = (tree: MdastTree) => void;

export function remarkBlockPlugin(): MdastTransformer {
  return (tree: MdastTree) => {
    let seq = 0;
    visitMdast(tree, (node) => {
      if (!isBlockNode(node)) {
        return;
      }

      seq += 1;
      const meta: BlockMeta = {
        id: `b_${seq}`,
        type: inferBlockType(node),
        breakInside: inferBreakInside(node),
        keepWithNext: normalizeNodeType(node.type) === "heading"
      };

      const data = ensureRecord(node.data);
      const hProperties = ensureRecord(data.hProperties);
      data.blockMeta = meta;
      hProperties.__blockMeta = meta;
      data.hProperties = hProperties;
      node.data = data;
    });
  };
}

function visitMdast(node: MdastNode, visitor: (node: MdastNode) => void): void {
  visitor(node);
  for (const child of asNodeList(node.children)) {
    visitMdast(child, visitor);
  }
}

function isBlockNode(node: MdastNode): boolean {
  const type = normalizeNodeType(node.type);
  return (
    type === "heading"
    || type === "paragraph"
    || type === "list"
    || type === "blockquote"
    || type === "code"
    || type === "image"
    || type === "thematicBreak"
    || type === "table"
  );
}

function inferBlockType(node: MdastNode): BlockType {
  const type = normalizeNodeType(node.type);
  if (type === "heading") {
    return "heading";
  }
  if (type === "list") {
    return "list";
  }
  if (type === "blockquote") {
    return "blockquote";
  }
  if (type === "code") {
    return "code";
  }
  if (type === "image") {
    return "image";
  }
  if (type === "thematicBreak") {
    return "divider";
  }
  return "paragraph";
}

function inferBreakInside(node: MdastNode): "avoid" | "auto" {
  const type = normalizeNodeType(node.type);
  if (
    type === "heading"
    || type === "blockquote"
    || type === "code"
    || type === "image"
    || type === "thematicBreak"
    || type === "table"
  ) {
    return "avoid";
  }
  return "auto";
}

function normalizeNodeType(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNodeList(value: unknown): MdastNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => Boolean(item) && typeof item === "object") as MdastNode[];
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}
