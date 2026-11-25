// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/components/AppShell";
import type { SessionStatus } from "../src/session/SessionContext";

const { mockUseSession } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
}));

vi.mock("../src/session/useSession", () => ({
  useSession: mockUseSession,
}));

function renderShell(status: SessionStatus, restoringWallet: boolean) {
  return render(
    <AppShell
      tab="notes"
      onTabChange={vi.fn()}
      status={status}
      identityId="GgZekwh38XcWQTyWWWvmw6CEYFnLU7yiZFPWZEjqKHit"
      dpnsName="alice"
      contractId={null}
      restoringWallet={restoringWallet}
      onLoginOpen={vi.fn()}
    >
      <div>content</div>
    </AppShell>,
  );
}

beforeEach(() => {
  mockUseSession.mockReset();
  mockUseSession.mockReturnValue({ logout: vi.fn() });
});

afterEach(() => {
  cleanup();
});

describe("AppShell", () => {
  it("offers a Sign in entry in the sidebar when signed out", () => {
    renderShell("connecting", false);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("hides the Sign in entry while a kept wallet session restores", () => {
    renderShell("connecting", true);
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByRole("button", { name: /sign in/i })).toBeNull();
    expect(screen.getByTestId("identity-restoring")).toBeTruthy();
  });

  it("hides the Sign in entry once signed in", () => {
    renderShell("authenticated", false);
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByRole("button", { name: /sign in/i })).toBeNull();
  });
});
