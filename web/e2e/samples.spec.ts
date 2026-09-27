import { expect, test } from "@playwright/test";
import { hasE2EUser, signInFromHeader } from "./helpers";

// Sample reports come from scripts/seed-demo.py (run on every deploy).

test("sample reports are labeled on the public map", async ({ page }) => {
  await page.goto("/");
  const pin = page.getByRole("button", { name: /\(sample\)$/ }).first();
  await expect(pin).toBeVisible({ timeout: 15_000 });
});

test.describe("sample report details", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");

  test("say they are samples and follow the real City request", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await signInFromHeader(page);
    await page.goto("/reports/view/?id=sample01");
    await expect(
      page.getByRole("heading", { level: 1, name: "Catch Basin Not Draining" }),
    ).toBeVisible();
    await expect(page.getByTestId("sample-badge")).toBeVisible();
    await expect(page.getByTestId("sample-note")).toContainText(
      "status follows the City's",
    );
    await expect(
      page.getByText(/NOLA 311 closed request #2026-1316662/),
    ).toBeVisible();
    // Residents are never asked to +1 demo data.
    await expect(
      page.getByRole("button", { name: /I see this too/ }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `screenshots/sample-detail-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
});
