import { USABLE_HEIGHT } from "../styles/mobileCss";
import { BlockMeasure } from "./measureBlocks";

export type PagePlan = {
  pages: Array<{
    index: number;
    blockIds: string[];
  }>;
};

export function paginateBlocks(blocks: BlockMeasure[]): PagePlan {
  const orderedBlocks = [...blocks].sort((left, right) => left.top - right.top);
  const pages: Array<{ index: number; blockIds: string[] }> = [];

  let currentPageIds: string[] = [];
  let currentPageTop: number | null = null;

  let cursor = 0;
  while (cursor < orderedBlocks.length) {
    const group = resolvePlacementGroup(orderedBlocks, cursor);
    const groupStart = orderedBlocks[cursor];
    const groupEnd = orderedBlocks[group.endIndex];
    const groupIds = orderedBlocks.slice(cursor, group.endIndex + 1).map((block) => block.id);
    const groupBottom = groupEnd.top + groupEnd.height;

    if (groupStart.height > USABLE_HEIGHT) {
      flushCurrentPage();
      pages.push({
        index: pages.length,
        blockIds: [groupStart.id]
      });
      cursor += 1;
      continue;
    }

    if (currentPageTop === null) {
      currentPageIds = groupIds;
      currentPageTop = groupStart.top;
      cursor = group.endIndex + 1;
      continue;
    }

    const candidateHeight = groupBottom - currentPageTop;
    if (candidateHeight <= USABLE_HEIGHT) {
      currentPageIds.push(...groupIds);
      cursor = group.endIndex + 1;
      continue;
    }

    flushCurrentPage();
  }

  flushCurrentPage();
  return { pages };

  function flushCurrentPage(): void {
    if (currentPageIds.length === 0) {
      currentPageTop = null;
      return;
    }

    pages.push({
      index: pages.length,
      blockIds: [...currentPageIds]
    });
    currentPageIds = [];
    currentPageTop = null;
  }
}

function resolvePlacementGroup(blocks: BlockMeasure[], startIndex: number): { endIndex: number } {
  let endIndex = startIndex;

  while (endIndex < blocks.length - 1 && blocks[endIndex].keepWithNext) {
    endIndex += 1;
  }

  if (endIndex === startIndex) {
    return { endIndex };
  }

  const first = blocks[startIndex];
  const last = blocks[endIndex];
  const groupedHeight = last.top + last.height - first.top;

  if (groupedHeight > USABLE_HEIGHT) {
    return { endIndex: startIndex };
  }

  return { endIndex };
}
