import { expect, type Page, test } from "@playwright/test";
import { e2eEmail, hasE2EUser, signInFromHeader } from "./helpers";

/**
 * Answer selected Cognito calls in the browser so sign-up and password-reset
 * screens can be exercised without creating users or sending email.
 */
async function mockCognito(
  page: Page,
  replies: Record<string, { status?: number; body: object }>,
) {
  await page.route("https://cognito-idp.*.amazonaws.com/", async (route) => {
    const target = route.request().headers()["x-amz-target"] ?? "";
    const action = target.split(".").pop() ?? "";
    const reply = replies[action];
    if (!reply) return route.continue();
    await route.fulfill({
      status: reply.status ?? 200,
      contentType: "application/x-amz-json-1.1",
      body: JSON.stringify(reply.body),
    });
  });
}

const delivery = {
  Destination: "r***@e***",
  DeliveryMedium: "EMAIL",
  AttributeName: "email",
};

test("sign-up checks the password rules and the confirmation", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-up/");
  const form = page.getByRole("form", { name: "Create your account" });
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(form.getByText("Enter your email.")).toBeVisible();

  await form.getByLabel("Email").fill("resident@example.com");
  await form.getByLabel("Password", { exact: true }).fill("neworleans");
  const rules = form.getByRole("list", { name: "Password rules" });
  await expect(rules.getByText("At least 10 characters")).toHaveAttribute(
    "data-met",
    "true",
  );
  await expect(rules.getByText("An uppercase letter")).toHaveAttribute(
    "data-met",
    "false",
  );

  await form.getByLabel("Password", { exact: true }).fill("Neworleans2026");
  await form.getByLabel("Confirm password").fill("Neworleans2025");
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(form.getByText("The passwords don't match.")).toBeVisible();
  await page.screenshot({
    path: `screenshots/sign-up-${testInfo.project.name}.png`,
  });
});

test("sign-up sends a code, and a wrong code explains itself", async ({
  page,
}, testInfo) => {
  await mockCognito(page, {
    SignUp: {
      body: {
        UserConfirmed: false,
        UserSub: "00000000-0000-4000-8000-000000000000",
        CodeDeliveryDetails: delivery,
      },
    },
    ConfirmSignUp: {
      status: 400,
      body: {
        __type: "CodeMismatchException",
        message: "Invalid verification code provided, please try again.",
      },
    },
  });
  await page.goto("/sign-up/");
  const form = page.getByRole("form", { name: "Create your account" });
  await form.getByLabel("Email").fill("resident@example.com");
  await form.getByLabel("Password", { exact: true }).fill("Neworleans2026");
  await form.getByLabel("Confirm password").fill("Neworleans2026");
  await form.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  const confirm = page.getByRole("form", { name: "Confirm your email" });
  await expect(confirm.getByText("resident@example.com")).toBeVisible();
  await confirm.getByLabel("Verification code").fill("123456");
  await confirm.getByRole("button", { name: "Confirm and continue" }).click();
  await expect(confirm.getByRole("alert")).toHaveText(/code isn't right/);
  await page.screenshot({
    path: `screenshots/confirm-code-${testInfo.project.name}.png`,
  });
});

test("forgot password asks for the code and a new password", async ({
  page,
}) => {
  await mockCognito(page, {
    ForgotPassword: { body: { CodeDeliveryDetails: delivery } },
  });
  await page.goto("/sign-in/");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  const request = page.getByRole("form", { name: "Reset your password" });
  await request.getByLabel("Email").fill("resident@example.com");
  await request.getByRole("button", { name: "Send code" }).click();
  const reset = page.getByRole("form", { name: "Choose a new password" });
  await expect(reset.getByLabel("Verification code")).toBeVisible();
  await expect(reset.getByLabel("New password", { exact: true })).toBeVisible();
});

test("auth pages follow the dark theme", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sign-in/");
  await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
  await page.screenshot({
    path: `screenshots/sign-in-dark-${testInfo.project.name}.png`,
  });
});

test.describe("with the test account", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");

  test("a wrong password shows a plain error", async ({ page }, testInfo) => {
    await page.goto("/sign-in/");
    const form = page.getByRole("form", { name: "Sign in" });
    await form.getByLabel("Email").fill(e2eEmail as string);
    await form.getByLabel("Password").fill("NotThePassword1");
    await form.getByRole("button", { name: "Sign in" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      /email and password don't match/,
    );
    await page.screenshot({
      path: `screenshots/sign-in-error-${testInfo.project.name}.png`,
    });
  });

  test("signed-in visitors skip the sign-in page", async ({ page }) => {
    await page.goto("/");
    await signInFromHeader(page);
    await page.goto("/sign-in/");
    await page.waitForURL(/\/dashboard\/$/);
  });
});
