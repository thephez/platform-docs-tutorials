// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App";

const { mockUseSession } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
}));

vi.mock("../src/session/useSession", () => ({
  useSession: mockUseSession,
}));

vi.mock("sonner", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

vi.mock("../src/components/NotesWorkspace", () => ({
  NotesWorkspace: () => <div>Notes Workspace</div>,
}));

vi.mock("../src/components/HowItWorks", () => ({
  HowItWorks: () => <div>How It Works</div>,
}));

vi.mock("../src/components/AppShell", () => ({
  AppShell: ({
    children,
    onLoginOpen,
    onTabChange,
    onOpenActivity,
  }: {
    children: ReactNode;
    onLoginOpen: () => void;
    onTabChange: (tab: "notes" | "how-it-works" | "settings") => void;
    onOpenActivity?: () => void;
  }) => (
    <div>
      <button type="button" onClick={onLoginOpen}>
        Open settings
      </button>
      {onOpenActivity && (
        <button type="button" onClick={onOpenActivity}>
          Open shell activity
        </button>
      )}
      <button type="button" onClick={() => onTabChange("how-it-works")}>
        How it works tab
      </button>
      <button type="button" onClick={() => onTabChange("settings")}>
        Settings tab
      </button>
      {children}
    </div>
  ),
}));

vi.mock("../src/components/LoginModal", () => ({
  LoginModal: ({
    open,
    onClose,
    initialView,
    renew,
  }: {
    open: boolean;
    onClose: () => void;
    initialView?: string;
    renew?: boolean;
  }) => (
    <div>
      <span>login:{String(open)}</span>
      <button type="button" onClick={onClose}>
        Close login
      </button>
      <span>view:{String(initialView)}</span>
      <span>renew:{String(Boolean(renew))}</span>
    </div>
  ),
}));

vi.mock("../src/components/ActivityPanel", () => ({
  ActivityPanel: ({ open }: { open: boolean }) => (
    <div>activity:{String(open)}</div>
  ),
}));

vi.mock("../src/components/NotesToolbar", () => ({
  NotesToolbar: ({
    title,
    onOpenActivity,
  }: {
    title: string;
    onOpenActivity?: () => void;
  }) => (
    <div>
      toolbar:{title}
      {onOpenActivity && (
        <button type="button" onClick={onOpenActivity}>
          Open activity
        </button>
      )}
    </div>
  ),
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    status: "idle",
    error: null,
    sdk: null,
    identityId: null,
    contractId: null,
    rememberedIdentityId: null,
    dpnsName: null,
    restoringWallet: false,
    enterReadOnly: vi.fn().mockResolvedValue(undefined),
    viewAsRemembered: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseSession.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("auto-connects in read-only mode from idle when no identity is remembered", async () => {
    const session = makeSession();
    mockUseSession.mockReturnValue(session);

    render(<App />);

    await waitFor(() => {
      expect(session.enterReadOnly).toHaveBeenCalled();
    });
    expect(session.viewAsRemembered).not.toHaveBeenCalled();
  });

  it("finishes wiring up the SDK when boot starts in browsing mode without an SDK", async () => {
    const session = makeSession({
      status: "browsing",
      sdk: null,
      rememberedIdentityId: "remembered-identity-id",
    });
    mockUseSession.mockReturnValue(session);

    render(<App />);

    await waitFor(() => {
      expect(session.viewAsRemembered).toHaveBeenCalled();
    });
    expect(session.enterReadOnly).not.toHaveBeenCalled();
  });

  it("waits for a kept wallet session to restore before browsing", async () => {
    const session = makeSession({
      status: "browsing",
      sdk: null,
      rememberedIdentityId: "remembered-identity-id",
      restoringWallet: true,
    });
    mockUseSession.mockReturnValue(session);

    const { rerender } = render(<App />);
    await Promise.resolve();
    expect(session.viewAsRemembered).not.toHaveBeenCalled();
    expect(session.enterReadOnly).not.toHaveBeenCalled();

    const restored = { ...session, restoringWallet: false };
    mockUseSession.mockReturnValue(restored);
    rerender(<App />);
    await waitFor(() => {
      expect(restored.viewAsRemembered).toHaveBeenCalled();
    });
  });

  it("does not re-trigger viewAsRemembered once the SDK is initialized", async () => {
    const session = makeSession({
      status: "browsing",
      sdk: {},
      rememberedIdentityId: "remembered-identity-id",
    });
    mockUseSession.mockReturnValue(session);

    render(<App />);

    await Promise.resolve();
    expect(session.viewAsRemembered).not.toHaveBeenCalled();
    expect(session.enterReadOnly).not.toHaveBeenCalled();
  });

  it("switches tabs and opens the settings modal", () => {
    mockUseSession.mockReturnValue(makeSession({ status: "readonly" }));

    render(<App />);
    expect(screen.getAllByText("Notes Workspace")[0]).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /how it works tab/i }));
    expect(screen.getByText("How It Works")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByText("login:true")).toBeTruthy();
  });

  it("opens the activity panel via ⌘L hotkey and toolbar button", () => {
    mockUseSession.mockReturnValue(makeSession({ status: "readonly" }));

    render(<App />);
    expect(screen.getByText("activity:false")).toBeTruthy();

    fireEvent.keyDown(window, { key: "l", metaKey: true });
    expect(screen.getByText("activity:true")).toBeTruthy();

    // Toggling again closes it.
    fireEvent.keyDown(window, { key: "l", metaKey: true });
    expect(screen.getByText("activity:false")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /open activity/i }));
    expect(screen.getByText("activity:true")).toBeTruthy();
  });

  it("opens the activity panel from the shell activity action", () => {
    mockUseSession.mockReturnValue(makeSession({ status: "readonly" }));

    render(<App />);
    expect(screen.getByText("activity:false")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /open shell activity/i }),
    );
    expect(screen.getByText("activity:true")).toBeTruthy();
  });

  it("renders SettingsPanel when the settings tab is selected", () => {
    mockUseSession.mockReturnValue(
      makeSession({
        status: "authenticated",
        identityId: "id-app-settings",
        contractId: "contract-app-settings",
        sdk: { documents: {} },
      }),
    );

    render(<App />);
    expect(screen.queryByTestId("settings-identity-block")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /settings tab/i }));
    expect(screen.getByTestId("settings-identity-block")).toBeTruthy();
    expect(screen.getByText("id-app-settings")).toBeTruthy();
  });

  it("opens the login modal on the form, and on DashPay to renew", () => {
    mockUseSession.mockReturnValue(
      makeSession({
        status: "authenticated",
        identityId: "id-wallet",
        contractId: "contract-wallet",
        sdk: { documents: {} },
        walletGrant: {
          keyId: 3,
          contractId: "contract-wallet",
          totalBudget: null,
          remainingBudget: null,
          expiresAt: null,
        },
        walletNotice: null,
        refreshWalletGrant: vi.fn(),
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /settings tab/i }));
    fireEvent.click(screen.getByRole("button", { name: "Renew in DashPay" }));
    expect(screen.getByText("login:true")).toBeTruthy();
    expect(screen.getByText("view:wallet")).toBeTruthy();
    expect(screen.getByText("renew:true")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByText("view:form")).toBeTruthy();
    expect(screen.getByText("renew:false")).toBeTruthy();
  });

  describe("a login modal opened while a kept wallet session restores", () => {
    const restoring = {
      status: "connecting",
      identityId: "id-restoring",
      rememberedIdentityId: "id-restoring",
      dpnsName: "alice",
      restoringWallet: true,
    };

    it("closes when the restore signs in", () => {
      mockUseSession.mockReturnValue(makeSession(restoring));
      const { rerender } = render(<App />);
      fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
      expect(screen.getByText("login:true")).toBeTruthy();

      mockUseSession.mockReturnValue(
        makeSession({
          ...restoring,
          status: "authenticated",
          sdk: { documents: {} },
        }),
      );
      rerender(<App />);
      expect(screen.getByText("login:true")).toBeTruthy();

      mockUseSession.mockReturnValue(
        makeSession({
          ...restoring,
          status: "authenticated",
          sdk: { documents: {} },
          restoringWallet: false,
        }),
      );
      rerender(<App />);
      expect(screen.getByText("login:false")).toBeTruthy();
    });

    it("stays open when the restore falls back to browsing", () => {
      mockUseSession.mockReturnValue(makeSession(restoring));
      const { rerender } = render(<App />);
      fireEvent.click(screen.getByRole("button", { name: /open settings/i }));

      mockUseSession.mockReturnValue(
        makeSession({
          ...restoring,
          status: "browsing",
          sdk: {},
          restoringWallet: false,
        }),
      );
      rerender(<App />);
      expect(screen.getByText("login:true")).toBeTruthy();

      // The restore is over: a later sign-in from this modal is the
      // user's own and the modal handles its own close.
      mockUseSession.mockReturnValue(
        makeSession({
          ...restoring,
          status: "authenticated",
          sdk: { documents: {} },
          restoringWallet: false,
        }),
      );
      rerender(<App />);
      expect(screen.getByText("login:true")).toBeTruthy();
    });

    it("forgets the restore once the modal is closed and reopened", () => {
      mockUseSession.mockReturnValue(makeSession(restoring));
      const { rerender } = render(<App />);
      fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
      fireEvent.click(screen.getByRole("button", { name: /close login/i }));
      expect(screen.getByText("login:false")).toBeTruthy();

      mockUseSession.mockReturnValue(
        makeSession({
          ...restoring,
          status: "authenticated",
          sdk: { documents: {} },
          restoringWallet: false,
        }),
      );
      rerender(<App />);
      fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
      expect(screen.getByText("login:true")).toBeTruthy();
    });
  });

  it("keeps a Switch identity modal open while the session changes", () => {
    const signedIn = {
      status: "authenticated",
      identityId: "id-signed-in",
      contractId: "contract-signed-in",
      sdk: { documents: {} },
    };
    mockUseSession.mockReturnValue(makeSession(signedIn));
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByText("login:true")).toBeTruthy();

    mockUseSession.mockReturnValue(
      makeSession({ ...signedIn, identityId: "id-other" }),
    );
    rerender(<App />);
    expect(screen.getByText("login:true")).toBeTruthy();
  });
});
