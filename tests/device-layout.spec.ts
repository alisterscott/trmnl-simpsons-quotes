import { test, expect } from "@playwright/test";
import {
  boxOf,
  computedPx,
  DEVICE_SCREENS,
  renderUrl,
  viewParts,
  type Orientation,
} from "./support/preview";

const VIEWS = ["full", "half_horizontal", "half_vertical", "quadrant"];
const ORIENTATIONS: Orientation[] = ["landscape", "portrait"];

// The framework's `flex--stretch` once forced the two columns to equal size,
// silently overriding the template's width/height classes. These tests run at
// real device sizes and check the split that actually renders.
test("quote and artwork columns split as designed and stay inside the view on real device screens", async ({
  page,
}) => {
  for (const [deviceName, device] of Object.entries(DEVICE_SCREENS)) {
    for (const orientation of ORIENTATIONS) {
      for (const view of VIEWS) {
        await test.step(`${deviceName} ${orientation} ${view}`, async () => {
          const { width, height } = device.viewport;
          await page.setViewportSize(
            orientation === "portrait"
              ? { width: height, height: width }
              : { width, height },
          );
          await page.goto(renderUrl(view, device.classes, orientation), {
            waitUntil: "domcontentloaded",
          });
          const { quote } = viewParts(page);
          await expect(quote).toBeVisible();
          await expect(quote).toHaveAttribute("data-clamp-cached", "true", {
            timeout: 15000,
          });

          const layoutBox = await boxOf(page.locator(".layout"), "Layout");
          const textBox = await boxOf(page.locator("section"), "Text column");
          const artBox = await boxOf(page.locator(".character-art"), "Artwork");

          // The view clips anything outside the layout. A row wider than the
          // layout (the columns plus a gap) once cut off the right edge of the
          // artwork and the left edge of the quote in the full view.
          for (const [part, box] of [
            ["Text column", textBox],
            ["Artwork", artBox],
          ] as const) {
            expect(box.x, `${part} left edge`).toBeGreaterThanOrEqual(
              layoutBox.x - 0.5,
            );
            expect(box.x + box.width, `${part} right edge`).toBeLessThanOrEqual(
              layoutBox.x + layoutBox.width + 0.5,
            );
            expect(box.y, `${part} top edge`).toBeGreaterThanOrEqual(
              layoutBox.y - 0.5,
            );
            expect(box.y + box.height, `${part} bottom edge`).toBeLessThanOrEqual(
              layoutBox.y + layoutBox.height + 0.5,
            );
          }

          if (orientation === "landscape") {
            // 80/20, or 75/25 on large screens, of the width
            const expected = deviceName === "TRMNL X" ? 0.75 : 0.8;
            expect(textBox.width / (textBox.width + artBox.width)).toBeCloseTo(
              expected,
              1,
            );
          } else {
            // 65/35 of the height
            expect(
              textBox.height / (textBox.height + artBox.height),
            ).toBeCloseTo(0.65, 1);
          }
        });
      }
    }
  }
});

test("attribution lines up with the quote and is never larger than it", async ({
  page,
}) => {
  for (const [deviceName, device] of Object.entries(DEVICE_SCREENS)) {
    for (const orientation of ORIENTATIONS) {
      for (const view of VIEWS) {
        await test.step(`${deviceName} ${orientation} ${view}`, async () => {
          const { width, height } = device.viewport;
          await page.setViewportSize(
            orientation === "portrait"
              ? { width: height, height: width }
              : { width, height },
          );
          await page.goto(renderUrl(view, device.classes, orientation), {
            waitUntil: "domcontentloaded",
          });
          const { quote, name } = viewParts(page);
          await expect(quote).toHaveAttribute("data-clamp-cached", "true", {
            timeout: 15000,
          });

          const quoteBox = await boxOf(quote, "Quote");
          const nameBox = await boxOf(name, "Character name");
          expect(Math.abs(nameBox.x - quoteBox.x)).toBeLessThanOrEqual(1.5);
          expect(await computedPx(name, "fontSize")).toBeLessThanOrEqual(
            await computedPx(quote, "fontSize"),
          );
        });
      }
    }
  }
});
