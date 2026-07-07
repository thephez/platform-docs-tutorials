import { test, expect, HAS_MNEMONIC, loginAs } from "./fixtures";

test.describe("Sift submission (auth-gated)", () => {
  test.describe.configure({ mode: "serial" });

  test.skip(
    !HAS_MNEMONIC,
    "PLATFORM_MNEMONIC not set — skipping auth-gated specs",
  );

  test("Submit tab shows the Sift token balance once signed in", async ({
    page,
  }) => {
    await loginAs(page, 0);
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(/Sift token balance/)).toBeVisible({
      timeout: 30_000,
    });
  });

  // Genuine write: files one real submission, spending 1 Sift token.
  // Submissions can't be deleted (canBeDeleted: false), so this isn't
  // reversible — matches dashproof-lab's anchor spec, which accepts the
  // same trade-off for the same reason (immutable-by-design record).
  test("files a submission and it appears under My submissions", async ({
    page,
  }) => {
    await loginAs(page, 0);
    await page.getByRole("button", { name: "Submit" }).click();

    const balanceText = await page
      .getByText(/Sift token balance/)
      .textContent({ timeout: 30_000 });
    if (/balance:\s*0\b/i.test(balanceText ?? "")) {
      test.skip(true, "Submitter identity has no Sift tokens left to spend.");
    }

    const title = `E2E test submission ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Affected component").fill("E2E");
    await page
      .getByLabel("Public summary")
      .fill("Filed by the Sift Playwright suite.");
    await page.getByRole("button", { name: /Spend 1 Sift token/ }).click();

    await expect(page.getByText("Submission filed.")).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole("button", { name: "My submissions" }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 });
  });
});
