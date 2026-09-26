import { expect, test } from "@playwright/test";
import { fileReport, hasE2EUser, signInFromHeader } from "./helpers";

const prod =
  !!process.env.BASE_URL && !process.env.BASE_URL.includes("localhost");

test("home shows the City's drainage numbers", async ({ page }, testInfo) => {
  await page.goto("/");
  const impact = page.getByTestId("impact");
  await expect(impact).toBeVisible();
  await expect(impact.getByTestId("stat-tile")).toHaveCount(4);
  await expect(impact).toContainText("Hurricane Francine");

  const chart = impact.getByTestId("hood-chart");
  const bars = chart.getByRole("button");
  await expect(bars).toHaveCount(10);
  await bars.first().focus(); // keyboard users get the same details as hover
  await expect(chart.getByRole("tooltip")).toContainText("per 100 basins");
  await impact.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `screenshots/impact-${testInfo.project.name}.png`,
  });

  await impact.getByRole("button", { name: "Show as table" }).click();
  await expect(
    impact.getByTestId("hood-table").locator("tbody tr"),
  ).toHaveCount(10);
});

test("catch basins appear on the map when zoomed in", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("public-map").locator("canvas")).toBeVisible();
  await page.getByTestId("toggle-basins").check();
  await expect(page.getByTestId("basin-note")).toHaveText(
    /\([\d,]+ catch basins in view\)/,
    {
      timeout: 20_000,
    },
  );
  await page.getByTestId("public-map").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `screenshots/map-basins-${testInfo.project.name}.png`,
  });
});

test.describe("nearest catch basin", () => {
  test.skip(!hasE2EUser || !prod, "the City lookup runs in prod only");
  test.use({
    geolocation: { latitude: 29.9277, longitude: -90.0741 },
    permissions: ["geolocation"],
  });

  test("drainage reports name the nearest City catch basin", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await page.goto("/");
    await signInFromHeader(page);
    await fileReport(
      page,
      "Drainage",
      "Catch Basin Not Draining",
      "Water pooling at the basin.",
    );
    await page.getByRole("link", { name: "View report" }).click();
    await expect(page.getByTestId("nearest-basin")).toContainText(
      /Nearest City catch basin: CB\d+/,
    );
  });
});
