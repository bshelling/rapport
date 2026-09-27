import { expect, test } from "@playwright/test";
import { hasE2EUser, signInFromHeader } from "./helpers";

async function openChat(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Ask Rapport" }).click();
  return page.getByRole("dialog", { name: "Ask Rapport" });
}

test("signed-out visitors are asked to sign in to chat", async ({ page }) => {
  await page.goto("/");
  const chat = await openChat(page);
  await expect(
    chat.getByRole("button", { name: "Sign in to chat" }),
  ).toBeVisible();
});

test.describe("Ask Rapport", () => {
  test.skip(!hasE2EUser, "E2E_EMAIL / E2E_PASSWORD not set");
  // The agent reasons over several tool calls; a turn takes 10-20 s.
  test.setTimeout(120_000);

  test("off-topic questions get a redirect", async ({ page }) => {
    await page.goto("/");
    await signInFromHeader(page);
    const chat = await openChat(page);
    await chat.getByLabel("Message").fill("Write me a poem about gumbo");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(
      chat.getByText(/I can help with street, sidewalk and drainage/),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("the agent drafts a report the resident reviews in the form", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await signInFromHeader(page);
    const chat = await openChat(page);
    await chat
      .getByLabel("Message")
      .fill(
        "The catch basin in front of 1300 Perdido St is clogged with leaves",
      );
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByLabel("Rapport is typing")).toBeVisible();

    const card = chat.getByTestId("draft-card");
    await expect(card).toBeVisible({ timeout: 90_000 });
    await page.screenshot({
      path: `screenshots/chat-draft-${testInfo.project.name}.png`,
    });

    await card.getByRole("button", { name: "Review & submit" }).click();
    const form = page.getByRole("dialog", { name: "Report an issue" });
    // The draft opens on the last step with the agent's details filled in.
    const step3 = form.getByRole("form", { name: "Describe the request" });
    await expect(step3).toBeVisible({ timeout: 15_000 });
    await expect(step3.getByLabel(/Nearest address/)).toHaveValue(/Perdido/i);
    await page.screenshot({
      path: `screenshots/chat-review-${testInfo.project.name}.png`,
    });
  });
});
