import { expect, test } from "@playwright/test";
import { hasE2EUser, signInFromHeader } from "./helpers";

test("anyone can read how it works from the header", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "How it works" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "How Rapport works" }),
  ).toBeVisible();
  const steps = page.getByRole("list", { name: "How it works" });
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(
    page.getByRole("link", { name: "Create an account" }),
  ).toHaveAttribute("href", "/sign-up/");
  await page.screenshot({
    path: `screenshots/getting-started-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test.describe("new accounts", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");

  test("are welcomed with the next steps", async ({ page }, testInfo) => {
    await page.goto("/");
    await signInFromHeader(page);
    // Where sign-up lands after the email code is confirmed.
    await page.goto("/getting-started/?welcome=1");
    await expect(
      page.getByRole("heading", { level: 1, name: "Welcome to Rapport" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Set up your profile" }),
    ).toHaveAttribute("href", "/profile/");
    await expect(
      page.getByRole("main").getByRole("button", { name: "Report an issue" }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: `screenshots/welcome-dark-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
});
