import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  hasE2EUser,
  openReport,
  signInFromHeader,
  stepTwo,
  submitReport,
} from "./helpers";

const PHOTO = path.join(__dirname, "fixtures", "pothole-gps.jpg");
// Locally the API runs deterministic fake AI; against prod the model's answers vary.
const fakeAi = process.env.E2E_AI === "fake";

test.describe("AI photo triage", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");
  test.setTimeout(90_000);

  test("step 1: a photo suggests the category", async ({ page }, testInfo) => {
    await page.goto("/");
    await signInFromHeader(page);
    const dialog = await openReport(page);
    await dialog.getByTestId("type-photo-input").setInputFiles(PHOTO);

    const shortcut = dialog.getByTestId("photo-shortcut");
    // Final state: suggestions, "no problem found", or "couldn't analyze".
    await expect(
      shortcut.getByText(/looks like:|don't see a street|couldn't analyze/),
    ).toBeVisible({ timeout: 60_000 });
    await page.screenshot({
      path: `screenshots/triage-step1-${testInfo.project.name}.png`,
    });

    if (fakeAi) {
      await shortcut
        .getByRole("button", { name: /Catch Basin Clogged · 91%/ })
        .click();
      await expect(
        dialog.getByRole("radio", { name: "Catch Basin Clogged" }),
      ).toBeChecked();
      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect(
        page.getByRole("form", { name: "Contact info" }),
      ).toBeVisible();
    }
  });

  test("step 3: insights, switching reason and suggested description", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await signInFromHeader(page);
    const dialog = await openReport(page);
    // Deliberately pick a reason the (fake) photo analysis disagrees with.
    await dialog.getByText("Roads and Streets", { exact: true }).click();
    await dialog.getByText("Pothole", { exact: true }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await stepTwo(page);

    await page.getByTestId("photo-input").setInputFiles(PHOTO);
    const insights = page.getByTestId("insights");
    await expect(insights).toBeVisible();
    await expect(
      insights.getByText(/Severity:|couldn't analyze|don't see a street/),
    ).toBeVisible({ timeout: 60_000 });
    await insights.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `screenshots/triage-step3-${testInfo.project.name}.png`,
    });

    if (fakeAi) {
      const mismatch = insights.getByTestId("insight-mismatch");
      await expect(mismatch).toContainText("Catch Basin Clogged (91%)");
      await mismatch.getByRole("button", { name: "Switch" }).click();
      await expect(insights.getByTestId("insight-match")).toContainText(
        "Catch Basin Clogged",
      );
      await expect(insights.getByTestId("insight-severity")).toContainText(
        "Serious",
      );

      await insights
        .getByRole("button", { name: "Use this description" })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Description" }),
      ).toContainText("clogged with leaves");
      await submitReport(page);
      await expect(page.getByTestId("report-submitted")).toContainText(
        "Catch Basin Clogged (Drainage)",
      );
    }
  });
});
