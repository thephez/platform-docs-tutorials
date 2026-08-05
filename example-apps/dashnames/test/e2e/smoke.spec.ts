import { expect, test } from "@playwright/test";

/**
 * Read-only shell smoke tests against real testnet — no SDK mocks.
 *
 * These assert rendering and navigation, not live listing data: testnet may have
 * zero listings at any moment, so a spec that required a populated grid would be
 * flaky by construction. The empty states are themselves worth asserting.
 *
 * Desktop-only (one Playwright project): the app has no mobile layout, so there
 * is nothing to test at a small viewport.
 */
test.describe.configure({ mode: "serial" });

test("discover renders the hero, market summary, and footer", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator(".wordmark")).toHaveText("dashnames");
  await expect(
    page.getByRole("heading", { name: /Your name, on Dash/i }),
  ).toBeVisible();

  // The summary contains market figures only; sync state belongs to listings.
  await expect(page.locator(".market-stat")).toHaveCount(3);
  await expect(page.locator(".market-stats .label-caps").first()).toHaveText(
    /names for sale/i,
  );

  // The footer names the live network rather than a hardcoded "MAINNET".
  await expect(page.locator(".app-footer__chain")).toContainText("TESTNET");
});

test("the sync chip reports a real index state", async ({ page }) => {
  await page.goto("/");
  const chip = page.locator(".section__head .sync-chip").first();
  await expect(chip).toBeVisible();
  // Any of the designed states is acceptable; a blank chip is not.
  await expect(chip).toHaveText(/SYNCED|SYNCING|NOT SYNCED|LAST SYNCED|FAILED/);
});

test("testnet shows no protocol gate banner (v13 is active)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".sync-chip").first()).toBeVisible();
  // Sales are enabled on testnet, so the gate must not appear.
  await expect(page.locator(".gate-banner")).toHaveCount(0);
});

test("browse shows the filter sidebar and all four filter groups", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse", exact: true }).click();

  await expect(page.locator(".filter-sidebar")).toBeVisible();
  for (const group of ["Price", "Length", "Characters", "History"]) {
    await expect(
      page.locator(".filter-group__label", { hasText: group }),
    ).toBeVisible();
  }
  await expect(page.locator(".results-toolbar__count")).toContainText(
    /names? for sale/i,
  );
});

test("browse filters are interactive", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse", exact: true }).click();

  const under10 = page.locator(".filter-option", { hasText: "Under 10 DASH" });
  await under10.click();
  await expect(under10).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".results-toolbar__summary")).toContainText(
    "under 10 DASH",
  );

  const three = page.locator(".filter-chip", { hasText: "3" }).first();
  await three.click();
  await expect(three).toHaveClass(/filter-chip--active/);
});

test("the header stays horizontally fixed between views", async ({ page }) => {
  await page.goto("/");

  const wordmark = page.locator(".wordmark");
  const initialX = (await wordmark.boundingBox())?.x;
  expect(initialX).toBeDefined();

  for (const view of ["Browse", "My names", "Activity", "Discover"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(wordmark).toBeVisible();
    expect((await wordmark.boundingBox())?.x).toBe(initialX);
  }
});

test("activity renders the table and event-type filters", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Activity", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.locator(".activity-filter")).toHaveCount(4);
  // Header row is always present, even with no events.
  await expect(page.locator(".data-table__row--head")).toBeVisible();
  await expect(page.locator(".table-footnote")).toContainText(
    /zero-price update/i,
  );
});

test("the Name column shows names, not raw document IDs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Activity", exact: true }).click();

  // Events load asynchronously, so wait for the table to settle before deciding
  // whether there is anything to assert on.
  const rows = page.locator(".data-table__row:not(.data-table__row--head)");
  await expect(async () => {
    expect(await rows.count()).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });

  // Labels resolve in a second pass — history records carry only a documentId.
  const firstName = rows.first().locator(".data-table__cell-name");
  await expect(firstName).toBeVisible({ timeout: 20_000 });
  // A resolved name always renders its parent-domain suffix; a raw document ID
  // never would.
  await expect(firstName).toContainText(".dash");
});

test("my names prompts for sign-in when browsing read-only", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "My names", exact: true }).click();
  await expect(page.getByText(/Sign in with a recovery phrase/i)).toBeVisible();
});

test("settings switches networks and exposes index controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Network" })).toBeVisible();
  await expect(page.locator(".network-toggle .filter-chip")).toHaveCount(2);
  await expect(page.getByText(/Active protocol: v13/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Rebuild index from history/i }),
  ).toBeVisible();

  await page.getByRole("button", { name: "mainnet", exact: true }).click();
  await expect(page.getByLabel("Platform network")).toHaveValue("mainnet");
  await expect(page.locator(".app-footer__chain")).toContainText("MAINNET");
  await expect(
    page.getByRole("button", { name: "Mainnet sign-in disabled" }),
  ).toBeDisabled();

  // The header control uses the same transition and can switch back without
  // losing access to Settings.
  await page.getByLabel("Platform network").selectOption("testnet");
  await expect(
    page.getByRole("button", { name: "testnet", exact: true }),
  ).toHaveClass(/filter-chip--active/);
  await expect(page.locator(".app-footer__chain")).toContainText("TESTNET");
  await expect(
    page
      .getByRole("main")
      .getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
});

test("how-it-works explains the discovery algorithm", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /How it works/i }).click();
  await expect(
    page.getByRole("heading", { name: /Finding what is for sale/i }),
  ).toBeVisible();
  await expect(page.getByText(/\$price/).first()).toBeVisible();
});

test("no console errors during a read-only browse", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.locator(".sync-chip").first()).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".data-table__row--head")).toBeVisible();

  expect(errors).toEqual([]);
});
