import { test, expect } from "./fixtures";

test.describe("Read-only browsing (no auth required)", () => {
  test("app boots and shows the tab navigation", async ({ page }) => {
    await expect(page.getByText("Sift")).toBeVisible();
    for (const label of [
      "Submit",
      "Queue",
      "My submissions",
      "Review panel",
      "Panels",
      "Account",
    ]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("Queue view renders without signing in", async ({ page }) => {
    await page.getByRole("button", { name: "Queue" }).click();
    await expect(page.getByLabel("Filter by severity")).toBeVisible();
    await expect(page.getByLabel("Filter by component")).toBeVisible();
  });

  test("Review panel view renders without signing in", async ({ page }) => {
    await page.getByRole("button", { name: "Review panel" }).click();
    await expect(
      page.getByText(/Review Panel|Configure a Sift contract first/),
    ).toBeVisible();
  });

  test("Panels view renders without signing in", async ({ page }) => {
    await page.getByRole("button", { name: "Panels" }).click();
    await expect(
      page.getByText(/Sift groups|Configure a Sift contract first/),
    ).toBeVisible();
  });
});
