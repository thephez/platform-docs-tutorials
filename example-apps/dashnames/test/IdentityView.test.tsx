// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityView } from "../src/components/IdentityView";
import type { DomainRecord } from "../src/dash/dpnsQueries";

afterEach(cleanup);

const identityId = "identity-with-a-full-id";
const owned: DomainRecord = {
  documentId: "document-1",
  label: "alice",
  normalizedLabel: "alice",
  parentDomainName: "dash",
  ownerId: identityId,
  resolvesTo: identityId,
  price: null,
  revision: 1n,
};
const externallyOwned: DomainRecord = {
  ...owned,
  documentId: "document-2",
  label: "pay",
  normalizedLabel: "pay",
  ownerId: "different-owner",
};

function renderView(
  overrides: Partial<Parameters<typeof IdentityView>[0]> = {},
) {
  const props: Parameters<typeof IdentityView>[0] = {
    identityId,
    names: [],
    loading: false,
    error: null,
    network: "testnet",
    onBack: vi.fn(),
    onOpenName: vi.fn(),
    onOpenIdentity: vi.fn(),
    ...overrides,
  };
  render(<IdentityView {...props} />);
  return props;
}

describe("IdentityView", () => {
  it("renders loading, error, and empty states", () => {
    const { rerender } = render(
      <IdentityView {...renderlessProps()} loading />,
    );
    expect(screen.getByText("Loading resolving names…")).toBeTruthy();

    rerender(<IdentityView {...renderlessProps()} error="query failed" />);
    expect(screen.getByRole("alert").textContent).toContain("query failed");

    rerender(<IdentityView {...renderlessProps()} />);
    expect(screen.getByText("No resolving names")).toBeTruthy();
  });

  it("shows resolving names and distinguishes ownership", () => {
    const props = renderView({ names: [owned, externallyOwned] });
    expect(screen.getByText("This identity")).toBeTruthy();

    fireEvent.click(screen.getByTitle("different-owner — view identity"));
    expect(props.onOpenIdentity).toHaveBeenCalledWith("different-owner");

    fireEvent.click(screen.getByRole("button", { name: /alice\s*\.dash/i }));
    expect(props.onOpenName).toHaveBeenCalledWith(owned);
  });

  it("keeps Platform Explorer as a separate external action", () => {
    renderView();
    expect(
      screen
        .getByRole("link", { name: /View identity in Explorer/i })
        .getAttribute("href"),
    ).toContain(`/identity/${identityId}`);
  });
});

function renderlessProps(): Parameters<typeof IdentityView>[0] {
  return {
    identityId,
    names: [],
    loading: false,
    error: null,
    network: "testnet",
    onBack: vi.fn(),
    onOpenName: vi.fn(),
    onOpenIdentity: vi.fn(),
  };
}
