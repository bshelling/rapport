import { expect, test } from "@playwright/test";
import {
  hasE2EUser,
  openReport,
  signInFromHeader,
  stepOne,
  stepTwo,
} from "./helpers";

test("home shows the public live map", async ({ page }) => {
  // Catches regressions like MapLibre's worker failing to load (blank map).
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("public-map").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("map-summary")).toHaveText(
    /open reports? from residents/,
  );
});

test.describe("maps in the report flow", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");
  test.use({
    geolocation: { latitude: 29.9277, longitude: -90.0741 },
    permissions: ["geolocation"],
  });

  test("search an address, place the pin, and it shows on the map", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await signInFromHeader(page);
    await openReport(page);
    await stepOne(page, "Roads and Streets", "Pothole");
    await stepTwo(page);

    const form = page.getByRole("form", { name: "Describe the request" });
    await form.getByLabel("Search for an address").fill("Magazine Napoleon");
    const suggestions = form.getByRole("list", { name: "Address suggestions" });
    await suggestions.getByRole("button").first().click();
    await expect(page.getByTestId("location-set")).toContainText("(on map)");
    await expect(
      form.getByLabel("Nearest address or landmark"),
    ).not.toHaveValue("");
    await expect(page.getByTestId("location-pin")).toBeVisible();
    await page.getByTestId("location-map").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800); // let the map finish easing to the pin
    await page.screenshot({
      path: `screenshots/map-picker-${testInfo.project.name}.png`,
    });

    // Clicking the map moves the pin (and re-fills the address).
    const before = await page.getByTestId("location-set").textContent();
    await page
      .getByTestId("location-map")
      .click({ position: { x: 40, y: 40 } });
    await expect(page.getByTestId("location-set")).not.toHaveText(before ?? "");

    const editor = page.getByRole("textbox", { name: "Description" });
    await editor.click();
    await page.keyboard.type("Pothole in the right lane, about a foot across.");
    await form.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByTestId("report-submitted")).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("map-pin").first()).toBeAttached();
    await page.screenshot({
      path: `screenshots/map-home-${testInfo.project.name}.png`,
    });
  });

  test("current location fills the address", async ({ page }) => {
    await page.goto("/");
    await signInFromHeader(page);
    await openReport(page);
    await stepOne(page, "Drainage", "Street Flooding");
    await stepTwo(page);
    const form = page.getByRole("form", { name: "Describe the request" });
    await form.getByRole("button", { name: /Use my current location/ }).click();
    await expect(page.getByTestId("location-set")).toContainText(
      "29.92770, -90.07410",
    );
    // Reverse geocoding fills the (still empty) address field.
    await expect(
      form.getByLabel("Nearest address or landmark"),
    ).not.toHaveValue("");
  });
});

test("City 311 requests can be shown on the map", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("public-map").locator("canvas")).toBeVisible();
  await page.getByTestId("toggle-city").check();
  await expect(page.getByTestId("city-count")).toHaveText(/\(\d+\+? in view\)/);
  await expect(page.getByTestId("city-pin").first()).toBeAttached({
    timeout: 15_000,
  });
  await page.getByTestId("public-map").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `screenshots/map-city-${testInfo.project.name}.png`,
  });
});
