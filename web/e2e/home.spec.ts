import { expect, test } from "@playwright/test";

test("home page renders and reaches the API", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Report it in a minute",
  );
  await expect(
    page.getByRole("heading", { name: "Roads and Streets" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Drainage" })).toBeVisible();

  const status = page.getByTestId("api-status");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(status).toContainText("Service online");

  await page.screenshot({
    path: `screenshots/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("API health is served under /api", async ({ request, baseURL }) => {
  // Locally the API runs on its own port; in AWS it shares the site origin.
  const apiBase = process.env.API_BASE ?? baseURL;
  const res = await request.get(`${apiBase}/api/health`);
  expect(res.ok()).toBeTruthy();
  expect(await res.json()).toMatchObject({
    status: "ok",
    service: "rapport-api",
  });
});
