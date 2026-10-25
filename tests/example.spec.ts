import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

type Character = {
  id: string;
  name: string;
  imageUrl: string;
  quotes: string[];
};

const characters = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "src", "characters.json"),
    "utf-8",
  ),
) as Character[];
const homer = characters.find((character) => character.id === "homer-simpson");

test("renders a selected character's random quote in all views", async ({
  page,
}) => {
  const routes = ["/quadrant", "/full", "/half_vertical", "/half_horizontal"];

  for (const route of routes) {
    await test.step(`Testing route: ${route}`, async () => {
      await page.goto(route);
      const trmnlFrame = page.frameLocator("iframe");
      const view = trmnlFrame.locator("div.view");
      const quote = view.locator("blockquote");
      await expect(quote).toBeVisible();
      const quoteContainer = view.locator('[data-content-limiter="true"]');
      const quoteTextBox = await quote.boundingBox();
      const quoteContainerBox = await quoteContainer.boundingBox();
      const name = view.getByTestId("character-name");
      const nameBox = await name.boundingBox();
      const firstTextInset = await quote.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const firstTextRect = range.getClientRects()[0];
        return firstTextRect
          ? firstTextRect.left - element.getBoundingClientRect().left
          : null;
      });
      const quotePaddingLeft = await quote.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingLeft),
      );
      expect(quoteTextBox).not.toBeNull();
      expect(quoteContainerBox).not.toBeNull();
      expect(nameBox).not.toBeNull();
      expect(firstTextInset).not.toBeNull();
      if (
        !quoteTextBox ||
        !quoteContainerBox ||
        !nameBox ||
        firstTextInset === null
      ) {
        throw new Error("Quote or character name has no layout box");
      }
      expect(quotePaddingLeft).toBeGreaterThan(0);
      expect(firstTextInset).toBeGreaterThanOrEqual(quotePaddingLeft - 1);
      expect(
        quoteContainerBox.y + quoteContainerBox.height,
      ).toBeLessThanOrEqual(nameBox.y);

      const quoteText = (await quote.innerText())
        .trim()
        .replace(/^“/, "")
        .replace(/(?:\.{3}|…)\s*$/, "")
        .replace(/”$/, "");
      const characterName = (await name.innerText()).trim();
      const character = characters.find(
        (candidate) => candidate.name === characterName,
      );
      expect(
        character,
        `Character ${characterName} is missing from the catalog`,
      ).toBeDefined();
      if (!character) {
        throw new Error(
          `Character ${characterName} is missing from the catalog`,
        );
      }
      expect(
        character.quotes.some((candidate) => candidate.startsWith(quoteText)),
        `Rendered quote prefix did not match ${characterName}: ${JSON.stringify(quoteText)}`,
      ).toBe(true);
      await expect(view.locator("img")).toHaveAttribute(
        "src",
        character.imageUrl,
      );
      await expect(view.locator("img")).toHaveAttribute("alt", characterName);
      await expect(view.locator("img")).toHaveClass(/image--contain/);
      await expect(view.locator("img")).toHaveClass(/image-dither/);
      await expect(view.locator("img")).toHaveCSS("object-fit", "contain");
      await expect(name).toHaveClass(/lg:text--xxlarge/);
      await expect(quoteContainer).toBeVisible();
    });
  }
});

test("long quotes truncate without hiding attribution in quadrant and half views", async ({
  page,
}) => {
  if (!homer) {
    throw new Error("Homer Simpson is missing from the character catalog");
  }

  const longestQuote = homer.quotes.reduce((longest, quote) =>
    quote.length > longest.length ? quote : longest,
  );
  const injectedQuote = `${longestQuote} ${longestQuote} ${longestQuote}`;
  const escapedQuote = injectedQuote
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  await page.route("**/render/*.html*", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const longQuoteHtml = html.replace(
      /(<blockquote\b[^>]*>)[\s\S]*?(<\/blockquote>)/,
      `$1&ldquo;${escapedQuote}&rdquo;$2`,
    );

    if (html === longQuoteHtml) {
      throw new Error("Could not inject the long quote into the preview");
    }

    await route.fulfill({ response, body: longQuoteHtml });
  });

  const cases = [
    { view: "quadrant", orientation: "landscape" },
    { view: "quadrant", orientation: "portrait" },
    { view: "half_vertical", orientation: "landscape" },
    { view: "half_horizontal", orientation: "landscape" },
  ];

  for (const { view: viewName, orientation } of cases) {
    await test.step(`${viewName} ${orientation}`, async () => {
      const portraitClass =
        orientation === "portrait" ? "%20screen--portrait" : "";
      await page.goto(
        `/render/${viewName}.html?screen_classes=screen%20screen--1bit%20screen--ogv2%20screen--md${portraitClass}%20screen--1x`,
        { waitUntil: "domcontentloaded" },
      );

      const view = page.locator("div.view");
      const quote = view.locator("blockquote");
      const quoteContainer = view.locator('[data-content-limiter="true"]');
      const name = view.getByTestId("character-name");
      const image = view.locator("img");

      await expect(quote).toBeVisible();
      await expect(quote).toContainText(/(?:\.\.\.|…)\s*$/);
      await expect(name).toBeVisible();
      await expect(image).toHaveCSS("object-fit", "contain");

      const renderedQuote = (await quote.innerText()).replace(/^“|”$/g, "");
      expect(renderedQuote.length).toBeLessThan(injectedQuote.length);

      const viewBox = await view.boundingBox();
      const containerBox = await quoteContainer.boundingBox();
      const nameBox = await name.boundingBox();
      expect(viewBox).not.toBeNull();
      expect(containerBox).not.toBeNull();
      expect(nameBox).not.toBeNull();
      if (!viewBox || !containerBox || !nameBox) {
        throw new Error("Quote, character name, or view has no layout box");
      }

      expect(containerBox.y + containerBox.height).toBeLessThanOrEqual(
        nameBox.y,
      );
      expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(
        viewBox.y + viewBox.height,
      );
    });
  }
});

test("TRMNL X quote sizing prevents overflow and attribution overlap across views", async ({
  page,
}) => {
  const allQuotes = characters.flatMap((character) => character.quotes);
  const reportedOverlapQuote = characters
    .find((character) => character.id === "ralph-wiggum")
    ?.quotes.find((quote) => quote === "I found a moonrock in my nose!");
  if (!reportedOverlapQuote) {
    throw new Error(
      "The reported Ralph Wiggum overlap quote is missing from the catalog",
    );
  }
  const quoteCases = [
    { label: "reported Ralph quote", quote: reportedOverlapQuote },
    {
      label: "long word",
      quote:
        "[Johnny Newspaperseed Museum] If he's so smart, how come he's dead?",
    },
    {
      label: "short",
      quote: allQuotes
        .filter((quote) => quote.length <= 30)
        .reduce((longest, quote) =>
          quote.length > longest.length ? quote : longest,
        ),
    },
    {
      label: "medium",
      quote: allQuotes
        .filter((quote) => quote.length > 30 && quote.length <= 90)
        .reduce((longest, quote) =>
          quote.length > longest.length ? quote : longest,
        ),
    },
    {
      label: "long",
      quote: allQuotes
        .filter((quote) => quote.length > 90 && quote.length <= 150)
        .reduce((longest, quote) =>
          quote.length > longest.length ? quote : longest,
        ),
    },
    {
      label: "very long",
      quote: allQuotes
        .filter((quote) => quote.length > 150)
        .reduce((longest, quote) =>
          quote.length > longest.length ? quote : longest,
        ),
    },
  ];
  let injectedQuote = "";
  let selectedQuoteLength = 0;
  let selectedQuoteClass = "";

  await page.route("**/render/*.html*", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const selectedQuoteMatch = html.match(
      /<blockquote\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/blockquote>/,
    );
    if (!selectedQuoteMatch) {
      throw new Error(
        "Could not find the selected quote in the TRMNL X preview",
      );
    }
    const selectedQuoteSource = selectedQuoteMatch[2]
      .replace(/^\s*&ldquo;/, "")
      .replace(/&rdquo;\s*$/, "")
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    selectedQuoteLength = selectedQuoteSource.length;
    selectedQuoteClass =
      selectedQuoteMatch[1].match(
        /\blg:text--(?:xlarge|xxlarge|xxxlarge)\b/,
      )?.[0] ?? "";
    const escapedQuote = injectedQuote
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    const contentReplacedHtml = html.replace(
      /(<blockquote\b[^>]*>)[\s\S]*?(<\/blockquote>)/,
      `$1&ldquo;${escapedQuote}&rdquo;$2`,
    );
    const largeQuoteClass =
      injectedQuote.length > 55 ? "lg:text--xlarge" : "lg:text--xxlarge";
    if (
      !/(<blockquote\b[^>]*class="[^"]*)lg:text--(?:xlarge|xxlarge|xxxlarge)([^"]*")/.test(
        contentReplacedHtml,
      )
    ) {
      throw new Error("Could not set the TRMNL X quote size in the preview");
    }
    const quoteHtml = contentReplacedHtml.replace(
      /(<blockquote\b[^>]*class="[^"]*)lg:text--(?:xlarge|xxlarge|xxxlarge)([^"]*")/,
      `$1${largeQuoteClass}$2`,
    );

    if (html === contentReplacedHtml) {
      throw new Error("Could not inject the TRMNL X quote into the preview");
    }

    await route.fulfill({ response, body: quoteHtml });
  });

  const cases = [
    { view: "quadrant", orientations: ["landscape", "portrait"] },
    { view: "full", orientations: ["portrait"] },
    { view: "half_vertical", orientations: ["portrait"] },
  ] as const;

  for (const { view: viewName, orientations } of cases) {
    for (const { label, quote } of quoteCases) {
      for (const orientation of orientations) {
        await test.step(`${label} quote in ${viewName} ${orientation}`, async () => {
          injectedQuote = quote;
          const portraitClass =
            orientation === "portrait" ? "%20screen--portrait" : "";
          await page.goto(
            `/render/${viewName}.html?screen_classes=screen%20screen--v2%20screen--lg%20screen--density-2x%20screen--4bit${portraitClass}`,
            { waitUntil: "domcontentloaded" },
          );

          expect(
            selectedQuoteClass,
            `Unexpected class for source quote of ${selectedQuoteLength} characters`,
          ).toBe(
            selectedQuoteLength > 55 ? "lg:text--xlarge" : "lg:text--xxlarge",
          );

          const view = page.locator("div.view");
          const quoteElement = view.locator("blockquote");
          const quoteContainer = view.locator('[data-content-limiter="true"]');
          const name = view.getByTestId("character-name");
          await expect(quoteElement).toBeVisible();
          await expect(name).toBeVisible();
          await expect(quoteElement).toHaveAttribute("data-clamp-cached", "true");
          const quoteBox = await quoteElement.boundingBox();
          const containerBox = await quoteContainer.boundingBox();
          const nameBox = await name.boundingBox();
          const viewBox = await view.boundingBox();
          const quoteFontSize = await quoteElement.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          );

          expect(quoteBox).not.toBeNull();
          expect(containerBox).not.toBeNull();
          expect(nameBox).not.toBeNull();
          expect(viewBox).not.toBeNull();
          if (!quoteBox || !containerBox || !nameBox || !viewBox) {
            throw new Error("TRMNL X quote or attribution has no layout box");
          }
          await expect(quoteElement).toHaveAttribute(
            "data-clamp-lg-portrait",
            "3",
          );

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
            expect(quoteFontSize).toBeGreaterThan(40);
          } else if (orientation === "portrait") {
            expect(quoteFontSize).toBeGreaterThan(20);
            expect(quoteFontSize).toBeLessThan(50);
          } else if (quote.length > 55) {
            expect(quoteFontSize).toBeGreaterThan(20);
            expect(quoteFontSize).toBeLessThan(38);
          } else {
            expect(quoteFontSize).toBeGreaterThanOrEqual(38);
          }

          if (label === "long word") {
            const textOverflows = await quoteElement.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return [...range.getClientRects()].some(
                (rect) =>
                  rect.right > element.getBoundingClientRect().right + 1,
              );
            });
            expect(textOverflows).toBe(false);
          }
        });
      }
    }
  }
});
