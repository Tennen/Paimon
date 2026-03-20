export const VIEWPORT_WIDTH = 375;
export const VIEWPORT_HEIGHT = 800;
export const DEVICE_SCALE_FACTOR = 3;

export const PAGE_HEIGHT = 667;
export const CANVAS_PADDING_TOP = 24;
export const CANVAS_PADDING_RIGHT = 20;
export const CANVAS_PADDING_BOTTOM = 32;
export const CANVAS_PADDING_LEFT = 20;
export const USABLE_HEIGHT = PAGE_HEIGHT - CANVAS_PADDING_TOP - CANVAS_PADDING_BOTTOM;

export function getMobileCss(): string {
  return `
html, body {
  margin: 0;
  padding: 0;
  background: #f5f5f5;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: #222;
}

* {
  box-sizing: border-box;
}

.render-root,
.pages-root {
  width: 100%;
}

.mobile-canvas,
.page-canvas {
  width: ${VIEWPORT_WIDTH}px;
  margin: 0 auto;
  background: #ffffff;
  padding: ${CANVAS_PADDING_TOP}px ${CANVAS_PADDING_RIGHT}px ${CANVAS_PADDING_BOTTOM}px ${CANVAS_PADDING_LEFT}px;
}

.mobile-page {
  width: ${VIEWPORT_WIDTH}px;
  height: ${PAGE_HEIGHT}px;
  margin: 0 auto;
  background: #ffffff;
  overflow: hidden;
}

.mobile-page + .mobile-page {
  margin-top: 12px;
}

.page-canvas {
  height: ${PAGE_HEIGHT}px;
  overflow: hidden;
}

[data-block-id] {
  display: block;
}

[data-break-inside="avoid"] {
  break-inside: avoid;
  page-break-inside: avoid;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  color: #111;
}

h1 {
  font-size: 24px;
  line-height: 1.4;
  margin: 0 0 12px;
}

h2 {
  font-size: 20px;
  line-height: 1.45;
  margin: 20px 0 10px;
}

h3 {
  font-size: 17px;
  line-height: 1.5;
  margin: 18px 0 8px;
}

p {
  font-size: 15px;
  line-height: 1.75;
  margin: 0 0 12px;
  color: #222;
}

ul, ol {
  margin: 0 0 12px 20px;
  padding: 0;
}

li {
  font-size: 15px;
  line-height: 1.75;
  margin: 0 0 6px;
}

blockquote {
  margin: 12px 0;
  padding: 0 0 0 12px;
  border-left: 3px solid #ff6b6b;
  color: #666;
}

pre {
  margin: 12px 0;
  padding: 12px;
  background: #f6f8fa;
  border-radius: 8px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}

code {
  font-size: 13px;
  line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

hr {
  margin: 20px 0;
  border: none;
  border-top: 1px solid #eee;
}

img {
  display: block;
  width: 100%;
  height: auto;
  margin: 12px 0;
  border-radius: 12px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  table-layout: fixed;
}

th,
td {
  border: 1px solid #e5e7eb;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  vertical-align: top;
  word-break: break-word;
}

th {
  background: #f8fafc;
  color: #111827;
  font-weight: 700;
}
`.trim();
}
