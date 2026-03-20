import { buildHtmlDocument } from "../markdown/buildHtml";
import { PagePlan } from "./paginateBlocks";

export function buildPagedHtml(blockHtmlById: Map<string, string>, pagePlan: PagePlan): string {
  const pageSections = pagePlan.pages.map((page) => {
    const blocks = page.blockIds.map((blockId) => {
      const blockHtml = blockHtmlById.get(blockId);
      if (!blockHtml) {
        throw new Error(`md2img could not find block html for ${blockId}`);
      }
      return blockHtml;
    });

    return `
<section class="mobile-page">
  <article class="page-canvas">
    ${blocks.join("\n")}
  </article>
</section>
`.trim();
  });

  if (pageSections.length === 0) {
    throw new Error("md2img page plan is empty");
  }

  return buildHtmlDocument(`
<main class="pages-root">
  ${pageSections.join("\n")}
</main>
`.trim());
}
