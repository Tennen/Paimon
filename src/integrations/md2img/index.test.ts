import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { rehypeBlockAttrPlugin } from "./markdown/plugins/rehypeBlockAttrPlugin";
import { remarkBlockPlugin } from "./markdown/plugins/remarkBlockPlugin";
import { renderMarkdownToImages } from "./index";
import { paginateBlocks } from "./render/paginateBlocks";

type MdastTree = {
  type: "root";
  children: Array<Record<string, unknown>>;
};

type MockProcessor = {
  use: (plugin: unknown, options?: unknown) => MockProcessor;
  process: (markdown: string) => Promise<string>;
};

test("remarkBlockPlugin should annotate supported block nodes with sequential blockMeta", () => {
  const tree: MdastTree = {
    type: "root",
    children: [
      { type: "heading", depth: 1, children: [{ type: "text", value: "Title" }] },
      { type: "paragraph", children: [{ type: "text", value: "Body" }] },
      { type: "list", children: [] },
      { type: "blockquote", children: [] },
      { type: "code", value: "const a = 1;" },
      { type: "image", url: "https://example.com/a.png" },
      { type: "thematicBreak" }
    ]
  };

  const transform = remarkBlockPlugin();
  transform(tree);

  const annotated = tree.children.map((child) => {
    const data = (child.data || {}) as { blockMeta?: unknown; hProperties?: Record<string, unknown> };
    return {
      meta: data.blockMeta as { id: string; type: string; breakInside: string; keepWithNext: boolean },
      mirror: data.hProperties?.__blockMeta as { id: string }
    };
  });

  assert.deepEqual(
    annotated.map((item) => item.meta),
    [
      { id: "b_1", type: "heading", breakInside: "avoid", keepWithNext: true },
      { id: "b_2", type: "paragraph", breakInside: "auto", keepWithNext: false },
      { id: "b_3", type: "list", breakInside: "auto", keepWithNext: false },
      { id: "b_4", type: "blockquote", breakInside: "avoid", keepWithNext: false },
      { id: "b_5", type: "code", breakInside: "avoid", keepWithNext: false },
      { id: "b_6", type: "image", breakInside: "avoid", keepWithNext: false },
      { id: "b_7", type: "divider", breakInside: "avoid", keepWithNext: false }
    ]
  );
  assert.deepEqual(
    annotated.map((item) => item.mirror.id),
    ["b_1", "b_2", "b_3", "b_4", "b_5", "b_6", "b_7"]
  );
});

test("rehypeBlockAttrPlugin should wrap block elements in section nodes with data attributes", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "h1",
        properties: {
          __blockMeta: {
            id: "b_1",
            type: "heading",
            breakInside: "avoid",
            keepWithNext: true
          }
        },
        children: [{ type: "text", value: "Hello" }]
      }
    ]
  };

  const transform = rehypeBlockAttrPlugin();
  transform(tree);

  const wrapper = ((tree.children || [])[0] as unknown) as {
    tagName: string;
    properties: Record<string, string>;
    children: Array<{ tagName: string; properties: Record<string, unknown> }>;
  };
  assert.equal(wrapper.tagName, "section");
  assert.deepEqual(wrapper.properties, {
    "data-block-id": "b_1",
    "data-block-type": "heading",
    "data-break-inside": "avoid",
    "data-keep-with-next": "true"
  });
  assert.equal(wrapper.children[0].tagName, "h1");
  assert.equal("__blockMeta" in wrapper.children[0].properties, false);
});

test("paginateBlocks should keep heading with next block and split pages by usable height", () => {
  const pagePlan = paginateBlocks([
    { id: "b_1", type: "paragraph", top: 24, height: 300, breakInside: "auto", keepWithNext: false },
    { id: "b_2", type: "heading", top: 340, height: 40, breakInside: "avoid", keepWithNext: true },
    { id: "b_3", type: "paragraph", top: 392, height: 300, breakInside: "auto", keepWithNext: false },
    { id: "b_4", type: "paragraph", top: 708, height: 100, breakInside: "auto", keepWithNext: false },
    { id: "b_5", type: "code", top: 820, height: 700, breakInside: "avoid", keepWithNext: false }
  ]);

  assert.deepEqual(pagePlan, {
    pages: [
      { index: 0, blockIds: ["b_1"] },
      { index: 1, blockIds: ["b_2", "b_3", "b_4"] },
      { index: 2, blockIds: ["b_5"] }
    ]
  });
});

test("renderMarkdownToImages should support long-image and multi-page modes via new md2img pipeline", { concurrency: false }, async () => {
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "unified") {
      return {
        unified: () => createMockProcessor()
      };
    }
    if (id === "remark-parse" || id === "remark-gfm" || id === "remark-rehype" || id === "rehype-stringify") {
      return () => undefined;
    }
    if (id === "playwright") {
      return createMockPlaywright(["long-buffer", "page-1", "page-2"]);
    }
    return originalRequire.call(this, id);
  };

  try {
    const longImage = await renderMarkdownToImages({
      markdown: "# Demo",
      mode: "long-image"
    });
    assert.deepEqual(longImage.images.map((image) => image.toString("utf8")), ["long-buffer"]);

    const multiPage = await renderMarkdownToImages({
      markdown: "# Demo",
      mode: "multi-page"
    });
    assert.deepEqual(multiPage.images.map((image) => image.toString("utf8")), ["page-1", "page-2"]);
  } finally {
    Module.prototype.require = originalRequire;
  }
});

function createMockProcessor(): MockProcessor {
  return {
    use() {
      return this;
    },
    async process(markdown: string): Promise<string> {
      const safeMarkdown = String(markdown || "").replace(/[<&]/g, (value) => (value === "<" ? "&lt;" : "&amp;"));
      return [
        '<section data-block-id="b_1" data-block-type="heading" data-break-inside="avoid" data-keep-with-next="true"><h1>Demo</h1></section>',
        `<section data-block-id="b_2" data-block-type="paragraph" data-break-inside="auto" data-keep-with-next="false"><p>${safeMarkdown}</p></section>`
      ].join("");
    }
  };
}

function createMockPlaywright(screenshots: string[]): {
  chromium: {
    launch: () => Promise<{
      newPage: () => Promise<{
        setContent: () => Promise<void>;
        evaluate: <T>(fn: () => T | Promise<T>) => Promise<T | undefined>;
        waitForTimeout: () => Promise<void>;
        locator: (selector: string) => unknown;
      }>;
      close: () => Promise<void>;
    }>;
  };
} {
  return {
    chromium: {
      launch: async () => ({
        newPage: async () => ({
          async setContent(): Promise<void> {
            return undefined;
          },
          async evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T | undefined> {
            const source = String(pageFunction);
            if (source.includes('querySelectorAll("[data-block-id]")')) {
              return [
                {
                  id: "b_1",
                  type: "heading",
                  top: 24,
                  height: 48,
                  breakInside: "avoid",
                  keepWithNext: true
                },
                {
                  id: "b_2",
                  type: "paragraph",
                  top: 84,
                  height: 120,
                  breakInside: "auto",
                  keepWithNext: false
                }
              ] as T;
            }
            return undefined;
          },
          async waitForTimeout(): Promise<void> {
            return undefined;
          },
          locator(selector: string): unknown {
            if (selector === ".mobile-canvas") {
              return {
                screenshot: async () => Buffer.from(screenshots[0] || "long-buffer")
              };
            }
            if (selector === ".mobile-page") {
              return {
                count: async () => Math.max(0, screenshots.length - 1),
                nth: (index: number) => ({
                  screenshot: async () => Buffer.from(screenshots[index + 1] || `page-${index + 1}`)
                })
              };
            }
            throw new Error(`Unexpected selector: ${selector}`);
          }
        }),
        async close(): Promise<void> {
          return undefined;
        }
      })
    }
  };
}
