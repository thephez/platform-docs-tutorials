// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyNamesView } from "../src/components/MyNamesView";
import type { DomainRecord } from "../src/dash/dpnsQueries";

afterEach(cleanup);

describe("MyNamesView", () => {
  it("retains owner management actions", () => {
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

    render(
      <MyNamesView
        names={[record]}
        loading={false}
        identityName="alice"
        identityId="identity-1"
        balance={0n}
        canWrite
        onManage={onManage}
        onTransfer={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "List for sale" }));
    expect(onManage).toHaveBeenCalledWith(record);
    expect(
      screen.getByRole("button", { name: "Transfer a name" }),
    ).toBeTruthy();
  });
});
