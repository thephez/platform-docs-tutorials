// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NameTile } from "../src/components/NameTile";
import type { Listing } from "../src/dash/listingTypes";

afterEach(cleanup);

const listing: Listing = {
  documentId: "document-1",
  label: "alice",
  normalizedLabel: "alice",
  parentDomainName: "dash",
  ownerId: "owner-1",
  resolvesTo: "owner-1",
  price: 100_000_000_000n,
  revision: 1n,
  seenAt: 0,
};

describe("NameTile", () => {
  it("offers Manage instead of Buy to the listing owner", () => {
    const onManage = vi.fn();
    render(
      <NameTile
        listing={listing}
        onOpen={vi.fn()}
        onBuy={vi.fn()}
        onManage={onManage}
        canBuy
        buyerIdentityId="owner-1"
      />,
    );
    expect(screen.queryByRole("button", { name: "Buy" })).toBeNull();
    screen.getByRole("button", { name: "Manage" }).click();
    expect(onManage).toHaveBeenCalledWith(listing);
  });

  it("offers Buy to a different authenticated identity", () => {
    render(
      <NameTile
        listing={listing}
        onOpen={vi.fn()}
        onBuy={vi.fn()}
        canBuy
        buyerIdentityId="buyer-1"
      />,
    );
    expect(screen.getByRole("button", { name: "Buy" })).toBeTruthy();
    expect(screen.getByText("1 DASH")).toBeTruthy();
    expect(screen.queryByText(/credits/i)).toBeNull();
  });
});
