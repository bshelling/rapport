import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  describeIssue,
  hasE2EUser,
  openReport,
  signInFromHeader,
  signInWithForm,
  stepOne,
  stepTwo,
  submitReport,
} from "./helpers";

const PHOTO = path.join(__dirname, "fixtures", "pothole-gps.jpg");

test("signed-out visitors are asked to sign in", async ({ page }) => {
  await page.goto("/");
  const dialog = await openReport(page);
  await expect(dialog.getByText("Sign in to report an issue")).toBeVisible();
});

test.describe("signing in from the report modal", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");

  test("closes the modal, then reopens it after sign-in", async ({ page }) => {
    await page.goto("/");
    const dialog = await openReport(page);
    await dialog.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/sign-in\/$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await signInWithForm(page);
    // Back where they started: the report form, ready to fill in.
    await expect(
      page
        .getByRole("dialog", { name: "Report an issue" })
        .getByRole("form", { name: "Request type" }),
    ).toBeVisible();
  });
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
    await describeIssue(
      page,
      "Catch basin is packed with leaves and water is backing up.",
    );
    await shot("3-describe");
    await submitReport(page);

    const done = page.getByTestId("report-submitted");
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
    await describeIssue(page, "Short");
    await form.getByRole("button", { name: "Submit report" }).click();
    await expect(form.getByRole("alert")).toContainText(
      "at least 10 characters",
    );

    await describeIssue(page, " but now long enough to submit.");
    await submitReport(page);
    await expect(page.getByTestId("report-submitted")).toContainText(
      "Pothole (Roads and Streets)",
    );
  });

  test("a slow profile prefill doesn't erase what the resident typed", async ({
    page,
  }) => {
    await page.goto("/");
    await signInFromHeader(page);
    await page.route("**/api/me", async (route) => {
      if (route.request().method() === "GET")
        await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    await openReport(page);
    await stepOne(page, "Drainage", "Street Flooding");
    const form = page.getByRole("form", { name: "Contact info" });
    await form.getByLabel("First name").fill("Typed-Before-Prefill");
    await page.waitForTimeout(2500); // the prefill lands here
    await expect(form.getByLabel("First name")).toHaveValue(
      "Typed-Before-Prefill",
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

test.describe("already reported to NOLA 311", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");
  // Where scripts/seed-e2e.py puts an open City request (#2099-0000001, Street Flooding).
  test.use({
    geolocation: { latitude: 29.94, longitude: -90.08 },
    permissions: ["geolocation"],
  });

  test("submit offers to link the report to the City's open request", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await signInFromHeader(page);
    await openReport(page);
    await stepOne(page, "Drainage", "Street Flooding");
    await stepTwo(page);
    const form = page.getByRole("form", { name: "Describe the request" });
    await form.getByRole("button", { name: /Use my current location/ }).click();
    await expect(page.getByTestId("location-set")).toBeVisible();
    await describeIssue(
      page,
      "Water across both lanes after every heavy rain.",
    );
    await form.getByRole("button", { name: "Submit report" }).click();

    const asked = page.getByTestId("already-reported");
    await expect(asked).toBeVisible({ timeout: 30_000 });
    await expect(asked).toContainText("request #2099-0000001");
    await asked.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `screenshots/already-reported-${testInfo.project.name}.png`,
    });

    await asked
      .getByRole("button", { name: "Link my report to #2099-0000001" })
      .click();
    await expect(page.getByTestId("report-submitted")).toBeVisible();
    await page.goto("/dashboard/");
    await expect(page.getByText("311 #2099-0000001").first()).toBeVisible();
  });
});
