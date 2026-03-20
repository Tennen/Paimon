export type BlockMeasure = {
  id: string;
  type: string;
  top: number;
  height: number;
  breakInside: "avoid" | "auto";
  keepWithNext: boolean;
};

type PageLike = {
  evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
};

type RawBlockMeasure = {
  id?: unknown;
  type?: unknown;
  top?: unknown;
  height?: unknown;
  breakInside?: unknown;
  keepWithNext?: unknown;
};

export async function measureBlocks(page: PageLike): Promise<BlockMeasure[]> {
  const rawMeasures = await page.evaluate(() => {
    const canvas = document.querySelector(".mobile-canvas");
    if (!canvas) {
      throw new Error("md2img failed to find .mobile-canvas during block measurement");
    }

    const canvasRect = canvas.getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll("[data-block-id]"));
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.getAttribute("data-block-id"),
        type: node.getAttribute("data-block-type"),
        breakInside: node.getAttribute("data-break-inside"),
        keepWithNext: node.getAttribute("data-keep-with-next") === "true",
        top: rect.top - canvasRect.top,
        height: rect.height
      };
    });
  });

  const measures = normalizeMeasures(rawMeasures);
  if (measures.length === 0) {
    throw new Error("md2img found no measurable blocks");
  }
  return measures;
}

function normalizeMeasures(input: unknown): BlockMeasure[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => normalizeMeasure(item as RawBlockMeasure))
    .filter((item): item is BlockMeasure => item !== null);
}

function normalizeMeasure(input: RawBlockMeasure): BlockMeasure | null {
  const id = typeof input.id === "string" ? input.id : "";
  const type = typeof input.type === "string" ? input.type : "";
  const top = typeof input.top === "number" && Number.isFinite(input.top) ? input.top : NaN;
  const height = typeof input.height === "number" && Number.isFinite(input.height) ? input.height : NaN;
  const breakInside = input.breakInside === "avoid" ? "avoid" : input.breakInside === "auto" ? "auto" : null;
  const keepWithNext = input.keepWithNext === true;

  if (!id || !type || !Number.isFinite(top) || !Number.isFinite(height) || !breakInside) {
    return null;
  }

  return {
    id,
    type,
    top,
    height,
    breakInside,
    keepWithNext
  };
}
