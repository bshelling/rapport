import { expect, test } from "@playwright/test";
import { fileReport, hasE2EUser, signInFromHeader } from "./helpers";

test("dashboard asks signed-out visitors to sign in", async ({ page }) => {
  await page.goto("/dashboard/");
  await expect(page.getByText("Sign in to see your reports.")).toBeVisible();
});

test.describe("dashboard and report details", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");
  test.use({
    geolocation: { latitude: 29.9277, longitude: -90.0741 },
    permissions: ["geolocation"],
  });

  test("view a report, hand it to 311, see it on the dashboard", async ({
    page,
  }, testInfo) => {
    // One long end-to-end journey; against prod (cold Lambdas) it needs more than 30 s.
    test.setTimeout(90_000);
    const shot = (name: string) =>
      page.screenshot({
        path: `screenshots/${name}-${testInfo.project.name}.png`,
      });
    // Unique per run so we can find this report among earlier ones.
    const marker = `Sidewalk slab lifted ${Date.now().toString(36)} near the bus stop.`;

    await page.goto("/");
    await signInFromHeader(page);
    await fileReport(
      page,
      "Roads and Streets",
      "Sidewalk Damaged or Missing",
      marker,
    );
    await page.getByRole("link", { name: "View report" }).click();

    await page.waitForURL(/\/reports\/view\/\?id=/);
    const reportUrl = page.url();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sidewalk Damaged or Missing",
    );
    await expect(
      page.getByRole("region", { name: "Description" }),
    ).toContainText(marker);
    await expect(page.getByTestId("status-badge")).toHaveText("Submitted");
    await expect(
      page.getByTestId("timeline").getByRole("listitem"),
    ).toHaveCount(1);
    await expect(page.getByTestId("nola311-summary")).toContainText(
      "Request reason: Sidewalk Damaged or Missing",
    );
    await expect(
      page.getByRole("link", { name: "Open NOLA 311 ↗" }),
    ).toHaveAttribute("href", "https://nola311.org/service-request");
    await shot("report-view");

    const ticket = page.getByLabel("3. Add the request number they give you");
    await ticket.fill("12345");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("region", { name: "NOLA 311" }).getByRole("alert"),
    ).toContainText("like 2026-1322736");

    // Year 2099 can't match a real City request (the API verifies tickets live).
    const number = `2099-${String(Date.now()).slice(-7)}`;
    await ticket.fill(number);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(`Filed as request #${number}.`)).toBeVisible();
    await expect(page.getByTestId("status-badge")).toHaveText("Filed with 311");
    await expect(page.getByTestId("ticket-verified")).toContainText("tonight");
    const timeline = page.getByTestId("timeline");
    await expect(timeline.getByRole("listitem")).toHaveCount(2);
    await expect(timeline).toContainText(`Filed with NOLA 311 as ${number}`);

    // The ticket survives a reload.
    await page.goto(reportUrl);
    await expect(page.getByText(`Filed as request #${number}.`)).toBeVisible();

    await page
      .getByRole("banner")
      .getByRole("link", { name: "My reports" })
      .click();
    await page.waitForURL(/\/dashboard\/$/);
    const card = page
      .getByRole("list", { name: "Reports" })
      .getByRole("link")
      .first();
    await expect(card).toContainText("Sidewalk Damaged or Missing");
    await expect(card).toContainText("Filed with 311");
    await expect(card).toContainText(`311 #${number}`);
    await shot("dashboard");

    await page.getByRole("button", { name: "Resolved", exact: true }).click();
    await expect(
      page.getByRole("list", { name: "Reports" }).getByText(`311 #${number}`),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "All", exact: true }).click();
    // Switching filters reloads the list; wait for this report to be back before clicking.
    await expect(card).toContainText(`311 #${number}`);
    await card.click();
    await expect(page).toHaveURL(reportUrl);
  });

  test("a slow response for an old filter doesn't replace the current list", async ({
    page,
  }) => {
    await page.goto("/");
    await signInFromHeader(page);
    // Not a pothole: the duplicates spec seeds a neighbor's pothole at this spot.
    await fileReport(page, "Drainage", "Street Flooding", "Race test report.");
    await page.goto("/dashboard/");
    const list = page.getByRole("list", { name: "Reports" });
    await expect(list.getByRole("link").first()).toBeVisible();

    // Make the "Resolved" answer arrive after the "All" answer.
    await page.route("**/api/reports/mine?status=resolved*", async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    await page.getByRole("button", { name: "Resolved", exact: true }).click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(list.getByRole("link").first()).toBeVisible();
    await page.waitForTimeout(2500); // the stale reply lands here
    await expect(list.getByRole("link").first()).toBeVisible();
    await expect(page.getByText("No reports yet.")).toHaveCount(0);
  });

  test("unknown report id shows not found", async ({ page }) => {
    await page.goto("/");
    await signInFromHeader(page);
    await page.goto("/reports/view/?id=NOPE");
    await expect(page.getByText("We couldn't find that report.")).toBeVisible();
  });
});
