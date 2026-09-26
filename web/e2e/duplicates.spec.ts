import { expect, test } from "@playwright/test";
import {
  hasE2EUser,
  openReport,
  signInFromHeader,
  stepOne,
  stepTwo,
} from "./helpers";

// A report by a fake neighbor at the mocked GPS spot (scripts/seed-e2e.py).
const neighborId = process.env.E2E_NEIGHBOR_REPORT_ID ?? "e2e-neighbor-pothole";
const fakeAi = process.env.E2E_AI === "fake";

test.describe("duplicates and +1", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");
  test.use({
    geolocation: { latitude: 29.9277, longitude: -90.0741 },
    permissions: ["geolocation"],
  });

  test("a nearby report offers +1 instead of a duplicate", async ({
    page,
  }, testInfo) => {
    // The Jev "same issue?" check is deterministic only with fake AI; one +1 per user,
    // so run it once.
    test.skip(
      !fakeAi || testInfo.project.name !== "desktop",
      "fake AI, desktop only",
    );
    await page.goto("/");
    await signInFromHeader(page);
    await openReport(page);
    await stepOne(page, "Roads and Streets", "Pothole");
    await stepTwo(page);
    const form = page.getByRole("form", { name: "Describe the request" });
    await form.getByRole("button", { name: /Use my current location/ }).click();

    // The neighbor's report (not any of this user's own earlier ones).
    const match = page
      .getByTestId("duplicate-match")
      .filter({ hasText: "Likely already reported" });
    await expect(match).toContainText(
      "Likely already reported 0 m away: Pothole",
      {
        timeout: 20_000,
      },
    );
    await page.getByTestId("duplicates").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `screenshots/duplicates-${testInfo.project.name}.png`,
    });
    await match.getByRole("button", { name: "+1 instead" }).click();

    await expect(page.getByTestId("report-supported")).toBeVisible();
    await page.getByRole("link", { name: "View the report" }).click();
    await expect(page.getByTestId("supported")).toHaveText(
      "✓ You added your +1",
    );
    await expect(page.getByTestId("supporter-count")).toHaveText(
      "1 neighbor +1",
    );
  });

  test("I see this too (+1) on a neighbor's report", async ({ page }) => {
    await page.goto("/");
    await signInFromHeader(page);
    await page.goto(`/reports/view/?id=${neighborId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pothole");
    const already = page.getByTestId("supported");
    if (!(await already.isVisible())) {
      await page.getByRole("button", { name: "I see this too (+1)" }).click();
    }
    await expect(already).toHaveText("✓ You added your +1");
    await expect(page.getByTestId("supporter-count")).toHaveText(
      /[1-9]\d* neighbors? \+1/,
    );
    // No contact info or photos from someone else's report.
    await expect(page.getByText("Your contact info")).toHaveCount(0);
  });
});
