const { setTimeout: sleep } = require("timers/promises");

const CHATGPT_URL = process.env.CHATGPT_URL || "https://chatgpt.com/";
const PAGE_TIMEOUT_MS = toInt(process.env.CHATGPT_PAGE_TIMEOUT_MS, 120000);
const GENERATION_TIMEOUT_MS = toInt(process.env.CHATGPT_GENERATION_TIMEOUT_MS, 300000);
const STOP_APPEAR_TIMEOUT_MS = toInt(process.env.CHATGPT_STOP_APPEAR_TIMEOUT_MS, 25000);
const POLL_INTERVAL_MS = toInt(process.env.CHATGPT_POLL_INTERVAL_MS, 500);
const MIN_IMAGE_WIDTH = toInt(process.env.CHATGPT_IMAGE_MIN_WIDTH, 80);
const MIN_IMAGE_HEIGHT = toInt(process.env.CHATGPT_IMAGE_MIN_HEIGHT, 80);

const COMPOSER_SELECTORS = [
  "#prompt-textarea",
  "textarea#prompt-textarea",
  "div[contenteditable='true'][id='prompt-textarea']",
  "textarea[data-testid='prompt-textarea']",
  "div[contenteditable='true'][data-testid='prompt-textarea']"
];

let puppeteerCore = null;
let browserPromise = null;
let pagePromise = null;
let serialQueue = Promise.resolve();

module.exports.execute = async function execute(input) {
  const message = String(input || "").trim();
  if (!message) {
    return { text: "请输入要询问 ChatGPT 的内容。" };
  }

  const task = serialQueue.then(
    () => runChatgptRequest(message),
    () => runChatgptRequest(message)
  );
  serialQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
};

async function runChatgptRequest(message) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const page = await getChatPage();
      await ensureChatReady(page);
      const assistantCountBefore = await getAssistantCount(page);
      await fillComposerAndSend(page, message);
      await waitForGenerationComplete(page, assistantCountBefore);

      const reply = await readLastAssistantReply(page);
      if (isScreenshotEnabled()) {
        const screenshot = await captureChatAreaScreenshot(page);
        if (screenshot) {
          reply.images.push(screenshot);
        }
      }

      if (!reply.text && reply.images.length === 0) {
        throw new Error("ChatGPT 未返回可见文本或图片。");
      }

      return {
        text: reply.text || "已收到 ChatGPT 回复。",
        ...(reply.images.length > 0 ? { images: reply.images } : {})
      };
    } catch (error) {
      lastError = error;
      if (!isRecoverableError(error) || attempt > 0) {
        break;
      }
      resetBrowserState();
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError || "unknown");
  throw new Error(`chatgpt-bridge failed: ${detail}`);
}

function loadPuppeteer() {
  if (puppeteerCore) {
    return puppeteerCore;
  }
  try {
    puppeteerCore = require("puppeteer-core");
    return puppeteerCore;
  } catch (_error) {
    throw new Error("Missing dependency puppeteer-core. Run: npm install puppeteer-core --no-save");
  }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = connectBrowser().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

async function connectBrowser() {
  const puppeteer = loadPuppeteer();
  const browserWSEndpoint = await resolveBrowserWSEndpoint();
  const browser = await puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: null
  });
  browser.on("disconnected", () => {
    browserPromise = null;
    pagePromise = null;
  });
  return browser;
}

async function resolveBrowserWSEndpoint() {
  if (process.env.CHATGPT_BROWSER_WS_ENDPOINT) {
    return process.env.CHATGPT_BROWSER_WS_ENDPOINT;
  }

  if (typeof fetch !== "function") {
    throw new Error("Global fetch is unavailable in current Node runtime");
  }

  const remoteUrl = getRemoteDebuggingUrl();
  const endpoint = `${remoteUrl.replace(/\/$/, "")}/json/version`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Cannot reach Chrome remote debugging endpoint (${endpoint}), HTTP ${response.status}`);
  }
  const data = await response.json();
  const ws = data && typeof data === "object" ? data.webSocketDebuggerUrl : undefined;
  if (!ws || typeof ws !== "string") {
    throw new Error(`Chrome remote debugging endpoint has no webSocketDebuggerUrl: ${endpoint}`);
  }
  return ws;
}

function getRemoteDebuggingUrl() {
  const explicitUrl = process.env.CHATGPT_REMOTE_DEBUGGING_URL || process.env.CHROME_REMOTE_DEBUGGING_URL;
  if (explicitUrl) {
    return explicitUrl;
  }
  const port = process.env.CHATGPT_REMOTE_DEBUGGING_PORT || process.env.CHROME_REMOTE_DEBUGGING_PORT || "9222";
  return `http://127.0.0.1:${port}`;
}

async function getChatPage() {
  if (pagePromise) {
    const page = await pagePromise;
    if (!page.isClosed()) {
      return page;
    }
    pagePromise = null;
  }

  pagePromise = createOrAttachChatPage().catch((error) => {
    pagePromise = null;
    throw error;
  });
  return pagePromise;
}

async function createOrAttachChatPage() {
  const browser = await getBrowser();
  const existing = await findExistingChatPage(browser);
  const page = existing || (await browser.newPage());
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  page.once("close", () => {
    pagePromise = null;
  });

  if (!isChatgptPageUrl(page.url())) {
    await page.goto(CHATGPT_URL, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS
    });
  }

  try {
    await page.bringToFront();
  } catch (_error) {
    // ignore
  }

  return page;
}

async function findExistingChatPage(browser) {
  const pages = await browser.pages();
  for (const page of pages) {
    if (!page.isClosed() && isChatgptPageUrl(page.url())) {
      return page;
    }
  }
  return null;
}

function isChatgptPageUrl(url) {
  const value = String(url || "").toLowerCase();
  return value.includes("chatgpt.com") || value.includes("chat.openai.com");
}

async function ensureChatReady(page) {
  if (!isChatgptPageUrl(page.url())) {
    await page.goto(CHATGPT_URL, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS
    });
  }

  try {
    await waitForAnySelector(page, COMPOSER_SELECTORS, PAGE_TIMEOUT_MS);
  } catch (_error) {
    const requiresLogin = await page
      .evaluate(() => {
        const bodyText = document.body ? String(document.body.innerText || "").toLowerCase() : "";
        return bodyText.includes("log in") || bodyText.includes("sign up") || bodyText.includes("登录");
      })
      .catch(() => false);
    if (requiresLogin) {
      throw new Error("ChatGPT 页面未登录。请先在该 Chrome 中登录。");
    }
    throw new Error("未找到 ChatGPT 输入框。请确认 Chrome 已开启 --remote-debugging-port 且页面可用。");
  }
}

async function getAssistantCount(page) {
  const count = await page.evaluate(() => {
    return document.querySelectorAll("[data-message-author-role='assistant']").length;
  });
  return typeof count === "number" ? count : 0;
}

async function fillComposerAndSend(page, message) {
  const selector = await waitForAnySelector(page, COMPOSER_SELECTORS, PAGE_TIMEOUT_MS);
  const composer = await page.$(selector);
  if (!composer) {
    throw new Error("无法定位 ChatGPT 输入框。");
  }

  await composer.click();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  await page.keyboard.press("KeyA");
  await page.keyboard.up(modifier);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(message, { delay: 0 });

  const clicked = await clickSendButton(page);
  if (!clicked) {
    await page.keyboard.press("Enter");
  }
  await sleep(120);
}

async function clickSendButton(page) {
  const clicked = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    const direct = document.querySelector("button[data-testid='send-button']");
    if (direct instanceof HTMLButtonElement && isVisible(direct) && !direct.disabled) {
      direct.click();
      return true;
    }

    const buttons = Array.from(document.querySelectorAll("button"));
    const fallback = buttons.find((button) => {
      if (!(button instanceof HTMLButtonElement)) return false;
      if (button.disabled || !isVisible(button)) return false;
      const text = [
        button.getAttribute("aria-label") || "",
        button.textContent || "",
        button.getAttribute("data-testid") || ""
      ]
        .join(" ")
        .toLowerCase();
      return /(^|\s)(send|发送)($|\s)/.test(text);
    });
    if (fallback) {
      fallback.click();
      return true;
    }
    return false;
  });
  return Boolean(clicked);
}

async function waitForGenerationComplete(page, previousAssistantCount) {
  const startedAt = Date.now();
  const stopAppearDeadline = startedAt + STOP_APPEAR_TIMEOUT_MS;
  const doneDeadline = startedAt + GENERATION_TIMEOUT_MS;
  let sawStop = false;

  while (Date.now() < doneDeadline) {
    const state = await readGenerationState(page);
    const hasCompletionButton = state.sendVisible || state.regenerateVisible;
    if (state.stopVisible) {
      sawStop = true;
    }

    if (sawStop) {
      if (!state.stopVisible && hasCompletionButton) {
        return;
      }
    } else {
      if (hasCompletionButton && state.assistantCount > previousAssistantCount) {
        return;
      }
      if (Date.now() > stopAppearDeadline && hasCompletionButton) {
        return;
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`等待 ChatGPT 生成完成超时 (${GENERATION_TIMEOUT_MS}ms)`);
}

async function readGenerationState(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    const buttons = Array.from(document.querySelectorAll("button")).filter((el) => el instanceof HTMLButtonElement);
    const hasButton = (regexp, testId) =>
      buttons.some((button) => {
        if (!isVisible(button)) return false;
        const text = [
          button.getAttribute("data-testid") || "",
          button.getAttribute("aria-label") || "",
          button.textContent || ""
        ]
          .join(" ")
          .toLowerCase();
        if (testId && button.getAttribute("data-testid") === testId) {
          return true;
        }
        return regexp.test(text);
      });

    return {
      stopVisible: hasButton(/stop generating|停止生成/, "stop-button"),
      sendVisible: hasButton(/(^|\s)(send|发送)($|\s)/, "send-button"),
      regenerateVisible: hasButton(/regenerate|重新生成|重新回答|再试一次|try again/, "regenerate-button"),
      assistantCount: document.querySelectorAll("[data-message-author-role='assistant']").length
    };
  });
}

async function readLastAssistantReply(page) {
  const assistantBlocks = await page.$$("[data-message-author-role='assistant']");
  if (!assistantBlocks.length) {
    throw new Error("未找到 ChatGPT assistant 回复节点。");
  }

  const last = assistantBlocks[assistantBlocks.length - 1];
  const text = await last.evaluate((node) => {
    const pick = node.querySelector(".markdown, .prose, [class*='markdown'], [class*='prose']") || node;
    const raw = String(pick.innerText || "").trim();
    return raw.replace(/\n*chatgpt can make mistakes[\s\S]*$/i, "").trim();
  });

  const imageHandles = await last.$$("img");
  const images = [];
  const dedup = new Set();
  let imageIndex = 0;

  for (const imageHandle of imageHandles) {
    try {
      const box = await imageHandle.boundingBox();
      if (!box || box.width < MIN_IMAGE_WIDTH || box.height < MIN_IMAGE_HEIGHT) {
        continue;
      }
      const data = await imageHandle.screenshot({
        type: "jpeg",
        quality: 82,
        encoding: "base64"
      });
      if (!data || typeof data !== "string") {
        continue;
      }
      const key = `${data.length}:${data.slice(0, 64)}`;
      if (dedup.has(key)) {
        continue;
      }
      dedup.add(key);
      imageIndex += 1;
      images.push({
        data,
        contentType: "image/jpeg",
        filename: `chatgpt-reply-${Date.now()}-${imageIndex}.jpg`
      });
    } catch (_error) {
      // ignore single image extraction errors
    }
  }

  return {
    text: String(text || "").trim(),
    images
  };
}

async function captureChatAreaScreenshot(page) {
  let restoreState = null;
  try {
    restoreState = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!(main instanceof HTMLElement)) {
        return null;
      }

      const nodes = [main, ...Array.from(main.querySelectorAll("div"))];
      let target = null;
      let maxOverflow = 0;

      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const overflow = node.scrollHeight - node.clientHeight;
        if (overflow > maxOverflow) {
          maxOverflow = overflow;
          target = node;
        }
      }

      if (!(target instanceof HTMLElement)) {
        return null;
      }

      target.setAttribute("data-chatgpt-skill-scroll-target", "1");
      const previous = {
        height: target.style.height || "",
        maxHeight: target.style.maxHeight || "",
        overflow: target.style.overflow || "",
        scrollTop: target.scrollTop
      };

      const desiredHeight = Math.min(Math.max(target.scrollHeight, target.clientHeight), 16000);
      target.style.height = `${desiredHeight}px`;
      target.style.maxHeight = `${desiredHeight}px`;
      target.style.overflow = "visible";
      target.scrollTop = 0;
      main.scrollIntoView({ block: "start" });
      return previous;
    });

    await sleep(120);

    const main = await page.$("main");
    const data = main
      ? await main.screenshot({
          type: "jpeg",
          quality: 72,
          encoding: "base64"
        })
      : await page.screenshot({
          type: "jpeg",
          quality: 72,
          fullPage: true,
          encoding: "base64"
        });

    if (!data || typeof data !== "string") {
      return null;
    }

    return {
      data,
      contentType: "image/jpeg",
      filename: `chatgpt-chat-${Date.now()}.jpg`
    };
  } finally {
    if (restoreState) {
      await page
        .evaluate((previous) => {
          const target = document.querySelector("[data-chatgpt-skill-scroll-target='1']");
          if (!(target instanceof HTMLElement)) {
            return;
          }
          target.style.height = previous.height || "";
          target.style.maxHeight = previous.maxHeight || "";
          target.style.overflow = previous.overflow || "";
          target.scrollTop = typeof previous.scrollTop === "number" ? previous.scrollTop : 0;
          target.removeAttribute("data-chatgpt-skill-scroll-target");
        }, restoreState)
        .catch(() => {});
    }
  }
}

async function waitForAnySelector(page, selectors, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const selector of selectors) {
      const handle = await page.$(selector);
      if (handle) {
        await handle.dispose();
        return selector;
      }
    }
    await sleep(200);
  }
  throw new Error(`Timeout waiting selectors: ${selectors.join(", ")}`);
}

function isScreenshotEnabled() {
  return readBooleanEnv(["CHATGPT_SCREENSHOT", "SCREENSHOT", "screenshot"]);
}

function readBooleanEnv(keys) {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw == null) {
      continue;
    }
    if (/^(1|true|yes|on)$/i.test(raw.trim())) {
      return true;
    }
    if (/^(0|false|no|off)$/i.test(raw.trim())) {
      return false;
    }
  }
  return false;
}

function isRecoverableError(error) {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  return (
    message.includes("target closed") ||
    message.includes("session closed") ||
    message.includes("connection closed") ||
    message.includes("protocol error") ||
    message.includes("browser has disconnected")
  );
}

function resetBrowserState() {
  pagePromise = null;
  browserPromise = null;
}

function toInt(raw, fallbackValue) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackValue;
  }
  return Math.floor(value);
}
