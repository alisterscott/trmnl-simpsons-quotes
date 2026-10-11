import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

test("renders the shared quote layout in all views", async ({ page }) => {
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
    const routes = ["/quadrant", "/full", "/half_vertical", "/half_horizontal"];

    for (const route of routes) {
      await test.step(`Testing route: ${route}`, async () => {
        await page.goto(route);
        const trmnlFrame = page.frameLocator("iframe");
        const view = trmnlFrame.locator("div.view");
        await expect(view).toContainText("A sample quote is shown here.");
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
