import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

type RenderMarkdownImageInput = {
  markdown: string;
  title?: string;
  width?: number;
  filenamePrefix?: string;
  layoutPreset?: "default" | "mobile";
};

type RenderMarkdownImageResult = {
  data: string;
  contentType: string;
  filename: string;
};

type MarkdownImageAdapterModule = {
  renderMarkdownAsLongImage: (input: RenderMarkdownImageInput) => Promise<RenderMarkdownImageResult>;
};

type ResolveFilenameFn = (
  request: string,
  parent?: NodeModule | null,
  isMain?: boolean,
  options?: unknown
) => string;

const REPO_ROOT = path.resolve(__dirname, "../../..");
const MOCK_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf";
const childProcess = require("node:child_process") as {
  spawnSync: typeof import("node:child_process").spawnSync;
};

function loadAdapterFresh(): MarkdownImageAdapterModule {
  const adapterPath = require.resolve("./markdownImageAdapter");
  delete require.cache[adapterPath];
  return require("./markdownImageAdapter") as MarkdownImageAdapterModule;
}

function createModuleNotFoundError(moduleName: string): NodeJS.ErrnoException {
  const error = new Error(`Cannot find module '${moduleName}'`) as NodeJS.ErrnoException;
  error.code = "MODULE_NOT_FOUND";
  return error;
}

function createRequireEsmError(moduleName: string): NodeJS.ErrnoException {
  const error = new Error(`require() of ES Module ${moduleName} not supported`) as NodeJS.ErrnoException;
  error.code = "ERR_REQUIRE_ESM";
  return error;
}

async function withMockedFontData(run: () => Promise<void>): Promise<void> {
  const fsMutable = fs as unknown as {
    existsSync: typeof fs.existsSync;
    readFileSync: typeof fs.readFileSync;
  };
  const originalExistsSync = fsMutable.existsSync;
  const originalReadFileSync = fsMutable.readFileSync;

  fsMutable.existsSync = ((filePath: fs.PathLike): boolean => {
    if (String(filePath) === MOCK_FONT_PATH) {
      return true;
    }
    return originalExistsSync(filePath);
  }) as typeof fs.existsSync;

  fsMutable.readFileSync = ((filePath: fs.PathOrFileDescriptor, options?: unknown): unknown => {
    if (String(filePath) === MOCK_FONT_PATH) {
      return Buffer.from("mock-font-data");
    }
    return originalReadFileSync(filePath, options as never);
  }) as typeof fs.readFileSync;

  try {
    await run();
  } finally {
    fsMutable.existsSync = originalExistsSync;
    fsMutable.readFileSync = originalReadFileSync;
  }
}

test("renderMarkdownAsLongImage should load ESM-only dependency via import fallback", { concurrency: false }, async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-image-adapter-esm-"));
  const remarkEsmPath = path.join(fixtureDir, "remark-esm.mjs");
  const satoriCjsPath = path.join(fixtureDir, "satori.cjs");
  const resvgCjsPath = path.join(fixtureDir, "resvg.cjs");

  fs.writeFileSync(
    remarkEsmPath,
    [
      "export function remark() {",
      "  return {",
      "    parse(markdown) {",
      "      return {",
      "        type: 'root',",
      "        children: [{",
      "          type: 'heading',",
      "          depth: 1,",
      "          children: [{ type: 'text', value: String(markdown || '') }]",
      "        }]",
      "      };",
      "    }",
      "  };",
      "}"
    ].join("\n")
  );
  fs.writeFileSync(
    satoriCjsPath,
    [
      "module.exports = async function satori() {",
      "  return '<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>';",
      "};"
    ].join("\n")
  );
  fs.writeFileSync(
    resvgCjsPath,
    [
      "class Resvg {",
      "  constructor(svg) {",
      "    this.svg = svg;",
      "  }",
      "  render() {",
      "    return {",
      "      asPng() {",
      "        return Buffer.from('png-from-esm-test');",
      "      }",
      "    };",
      "  }",
      "}",
      "module.exports = { Resvg };"
    ].join("\n")
  );

  const moduleMutable = Module as unknown as { _resolveFilename: ResolveFilenameFn };
  const originalResolveFilename = moduleMutable._resolveFilename;
  const mapped = new Map<string, string>([
    ["remark", remarkEsmPath],
    ["satori", satoriCjsPath],
    ["@resvg/resvg-js", resvgCjsPath]
  ]);

  moduleMutable._resolveFilename = function patchedResolveFilename(
    this: unknown,
    request: string,
    parent?: NodeModule | null,
    isMain?: boolean,
    options?: unknown
  ): string {
    const mappedPath = mapped.get(request);
    if (mappedPath) {
      return mappedPath;
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  const { renderMarkdownAsLongImage } = loadAdapterFresh();

  try {
    await withMockedFontData(async () => {
      const image = await renderMarkdownAsLongImage({
        markdown: "# hi",
        filenamePrefix: "esm"
      });

      assert.equal(image.contentType, "image/png");
      assert.equal(Buffer.from(image.data, "base64").toString("utf8"), "png-from-esm-test");
      assert.match(image.filename, /^esm-\d+\.png$/);
    });
  } finally {
    moduleMutable._resolveFilename = originalResolveFilename;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("renderMarkdownAsLongImage should resolve modules when cwd changes", { concurrency: false }, async () => {
  const originalCwd = process.cwd();
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-image-adapter-cwd-"));
  const originalRequire = Module.prototype.require;
  const rootPackageJson = path.join(REPO_ROOT, "package.json");
  const { renderMarkdownAsLongImage } = loadAdapterFresh();

  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id !== "remark" && id !== "satori" && id !== "@resvg/resvg-js") {
      return originalRequire.call(this, id);
    }

    const callerFilename =
      typeof (this as { filename?: unknown }).filename === "string"
        ? ((this as { filename: string }).filename as string)
        : "";
    const fromRepoRoot =
      callerFilename === rootPackageJson || callerFilename.startsWith(`${REPO_ROOT}${path.sep}`);

    if (!fromRepoRoot) {
      throw createModuleNotFoundError(id);
    }

    if (id === "remark") {
      return {
        remark: () => ({
          parse: () => ({
            type: "root",
            children: [{ type: "paragraph", children: [{ type: "text", value: "cwd stable" }] }]
          })
        })
      };
    }

    if (id === "satori") {
      return async () => "<svg></svg>";
    }

    return {
      Resvg: class {
        render(): { asPng: () => Buffer } {
          return {
            asPng: () => Buffer.from("png-from-cwd-test")
          };
        }
      }
    };
  };

  try {
    process.chdir(tempCwd);

    await withMockedFontData(async () => {
      const image = await renderMarkdownAsLongImage({
        markdown: "# cwd",
        filenamePrefix: "cwd"
      });

      assert.equal(Buffer.from(image.data, "base64").toString("utf8"), "png-from-cwd-test");
      assert.match(image.filename, /^cwd-\d+\.png$/);
    });
  } finally {
    process.chdir(originalCwd);
    Module.prototype.require = originalRequire;
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
});

test("renderMarkdownAsLongImage should render markdown table as structured layout", { concurrency: false }, async () => {
  const originalRequire = Module.prototype.require;
  const capturedElements: unknown[] = [];
  const { renderMarkdownAsLongImage } = loadAdapterFresh();

  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "remark") {
      return {
        remark: () => ({
          parse: (markdown: string) => ({
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: String(markdown || "") }]
              }
            ]
          })
        })
      };
    }

    if (id === "satori") {
      return async (element: unknown) => {
        capturedElements.push(element);
        return "<svg></svg>";
      };
    }

    if (id === "@resvg/resvg-js") {
      return {
        Resvg: class {
          render(): { asPng: () => Buffer } {
            return {
              asPng: () => Buffer.from("png-from-table-test")
            };
          }
        }
      };
    }

    return originalRequire.call(this, id);
  };

  try {
    await withMockedFontData(async () => {
      const image = await renderMarkdownAsLongImage({
        markdown: [
          "# 今日结论",
          "维持仓位。",
          "",
          "| 基金 | 建议动作 | 数据完整性 |",
          "| --- | --- | --- |",
          "| 沪深300ETF(510300) | 持有 | 较完整 |"
        ].join("\n"),
        filenamePrefix: "table"
      });

      assert.equal(Buffer.from(image.data, "base64").toString("utf8"), "png-from-table-test");
      const rendered = JSON.stringify(capturedElements[0] || {});
      assert.match(rendered, /沪深300ETF/);
      assert.doesNotMatch(rendered, /\| 基金 \| 建议动作 \| 数据完整性 \|/);
    });
  } finally {
    Module.prototype.require = originalRequire;
  }
});

test("renderMarkdownAsLongImage should support mobile layout preset for phone reading", { concurrency: false }, async () => {
  const originalRequire = Module.prototype.require;
  const capturedElements: unknown[] = [];
  const capturedOptions: Array<{ width: number; height: number }> = [];
  const { renderMarkdownAsLongImage } = loadAdapterFresh();

  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "remark") {
      return {
        remark: () => ({
          parse: () => ({
            type: "root",
            children: [
              { type: "heading", depth: 1, children: [{ type: "text", value: "今日结论" }] },
              { type: "paragraph", children: [{ type: "text", value: "建议保持耐心，先看确认信号。" }] }
            ]
          })
        })
      };
    }

    if (id === "satori") {
      return async (element: unknown, options: { width: number; height: number }) => {
        capturedElements.push(element);
        capturedOptions.push(options);
        return "<svg></svg>";
      };
    }

    if (id === "@resvg/resvg-js") {
      return {
        Resvg: class {
          render(): { asPng: () => Buffer } {
            return {
              asPng: () => Buffer.from("png-from-mobile-layout-test")
            };
          }
        }
      };
    }

    return originalRequire.call(this, id);
  };

  try {
    await withMockedFontData(async () => {
      const image = await renderMarkdownAsLongImage({
        markdown: "# 今日结论\n建议保持耐心，先看确认信号。",
        filenamePrefix: "mobile-layout",
        layoutPreset: "mobile"
      });

      assert.equal(Buffer.from(image.data, "base64").toString("utf8"), "png-from-mobile-layout-test");
      assert.equal(capturedOptions[0]?.width, 780);
      const rendered = JSON.stringify(capturedElements[0] || {});
      assert.match(rendered, /"fontSize":38/);
      assert.match(rendered, /"fontSize":18/);
    });
  } finally {
    Module.prototype.require = originalRequire;
  }
});

test("renderMarkdownAsLongImage should include installCwd and original error when dependency is missing", { concurrency: false }, async () => {
  const originalRequire = Module.prototype.require;
  const { renderMarkdownAsLongImage } = loadAdapterFresh();

  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "remark") {
      throw createModuleNotFoundError(id);
    }
    return originalRequire.call(this, id);
  };

  try {
    await assert.rejects(
      () => renderMarkdownAsLongImage({ markdown: "# install-fail" }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        const typedError = error as Error;
        assert.match(typedError.message, /moduleName=remark/);
        assert.match(typedError.message, /installCwd=/);
        assert.match(typedError.message, /Cannot find module 'remark'/);
        return true;
      }
    );
  } finally {
    Module.prototype.require = originalRequire;
  }
});

test("renderMarkdownAsLongImage should fallback to import when require reports ERR_REQUIRE_ESM", { concurrency: false }, async () => {
  const originalRequire = Module.prototype.require;
  const { renderMarkdownAsLongImage } = loadAdapterFresh();

  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "remark") {
      throw createRequireEsmError(id);
    }
    return originalRequire.call(this, id);
  };

  try {
    await withMockedFontData(async () => {
      const image = await renderMarkdownAsLongImage({ markdown: "# esm-fallback" });
      assert.equal(image.contentType, "image/png");
      assert.equal(Buffer.from(image.data, "base64").length > 0, true);
    });
  } finally {
    Module.prototype.require = originalRequire;
  }
});
