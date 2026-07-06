import {
  test,
  expect,
  HAS_PANEL_IDENTITIES,
  PANELIST_IDS,
  loginAs,
} from "./fixtures";

// The only spec that exercises the access group 2-of-3 propose/co-sign flow for
// real. Requires 4 distinct on-chain identities (see
// scripts/bootstrap-identities.mjs) — a genuinely different signing
// identity for the second signature, not the same key re-signing. Gated
// behind HAS_PANEL_IDENTITIES rather than HAS_MNEMONIC so casual
// contributors/CI aren't blocked by the heavier 4-identity setup cost.
//
// Suspend → restore round-trip on panelist 2's own identity, ending back at
// baseline — reversible, matching every sibling app's e2e write
// spec philosophy (dashmint-lab's SetPrice list→update→unlist round-trip).
// Revocation (irreversible destroyFrozen) is deliberately excluded from automated
// e2e for the same reason marketplace/burn writes are excluded elsewhere.
test.describe("Sift Review Panel group signing (2-of-3, auth-gated)", () => {
  test.describe.configure({ mode: "serial" });

  test.skip(
    !HAS_PANEL_IDENTITIES,
    "VITE_PANELIST_1_ID/_2_ID/_3_ID not set — skipping group-signing specs",
  );

  test.setTimeout(300_000);

  test("panelist 1 proposes a suspension, panelist 3 co-signs, then restores baseline", async ({
    page,
  }) => {
    const [, target] = PANELIST_IDS; // panelist 2's identity is the suspension target

    // Step 1: panelist 1 proposes a suspension on panelist 2
    await loginAs(page, 1);
    await page.getByRole("button", { name: "Review panel" }).click();
    await expect(page.getByText(/Access actions require/i)).toBeVisible({
      timeout: 30_000,
    });

    await page.getByLabel("Action").selectOption("freeze");
    await page.getByLabel("Target identity ID").fill(target);
    await page.getByRole("button", { name: /Propose Suspend access/ }).click();
    await expect(page.getByText(/1\/2 power signed/)).toBeVisible({
      timeout: 60_000,
    });

    // Step 2: panelist 3 discovers the pending action and co-signs
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await loginAs(page, 3);
    await page.getByRole("button", { name: "Review panel" }).click();

    const suspendCard = page
      .locator(".card", { hasText: "Suspend access proposal" })
      .first();
    await expect(suspendCard).toBeVisible({ timeout: 30_000 });
    await suspendCard
      .getByPlaceholder("Confirm target identity ID")
      .fill(target);
    await suspendCard.getByRole("button", { name: "Co-sign" }).click();

    await expect(suspendCard).toBeHidden({ timeout: 60_000 });

    // Step 3: panelist 3 immediately proposes the restore action
    await page.getByLabel("Action").selectOption("unfreeze");
    await page.getByLabel("Target identity ID").fill(target);
    await page.getByRole("button", { name: /Propose Restore access/ }).click();
    await expect(page.getByText(/1\/2 power signed/)).toBeVisible({
      timeout: 60_000,
    });

    // Step 4: panelist 1 co-signs the restore action
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await loginAs(page, 1);
    await page.getByRole("button", { name: "Review panel" }).click();

    const restoreCard = page
      .locator(".card", { hasText: "Restore access proposal" })
      .first();
    await expect(restoreCard).toBeVisible({ timeout: 30_000 });
    await restoreCard
      .getByPlaceholder("Confirm target identity ID")
      .fill(target);
    await restoreCard.getByRole("button", { name: "Co-sign" }).click();
    await expect(restoreCard).toBeHidden({ timeout: 60_000 });
  });
});
