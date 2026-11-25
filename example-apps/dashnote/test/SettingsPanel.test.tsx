// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPanel } from "../src/components/SettingsPanel";

const { mockUseSession, mockRegisterContract, mockClearCachedNotes } =
  vi.hoisted(() => ({
    mockUseSession: vi.fn(),
    mockRegisterContract: vi.fn(),
    mockClearCachedNotes: vi.fn(),
  }));

vi.mock("../src/session/useSession", () => ({
  useSession: mockUseSession,
}));

vi.mock("../src/dash/contract", () => ({
  registerContract: mockRegisterContract,
}));

vi.mock("../src/lib/notesCache", () => ({
  clearCachedNotes: mockClearCachedNotes,
}));

vi.mock("../src/lib/walletSessionStore", () => ({
  walletSessionStorageAvailable: vi.fn().mockResolvedValue(true),
  saveWalletSession: vi.fn().mockResolvedValue(undefined),
  peekWalletSession: vi.fn().mockResolvedValue(null),
  loadWalletSession: vi.fn().mockResolvedValue(null),
  clearWalletSession: vi.fn().mockResolvedValue(undefined),
}));

interface SessionOverrides {
  status?: string;
  identityId?: string | null;
  contractId?: string | null;
  rememberedIdentityId?: string | null;
  dpnsName?: string | null;
  sdk?: unknown;
  keyManager?: unknown;
  setContractId?: ReturnType<typeof vi.fn>;
  forgetIdentity?: ReturnType<typeof vi.fn>;
  logout?: ReturnType<typeof vi.fn>;
  log?: ReturnType<typeof vi.fn>;
  walletGrant?: unknown;
  walletNotice?: "renew" | null;
  walletSessionKept?: boolean;
  refreshWalletGrant?: ReturnType<typeof vi.fn>;
  dismissWalletNotice?: ReturnType<typeof vi.fn>;
}

function makeSession(overrides: SessionOverrides = {}) {
  return {
    status: "authenticated",
    error: null,
    sdk: { documents: {} },
    keyManager: { getAuth: vi.fn() },
    identityId: "id-1234567890",
    contractId: "contract-abc",
    rememberedIdentityId: null,
    dpnsName: null,
    log: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    setContractId: vi.fn(),
    enterReadOnly: vi.fn(),
    viewAsRemembered: vi.fn(),
    forgetIdentity: vi.fn(),
    walletGrant: null,
    walletNotice: null,
    walletSessionKept: false,
    refreshWalletGrant: vi.fn().mockResolvedValue(undefined),
    dismissWalletNotice: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseSession.mockReset();
  mockRegisterContract.mockReset();
  mockClearCachedNotes.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SettingsPanel", () => {
  it("renders the identity ID and DPNS caption when authenticated", () => {
    mockUseSession.mockReturnValue(
      makeSession({ identityId: "id-abc", dpnsName: "alice" }),
    );
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    const block = screen.getByTestId("settings-identity-block");
    expect(within(block).getByText("id-abc")).toBeTruthy();
    expect(within(block).getByText("✓ alice.dash")).toBeTruthy();
  });

  it("omits the DPNS caption when no name is set", () => {
    mockUseSession.mockReturnValue(
      makeSession({ identityId: "id-abc", dpnsName: null }),
    );
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    const block = screen.getByTestId("settings-identity-block");
    expect(within(block).queryByText(/\.dash$/)).toBeNull();
  });

  it("renders the network indicator as testnet", () => {
    mockUseSession.mockReturnValue(makeSession());
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    expect(screen.getByText("testnet")).toBeTruthy();
  });

  it("shows an empty state with a Sign in button when not signed in or browsing", () => {
    mockUseSession.mockReturnValue(
      makeSession({ status: "readonly", identityId: null, keyManager: null }),
    );
    const onOpenLogin = vi.fn();
    render(
      <SettingsPanel onOpenLogin={onOpenLogin} onRenewInWallet={vi.fn()} />,
    );
    expect(screen.getByText(/sign in to view/i)).toBeTruthy();
    expect(screen.queryByTestId("settings-identity-block")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(onOpenLogin).toHaveBeenCalled();
  });

  it("hides the danger zone when nothing is remembered", () => {
    mockUseSession.mockReturnValue(makeSession({ rememberedIdentityId: null }));
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /forget this device/i }),
    ).toBeNull();
  });

  it("calls session.forgetIdentity when Forget this device is clicked", () => {
    const forgetIdentity = vi.fn();
    mockUseSession.mockReturnValue(
      makeSession({
        rememberedIdentityId: "id-1234567890",
        forgetIdentity,
      }),
    );
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /forget this device/i }),
    );
    expect(forgetIdentity).toHaveBeenCalled();
  });

  it("copies the identity ID to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockUseSession.mockReturnValue(makeSession({ identityId: "id-xyz" }));
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /copy identity id/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("id-xyz");
    });
  });

  it("applies a pasted contract ID via session.setContractId", () => {
    const setContractId = vi.fn();
    mockUseSession.mockReturnValue(
      makeSession({ contractId: "old", setContractId }),
    );
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    const input = screen.getByPlaceholderText(/paste a note contract id/i);
    fireEvent.change(input, { target: { value: " new-contract " } });
    fireEvent.click(screen.getByRole("button", { name: /use this id/i }));
    expect(setContractId).toHaveBeenCalledWith("new-contract");
  });

  it("registers a fresh contract with the session sdk, keyManager, and log", async () => {
    const setContractId = vi.fn();
    const sdk = { documents: {}, marker: "sdk" };
    const keyManager = { getAuth: vi.fn(), marker: "km" };
    const log = vi.fn();
    mockRegisterContract.mockResolvedValue("brand-new-id");
    mockUseSession.mockReturnValue(
      makeSession({ setContractId, sdk, keyManager, log }),
    );
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /register a fresh contract/i }),
    );
    await waitFor(() => {
      expect(mockRegisterContract).toHaveBeenCalledWith({
        sdk,
        keyManager,
        log,
      });
    });
    await waitFor(() => {
      expect(setContractId).toHaveBeenCalledWith("brand-new-id");
    });
  });

  it("rejects concurrent register clicks before React disables the button", async () => {
    // Hold the first call open so a second invocation can race past
    // setRegistering(true). The ref guard inside the hook must short-circuit
    // the second call so the SDK only sees one publish.
    let resolveFirst: ((value: string) => void) | undefined;
    mockRegisterContract.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    mockUseSession.mockReturnValue(makeSession({ setContractId: vi.fn() }));
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    const button = screen.getByRole("button", {
      name: /register a fresh contract/i,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockRegisterContract).toHaveBeenCalledTimes(1);
    resolveFirst?.("only-id");
    await waitFor(() => {
      expect(mockRegisterContract).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces a registration failure without switching contracts", async () => {
    const setContractId = vi.fn();
    mockRegisterContract.mockRejectedValue(new Error("Network down"));
    mockUseSession.mockReturnValue(makeSession({ setContractId }));
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /register a fresh contract/i }),
    );
    expect(await screen.findByText("Network down")).toBeTruthy();
    expect(setContractId).not.toHaveBeenCalled();
  });

  it("invokes clearCachedNotes with the current identity ID", () => {
    mockUseSession.mockReturnValue(makeSession({ identityId: "id-cache" }));
    render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /clear local cache for this device/i,
      }),
    );
    expect(mockClearCachedNotes).toHaveBeenCalledWith("id-cache");
  });

  describe("wallet connection", () => {
    const grant = {
      keyId: 7,
      contractId: "8d6heK6CoskLBi6Rs7cChRG9RuckcZqZst28BdviBe8y",
      totalBudget: 10_000_000_000n,
      remainingBudget: 2_500_000_000n,
      expiresAt: Date.UTC(2027, 1, 20, 12),
    };

    it("is hidden for a mnemonic or WIF session", () => {
      mockUseSession.mockReturnValue(makeSession());
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      expect(screen.queryByText("Wallet connection")).toBeNull();
    });

    it("shows what the wallet granted", () => {
      mockUseSession.mockReturnValue(makeSession({ walletGrant: grant }));
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      const block = screen.getByTestId("wallet-connection");
      expect(block.textContent).toContain("0.0250 of 0.1000 DASH");
      expect(block.textContent).toContain(
        new Date(grant.expiresAt).toLocaleDateString(),
      );
      expect(block.textContent).toContain("7");
      expect(block.textContent).toContain("8d6heK6Cos…BdviBe8y");
    });

    it("says whether the session is kept on this device", () => {
      mockUseSession.mockReturnValue(
        makeSession({ walletGrant: grant, walletSessionKept: true }),
      );
      const { unmount } = render(
        <SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />,
      );
      expect(screen.getByText("On this device")).toBeTruthy();
      expect(screen.getByTestId("wallet-session-kept").textContent).toBe(
        "Kept on this device",
      );
      unmount();

      mockUseSession.mockReturnValue(makeSession({ walletGrant: grant }));
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      expect(screen.getByTestId("wallet-session-kept").textContent).toBe(
        "This tab only",
      );
    });

    it("tells a wallet user that forgetting leaves the wallet connected", () => {
      const forgetIdentity = vi.fn();
      mockUseSession.mockReturnValue(
        makeSession({
          walletGrant: grant,
          walletSessionKept: true,
          rememberedIdentityId: "id-1234567890",
          forgetIdentity,
        }),
      );
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      expect(
        screen.getByText(
          /The wallet still holds the connection; Disconnect in DashPay to revoke the key\./,
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          /Removes the remembered identity, deletes any wallet key kept on this device and clears the identity's cached notes from this browser\./,
        ),
      ).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: /forget this device/i }),
      );
      expect(forgetIdentity).toHaveBeenCalledTimes(1);
    });

    it("leaves the wallet out of Forget for a mnemonic session", () => {
      mockUseSession.mockReturnValue(
        makeSession({ rememberedIdentityId: "id-1234567890" }),
      );
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      expect(screen.queryByText(/The wallet still holds/)).toBeNull();
    });

    it("shows a grant without limits", () => {
      mockUseSession.mockReturnValue(
        makeSession({
          walletGrant: {
            ...grant,
            totalBudget: null,
            remainingBudget: null,
            expiresAt: null,
          },
        }),
      );
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      const block = screen.getByTestId("wallet-connection");
      expect(block.textContent).toContain("no limit");
      expect(block.textContent).toContain("never");
    });

    it("refreshes the grant and opens the renewal", async () => {
      const refreshWalletGrant = vi.fn().mockResolvedValue(undefined);
      const onRenewInWallet = vi.fn();
      mockUseSession.mockReturnValue(
        makeSession({ walletGrant: grant, refreshWalletGrant }),
      );
      render(
        <SettingsPanel
          onOpenLogin={vi.fn()}
          onRenewInWallet={onRenewInWallet}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(refreshWalletGrant).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy(),
      );

      fireEvent.click(screen.getByRole("button", { name: "Renew in DashPay" }));
      expect(onRenewInWallet).toHaveBeenCalledTimes(1);
    });

    it("explains that writes stop until the key is renewed", () => {
      mockUseSession.mockReturnValue(
        makeSession({ walletGrant: grant, walletNotice: "renew" }),
      );
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      const text = screen.getByRole("alert").textContent ?? "";
      expect(text).toMatch(
        /has run out of allowance or expired, so the network will refuse new writes until you renew the connection in DashPay\./,
      );
      expect(text).not.toMatch(/last write/);
    });

    it("dismisses the renewal notice", () => {
      const dismissWalletNotice = vi.fn();
      mockUseSession.mockReturnValue(
        makeSession({
          walletGrant: grant,
          walletNotice: "renew",
          dismissWalletNotice,
        }),
      );
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      fireEvent.click(
        within(screen.getByRole("alert")).getByRole("button", {
          name: "Dismiss",
        }),
      );
      expect(dismissWalletNotice).toHaveBeenCalledTimes(1);
    });

    it("can't register a contract with a wallet key", () => {
      mockUseSession.mockReturnValue(makeSession({ walletGrant: grant }));
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      const button = screen.getByRole("button", {
        name: "Register a fresh contract",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(
        screen.getByText(
          "Registering a contract needs a mnemonic or private-key sign-in; a wallet key only writes notes.",
        ),
      ).toBeTruthy();
    });

    it("offers registration outside a wallet session", () => {
      mockUseSession.mockReturnValue(makeSession());
      render(<SettingsPanel onOpenLogin={vi.fn()} onRenewInWallet={vi.fn()} />);
      const button = screen.getByRole("button", {
        name: "Register a fresh contract",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(screen.queryByText(/a wallet key only writes notes/)).toBeNull();
    });
  });
});
