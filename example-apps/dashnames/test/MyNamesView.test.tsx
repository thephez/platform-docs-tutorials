// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyNamesView } from "../src/components/MyNamesView";
import type { DomainRecord } from "../src/dash/dpnsQueries";

afterEach(cleanup);

describe("MyNamesView", () => {
  it("keeps management and transfer actions attached to their row", () => {
    const record: DomainRecord = {
      documentId: "document-1",
      label: "alice",
      normalizedLabel: "alice",
      parentDomainName: "dash",
      ownerId: "identity-1",
      resolvesTo: "identity-1",
      price: null,
      revision: 1n,
    };
    const onManage = vi.fn();
    const onTransfer = vi.fn();

    render(
      <MyNamesView
        names={[record]}
        loading={false}
        identityName="alice"
        identityId="identity-1"
        balance={0n}
        canWrite
        onManage={onManage}
        onTransfer={onTransfer}
        onOpen={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "List for sale" }));
    expect(onManage).toHaveBeenCalledWith(record);

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for alice.dash" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Transfer" }));
    expect(onTransfer).toHaveBeenCalledWith(record);
  });

  it("summarizes and filters listed names without repeating status", () => {
    const records: DomainRecord[] = [
      {
        documentId: "listed-document",
        label: "listed-name",
        normalizedLabel: "listed-name",
        parentDomainName: "dash",
        ownerId: "identity-1",
        resolvesTo: "identity-1",
        price: 1_250_000_000_000n,
        revision: 2n,
      },
      {
        documentId: "idle-document",
        label: "idle-name",
        normalizedLabel: "idle-name",
        parentDomainName: "dash",
        ownerId: "identity-1",
        resolvesTo: null,
        price: null,
        revision: 1n,
      },
    ];

    render(
      <MyNamesView
        names={records}
        loading={false}
        identityName="alice"
        identityId="identity-1"
        balance={42_000_000_000n}
        canWrite
        onManage={vi.fn()}
        onTransfer={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    const summary = screen.getByLabelText("Portfolio summary");
    expect(summary.textContent).toContain("2owned");
    expect(summary.textContent).toContain("1listed");
    expect(summary.textContent).toContain("12.500DASH asked");

    expect(screen.getAllByText("Listed")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Not listed/ }));
    expect(screen.queryByText("listed-name")).toBeNull();
    expect(screen.getByText("idle-name")).toBeTruthy();
  });
});
