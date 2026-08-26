// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityView } from "../src/components/ActivityView";
import { Timeline } from "../src/components/Timeline";
import { isSelfTransfer, type HistoryEvent } from "../src/dash/listingTypes";

afterEach(cleanup);

function transfer(
  ownerId: string | null,
  toIdentityId: string | null,
): HistoryEvent {
  return {
    id: "event-1",
    type: "transfer",
    documentId: "document-1",
    createdAt: Date.now(),
    createdAtBlockHeight: 42n,
    ownerId,
    toIdentityId,
    price: null,
    sellerId: null,
  };
}

describe("self-transfer detection", () => {
  it("compares complete, non-empty identity IDs", () => {
    expect(isSelfTransfer(transfer("same-id", "same-id"))).toBe(true);
    expect(isSelfTransfer(transfer("abcd-left", "abcd-right"))).toBe(false);
    expect(isSelfTransfer(transfer(null, null))).toBe(false);
  });
});

describe("self-transfer presentation", () => {
  it("annotates activity without changing its transfer classification", () => {
    const event = transfer("same-id", "same-id");
    render(
      <ActivityView
        events={[event]}
        loading={false}
        filter="transfers"
        onFilterChange={vi.fn()}
        onOpenDocument={vi.fn()}
        lookupName={() => null}
        onOpenIdentity={vi.fn()}
      />,
    );

    expect(screen.getByText("Transferred")).toBeTruthy();
    expect(screen.getByText("to self").getAttribute("title")).toContain(
      "Some wallets delist",
    );
    expect(
      screen.getByRole("button", { name: /Transfers/ }).textContent,
    ).toContain("1");
    expect(screen.getAllByTitle("same-id — view identity")).toHaveLength(1);
  });

  it("does not mark different full IDs that could truncate alike", () => {
    render(
      <ActivityView
        events={[transfer("abcd1111wxyz", "abcd2222wxyz")]}
        loading={false}
        filter="all"
        onFilterChange={vi.fn()}
        onOpenDocument={vi.fn()}
        lookupName={() => null}
        onOpenIdentity={vi.fn()}
      />,
    );

    expect(screen.queryByText("to self")).toBeNull();
    expect(screen.getAllByTitle(/view identity/)).toHaveLength(2);
  });

  it("uses precise self-transfer copy in the detail timeline", () => {
    render(
      <Timeline
        events={[transfer("same-id", "same-id")]}
        onOpenIdentity={vi.fn()}
      />,
    );

    expect(screen.getByText("Transferred to self")).toBeTruthy();
    expect(screen.getByText(/clears any active listing/)).toBeTruthy();
    expect(screen.getAllByTitle("same-id — view identity")).toHaveLength(1);
  });
});
