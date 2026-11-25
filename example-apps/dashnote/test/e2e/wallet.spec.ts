import {
  test,
  expect,
  HAS_MNEMONIC,
  navButton,
  openIdentityMenu,
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
  liveIdentityKeyIds,
} from "./walletResponder";

test.skip(!HAS_MNEMONIC, "PLATFORM_MNEMONIC not set — skipping wallet specs");
test.describe.configure({ mode: "serial" });

// The scripted wallet adds a live key to the PLATFORM_MNEMONIC identity
// that stays usable until afterAll disables it; keep traces of the
// signed-in session off disk.
test.use({ trace: "off" });

const sidebar = (page: Page) =>
  page.locator('aside[aria-label="Main navigation"]');

const fullAccess = (page: Page) =>
  sidebar(page).getByText("Full access", { exact: true });

/** The value next to a term in Settings → Wallet connection. */
const grantValue = (page: Page, term: string) =>
  page
    .locator('[data-testid="wallet-connection"]')
    .locator("dt", { hasText: term })
    .locator("xpath=following-sibling::dd[1]");

let signedIn = false;
let approvals = 0;

test.beforeEach(async ({ page }) => {
  signedIn = false;
  approvals = 0;
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

/** Approve through the scripted wallet, counting calls per test. */
async function approve(uri: string) {
  approvals += 1;
  return approveWalletRequest(uri);
}

/**
 * Sign in through the wallet with "Stay signed in on this device" set as
 * given, and wait for Full access; returns the key id the wallet granted.
 */
async function signInWithWallet(
  page: Page,
  { staySignedIn }: { staySignedIn: boolean },
) {
  const { dialog, uri } = await openWalletSignIn(page);
  const stay = dialog.getByRole("checkbox", {
    name: "Stay signed in on this device",
  });
  await expect(stay).toBeChecked();
  await stay.setChecked(staySignedIn);

  const { keyId } = await approve(uri);

  const continueAs = dialog.getByRole("button", { name: /continue as/i });
  await expect(continueAs).toBeVisible({ timeout: 120_000 });
  await continueAs.click();

  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(fullAccess(page)).toBeVisible({ timeout: 60_000 });
  signedIn = true;
  return keyId;
}

/** After a reload, the kept key must come back without a wallet round trip. */
async function expectRestored(page: Page, liveKeys: number[]) {
  await expect(fullAccess(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await liveIdentityKeyIds()).toEqual(liveKeys);
}

/** The readonly card: no identity remembered, no key kept. */
async function expectGuest(page: Page) {
  await expect(sidebar(page).getByText("Guest", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    sidebar(page).getByText("Connected", { exact: true }),
  ).toBeVisible();
  await expect(fullAccess(page)).toBeHidden();
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
  await expect(
    page.getByRole("heading", { name: "Wallet connection" }),
  ).toBeVisible();
  await expect(grantValue(page, "Allowance left")).toHaveText(
    /^[\d.,]+ of [\d.,]+ DASH$/,
  );
  await expect(grantValue(page, "Expires")).toHaveText(/\d/);
  await expect(grantValue(page, "Key id")).toHaveText(String(keyId));
});

test("a kept session survives a reload without a new wallet approval", async ({
  page,
}) => {
  test.setTimeout(300_000);

  const keyId = await signInWithWallet(page, { staySignedIn: true });
  const liveKeys = await liveIdentityKeyIds();
  expect(liveKeys).toContain(keyId);

  await page.reload();
  await expectRestored(page, liveKeys);

  // The restored key still signs.
  const title = e2eTitle("kept");
  await createNoteViaEditor(page, {
    title,
    message: "Written with a wallet-issued key restored after a reload.",
  });
  await deleteNoteByTitle(page, title);

  await openSettingsTab(page);
  await expect(
    page.getByRole("heading", { name: "Wallet connection" }),
  ).toBeVisible();
  await expect(grantValue(page, "On this device")).toHaveText(
    "Kept until it expires",
  );
  await expect(grantValue(page, "Key id")).toHaveText(String(keyId));

  // Logging out drops the kept key; the identity stays remembered.
  await openIdentityMenu(page);
  await page.getByRole("menuitem", { name: /^log out$/i }).click();
  signedIn = false;
  await page.reload();
  await expect(
    sidebar(page).getByText("Read-only access", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    sidebar(page).getByText("Signed out", { exact: true }),
  ).toBeVisible();
  await expect(fullAccess(page)).toBeHidden();

  expect(approvals).toBe(1);
});

test("an unchecked box keeps nothing", async ({ page }) => {
  test.setTimeout(300_000);

  await signInWithWallet(page, { staySignedIn: false });

  await openSettingsTab(page);
  await expect(grantValue(page, "On this device")).toHaveText("This tab only");

  await page.reload();
  signedIn = false;
  await expectGuest(page);

  expect(approvals).toBe(1);
});

test("Forget this device drops the kept session", async ({ page }) => {
  test.setTimeout(300_000);

  await signInWithWallet(page, { staySignedIn: true });
  const liveKeys = await liveIdentityKeyIds();

  await page.reload();
  await expectRestored(page, liveKeys);

  await openSettingsTab(page);
  await page.getByRole("button", { name: /forget this device/i }).click();
  // This tab keeps its key; only the copy kept on the device is gone.
  await expect(grantValue(page, "On this device")).toHaveText("This tab only");

  await page.reload();
  signedIn = false;
  await expectGuest(page);

  expect(approvals).toBe(1);
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
