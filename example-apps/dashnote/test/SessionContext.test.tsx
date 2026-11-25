// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode, useContext, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockKeyManagerCreate,
  mockRefreshContractCache,
  mockDpnsUsername,
  mockResolveDpnsName,
  mockLoginWithPrivateKey,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockKeyManagerCreate: vi.fn(),
  mockRefreshContractCache: vi.fn(),
  mockDpnsUsername: vi.fn(),
  mockResolveDpnsName: vi.fn(),
  mockLoginWithPrivateKey: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

const {
  mockReadWalletGrant,
  mockClassifyWalletWriteError,
  mockRestoreWalletLogin,
} = vi.hoisted(() => ({
  mockReadWalletGrant: vi.fn(),
  mockClassifyWalletWriteError: vi.fn(),
  mockRestoreWalletLogin: vi.fn(),
}));

vi.mock("../src/dash/appConnect", () => ({
  readWalletGrant: mockReadWalletGrant,
  classifyWalletWriteError: mockClassifyWalletWriteError,
  restoreWalletLogin: mockRestoreWalletLogin,
}));

const store = vi.hoisted(() => ({
  peekWalletSession: vi.fn(),
  loadWalletSession: vi.fn(),
  clearWalletSession: vi.fn(),
}));

vi.mock("../src/lib/walletSessionStore", () => ({
  walletSessionStorageAvailable: vi.fn().mockResolvedValue(true),
  saveWalletSession: vi.fn().mockResolvedValue(undefined),
  peekWalletSession: store.peekWalletSession,
  loadWalletSession: store.loadWalletSession,
  clearWalletSession: store.clearWalletSession,
}));

vi.mock("../../../setupDashClient-core.mjs", () => ({
  createClient: mockCreateClient,
  IdentityKeyManager: {
    create: mockKeyManagerCreate,
  },
}));

vi.mock("../src/dash/loginWithPrivateKey", () => ({
  loginWithPrivateKey: mockLoginWithPrivateKey,
  UnknownIdentityError: class UnknownIdentityError extends Error {},
  WrongKeyPurposeError: class WrongKeyPurposeError extends Error {},
  KeyDisabledError: class KeyDisabledError extends Error {},
  InvalidPrivateKeyError: class InvalidPrivateKeyError extends Error {},
}));

// Default resolver delegates to the real implementation (which calls
// sdk.dpns.username — already mocked via mockDpnsUsername). Specific tests
// override this to make resolveDpnsName itself throw, exercising the outer
// try/catch in SessionContext.
vi.mock("../src/dash/resolveDpnsName", () => ({
  resolveDpnsName: mockResolveDpnsName,
}));

vi.mock("../src/dash/contract", async () => {
  const actual = await vi.importActual<typeof import("../src/dash/contract")>(
    "../src/dash/contract",
  );
  return {
    ...actual,
    refreshContractCache: mockRefreshContractCache,
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

import {
  SessionContext,
  SessionProvider,
  type SessionValue,
} from "../src/session/SessionContext";

const REMEMBERED_KEY = "dashnote.lastIdentity";

function Harness({ onValue }: { onValue: (value: SessionValue) => void }) {
  const value = useContext(SessionContext);
  if (value) onValue(value);
  return null;
}

function mountSession(): { current: SessionValue } {
  const ref = { current: null as unknown as SessionValue };
  const handler = (value: SessionValue) => {
    ref.current = value;
  };
  const ui: ReactNode = (
    <SessionProvider>
      <Harness onValue={handler} />
    </SessionProvider>
  );
  render(ui);
  return ref;
}

beforeEach(() => {
  localStorage.clear();
  mockCreateClient.mockReset();
  mockKeyManagerCreate.mockReset();
  mockRefreshContractCache.mockReset();
  mockDpnsUsername.mockReset();
  mockDpnsUsername.mockResolvedValue(null);
  mockCreateClient.mockResolvedValue({
    documents: {},
    dpns: { username: mockDpnsUsername },
  });
  // Default behavior mirrors the real resolveDpnsName: forward to
  // sdk.dpns.username, strip the .dash suffix, and return null on null/empty.
  // Tests that need the resolver to throw outright override this.
  mockToastError.mockReset();
  mockToastSuccess.mockReset();
  mockResolveDpnsName.mockReset();
  mockLoginWithPrivateKey.mockReset();
  mockReadWalletGrant.mockReset();
  mockClassifyWalletWriteError.mockReset();
  mockRestoreWalletLogin.mockReset();
  store.peekWalletSession.mockReset();
  store.loadWalletSession.mockReset();
  store.clearWalletSession.mockReset();
  store.peekWalletSession.mockResolvedValue(null);
  store.loadWalletSession.mockResolvedValue(null);
  store.clearWalletSession.mockResolvedValue(undefined);
  mockResolveDpnsName.mockImplementation(async (sdk, identityId) => {
    const result = await sdk.dpns.username(identityId);
    if (typeof result !== "string" || result.length === 0) return null;
    return result.endsWith(".dash") ? result.slice(0, -5) : result;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SessionProvider", () => {
  it("loads the remembered identity ID from localStorage on mount and starts in browsing mode", () => {
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "stored-identity-id" }),
    );
    const ref = mountSession();
    expect(ref.current.rememberedIdentityId).toBe("stored-identity-id");
    expect(ref.current.status).toBe("browsing");
    expect(ref.current.identityId).toBe("stored-identity-id");
  });

  it("starts in idle mode when no identity is remembered", () => {
    const ref = mountSession();
    expect(ref.current.rememberedIdentityId).toBeNull();
    expect(ref.current.status).toBe("idle");
  });

  it("persists the identity ID on login when rememberMe is true", async () => {
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "logged-in-identity-id",
    });
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("test mnemonic", { rememberMe: true });
    });

    expect(JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "null")).toEqual({
      id: "logged-in-identity-id",
      name: null,
    });
    expect(ref.current.rememberedIdentityId).toBe("logged-in-identity-id");
    expect(ref.current.status).toBe("authenticated");
    expect(ref.current.identityId).toBe("logged-in-identity-id");
    expect(ref.current.dpnsName).toBeNull();
  });

  it("persists the resolved DPNS name alongside the identity on login", async () => {
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "logged-in-identity-id",
    });
    mockDpnsUsername.mockResolvedValue("alice.dash");
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("test mnemonic", { rememberMe: true });
    });

    expect(JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "null")).toEqual({
      id: "logged-in-identity-id",
      name: "alice",
    });
    expect(ref.current.dpnsName).toBe("alice");
  });

  it("does not persist on login when rememberMe is false", async () => {
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "logged-in-identity-id",
    });
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("test mnemonic");
    });

    expect(localStorage.getItem(REMEMBERED_KEY)).toBeNull();
    expect(ref.current.rememberedIdentityId).toBeNull();
    expect(ref.current.status).toBe("authenticated");
  });

  it("clears a previously remembered identity when login uses rememberMe: false", async () => {
    // Pre-seed a remembered identity from an earlier session, then log in
    // with the box unchecked. The new identity must NOT be persisted, and
    // the previously-remembered identity must be wiped — otherwise logout
    // falls back to the wrong identity.
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "previously-remembered-id", name: "alice" }),
    );
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "newly-logged-in-id",
    });
    const ref = mountSession();
    expect(ref.current.rememberedIdentityId).toBe("previously-remembered-id");

    await act(async () => {
      await ref.current.login("test mnemonic", { rememberMe: false });
    });

    expect(localStorage.getItem(REMEMBERED_KEY)).toBeNull();
    expect(ref.current.rememberedIdentityId).toBeNull();
    expect(ref.current.status).toBe("authenticated");
    expect(ref.current.identityId).toBe("newly-logged-in-id");
  });

  it("completes login when DPNS resolution rejects (caption is optional)", async () => {
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "logged-in-identity-id",
    });
    // Make resolveDpnsName itself throw, escaping its internal try/catch
    // (e.g., a future refactor removes the swallow, or sdk.dpns is missing).
    // The session must still reach authenticated state with dpnsName=null.
    mockResolveDpnsName.mockRejectedValue(new Error("DPNS service down"));
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("test mnemonic", { rememberMe: true });
    });

    expect(ref.current.status).toBe("authenticated");
    expect(ref.current.error).toBeNull();
    expect(ref.current.dpnsName).toBeNull();
    // Identity is still persisted — just without the optional name caption.
    expect(JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "null")).toEqual({
      id: "logged-in-identity-id",
      name: null,
    });
    // No error toast: a missing name is not a session failure.
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("hydrates dpnsName from the remembered identity record on mount", () => {
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "stored-identity-id", name: "alice" }),
    );
    const ref = mountSession();
    expect(ref.current.dpnsName).toBe("alice");
  });

  it("viewAsRemembered skips the DPNS lookup when a name is already cached", async () => {
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "stored-identity-id", name: "alice" }),
    );
    const ref = mountSession();

    await act(async () => {
      await ref.current.viewAsRemembered();
    });

    expect(mockDpnsUsername).not.toHaveBeenCalled();
    expect(ref.current.dpnsName).toBe("alice");
  });

  it("viewAsRemembered resolves and persists the DPNS name when none is cached", async () => {
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "stored-identity-id" }),
    );
    mockDpnsUsername.mockResolvedValue("alice.dash");
    const ref = mountSession();

    await act(async () => {
      await ref.current.viewAsRemembered();
    });

    expect(mockDpnsUsername).toHaveBeenCalledWith("stored-identity-id");
    expect(ref.current.dpnsName).toBe("alice");
    expect(JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "null")).toEqual({
      id: "stored-identity-id",
      name: "alice",
    });
  });

  it("viewAsRemembered enters browsing mode using the stored identity", async () => {
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "stored-identity-id" }),
    );
    const ref = mountSession();

    await act(async () => {
      await ref.current.viewAsRemembered();
    });

    expect(ref.current.status).toBe("browsing");
    expect(ref.current.identityId).toBe("stored-identity-id");
    expect(ref.current.keyManager).toBeNull();
  });

  it("viewAsRemembered falls back to read-only when nothing is stored", async () => {
    const ref = mountSession();

    await act(async () => {
      await ref.current.viewAsRemembered();
    });

    expect(ref.current.status).toBe("readonly");
    expect(ref.current.identityId).toBeNull();
  });

  it("forgetIdentity clears storage and drops browsing back to readonly", async () => {
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "stored-identity-id" }),
    );
    const ref = mountSession();

    await act(async () => {
      await ref.current.viewAsRemembered();
    });
    expect(ref.current.status).toBe("browsing");

    act(() => {
      ref.current.forgetIdentity();
    });

    expect(localStorage.getItem(REMEMBERED_KEY)).toBeNull();
    expect(ref.current.rememberedIdentityId).toBeNull();
    expect(ref.current.status).toBe("readonly");
    expect(ref.current.identityId).toBeNull();
  });

  it("forgetIdentity also evicts the remembered identity's note cache", async () => {
    const REMEMBERED_ID = "stored-identity-id";
    const NOTES_KEY = `dashnote.notes.${REMEMBERED_ID}.contract-1.testnet`;
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify({ id: REMEMBERED_ID }));
    localStorage.setItem(
      NOTES_KEY,
      JSON.stringify({
        version: 1,
        identityId: REMEMBERED_ID,
        contractId: "contract-1",
        network: "testnet",
        cachedAt: Date.now(),
        notes: [],
      }),
    );

    const ref = mountSession();
    await act(async () => {
      await ref.current.viewAsRemembered();
    });

    act(() => {
      ref.current.forgetIdentity();
    });

    expect(localStorage.getItem(REMEMBERED_KEY)).toBeNull();
    expect(localStorage.getItem(NOTES_KEY)).toBeNull();
  });

  it("logout retains the remembered identity and transitions to browsing", async () => {
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "logged-in-identity-id",
    });
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("test mnemonic", { rememberMe: true });
    });
    expect(ref.current.status).toBe("authenticated");

    act(() => {
      ref.current.logout();
    });

    expect(ref.current.status).toBe("browsing");
    expect(ref.current.identityId).toBe("logged-in-identity-id");
    expect(ref.current.keyManager).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "null"),
    ).toMatchObject({ id: "logged-in-identity-id" });
  });

  it("setContractId evicts the previous contract from the SDK cache when the ID changes", async () => {
    localStorage.setItem("dashnote.contractId", "old-contract-id");
    const ref = mountSession();
    await act(async () => {
      await ref.current.viewAsRemembered();
    });
    mockRefreshContractCache.mockClear();

    act(() => {
      ref.current.setContractId("new-contract-id");
    });

    expect(mockRefreshContractCache).toHaveBeenCalledTimes(1);
    expect(mockRefreshContractCache).toHaveBeenCalledWith({
      sdk: expect.anything(),
      contractId: "old-contract-id",
    });
  });

  it("setContractId does not evict when the new ID equals the current ID", async () => {
    localStorage.setItem("dashnote.contractId", "same-contract-id");
    const ref = mountSession();
    await act(async () => {
      await ref.current.viewAsRemembered();
    });
    mockRefreshContractCache.mockClear();

    act(() => {
      ref.current.setContractId("same-contract-id");
    });

    expect(mockRefreshContractCache).not.toHaveBeenCalled();
  });

  it("logout falls back to readonly when no identity is remembered", async () => {
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "logged-in-identity-id",
    });
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("test mnemonic");
    });

    act(() => {
      ref.current.logout();
    });

    expect(ref.current.status).toBe("readonly");
    expect(ref.current.identityId).toBeNull();
  });

  it("logout clears dpnsName when no identity is remembered", async () => {
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "logged-in-identity-id",
    });
    mockDpnsUsername.mockResolvedValue("alice.dash");
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("test mnemonic");
    });
    expect(ref.current.dpnsName).toBe("alice");

    act(() => {
      ref.current.logout();
    });

    expect(ref.current.dpnsName).toBeNull();
  });

  it("forgetIdentity clears the cached dpnsName", async () => {
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "stored-identity-id", name: "alice" }),
    );
    const ref = mountSession();
    expect(ref.current.dpnsName).toBe("alice");

    act(() => {
      ref.current.forgetIdentity();
    });

    expect(ref.current.dpnsName).toBeNull();
  });

  it("enterReadOnly clears any prior dpnsName because readonly has no identity", async () => {
    mockKeyManagerCreate.mockResolvedValue({
      identityId: "logged-in-identity-id",
    });
    mockDpnsUsername.mockResolvedValue("alice.dash");
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("test mnemonic");
    });
    expect(ref.current.dpnsName).toBe("alice");

    await act(async () => {
      await ref.current.enterReadOnly();
    });

    expect(ref.current.dpnsName).toBeNull();
    expect(ref.current.identityId).toBeNull();
    expect(ref.current.status).toBe("readonly");
  });

  it("dispatches a WIF input to loginWithPrivateKey, not IdentityKeyManager", async () => {
    mockLoginWithPrivateKey.mockResolvedValue({
      identityId: "wif-identity-id",
      identity: { id: "wif-identity-id" },
      identityKey: { mock: "key" },
      signer: { mock: "signer" },
    });
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("cVHcfvcWNc7DvqaPCwM6Z3", { rememberMe: true });
    });

    expect(mockLoginWithPrivateKey).toHaveBeenCalledTimes(1);
    expect(mockKeyManagerCreate).not.toHaveBeenCalled();
    expect(ref.current.status).toBe("authenticated");
    expect(ref.current.identityId).toBe("wif-identity-id");
    expect(ref.current.keyManager?.identityId).toBe("wif-identity-id");
  });

  it("passes the expected identity ID to WIF login", async () => {
    mockLoginWithPrivateKey.mockResolvedValue({
      identityId: "expected-id",
      identity: { id: "expected-id" },
      identityKey: { mock: "key" },
      signer: { mock: "signer" },
    });
    const ref = mountSession();

    await act(async () => {
      await ref.current.login("cVHcfvcWNc7DvqaPCwM6Z3", {
        expectedIdentityId: "expected-id",
      });
    });

    expect(mockLoginWithPrivateKey).toHaveBeenCalledWith(
      expect.anything(),
      "cVHcfvcWNc7DvqaPCwM6Z3",
      "expected-id",
    );
  });

  it("failed WIF login from idle returns to idle without clobbering identity state", async () => {
    mockLoginWithPrivateKey.mockRejectedValue(
      new Error("Found identity X, but this is a transfer key."),
    );
    const ref = mountSession();
    expect(ref.current.status).toBe("idle");

    await act(async () => {
      await ref.current.login("cVHcfvcWNc7DvqaPCwM6Z3").catch(() => undefined);
    });

    expect(ref.current.status).toBe("idle");
    expect(ref.current.keyManager).toBeNull();
    expect(ref.current.identityId).toBeNull();
    expect(ref.current.error).toMatch(/transfer key/);
    // Assert the precise message reaches the toast — guards against a
    // future refactor swallowing it into a generic "Login failed".
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("transfer key"),
    );
  });

  it("failed login from authenticated without rememberMe restores authenticated state", async () => {
    // Locks in the snapshot/restore branch for the case where no
    // remembered identity exists. Without the snapshot/restore, a failed
    // key-swap from an authenticated session would log the user out.
    mockKeyManagerCreate.mockResolvedValueOnce({
      identityId: "logged-in-id",
    });
    const ref = mountSession();
    await act(async () => {
      await ref.current.login("test mnemonic", { rememberMe: false });
    });
    expect(ref.current.status).toBe("authenticated");
    const priorKeyManager = ref.current.keyManager;
    expect(priorKeyManager).not.toBeNull();
    expect(ref.current.rememberedIdentityId).toBeNull();

    mockLoginWithPrivateKey.mockRejectedValueOnce(
      new Error("Found identity Y, but this is a transfer key."),
    );
    await act(async () => {
      await ref.current.login("cVHcfvcWNc7DvqaPCwM6Z3").catch(() => undefined);
    });

    expect(ref.current.status).toBe("authenticated");
    expect(ref.current.identityId).toBe("logged-in-id");
    expect(ref.current.keyManager).toBe(priorKeyManager);
    expect(ref.current.rememberedIdentityId).toBeNull();
    expect(ref.current.error).toMatch(/transfer key/);
  });

  it("failed WIF login from browsing keeps the remembered identity panel intact", async () => {
    // Reproduces the screenshot bug: a wrong-purpose key while browsing
    // a remembered identity should NOT log the user out.
    localStorage.setItem(
      REMEMBERED_KEY,
      JSON.stringify({ id: "remembered-id", name: "alice" }),
    );
    mockLoginWithPrivateKey.mockRejectedValue(
      new Error("Found identity X, but this is a transfer key."),
    );
    const ref = mountSession();
    expect(ref.current.status).toBe("browsing");

    await act(async () => {
      await ref.current.login("cVHcfvcWNc7DvqaPCwM6Z3").catch(() => undefined);
    });

    expect(ref.current.status).toBe("browsing");
    expect(ref.current.identityId).toBe("remembered-id");
    expect(ref.current.dpnsName).toBe("alice");
    expect(ref.current.rememberedIdentityId).toBe("remembered-id");
    expect(ref.current.keyManager).toBeNull();
    expect(ref.current.error).toMatch(/transfer key/);
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("transfer key"),
    );
  });

  it("failed switch-identity from authenticated keeps the active session", async () => {
    // First, authenticate so a real keyManager + remembered identity exist.
    mockKeyManagerCreate.mockResolvedValueOnce({
      identityId: "logged-in-id",
    });
    const ref = mountSession();
    await act(async () => {
      await ref.current.login("test mnemonic", { rememberMe: true });
    });
    expect(ref.current.status).toBe("authenticated");
    const priorKeyManager = ref.current.keyManager;
    expect(priorKeyManager).not.toBeNull();

    // Now attempt to switch with a wrong-purpose WIF. The active session
    // must NOT drop — typing a bad secret while signed in should never log
    // the user out, even if a remembered identity is present in storage.
    mockLoginWithPrivateKey.mockRejectedValueOnce(
      new Error("Found identity Y, but this is a transfer key."),
    );
    await act(async () => {
      await ref.current.login("cVHcfvcWNc7DvqaPCwM6Z3").catch(() => undefined);
    });

    expect(ref.current.status).toBe("authenticated");
    expect(ref.current.identityId).toBe("logged-in-id");
    expect(ref.current.keyManager).toBe(priorKeyManager);
    expect(ref.current.error).toMatch(/transfer key/);
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("transfer key"),
    );
  });

  it("failed mnemonic login from idle restores idle state (not just the WIF path)", async () => {
    mockKeyManagerCreate.mockRejectedValue(new Error("Bad mnemonic checksum."));
    const ref = mountSession();
    expect(ref.current.status).toBe("idle");

    await act(async () => {
      await ref.current
        .login("not a real mnemonic phrase")
        .catch(() => undefined);
    });

    expect(ref.current.status).toBe("idle");
    expect(ref.current.keyManager).toBeNull();
    expect(ref.current.identityId).toBeNull();
    expect(ref.current.error).toMatch(/checksum/);
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("checksum"),
    );
  });

  describe("wallet sessions", () => {
    const grant = {
      keyId: 5,
      contractId: "contract-abc",
      totalBudget: 10_000_000_000n,
      remainingBudget: 9_000_000_000n,
      expiresAt: 1_800_000_000_000,
    };
    const auth = { identity: {}, identityKey: undefined, signer: {} };

    async function signInWithWallet(rememberMe = true) {
      const ref = mountSession();
      await act(async () => {
        await ref.current.loginWithWallet(
          { identityId: "wallet-identity", auth: auth as never, grant },
          { rememberMe },
        );
      });
      return ref;
    }

    it("loginWithWallet authenticates with the granted key and keeps the grant", async () => {
      mockDpnsUsername.mockResolvedValue("alice.dash");
      const ref = await signInWithWallet();

      expect(ref.current.status).toBe("authenticated");
      expect(ref.current.identityId).toBe("wallet-identity");
      expect(ref.current.dpnsName).toBe("alice");
      expect(ref.current.walletGrant).toEqual(grant);
      expect(ref.current.walletNotice).toBeNull();
      expect(await ref.current.keyManager?.getAuth()).toBe(auth);
      expect(
        ref.current.activityLog.find((e) =>
          e.message.startsWith("Identity resolved"),
        )?.detail,
      ).toBe("loginWithWalletAnswer");
      expect(
        JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "null"),
      ).toEqual({ id: "wallet-identity", name: "alice" });
    });

    it("a mnemonic login and a logout both drop the grant", async () => {
      const ref = await signInWithWallet(false);
      mockKeyManagerCreate.mockResolvedValue({ identityId: "mnemonic-id" });
      await act(async () => {
        await ref.current.login("test mnemonic");
      });
      expect(ref.current.walletGrant).toBeNull();

      await act(async () => {
        await ref.current.loginWithWallet(
          { identityId: "wallet-identity", auth: auth as never, grant },
          {},
        );
      });
      expect(ref.current.walletGrant).toEqual(grant);
      act(() => ref.current.logout());
      expect(ref.current.walletGrant).toBeNull();
      expect(ref.current.keyManager).toBeNull();
    });

    it("reportWriteError asks for a renewal when the key ran out", async () => {
      const ref = await signInWithWallet();
      mockClassifyWalletWriteError.mockReturnValue("renew");
      const failure = new Error("budget");

      let action: unknown;
      await act(async () => {
        action = await ref.current.reportWriteError(failure);
      });

      expect(action).toBe("renew");
      expect(mockClassifyWalletWriteError).toHaveBeenCalledWith(failure);
      expect(ref.current.walletNotice).toBe("renew");
      expect(ref.current.status).toBe("authenticated");
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/Renew the connection in DashPay/),
      );

      act(() => ref.current.dismissWalletNotice());
      expect(ref.current.walletNotice).toBeNull();
    });

    it("reportWriteError logs out when the wallet revoked the key", async () => {
      const ref = await signInWithWallet(false);
      mockClassifyWalletWriteError.mockReturnValue("logout");

      await act(async () => {
        await ref.current.reportWriteError(new Error("disabled"));
      });

      expect(mockToastError).toHaveBeenCalledWith(
        "Your wallet revoked this browser's key. Sign in again.",
      );
      expect(ref.current.keyManager).toBeNull();
      expect(ref.current.walletGrant).toBeNull();
      expect(ref.current.status).toBe("readonly");
    });

    it("reportWriteError ignores failures outside a wallet session", async () => {
      mockKeyManagerCreate.mockResolvedValue({ identityId: "mnemonic-id" });
      const ref = mountSession();
      await act(async () => {
        await ref.current.login("test mnemonic");
      });

      let action: unknown = "unset";
      await act(async () => {
        action = await ref.current.reportWriteError(new Error("boom"));
      });
      expect(action).toBeNull();
      expect(mockClassifyWalletWriteError).not.toHaveBeenCalled();
    });

    it("refreshWalletGrant reads the latest limits", async () => {
      const ref = await signInWithWallet();
      const fresher = { ...grant, remainingBudget: 1n };
      mockReadWalletGrant.mockResolvedValue(fresher);

      await act(async () => {
        await ref.current.refreshWalletGrant();
      });

      expect(mockReadWalletGrant).toHaveBeenCalledWith(
        expect.anything(),
        "wallet-identity",
        5,
      );
      expect(ref.current.walletGrant).toEqual(fresher);
    });

    it("refreshWalletGrant logs out when the wallet disabled the key", async () => {
      const ref = await signInWithWallet();
      mockReadWalletGrant.mockResolvedValue(null);

      await act(async () => {
        await ref.current.refreshWalletGrant();
      });

      expect(mockToastError).toHaveBeenCalledWith(
        "Your wallet disabled this key.",
      );
      expect(ref.current.keyManager).toBeNull();
      expect(ref.current.walletGrant).toBeNull();
      expect(ref.current.status).toBe("browsing");
    });

    function pending<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    }

    async function renewTo(
      ref: { current: SessionValue },
      identityId: string,
      keyId: number,
    ) {
      await act(async () => {
        await ref.current.loginWithWallet(
          { identityId, auth: auth as never, grant: { ...grant, keyId } },
          { rememberMe: true },
        );
      });
    }

    it("refreshWalletGrant ignores a result for a key that was since replaced", async () => {
      const ref = await signInWithWallet();
      const read = pending<null>();
      mockReadWalletGrant.mockReturnValue(read.promise);
      let refresh!: Promise<void>;
      act(() => {
        refresh = ref.current.refreshWalletGrant();
      });

      await renewTo(ref, "wallet-identity", 6);
      await act(async () => {
        read.resolve(null);
        await refresh;
      });

      expect(mockToastError).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("authenticated");
      expect(ref.current.walletGrant?.keyId).toBe(6);
    });

    it("refreshWalletGrant ignores a result that lands before the renewed grant renders", async () => {
      const ref = await signInWithWallet();
      const read = pending<null>();
      mockReadWalletGrant.mockReturnValue(read.promise);
      let refresh!: Promise<void>;
      act(() => {
        refresh = ref.current.refreshWalletGrant();
      });

      // The renewal and the stale read settle inside one act, so React has
      // not re-rendered the new grant when the old read comes back.
      await act(async () => {
        await ref.current.loginWithWallet(
          {
            identityId: "wallet-identity",
            auth: auth as never,
            grant: { ...grant, keyId: 6 },
          },
          { rememberMe: true },
        );
        read.resolve(null);
        await refresh;
      });

      expect(mockToastError).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("authenticated");
      expect(ref.current.walletGrant?.keyId).toBe(6);
    });

    it("refreshWalletGrant does not apply limits to another identity's key with the same id", async () => {
      const ref = await signInWithWallet();
      const read = pending<typeof grant>();
      mockReadWalletGrant.mockReturnValue(read.promise);
      let refresh!: Promise<void>;
      act(() => {
        refresh = ref.current.refreshWalletGrant();
      });

      await renewTo(ref, "other-identity", 5);
      await act(async () => {
        read.resolve({ ...grant, remainingBudget: 1n });
        await refresh;
      });

      expect(ref.current.identityId).toBe("other-identity");
      expect(ref.current.walletGrant).toEqual(grant);
    });

    it("reportWriteError ignores a failure from a key that was since replaced", async () => {
      const ref = await signInWithWallet();
      mockClassifyWalletWriteError.mockReturnValue("logout");
      // The write handler holds the session from the render that started
      // the write, so its report arrives through that render's callback.
      const reportFromOldKey = ref.current.reportWriteError;

      await renewTo(ref, "wallet-identity", 6);
      let action: unknown = "unset";
      await act(async () => {
        action = await reportFromOldKey(new Error("disabled"));
      });

      expect(action).toBeNull();
      expect(mockToastError).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("authenticated");
      expect(ref.current.walletGrant?.keyId).toBe(6);
    });

    it("signs out when the app switches away from the key's contract", async () => {
      localStorage.setItem("dashnote.contractId", "contract-abc");
      const ref = await signInWithWallet();

      act(() => ref.current.setContractId("contract-xyz"));

      expect(ref.current.contractId).toBe("contract-xyz");
      expect(mockToastError).toHaveBeenCalledWith(
        "Your wallet key is bound to the previous contract. Sign in again to use this one.",
      );
      expect(ref.current.walletGrant).toBeNull();
      expect(ref.current.keyManager).toBeNull();
    });

    it("keeps the wallet session when the contract stays the key's own", async () => {
      localStorage.setItem("dashnote.contractId", "contract-abc");
      const ref = await signInWithWallet();

      act(() => ref.current.setContractId(" contract-abc "));

      expect(mockToastError).not.toHaveBeenCalled();
      expect(ref.current.walletGrant).toEqual(grant);
      expect(ref.current.status).toBe("authenticated");
    });

    it("staying signed in also remembers the identity", async () => {
      const ref = mountSession();
      await act(async () => {
        await ref.current.loginWithWallet(
          { identityId: "wallet-identity", auth: auth as never, grant },
          { rememberMe: false, staySignedIn: true },
        );
      });
      expect(ref.current.rememberedIdentityId).toBe("wallet-identity");
      expect(
        JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "null"),
      ).toEqual({ id: "wallet-identity", name: null });
      expect(ref.current.walletSessionKept).toBe(true);
    });

    it("a sign-in without staying signed in keeps the session to this tab", async () => {
      const ref = await signInWithWallet();
      expect(ref.current.walletSessionKept).toBe(false);
    });

    describe("dropping the kept session", () => {
      async function keptSession() {
        localStorage.setItem("dashnote.contractId", "contract-abc");
        const ref = mountSession();
        await act(async () => {
          await ref.current.loginWithWallet(
            { identityId: "wallet-identity", auth: auth as never, grant },
            { staySignedIn: true },
          );
        });
        store.clearWalletSession.mockClear();
        return ref;
      }

      it("on logout", async () => {
        const ref = await keptSession();
        act(() => ref.current.logout());
        expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
        expect(ref.current.walletSessionKept).toBe(false);
      });

      it("on forgetting the identity", async () => {
        const ref = await keptSession();
        act(() => ref.current.forgetIdentity());
        expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
        expect(ref.current.walletSessionKept).toBe(false);
      });

      it("on a mnemonic or WIF sign-in", async () => {
        const ref = await keptSession();
        mockKeyManagerCreate.mockResolvedValue({ identityId: "mnemonic-id" });
        await act(async () => {
          await ref.current.login("test mnemonic");
        });
        expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
        expect(ref.current.walletSessionKept).toBe(false);
      });

      it("not on a mnemonic sign-in that fails", async () => {
        const ref = await keptSession();
        mockKeyManagerCreate.mockRejectedValue(new Error("bad mnemonic"));
        await act(async () => {
          await ref.current.login("test mnemonic").catch(() => {});
        });
        expect(store.clearWalletSession).not.toHaveBeenCalled();
        expect(ref.current.walletSessionKept).toBe(true);
      });

      it("on switching away from the key's contract", async () => {
        const ref = await keptSession();
        act(() => ref.current.setContractId("contract-xyz"));
        expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
      });

      it("when a refresh finds the key gone", async () => {
        const ref = await keptSession();
        mockReadWalletGrant.mockResolvedValue(null);
        await act(async () => {
          await ref.current.refreshWalletGrant();
        });
        expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
      });

      it("when a write shows the key was revoked", async () => {
        const ref = await keptSession();
        mockClassifyWalletWriteError.mockReturnValue("logout");
        await act(async () => {
          await ref.current.reportWriteError(new Error("disabled"));
        });
        expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
      });

      it("swallows a failure to clear", async () => {
        const ref = await keptSession();
        store.clearWalletSession.mockRejectedValue(new Error("blocked"));
        act(() => ref.current.logout());
        await act(async () => {});
        expect(ref.current.status).toBe("browsing");
      });
    });
  });

  describe("restoring a kept wallet session", () => {
    const grant = {
      keyId: 5,
      contractId: "contract-abc",
      totalBudget: 10_000_000_000n,
      remainingBudget: 9_000_000_000n,
      expiresAt: 1_800_000_000_000,
    };
    const auth = { identity: {}, identityKey: undefined, signer: {} };
    const stored = {
      identityId: "wallet-identity",
      keyId: 5,
      contractId: "contract-abc",
      totalBudget: 10_000_000_000n,
      expiresAt: 1_800_000_000_000,
      grantedAt: 1_700_000_000_000,
    };
    let privateKey: Uint8Array;

    beforeEach(() => {
      localStorage.setItem("dashnote.contractId", "contract-abc");
      localStorage.setItem(
        REMEMBERED_KEY,
        JSON.stringify({ id: "wallet-identity", name: "alice" }),
      );
      privateKey = new Uint8Array(32).fill(7);
      store.peekWalletSession.mockResolvedValue(stored);
      store.loadWalletSession.mockResolvedValue({
        session: stored,
        privateKey,
      });
      mockRestoreWalletLogin.mockResolvedValue({
        login: { identityId: "wallet-identity", auth, grant },
        renewNeeded: false,
      });
    });

    async function settle(ref: { current: SessionValue }) {
      await waitFor(() => expect(ref.current.restoringWallet).toBe(false));
    }

    it("signs back in with the kept key for the remembered identity", async () => {
      mockDpnsUsername.mockResolvedValue("alice.dash");
      const ref = mountSession();
      expect(ref.current.restoringWallet).toBe(true);
      await settle(ref);

      expect(mockRestoreWalletLogin).toHaveBeenCalledWith(
        expect.anything(),
        { identityId: "wallet-identity", keyId: 5, contractId: "contract-abc" },
        privateKey,
      );
      expect(ref.current.status).toBe("authenticated");
      expect(ref.current.identityId).toBe("wallet-identity");
      expect(ref.current.walletGrant).toEqual(grant);
      expect(ref.current.walletSessionKept).toBe(true);
      expect(ref.current.walletNotice).toBeNull();
      expect(ref.current.rememberedIdentityId).toBe("wallet-identity");
      expect(await ref.current.keyManager?.getAuth()).toBe(auth);
      expect(store.clearWalletSession).not.toHaveBeenCalled();
    });

    it("asks for a renewal when the kept key can no longer write", async () => {
      mockRestoreWalletLogin.mockResolvedValue({
        login: { identityId: "wallet-identity", auth, grant },
        renewNeeded: true,
      });
      const ref = mountSession();
      await settle(ref);
      expect(ref.current.status).toBe("authenticated");
      expect(ref.current.walletNotice).toBe("renew");
    });

    it("drops a session kept for another identity", async () => {
      localStorage.setItem(
        REMEMBERED_KEY,
        JSON.stringify({ id: "someone-else" }),
      );
      const ref = mountSession();
      await settle(ref);
      expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
      expect(store.loadWalletSession).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("browsing");
      expect(ref.current.identityId).toBe("someone-else");
    });

    it("drops a kept session when no identity is remembered", async () => {
      localStorage.removeItem(REMEMBERED_KEY);
      const ref = mountSession();
      expect(ref.current.restoringWallet).toBe(false);
      await waitFor(() =>
        expect(store.clearWalletSession).toHaveBeenCalledTimes(1),
      );
      expect(store.loadWalletSession).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("idle");
    });

    it("drops a session kept for another contract", async () => {
      localStorage.setItem("dashnote.contractId", "contract-xyz");
      const ref = mountSession();
      await settle(ref);
      expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
      expect(store.loadWalletSession).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("browsing");
    });

    it("forgets a key the wallet no longer honours and browses", async () => {
      mockRestoreWalletLogin.mockResolvedValue(null);
      const ref = mountSession();
      await settle(ref);
      expect(store.clearWalletSession).toHaveBeenCalledTimes(1);
      expect(ref.current.status).toBe("browsing");
      expect(ref.current.keyManager).toBeNull();
      expect(ref.current.identityId).toBe("wallet-identity");
      const entry = ref.current.activityLog.find(
        (e) =>
          e.message === "Your wallet key is no longer valid. Sign in again.",
      );
      expect(entry?.level).toBe("info");
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it("keeps the record when the network fails, and browses", async () => {
      mockRestoreWalletLogin.mockRejectedValue(new Error("node down"));
      const ref = mountSession();
      await settle(ref);
      expect(store.clearWalletSession).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("browsing");
      expect(ref.current.keyManager).toBeNull();
      expect(mockToastError).not.toHaveBeenCalled();
      expect(
        ref.current.activityLog.some((e) => e.message.includes("node down")),
      ).toBe(true);
    });

    it("keeps the record when connecting fails", async () => {
      mockCreateClient.mockRejectedValue(new Error("no route"));
      const ref = mountSession();
      await settle(ref);
      expect(store.clearWalletSession).not.toHaveBeenCalled();
      expect(store.loadWalletSession).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("browsing");
      expect(ref.current.sdk).toBeNull();
    });

    it("treats unreadable storage as no record", async () => {
      store.peekWalletSession.mockRejectedValue(new Error("blocked"));
      const ref = mountSession();
      await settle(ref);
      expect(store.loadWalletSession).not.toHaveBeenCalled();
      expect(store.clearWalletSession).not.toHaveBeenCalled();
      expect(ref.current.status).toBe("browsing");
    });

    it("does not sign back in after a logout during the restore", async () => {
      let finish!: (value: unknown) => void;
      mockRestoreWalletLogin.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const ref = mountSession();
      await waitFor(() => expect(mockRestoreWalletLogin).toHaveBeenCalled());
      act(() => ref.current.logout());
      await act(async () => {
        finish({
          login: { identityId: "wallet-identity", auth, grant },
          renewNeeded: false,
        });
      });
      await settle(ref);
      expect(ref.current.status).not.toBe("authenticated");
      expect(ref.current.walletGrant).toBeNull();
      expect(ref.current.walletSessionKept).toBe(false);
    });

    it("restores once under StrictMode", async () => {
      const ref = { current: null as unknown as SessionValue };
      render(
        <StrictMode>
          <SessionProvider>
            <Harness
              onValue={(value) => {
                ref.current = value;
              }}
            />
          </SessionProvider>
        </StrictMode>,
      );
      await settle(ref);
      expect(ref.current.status).toBe("authenticated");
      expect(mockRestoreWalletLogin).toHaveBeenCalledTimes(1);
    });
  });

  describe("activity log", () => {
    it("appends entries with default info level and a generated id", () => {
      const ref = mountSession();
      expect(ref.current.activityLog).toEqual([]);

      act(() => {
        ref.current.log("hello");
      });

      expect(ref.current.activityLog).toHaveLength(1);
      const [entry] = ref.current.activityLog;
      expect(entry.message).toBe("hello");
      expect(entry.level).toBe("info");
      expect(entry.detail).toBeUndefined();
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.timestamp).toBe("number");
    });

    it("accepts the legacy string-level call shape", () => {
      const ref = mountSession();
      act(() => {
        ref.current.log("done", "success");
      });
      expect(ref.current.activityLog[0].level).toBe("success");
    });

    it("accepts the object-form call shape and carries detail", () => {
      const ref = mountSession();
      act(() => {
        ref.current.log("saving", { level: "info", detail: "documents.get" });
      });
      const [entry] = ref.current.activityLog;
      expect(entry.level).toBe("info");
      expect(entry.detail).toBe("documents.get");
    });

    it("prepends new entries so the newest is first", () => {
      const ref = mountSession();
      act(() => {
        ref.current.log("first");
      });
      act(() => {
        ref.current.log("second");
      });
      expect(ref.current.activityLog.map((e) => e.message)).toEqual([
        "second",
        "first",
      ]);
    });

    it("caps the log at ACTIVITY_LOG_LIMIT (200) entries", () => {
      const ref = mountSession();
      act(() => {
        for (let i = 0; i < 205; i += 1) ref.current.log(`msg-${i}`);
      });
      expect(ref.current.activityLog).toHaveLength(200);
      // Newest first; oldest five (msg-0..msg-4) should have been evicted.
      expect(ref.current.activityLog[0].message).toBe("msg-204");
      expect(
        ref.current.activityLog.find((e) => e.message === "msg-4"),
      ).toBeUndefined();
      expect(
        ref.current.activityLog.find((e) => e.message === "msg-5"),
      ).toBeDefined();
    });

    it("clearActivityLog empties the log", () => {
      const ref = mountSession();
      act(() => {
        ref.current.log("a");
        ref.current.log("b");
      });
      expect(ref.current.activityLog).toHaveLength(2);
      act(() => {
        ref.current.clearActivityLog();
      });
      expect(ref.current.activityLog).toEqual([]);
    });

    it("fires toast.success and toast.error matching the log level", () => {
      const ref = mountSession();
      act(() => {
        ref.current.log("ok", "success");
        ref.current.log("nope", "error");
        ref.current.log("info-line");
      });
      expect(mockToastSuccess).toHaveBeenCalledWith("ok");
      expect(mockToastError).toHaveBeenCalledWith("nope");
      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });
  });
});

describe("connection settings", () => {
  it("connects with a short connect timeout so a dead node fails fast", async () => {
    mockCreateClient.mockResolvedValue({
      documents: {},
      dpns: { username: mockDpnsUsername },
    });
    const ref = mountSession();

    await act(async () => {
      await ref.current.enterReadOnly();
    });

    expect(mockCreateClient).toHaveBeenCalledWith("testnet", {
      settings: { connectTimeoutMs: 5_000 },
    });
  });
});
