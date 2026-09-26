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

export async function openReport(page: Page) {
  await page.getByRole("button", { name: "Report an issue" }).first().click();
  return page.getByRole("dialog", { name: "Report an issue" });
}

export async function stepOne(page: Page, type: string, reason: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByText(type, { exact: true }).click();
  await dialog.getByText(reason, { exact: true }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
}

export async function stepTwo(page: Page) {
  const form = page.getByRole("form", { name: "Contact info" });
  await expect(form).toBeVisible();
  await form.getByLabel("First name").fill("E2E");
  await form.getByLabel("Last name").fill("Reporter");
  await form.getByLabel("Email").fill("e2e@example.com");
  await form.getByRole("button", { name: "Continue" }).click();
}

export async function describeIssue(page: Page, text: string) {
  const editor = page.getByRole("textbox", { name: "Description" });
  await editor.click();
  await page.keyboard.type(text);
}

/** File a report using the current (mocked) location; lands on the success screen. */
export async function fileReport(
  page: Page,
  type: string,
  reason: string,
  text: string,
) {
  await openReport(page);
  await stepOne(page, type, reason);
  await stepTwo(page);
  const form = page.getByRole("form", { name: "Describe the request" });
  await form.getByRole("button", { name: /Use my current location/ }).click();
  await expect(page.getByTestId("location-set")).toBeVisible();
  await form
    .getByLabel("Nearest address or landmark")
    .fill("Magazine St & Jackson Ave");
  await describeIssue(page, text);
  await form.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByTestId("report-submitted")).toBeVisible();
}
