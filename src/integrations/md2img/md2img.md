> **输入 Markdown，输出适配移动端阅读的图片**
>
> * `long-image`：单张长图
> * `multi-page`：多张分页图
>
> 中间使用 **HTML + CSS 排版**，最终使用 **Playwright 截图**。

---

# Markdown → 移动端图片生成技术说明

## 1. 固定技术栈

### Markdown 解析与 HTML 生成

* `unified`
* `remark-parse`
* `remark-gfm`
* `remark-rehype`
* `rehype-stringify`

### 截图引擎

* `playwright`

---

## 2. 输入输出

### 输入

```ts
type RenderInput = {
  markdown: string
  mode: 'long-image' | 'multi-page'
}
```

### 输出

```ts
type RenderOutput = {
  images: Buffer[]
}
```

约定：

* `long-image` 返回长度为 1 的 `images`
* `multi-page` 返回按顺序排列的多张图片

---

## 3. 固定处理链路

```text
Markdown
  ↓
unified 解析
  ↓
block 元信息注入
  ↓
remark-rehype
  ↓
rehype 注入 data-* 属性
  ↓
rehype-stringify 输出 HTML
  ↓
拼接固定移动端样式
  ↓
Playwright 加载 HTML
  ↓
等待字体、图片、布局稳定
  ↓
根据模式截图：
  ├─ long-image：单张长图
  └─ multi-page：多张分页图
```

---

## 4. unified 流水线

固定为：

```ts
unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBlockPlugin)
  .use(remarkRehype)
  .use(rehypeBlockAttrPlugin)
  .use(rehypeStringify)
```

---

## 5. block 元信息规则

所有 block 节点都必须注入统一元信息。

```ts
type BlockMeta = {
  id: string
  type: 'heading' | 'paragraph' | 'list' | 'blockquote' | 'code' | 'image' | 'divider'
  breakInside: 'avoid' | 'auto'
  keepWithNext: boolean
}
```

固定规则：

| type       | breakInside | keepWithNext |
| ---------- | ----------- | ------------ |
| heading    | avoid       | true         |
| paragraph  | auto        | false        |
| list       | auto        | false        |
| blockquote | avoid       | false        |
| code       | avoid       | false        |
| image      | avoid       | false        |
| divider    | avoid       | false        |

---

## 6. remarkBlockPlugin

职责：

* 遍历 mdast
* 识别 block 节点
* 生成唯一 `id`
* 注入 `type / breakInside / keepWithNext`

实现逻辑：

```ts
let seq = 0

visit(tree, (node) => {
  if (!isBlock(node)) return

  seq += 1

  node.data ||= {}
  node.data.blockMeta = {
    id: `b_${seq}`,
    type: inferBlockType(node),
    breakInside: inferBreakInside(node),
    keepWithNext: node.type === 'heading'
  }
})
```

---

## 7. rehypeBlockAttrPlugin

职责：

把 `blockMeta` 写入最终 HTML 属性。

输出格式必须为：

```html
<section
  data-block-id="b_12"
  data-block-type="paragraph"
  data-break-inside="auto"
  data-keep-with-next="false"
>
  ...
</section>
```

实现逻辑：

```ts
node.properties['data-block-id'] = meta.id
node.properties['data-block-type'] = meta.type
node.properties['data-break-inside'] = meta.breakInside
node.properties['data-keep-with-next'] = String(meta.keepWithNext)
```

---

## 8. HTML 文档模板

固定输出结构：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    /* 固定移动端成图样式 */
  </style>
</head>
<body>
  <main class="render-root">
    <article class="mobile-canvas">
      <!-- markdown 转出的 block html -->
    </article>
  </main>
</body>
</html>
```

---

## 9. 固定移动端样式

目标是：**两种输出模式共用一套排版规则**，并且适合手机观看。

## 9.1 画布尺寸

固定逻辑宽度：

```css
.mobile-canvas {
  width: 375px;
}
```

截图缩放由 Playwright 的 `deviceScaleFactor` 负责，固定为：

```ts
deviceScaleFactor = 3
```

最终输出宽度约为：

```text
375 × 3 = 1125 px
```

---

## 9.2 页面基础样式

```css
html, body {
  margin: 0;
  padding: 0;
  background: #f5f5f5;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: #222;
}

.render-root {
  width: 100%;
}

.mobile-canvas {
  width: 375px;
  margin: 0 auto;
  box-sizing: border-box;
  background: #ffffff;
  padding: 24px 20px 32px;
}
```

---

## 9.3 字体与排版规范

```css
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
```

---

## 9.4 引用、代码、分隔线、图片

```css
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
```

---

## 10. 支持的 Markdown block 范围

必须支持：

* `heading`
* `paragraph`
* `list`
* `blockquote`
* `code`
* `image`
* `divider`

不实现额外编辑能力，不实现自定义交互组件。

---

## 11. Playwright 渲染配置

## 11.1 浏览器与页面初始化

```ts
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: {
    width: 375,
    height: 800
  },
  deviceScaleFactor: 3
})
```

---

## 11.2 HTML 加载

使用 `page.setContent` 直接加载最终 HTML：

```ts
await page.setContent(html, {
  waitUntil: 'load'
})
```

---

## 11.3 等待布局稳定

必须等待以下条件：

1. DOM 加载完成
2. 图片加载完成
3. 字体可用
4. 布局稳定

固定实现：

```ts
await page.evaluate(async () => {
  const images = Array.from(document.images)
  await Promise.all(
    images.map(img => {
      if (img.complete) return Promise.resolve()
      return new Promise(resolve => {
        img.onload = resolve
        img.onerror = resolve
      })
    })
  )

  if (document.fonts?.ready) {
    await document.fonts.ready
  }
})

await page.waitForTimeout(100)
```

---

## 12. long-image 模式

## 12.1 截图区域

直接对 `.mobile-canvas` 做单张截图。

```ts
const canvas = page.locator('.mobile-canvas')
const buffer = await canvas.screenshot({
  type: 'png'
})
```

说明：

* 不用手工计算全页 clip
* 直接截取 `.mobile-canvas` 元素
* 这样更稳定，也避免 body 背景干扰

---

## 13. multi-page 模式

多图模式不通过“滚动页面截图”，而是通过**预先计算分页并生成分页 HTML** 来完成。

也就是说：

> 长图模式：一个 `.mobile-canvas`
>
> 多图模式：多个 `.mobile-page`

---

## 13.1 固定分页高度

逻辑页高固定为：

```ts
PAGE_HEIGHT = 667
```

画布 padding 固定为：

```ts
PADDING_TOP = 24
PADDING_BOTTOM = 32
```

可用内容高度：

```ts
USABLE_HEIGHT = 667 - 24 - 32 = 611
```

---

## 13.2 分页数据采集

先在连续文档里采集所有 block 的几何信息：

```ts
type BlockMeasure = {
  id: string
  type: string
  top: number
  height: number
  breakInside: 'avoid' | 'auto'
  keepWithNext: boolean
}
```

Playwright 中执行：

```ts
const blocks = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('[data-block-id]'))

  return nodes.map(node => {
    const rect = node.getBoundingClientRect()
    const canvasRect = document.querySelector('.mobile-canvas')!.getBoundingClientRect()

    return {
      id: node.getAttribute('data-block-id'),
      type: node.getAttribute('data-block-type'),
      breakInside: node.getAttribute('data-break-inside'),
      keepWithNext: node.getAttribute('data-keep-with-next') === 'true',
      top: rect.top - canvasRect.top,
      height: rect.height
    }
  })
})
```

---

## 13.3 分页规则

分页按 block 顺序执行。

规则固定如下：

1. 当前 block 放得下，则放入当前页
2. 当前 block 放不下：

   * 若 `breakInside = avoid`，整体移到下一页
   * 若 `breakInside = auto`，也整体移到下一页
3. 若单个 block 本身高度大于 `USABLE_HEIGHT`：

   * 直接单独占一页
   * 第一版不做内部切分
4. 若当前 block `keepWithNext = true`：

   * 与下一个 block 一起判断是否能放入当前页
   * 放不下则一起移到下一页

注意：
这里固定不做段落切分、不做列表项切分、不做代码行切分。
分页只在 **block 级** 进行。

---

## 13.4 分页结果结构

```ts
type PagePlan = {
  pages: Array<{
    index: number
    blockIds: string[]
  }>
}
```

---

## 13.5 多页 HTML 生成

根据 `PagePlan` 重新生成分页版 HTML：

```html
<body>
  <main class="pages-root">
    <section class="mobile-page">
      <article class="page-canvas">
        <!-- page 1 blocks -->
      </article>
    </section>

    <section class="mobile-page">
      <article class="page-canvas">
        <!-- page 2 blocks -->
      </article>
    </section>
  </main>
</body>
```

分页样式固定为：

```css
.mobile-page {
  width: 375px;
  height: 667px;
  margin: 0 auto;
  background: #ffffff;
  overflow: hidden;
}

.page-canvas {
  box-sizing: border-box;
  width: 375px;
  height: 667px;
  padding: 24px 20px 32px;
  background: #ffffff;
}
```

---

## 13.6 多页截图

重新加载分页 HTML 后，逐页截图：

```ts
const pages = page.locator('.mobile-page')
const count = await pages.count()

const images: Buffer[] = []

for (let i = 0; i < count; i++) {
  const buffer = await pages.nth(i).screenshot({ type: 'png' })
  images.push(buffer)
}
```

---

## 14. 文件组织要求

目录固定为：

```text
md2img/
  markdown/
    buildHtml.ts
    plugins/
      remarkBlockPlugin.ts
      rehypeBlockAttrPlugin.ts

  render/
    renderLongImage.ts
    renderMultiPage.ts
    measureBlocks.ts
    paginateBlocks.ts
    buildPagedHtml.ts

  styles/
    mobileCss.ts

  index.ts
```

---

## 15. 模块职责

## `buildHtml.ts`

职责：

* 接收 Markdown
* 跑 unified pipeline
* 生成连续文档 HTML

---

## `remarkBlockPlugin.ts`

职责：

* 给 block 节点注入 `blockMeta`

---

## `rehypeBlockAttrPlugin.ts`

职责：

* 把 `blockMeta` 写到 HTML `data-*`

---

## `mobileCss.ts`

职责：

* 输出唯一一份固定移动端 CSS
* 长图与多图共用同一套排版 token

---

## `measureBlocks.ts`

职责：

* 在连续文档中采集 block 几何信息

---

## `paginateBlocks.ts`

职责：

* 根据固定规则输出 `PagePlan`

---

## `buildPagedHtml.ts`

职责：

* 根据原 block HTML 和 `PagePlan` 生成分页版 HTML

---

## `renderLongImage.ts`

职责：

* 载入连续 HTML
* 截 `.mobile-canvas`
* 返回单张图片

---

## `renderMultiPage.ts`

职责：

* 载入连续 HTML
* 测量 block
* 分页
* 生成分页 HTML
* 逐页截图
* 返回多张图片

---

## 16. 顶层接口

```ts
export async function renderMarkdownToImages(
  input: RenderInput
): Promise<RenderOutput>
```

实现逻辑：

```ts
if (input.mode === 'long-image') {
  return renderLongImage(input.markdown)
}

return renderMultiPage(input.markdown)
```

---

## 17. 顶层行为要求

### 当 mode = `long-image`

执行：

1. Markdown → 连续 HTML
2. Playwright 加载
3. 等待稳定
4. 截取 `.mobile-canvas`
5. 返回单张图片

### 当 mode = `multi-page`

执行：

1. Markdown → 连续 HTML
2. Playwright 加载
3. 等待稳定
4. 采集 block 几何数据
5. 计算分页
6. 生成分页 HTML
7. 重新加载分页 HTML
8. 逐页截图
9. 返回多张图片

---

## 18. 关键约束

必须满足以下约束：

1. 不实现网页编辑能力
2. 不实现网页展示组件抽象
3. HTML 只作为截图中间介质
4. 长图和多图必须使用同一套 CSS
5. 图片宽度固定为移动端逻辑宽度 375
6. 导出分辨率固定依赖 `deviceScaleFactor = 3`
7. 第一版分页只支持 block 级分页，不做 block 内切分
8. 截图对象必须是具体元素，不做整页全屏截图

---

## 19. 直接给 Codex 的任务描述

```text
实现一个 Markdown 转移动端图片的 Node 服务模块，固定技术栈为：

- unified
- remark-parse
- remark-gfm
- remark-rehype
- rehype-stringify
- playwright

目标：
输入 Markdown，输出两种模式：
1. long-image：单张长图
2. multi-page：多张分页图

要求：

1. 使用 unified pipeline：
   - remark-parse
   - remark-gfm
   - 自定义 remarkBlockPlugin
   - remark-rehype
   - 自定义 rehypeBlockAttrPlugin
   - rehype-stringify

2. remarkBlockPlugin 必须为所有 block 节点注入：
   - id
   - type
   - breakInside
   - keepWithNext

3. rehypeBlockAttrPlugin 必须输出：
   - data-block-id
   - data-block-type
   - data-break-inside
   - data-keep-with-next

4. 支持 block 类型：
   - heading
   - paragraph
   - list
   - blockquote
   - code
   - image
   - divider

5. 固定移动端画布样式：
   - width: 375px
   - padding: 24px 20px 32px
   - body font-family 使用系统中文字体栈
   - h1: 24px
   - h2: 20px
   - p/li: 15px
   - line-height 适合手机阅读

6. 使用 Playwright：
   - viewport width 375
   - viewport height 800
   - deviceScaleFactor 3

7. long-image 模式：
   - 生成连续 HTML
   - 加载后等待图片和字体完成
   - 直接截图 .mobile-canvas 元素
   - 返回单张 png buffer

8. multi-page 模式：
   - 先生成连续 HTML
   - 采集所有 data-block-id 节点的位置和高度
   - 固定页高 667
   - paddingTop 24
   - paddingBottom 32
   - 可用内容高度 611
   - 按 block 级分页，不做 block 内切分
   - heading keepWithNext=true
   - 生成分页 HTML
   - 逐个截图 .mobile-page
   - 返回多个 png buffer

9. 目录结构固定为：
   - md2img/markdown/buildHtml.ts
   - md2img/markdown/plugins/remarkBlockPlugin.ts
   - md2img/markdown/plugins/rehypeBlockAttrPlugin.ts
   - md2img/render/renderLongImage.ts
   - md2img/render/renderMultiPage.ts
   - md2img/render/measureBlocks.ts
   - md2img/render/paginateBlocks.ts
   - md2img/render/buildPagedHtml.ts
   - md2img/styles/mobileCss.ts
   - md2img/index.ts

10. 不实现编辑器，不实现 React 组件，不实现网页交互。
HTML 仅作为截图中间层。
```

