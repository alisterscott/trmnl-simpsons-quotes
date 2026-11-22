import type { FrameLocator, Locator, Page } from "@playwright/test";

/** Quotes longer than this use the smaller "long" text sizes (see src/shared.liquid). */
export const LONG_QUOTE_LENGTH = 55;

/** Large-screen quote size classes per view: [short quote, long quote]. */
export const LARGE_QUOTE_SIZES: Record<
  string,
  { short: string; long: string }
> = {
  quadrant: { short: "lg:text--xxlarge", long: "lg:text--xlarge" },
  full: { short: "lg:text--xxxlarge", long: "lg:text--xxlarge" },
  half_vertical: { short: "lg:text--xxlarge", long: "lg:text--xlarge" },
  half_horizontal: { short: "lg:text--xxlarge", long: "lg:text--xlarge" },
};

/** Max quote lines on large screens per view (see the view files in src/). */
export const LARGE_QUOTE_CLAMPS: Record<
  string,
  { landscape: string; portrait: string }
> = {
  quadrant: { landscape: "9", portrait: "8" },
  full: { landscape: "11", portrait: "17" },
  half_vertical: { landscape: "17", portrait: "17" },
  half_horizontal: { landscape: "8", portrait: "8" },
};

const BLOCKQUOTE_CONTENT = /(<blockquote\b[^>]*>)[\s\S]*?(<\/blockquote>)/;

/** Preview screen classes for the TRMNL OG (1-bit) display. */
export const OG_SCREEN = "screen screen--1bit screen--ogv2 screen--md screen--1x";
/** Preview screen classes for the TRMNL X (large, 4-bit) display. */
export const X_SCREEN = "screen screen--v2 screen--lg screen--density-2x screen--4bit";

/**
 * Real device screens as the preview's picker renders them: CSS pixel size
 * (device pixels / scale factor, landscape) and screen classes.
 */
export const DEVICE_SCREENS = {
  "TRMNL OG": {
    viewport: { width: 800, height: 480 },
    classes: OG_SCREEN,
  },
  "TRMNL X": {
    viewport: { width: 1040, height: 780 },
    classes: "screen screen--4bit screen--v2 screen--lg screen--1x",
  },
};

export type Orientation = "landscape" | "portrait";

/** URL of a single rendered view, e.g. /render/quadrant.html?screen_classes=... */
export function renderUrl(
  view: string,
  screenClasses: string,
  orientation: Orientation = "landscape",
): string {
  const classes =
    orientation === "portrait"
      ? `${screenClasses} screen--portrait`
      : screenClasses;
  return `/render/${view}.html?screen_classes=${encodeURIComponent(classes)}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replaces the text inside the first <blockquote>, throwing if there is none.
 * The result may equal the input when the preview happened to pick the same
 * quote, so check for the element rather than for a change.
 */
export function replaceQuote(html: string, quote: string): string {
  if (!BLOCKQUOTE_CONTENT.test(html)) {
    throw new Error("Could not find a quote to replace in the preview");
  }
  return html.replace(
    BLOCKQUOTE_CONTENT,
    (_match, open: string, close: string) =>
      `${open}&ldquo;${escapeHtml(quote)}&rdquo;${close}`,
  );
}

/** Intercepts rendered view HTML so a test can control the displayed quote. */
export async function interceptRenderedHtml(
  page: Page,
  transform: (html: string) => string,
  urlPattern = "**/render/*.html*",
) {
  await page.route(urlPattern, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: transform(await response.text()) });
  });
}

export async function boxOf(locator: Locator, description: string) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`${description} has no layout box`);
  }
  return box;
}

export async function computedPx(
  locator: Locator,
  property: "fontSize" | "marginTop" | "paddingLeft",
): Promise<number> {
  return locator.evaluate(
    (element, prop) => Number.parseFloat(getComputedStyle(element)[prop]),
    property,
  );
}

/** True when any line of the element's text extends past its right edge. */
export function textOverflowsRight(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const right = element.getBoundingClientRect().right;
    return [...range.getClientRects()].some((rect) => rect.right > right + 1);
  });
}

/** The elements every view renders, found within a page or iframe. */
export function viewParts(root: Page | FrameLocator) {
  const view = root.locator("div.view");
  return {
    view,
    quote: view.locator("blockquote"),
    quoteContainer: view.locator('[data-content-limiter="true"]'),
    name: view.getByTestId("character-name"),
    image: view.locator("img"),
  };
}
