import { renderLongImage } from "./render/renderLongImage";
import { renderMultiPage } from "./render/renderMultiPage";

export type RenderInput = {
  markdown: string;
  mode: "long-image" | "multi-page";
};

export type RenderOutput = {
  images: Buffer[];
};

export async function renderMarkdownToImages(input: RenderInput): Promise<RenderOutput> {
  const markdown = String(input.markdown || "");
  if (input.mode === "long-image") {
    return renderLongImage(markdown);
  }
  if (input.mode === "multi-page") {
    return renderMultiPage(markdown);
  }
  throw new Error(`unsupported md2img mode: ${String((input as { mode?: unknown }).mode ?? "")}`);
}
