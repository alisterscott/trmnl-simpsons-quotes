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
  fs.readFileSync(path.join(__dirname, "..", "src", "characters.json"), "utf-8"),
) as Character[];
const homer = characters.find((character) => character.id === "homer-simpson");

test("renders a selected character's random quote in all views", async ({ page }) => {
  const routes = ["/quadrant", "/full", "/half_vertical", "/half_horizontal"];

  for (const route of routes) {
    await test.step(`Testing route: ${route}`, async () => {
      await page.goto(route);
      const trmnlFrame = page.frameLocator("iframe");
      const view = trmnlFrame.locator("div.view");
      const quote = view.locator("blockquote");
      await expect(quote).toBeVisible();
      const quoteContainer = view.locator('[data-content-limiter="true"]');
      const quoteBox = await quoteContainer.boundingBox();
      const name = view.getByTestId("character-name");
      const nameBox = await name.boundingBox();
      expect(quoteBox).not.toBeNull();
      expect(nameBox).not.toBeNull();
      if (!quoteBox || !nameBox) {
        throw new Error("Quote or character name has no layout box");
      }
      expect(quoteBox.y + quoteBox.height).toBeLessThanOrEqual(nameBox.y);

      const quoteText = (await quote.innerText())
        .trim()
        .replace(/^“/, "")
        .replace(/(?:\.{3}|…)\s*$/, "")
        .replace(/”$/, "");
      const characterName = (await name.innerText()).trim();
      const character = characters.find((candidate) => candidate.name === characterName);
      expect(character, `Character ${characterName} is missing from the catalog`).toBeDefined();
      if (!character) {
        throw new Error(`Character ${characterName} is missing from the catalog`);
      }
      expect(
        character.quotes.some((candidate) => candidate.startsWith(quoteText)),
        `Rendered quote prefix did not match ${characterName}: ${JSON.stringify(quoteText)}`,
      ).toBe(true);
      await expect(view.locator("img")).toHaveAttribute("src", character.imageUrl);
      await expect(view.locator("img")).toHaveAttribute("alt", characterName);
      await expect(view.locator("img")).toHaveClass(/image--contain/);
      await expect(view.locator("img")).toHaveClass(/image-dither/);
      await expect(quoteContainer).toBeVisible();
    });
  }
});

test("portrait quadrant truncates long quotes to fit above the character name", async ({ page }) => {
  if (!homer) {
    throw new Error("Homer Simpson is missing from the character catalog");
  }

  const longestQuote = homer.quotes.reduce((longest, quote) =>
    quote.length > longest.length ? quote : longest,
  );
  const escapedQuote = longestQuote
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  await page.route("**/render/quadrant.html*", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const longQuoteHtml = html.replace(
      /(<blockquote\b[^>]*>)[\s\S]*?(<\/blockquote>)/,
      `$1&ldquo;${escapedQuote}&rdquo;$2`,
    );

    if (html === longQuoteHtml) {
      throw new Error("Could not inject the long quote into the quadrant preview");
    }

    await route.fulfill({ response, body: longQuoteHtml });
  });

  await page.goto(
    "/render/quadrant.html?screen_classes=screen%20screen--1bit%20screen--ogv2%20screen--md%20screen--portrait%20screen--1x",
    { waitUntil: "domcontentloaded" },
  );

  const view = page.locator("div.view");
  const quote = view.locator("blockquote");
  const quoteContainer = view.locator('[data-content-limiter="true"]');
  const name = view.getByTestId("character-name");

  await expect(quote).toBeVisible();
  await expect(quote).toContainText(/(?:\.\.\.|…)\s*$/);

  const renderedQuote = (await quote.innerText()).replace(/^“|”$/g, "");
  expect(renderedQuote.length).toBeLessThan(longestQuote.length);

  const quoteBox = await quote.boundingBox();
  const containerBox = await quoteContainer.boundingBox();
  const nameBox = await name.boundingBox();
  expect(quoteBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  expect(nameBox).not.toBeNull();
  if (!quoteBox || !containerBox || !nameBox) {
    throw new Error("Quote or character name has no layout box");
  }

  expect(quoteBox.height).toBeLessThanOrEqual(containerBox.height);
  expect(containerBox.y + containerBox.height).toBeLessThanOrEqual(nameBox.y);
});
