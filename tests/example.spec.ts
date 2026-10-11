import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

test("can see all the views", async ({ page }) => {
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
        await expect
          .soft(trmnlFrame.locator("div.view"))
          .toContainText(route.replace("/", "").replace("_", " "));
      });
    }
  } finally {
    fs.writeFileSync(destFile, originalContent, "utf-8"); // Restore original content
  }
});
