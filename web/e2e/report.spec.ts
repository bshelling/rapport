import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { hasE2EUser, signInFromHeader } from "./helpers";

const PHOTO = path.join(__dirname, "fixtures", "pothole-gps.jpg");

async function openReport(page: Page) {
  await page.getByRole("button", { name: "Report an issue" }).first().click();
  return page.getByRole("dialog", { name: "Report an issue" });
}

async function stepOne(page: Page, type: string, reason: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByText(type, { exact: true }).click();
  await dialog.getByText(reason, { exact: true }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
}

async function stepTwo(page: Page) {
  const form = page.getByRole("form", { name: "Contact info" });
  await expect(form).toBeVisible();
  await form.getByLabel("First name").fill("E2E");
  await form.getByLabel("Last name").fill("Reporter");
  await form.getByLabel("Email").fill("e2e@example.com");
  await form.getByRole("button", { name: "Continue" }).click();
}

async function describe(page: Page, text: string) {
  const editor = page.getByRole("textbox", { name: "Description" });
  await editor.click();
  await page.keyboard.type(text);
}

test("signed-out visitors are asked to sign in", async ({ page }) => {
  await page.goto("/");
  const dialog = await openReport(page);
  await expect(dialog.getByText("Sign in to report an issue")).toBeVisible();
});

test.describe("report flow", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");
  test.use({
    geolocation: { latitude: 29.9511, longitude: -90.0715 },
    permissions: ["geolocation"],
  });

  test("photo sets the location, then the report submits", async ({
    page,
  }, testInfo) => {
    const shot = (name: string) =>
      page.screenshot({
        path: `screenshots/report-${name}-${testInfo.project.name}.png`,
      });

    await page.goto("/");
    await signInFromHeader(page);
    const dialog = await openReport(page);
    await expect(
      dialog.getByRole("form", { name: "Request type" }),
    ).toBeVisible();

    await dialog.getByText("Drainage", { exact: true }).click();
    await dialog.getByText("Catch Basin Clogged", { exact: true }).click();
    await shot("1-type");
    await dialog.getByRole("button", { name: "Continue" }).click();

    await stepTwo(page);

    const describeForm = page.getByRole("form", {
      name: "Describe the request",
    });
    await expect(describeForm).toBeVisible();
    await page.getByTestId("photo-input").setInputFiles(PHOTO);
    // Location comes from the photo's GPS tag (Napoleon Ave & Magazine St).
    await expect(page.getByTestId("location-set")).toContainText(
      "29.92120, -90.10270 (from photo)",
    );
    await expect(describeForm.getByText("Uploading…")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(describeForm.getByText("Failed")).toHaveCount(0);
    await describeForm
      .getByLabel("Nearest address or landmark")
      .fill("Napoleon Ave & Magazine St");
    await describe(
      page,
      "Catch basin is packed with leaves and water is backing up.",
    );
    await shot("3-describe");
    await describeForm.getByRole("button", { name: "Submit report" }).click();

    const done = page.getByTestId("report-submitted");
    await expect(done).toBeVisible();
    await expect(done).toContainText("Catch Basin Clogged (Drainage)");
    await page.waitForTimeout(800); // let the checkmark animation finish
    await shot("4-submitted");
  });

  test("current location and validation", async ({ page }) => {
    await page.goto("/");
    await signInFromHeader(page);
    await openReport(page);
    await stepOne(page, "Roads and Streets", "Pothole");
    await stepTwo(page);

    const form = page.getByRole("form", { name: "Describe the request" });
    await form.getByRole("button", { name: "Submit report" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Add the location of the problem.",
    );

    await form.getByRole("button", { name: /Use my current location/ }).click();
    await expect(page.getByTestId("location-set")).toContainText(
      "29.95110, -90.07150",
    );
    await describe(page, "Short");
    await form.getByRole("button", { name: "Submit report" }).click();
    await expect(form.getByRole("alert")).toContainText(
      "at least 10 characters",
    );

    await describe(page, " but now long enough to submit.");
    await form.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByTestId("report-submitted")).toContainText(
      "Pothole (Roads and Streets)",
    );
  });

  test("draft resumes after closing the dialog", async ({ page }) => {
    await page.goto("/");
    await signInFromHeader(page);
    await openReport(page);
    await stepOne(page, "Drainage", "Street Flooding");
    await page.getByRole("button", { name: "Close" }).click();
    await openReport(page);
    await expect(
      page.getByRole("form", { name: "Contact info" }),
    ).toBeVisible();
  });
});
