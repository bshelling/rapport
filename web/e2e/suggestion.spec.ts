import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { fileReport, hasE2EUser, signInFromHeader } from "./helpers";

// Local only: the suggestion comes from the nightly import, so we plant one in MiniStack.
const local =
  !process.env.BASE_URL || process.env.BASE_URL.includes("localhost");

test.describe("suggested NOLA 311 request", () => {
  test.skip(!hasE2EUser || !local, "local MiniStack only");
  test.use({
    geolocation: { latitude: 29.9277, longitude: -90.0741 },
    permissions: ["geolocation"],
  });

  test("linking a suggested ticket updates the 311 panel", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await page.goto("/");
    await signInFromHeader(page);
    await fileReport(
      page,
      "Drainage",
      "Catch Basin Clogged",
      "Suggestion banner test.",
    );
    await page.getByRole("link", { name: "View report" }).click();
    await page.waitForURL(/id=/);
    const id = new URL(page.url()).searchParams.get("id");
    execSync(
      `aws dynamodb update-item --table-name rapport-local --key '{"PK":{"S":"REPORT#${id}"},"SK":{"S":"META"}}' --update-expression "SET suggested_ticket = :t" --expression-attribute-values '{":t":{"M":{"ticket":{"S":"2026-1322723"},"probability":{"S":"0.91"}}}}'`,
      {
        env: {
          ...process.env,
          AWS_ENDPOINT_URL: "http://localhost:4566",
          AWS_DEFAULT_REGION: "us-east-1",
          AWS_ACCESS_KEY_ID: "test",
          AWS_SECRET_ACCESS_KEY: "test",
        },
      },
    );
    await page.reload();
    const banner = page.getByTestId("ticket-suggestion");
    await expect(banner).toContainText("#2026-1322723");
    await page.screenshot({
      path: `screenshots/suggestion-${testInfo.project.name}.png`,
    });
    await banner.getByRole("button", { name: "Yes, link it" }).click();
    await expect(
      page.getByText("Filed as request #2026-1322723."),
    ).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId("status-badge")).toHaveText("Filed with 311");
  });
});
