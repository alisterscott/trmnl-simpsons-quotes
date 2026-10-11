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
  const sourceFile = path.join(__dirname, "example.trmnlp.yml");
  const destFile = path.join(__dirname, "..", ".trmnlp.yml");

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Source file not found: ${sourceFile}`);
  }

  if (!fs.existsSync(destFile)) {
    throw new Error(`Destination file not found: ${destFile}`);
  }

  const originalContent = fs.readFileSync(destFile, "utf-8"); // Save original content to restore later

  fs.copyFileSync(sourceFile, destFile);

  try {
    const testConfig = fs
      .readFileSync(destFile, "utf-8")
      .replace("custom_fields: {}", "custom_fields:\n  character_ids: homer-simpson");
    fs.writeFileSync(destFile, testConfig, "utf-8");
    const routes = ["/quadrant", "/full", "/half_vertical", "/half_horizontal"];

    for (const route of routes) {
      await test.step(`Testing route: ${route}`, async () => {
        await page.goto(route);
        const trmnlFrame = page.frameLocator("iframe");
        const view = trmnlFrame.locator("div.view");
        const quote = view.locator("blockquote");
        await expect(quote).toBeVisible();
        const quoteText = (await quote.innerText())
          .trim()
          .replace(/^“/, "")
          .replace(/(?:\.{3}|…)\s*$/, "")
          .replace(/”$/, "");
        if (!homer) {
          throw new Error("Homer Simpson is missing from the character catalog");
        }
        expect(
          homer.quotes.some((candidate) => candidate.startsWith(quoteText)),
          `Rendered quote prefix did not match Homer catalog: ${JSON.stringify(quoteText)}`,
        ).toBe(true);
        await expect(view).toContainText("Homer Simpson");
        await expect(view.locator("img")).toHaveAttribute(
          "src",
          "https://upload.wikimedia.org/wikipedia/en/0/02/Homer_Simpson_2006.png?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=original",
        );
        await expect(view.locator("img")).toHaveAttribute("alt", "Homer Simpson");
        await expect(view.locator("img")).toHaveClass(/image--contain/);
        await expect(view.locator("img")).toHaveClass(/image-dither/);
        await expect(view.locator('[data-content-limiter="true"]')).toBeVisible();
      });
    }
  } finally {
    fs.writeFileSync(destFile, originalContent, "utf-8"); // Restore original content
  }
});
