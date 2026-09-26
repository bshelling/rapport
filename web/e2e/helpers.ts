import { expect, type Page } from "@playwright/test";

export const e2eEmail = process.env.E2E_EMAIL;
export const e2ePassword = process.env.E2E_PASSWORD;
export const hasE2EUser = Boolean(e2eEmail && e2ePassword);

/** Complete Cognito managed login after the app redirected there. */
export async function completeCognitoLogin(page: Page) {
  await page.waitForURL(/amazoncognito\.com/);
  await page.getByLabel("Email address").fill(e2eEmail as string);
  await page
    .getByLabel("Password", { exact: true })
    .fill(e2ePassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signInFromHeader(page: Page) {
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Sign in" })
    .click();
  await completeCognitoLogin(page);
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Sign out" }),
  ).toBeVisible();
}
