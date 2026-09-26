import { expect, test } from "@playwright/test";
import { completeCognitoLogin, hasE2EUser } from "./helpers";

// Signs in through Cognito managed login with the e2e test user
// (password in SSM /rapport/prod/e2e/password; see infra/modules/auth).

test.describe("profile", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");

  test("sign in, save profile, sign out", async ({ page }, testInfo) => {
    await page.goto("/profile/");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Sign in" })
      .click();

    await completeCognitoLogin(page);
    await page.waitForURL(/\/profile\/$/);
    const form = page.getByRole("form", { name: "Profile" });
    await expect(form).toBeVisible();

    // Unique per run so we know the value came from this save.
    const last = `Tester-${testInfo.project.name}-${Date.now().toString(36)}`;
    await form.getByLabel("First name").fill("E2E");
    await form.getByLabel("Last name").fill(last);
    await form
      .getByLabel("Phone", { exact: false })
      .first()
      .fill("504-555-0100");
    await form.getByLabel("Mobile").check();
    await form.getByLabel("Neighborhood").selectOption("Bayou St. John");
    await form.getByRole("button", { name: "Save profile" }).click();
    await expect(form.getByText("Saved.")).toBeVisible();
    await expect(page.getByTestId("profile-incomplete")).toHaveCount(0);

    await page.reload();
    await expect(form.getByLabel("Last name")).toHaveValue(last);
    await expect(
      form.getByLabel("Phone", { exact: false }).first(),
    ).toHaveValue("(504) 555-0100");
    await page.screenshot({
      path: `screenshots/profile-${testInfo.project.name}.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
  });

  test("validation errors show before saving", async ({ page }) => {
    await page.goto("/profile/");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Sign in" })
      .click();
    await completeCognitoLogin(page);
    await page.waitForURL(/\/profile\/$/);

    const form = page.getByRole("form", { name: "Profile" });
    await form.getByLabel("First name").fill("E2E");
    await form.getByLabel("Phone", { exact: false }).first().fill("555-01");
    await form.getByRole("button", { name: "Save profile" }).click();
    await expect(
      form.getByText("Enter a 10-digit US phone number"),
    ).toBeVisible();
  });
});

test("profile page asks signed-out visitors to sign in", async ({ page }) => {
  await page.goto("/profile/");
  await expect(page.getByText("Sign in to set up your profile.")).toBeVisible();
});
