import { test, expect, type Locator } from "@playwright/test";
import {
  allQuotes,
  characters,
  findCharacter,
  longestQuote,
} from "./support/catalog";
import {
  boxOf,
  computedPx,
  interceptRenderedHtml,
  LARGE_QUOTE_CLAMPS,
  LARGE_QUOTE_SIZES,
  LONG_QUOTE_LENGTH,
  OG_SCREEN,
  renderUrl,
  replaceQuote,
  textOverflowsRight,
  viewParts,
  X_SCREEN,
  type Orientation,
} from "./support/preview";

const ALL_VIEWS = ["quadrant", "full", "half_vertical", "half_horizontal"];

/** Distance from the quote's left edge to where its first glyph is drawn. */
function firstTextInset(quote: Locator) {
  return quote.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const firstTextRect = range.getClientRects()[0];
    return firstTextRect
      ? firstTextRect.left - element.getBoundingClientRect().left
      : null;
  });
}

test("renders a selected character's random quote in all views", async ({
  page,
}) => {
  for (const route of ALL_VIEWS.map((view) => `/${view}`)) {
    await test.step(`Testing route: ${route}`, async () => {
      await page.goto(route);
      const { quote, quoteContainer, name, image } = viewParts(
        page.frameLocator("iframe"),
      );
      await expect(quote).toBeVisible({ timeout: 15000 });

      const containerBox = await boxOf(quoteContainer, "Quote container");
      const nameBox = await boxOf(name, "Character name");
      const inset = await firstTextInset(quote);
      const quotePaddingLeft = await computedPx(quote, "paddingLeft");
      expect(quotePaddingLeft).toBeGreaterThan(0);
      expect(inset).not.toBeNull();
      expect(inset!).toBeGreaterThanOrEqual(quotePaddingLeft - 1);
      expect(containerBox.y + containerBox.height).toBeLessThanOrEqual(
        nameBox.y,
      );

      const quoteText = (await quote.innerText())
        .trim()
        .replace(/^“/, "")
        .replace(/(?:\.{3}|…)\s*$/, "")
        .replace(/”$/, "");
      const characterName = (await name.innerText()).trim();
      const character = characters.find(
        (candidate) => candidate.name === characterName,
      );
      if (!character) {
        throw new Error(`Character ${characterName} is missing from the catalog`);
      }
      expect(
        character.quotes.some((candidate) => candidate.startsWith(quoteText)),
        `Rendered quote prefix did not match ${characterName}: ${JSON.stringify(quoteText)}`,
      ).toBe(true);

      await expect(image).toHaveAttribute("src", character.imageUrl);
      await expect(image).toHaveAttribute("alt", characterName);
      await expect(image).toHaveClass(/image--contain/);
      await expect(image).toHaveClass(/image-dither/);
      await expect(image).toHaveCSS("object-fit", "contain");
      await expect(name).toHaveClass(/lg:text--xxlarge/);
      await expect(quoteContainer).toBeVisible();
    });
  }
});

test("long quotes truncate without hiding attribution in quadrant and half views", async ({
  page,
}) => {
  const longest = longestQuote(findCharacter("homer-simpson").quotes);
  const injectedQuote = `${longest} ${longest} ${longest}`;
  await interceptRenderedHtml(page, (html) => replaceQuote(html, injectedQuote));

  const cases: { view: string; orientation: Orientation }[] = [
    { view: "quadrant", orientation: "landscape" },
    { view: "quadrant", orientation: "portrait" },
    { view: "half_vertical", orientation: "landscape" },
    { view: "half_horizontal", orientation: "landscape" },
  ];

  for (const { view: viewName, orientation } of cases) {
    await test.step(`${viewName} ${orientation}`, async () => {
      await page.goto(renderUrl(viewName, OG_SCREEN, orientation), {
        waitUntil: "domcontentloaded",
      });
      const { view, quote, quoteContainer, name, image } = viewParts(page);

      await expect(quote).toBeVisible();
      await expect(quote).toContainText(/(?:\.\.\.|…)\s*$/);
      await expect(name).toBeVisible();
      await expect(image).toHaveCSS("object-fit", "contain");

      const renderedQuote = (await quote.innerText()).replace(/^“|”$/g, "");
      expect(renderedQuote.length).toBeLessThan(injectedQuote.length);

      const viewBox = await boxOf(view, "View");
      const containerBox = await boxOf(quoteContainer, "Quote container");
      const nameBox = await boxOf(name, "Character name");
      expect(containerBox.y + containerBox.height).toBeLessThanOrEqual(
        nameBox.y,
      );
      expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(
        viewBox.y + viewBox.height,
      );
    });
  }
});

test("TRMNL X portrait quadrant shows the full screenshot quote", async ({
  page,
}) => {
  const quote =
    "Oh, I'm in no condition to drive. Wait a minute. I don't have to listen to myself. I'm drunk.";
  await interceptRenderedHtml(
    page,
    (html) => replaceQuote(html, quote),
    "**/render/quadrant.html*",
  );

  await page.goto(renderUrl("quadrant", X_SCREEN, "portrait"), {
    waitUntil: "domcontentloaded",
  });
  const quoteElement = viewParts(page).quote;
  await expect(quoteElement).toBeVisible();
  await expect(quoteElement).toContainText(quote);
  await expect(quoteElement).not.toContainText(/(?:\.\.\.|…)\s*”?$/);
});

/** Longest catalog quote whose length is in (min, max]. */
function longestQuoteBetween(min: number, max: number) {
  return longestQuote(
    allQuotes.filter((quote) => quote.length > min && quote.length <= max),
  );
}

test("TRMNL X quote sizing prevents overflow and attribution overlap across views", async ({
  page,
}) => {
  const quoteCases = [
    {
      label: "reported Ralph quote",
      quote: "I found a moonrock in my nose!",
    },
    {
      label: "long word",
      quote:
        "[Johnny Newspaperseed Museum] If he's so smart, how come he's dead?",
    },
    { label: "short", quote: longestQuoteBetween(0, 30) },
    { label: "medium", quote: longestQuoteBetween(30, 90) },
    { label: "long", quote: longestQuoteBetween(90, 150) },
    { label: "very long", quote: longestQuoteBetween(150, Infinity) },
  ];
  expect(
    findCharacter("ralph-wiggum").quotes,
    "The reported Ralph Wiggum overlap quote is missing from the catalog",
  ).toContain(quoteCases[0].quote);

  let injectedQuote = "";
  let selectedQuoteLength = 0;
  let selectedQuoteSizeClass = "";
  let activeView = "quadrant";

  await interceptRenderedHtml(page, (html) => {
    // Record what the template picked, so its size class can be checked below.
    const selected = html.match(
      /<blockquote\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/blockquote>/,
    );
    if (!selected) {
      throw new Error("Could not find the selected quote in the TRMNL X preview");
    }
    const [, classes, content] = selected;
    selectedQuoteLength = content
      .replace(/^\s*&ldquo;/, "")
      .replace(/&rdquo;\s*$/, "")
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").length;
    selectedQuoteSizeClass =
      classes.match(/\blg:text--(?:xlarge|xxlarge|xxxlarge)\b/)?.[0] ?? "";

    // Swap in the test quote, along with the size class the template would
    // have chosen for it.
    const largeSizes = LARGE_QUOTE_SIZES[activeView];
    const largeSize =
      injectedQuote.length > LONG_QUOTE_LENGTH
        ? largeSizes.long
        : largeSizes.short;
    const largeSizeClass =
      /(<blockquote\b[^>]*class="[^"]*)lg:text--(?:xlarge|xxlarge|xxxlarge)([^"]*")/;
    if (!largeSizeClass.test(html)) {
      throw new Error("Could not set the TRMNL X quote size in the preview");
    }
    return replaceQuote(html, injectedQuote).replace(
      largeSizeClass,
      `$1${largeSize}$2`,
    );
  });

  const cases: { view: string; orientations: Orientation[] }[] = [
    { view: "quadrant", orientations: ["landscape", "portrait"] },
    { view: "full", orientations: ["portrait"] },
    { view: "half_vertical", orientations: ["portrait"] },
  ];

  for (const { view: viewName, orientations } of cases) {
    for (const { label, quote } of quoteCases) {
      for (const orientation of orientations) {
        await test.step(`${label} quote in ${viewName} ${orientation}`, async () => {
          injectedQuote = quote;
          activeView = viewName;
          await page.goto(renderUrl(viewName, X_SCREEN, orientation), {
            waitUntil: "domcontentloaded",
          });

          const expectedSizes = LARGE_QUOTE_SIZES[viewName];
          expect(
            selectedQuoteSizeClass,
            `Unexpected ${viewName} class for source quote of ${selectedQuoteLength} characters`,
          ).toBe(
            selectedQuoteLength > LONG_QUOTE_LENGTH
              ? expectedSizes.long
              : expectedSizes.short,
          );

          const { view, quote: quoteElement, quoteContainer, name, image } =
            viewParts(page);
          await expect(quoteElement).toBeVisible();
          await expect(name).toBeVisible();
          await expect(quoteElement).toHaveAttribute(
            "data-clamp-cached",
            "true",
            { timeout: 15000 },
          );
          const quoteBox = await boxOf(quoteElement, "Quote");
          const containerBox = await boxOf(quoteContainer, "Quote container");
          const nameBox = await boxOf(name, "Character name");
          const viewBox = await boxOf(view, "View");
          const quoteFontSize = await computedPx(quoteElement, "fontSize");

          await expect(quoteElement).toHaveAttribute(
            "data-clamp-lg-portrait",
            LARGE_QUOTE_CLAMPS[viewName].portrait,
          );
          await expect(quoteElement).toHaveAttribute(
            "data-clamp-lg",
            LARGE_QUOTE_CLAMPS[viewName].landscape,
          );
          if (viewName === "quadrant" && orientation === "landscape") {
            expect(await computedPx(name, "marginTop")).toBeGreaterThan(0);
            await expect(image).toHaveCSS("object-position", "50% 100%");
          }

          if (orientation === "landscape") {
            expect(
              quoteBox.y + quoteBox.height,
              `The ${label} TRMNL X landscape quote overlaps the attribution: ${JSON.stringify(
                {
                  quoteBox,
                  containerBox,
                  nameBox,
                  classes: await quoteElement.getAttribute("class"),
                },
              )}`,
            ).toBeLessThanOrEqual(nameBox.y);
            expect(quoteBox.y + quoteBox.height).toBeLessThanOrEqual(
              containerBox.y + containerBox.height,
            );
          } else {
            expect(containerBox.y + containerBox.height).toBeLessThanOrEqual(
              nameBox.y,
            );
          }
          expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(
            viewBox.y + viewBox.height,
          );

          if (orientation === "portrait" && viewName === "quadrant") {
            expect(quoteFontSize).toBeGreaterThan(20);
            expect(quoteFontSize).toBeLessThanOrEqual(40);
          } else if (orientation === "portrait") {
            expect(quoteFontSize).toBeGreaterThan(20);
            expect(quoteFontSize).toBeLessThan(50);
          } else if (quote.length > LONG_QUOTE_LENGTH) {
            expect(quoteFontSize).toBeGreaterThan(20);
            expect(quoteFontSize).toBeLessThan(38);
          } else {
            expect(quoteFontSize).toBeGreaterThanOrEqual(38);
          }

          if (label === "long word") {
            expect(await textOverflowsRight(quoteElement)).toBe(false);
          }
        });
      }
    }
  }
});
