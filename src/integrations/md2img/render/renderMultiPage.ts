import { buildHtml } from "../markdown/buildHtml";
import { buildPagedHtml } from "./buildPagedHtml";
import { measureBlocks } from "./measureBlocks";
import { paginateBlocks } from "./paginateBlocks";
import { openRenderPage, toBuffer, waitForStableLayout } from "./renderLongImage";

type LocatorLike = {
  screenshot: (options: { type: "png" }) => Promise<Buffer | Uint8Array>;
};

type LocatorListLike = {
  count: () => Promise<number>;
  nth: (index: number) => LocatorLike;
};

type PageLike = {
  setContent: (html: string, options: { waitUntil: "load" }) => Promise<void>;
  locator: (selector: string) => LocatorListLike;
};

export async function renderMultiPage(markdown: string): Promise<{ images: Buffer[] }> {
  const document = await buildHtml(markdown);
  const { browser, page } = await openRenderPage();
  const typedPage = page as PageLike;

  try {
    await typedPage.setContent(document.html, { waitUntil: "load" });
    await waitForStableLayout(page);

    const measures = await measureBlocks(page);
    const pagePlan = paginateBlocks(measures);
    const pagedHtml = buildPagedHtml(document.blockHtmlById, pagePlan);

    await typedPage.setContent(pagedHtml, { waitUntil: "load" });
    await waitForStableLayout(page);

    const pages = typedPage.locator(".mobile-page") as LocatorListLike;
    const count = await pages.count();
    const images: Buffer[] = [];
    for (let index = 0; index < count; index += 1) {
      images.push(toBuffer(await pages.nth(index).screenshot({ type: "png" })));
    }

    if (images.length === 0) {
      throw new Error("md2img multi-page render produced no images");
    }

    return { images };
  } finally {
    await browser.close();
  }
}
