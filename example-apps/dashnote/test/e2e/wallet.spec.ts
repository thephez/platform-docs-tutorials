import {
  test,
  expect,
  HAS_MNEMONIC,
  navButton,
  createNoteViaEditor,
  deleteNoteByTitle,
  cleanupE2eNotes,
  openSettingsTab,
  e2eTitle,
  type Page,
} from "./fixtures";
import {
  addedWalletKeyIds,
  approveWalletRequest,
  disableWalletKeys,
} from "./walletResponder";

test.skip(!HAS_MNEMONIC, "PLATFORM_MNEMONIC not set — skipping wallet specs");
test.describe.configure({ mode: "serial" });

// The scripted wallet adds a live key to the PLATFORM_MNEMONIC identity
// that stays usable until afterAll disables it; keep traces of the
// signed-in session off disk.
test.use({ trace: "off" });

const sidebar = (page: Page) =>
  page.locator('aside[aria-label="Main navigation"]');

let signedIn = false;

test.beforeEach(async ({ page }) => {
  signedIn = false;
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("dashnote.lastIdentity");
      window.localStorage.removeItem("dashnote.contractId");
    } catch {
      /* localStorage may be unavailable in some contexts */
    }
  });
  await page.reload();
  await expect(
    sidebar(page).getByText("Connected", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
});

test.afterEach(async ({ page }) => {
  if (!signedIn) return;
  await cleanupE2eNotes(page).catch(() => {
    /* best effort */
  });
});

// Every approval leaves a key on the identity; disabling is permanent, so
// a key from a failed run is never reused.
test.afterAll(async () => {
  await disableWalletKeys(addedWalletKeyIds());
});

/** Open the login modal and switch it to the DashPay view; returns the request URI. */
async function openWalletSignIn(page: Page) {
  await (await navButton(page, /sign in$/i)).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Keep localStorage clean, as loginViaModal does.
  await dialog
    .getByRole("checkbox", { name: /remember this identity/i })
    .uncheck();
  await dialog.getByRole("button", { name: "Continue with DashPay" }).click();

  const uriField = dialog.locator('[data-testid="wallet-request-uri"]');
  // The request waits on a proved chain-clock read before it renders.
  await expect(uriField).toHaveValue(/^dash-key:\w+\?n=t&v=2$/, {
    timeout: 60_000,
  });
  return { dialog, uri: await uriField.inputValue() };
}

test("sign in with a wallet-issued key, write a note with it, and see the grant in Settings", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);

  const { dialog, uri } = await openWalletSignIn(page);
  if (testInfo.project.name === "chromium-mobile") {
    await expect(
      dialog.getByRole("link", { name: "Open in DashPay" }),
    ).toHaveAttribute("href", uri);
  }

  const { keyId } = await approveWalletRequest(uri);

  // The app polls every 2 s, then verifies the key on chain before asking.
  const continueAs = dialog.getByRole("button", { name: /continue as/i });
  await expect(continueAs).toBeVisible({ timeout: 120_000 });
  await continueAs.click();

  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(
    sidebar(page).getByText("Full access", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  signedIn = true;

  // Signed by the contract-bound key the wallet just issued, not the
  // mnemonic's keys.
  const title = e2eTitle("wallet");
  await createNoteViaEditor(page, {
    title,
    message: "Written with a key issued by the scripted DashPay wallet.",
  });
  await deleteNoteByTitle(page, title);

  await openSettingsTab(page);
  const grant = page.locator('[data-testid="wallet-connection"]');
  await expect(
    page.getByRole("heading", { name: "Wallet connection" }),
  ).toBeVisible();
  const value = (term: string) =>
    grant
      .locator("dt", { hasText: term })
      .locator("xpath=following-sibling::dd[1]");
  await expect(value("Allowance left")).toHaveText(/^[\d.,]+ of [\d.,]+ DASH$/);
  await expect(value("Expires")).toHaveText(/\d/);
  await expect(value("Key id")).toHaveText(String(keyId));
});

test("Back returns to the mnemonic form and a restart issues a new request", async ({
  page,
}) => {
  const first = await openWalletSignIn(page);

  await first.dialog.getByRole("button", { name: /back$/i }).click();
  await expect(first.dialog.getByPlaceholder(/mnemonic phrase/i)).toBeVisible();
  await expect(
    first.dialog.getByRole("button", { name: "Continue with DashPay" }),
  ).toBeFocused();

  await first.dialog
    .getByRole("button", { name: "Continue with DashPay" })
    .click();
  const uriField = first.dialog.locator('[data-testid="wallet-request-uri"]');
  await expect(uriField).toHaveValue(/^dash-key:/, { timeout: 60_000 });
  await expect(uriField).not.toHaveValue(first.uri);
});
