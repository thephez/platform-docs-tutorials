// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNameDetail } from "../src/hooks/useNameDetail";
import type { DashSdk } from "../src/dash/types";

const DOCUMENT_ID = "8QbDdM3LaS6rZ1fk5otEkhTN8oJyrWi5AoKtb3DpPhVP";

/** A `domain` document shaped the way safeDoc reads it. */
const domainDoc = {
  id: DOCUMENT_ID,
  ownerId: "9uxMdcJt8rCcfWWaSP3m3k6d4k5WzZdKM4oK9wAsr8NW",
  revision: 1n,
  properties: {
    label: "phez",
    normalizedLabel: "phez",
    normalizedParentDomainName: "dash",
  },
};

function makeSdk(query: () => Promise<unknown>) {
  return {
    documents: {
      get: vi.fn(async () => domainDoc),
      query: vi.fn(query),
    },
  } as unknown as DashSdk;
}

describe("useNameDetail", () => {
  it("keeps the record when history is unavailable on this network", async () => {
    // The reported bug: on mainnet the domain fetch succeeds but every history
    // stream fails, and the detail view rendered "That name could not be found"
    // for a name that plainly exists.
    const sdk = makeSdk(async () => {
      throw new Error("Data contract not found");
    });

    const { result } = renderHook(() =>
      useNameDetail({ sdk, documentId: DOCUMENT_ID }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.record?.label).toBe("phez");
    expect(result.current.ownership).toEqual([]);
    expect(result.current.priceHistory).toEqual([]);
  });

  it("still shows the record when history fails for an unexpected reason", async () => {
    // A transport failure surfaces as an error, but must not erase a document
    // that was already fetched successfully.
    const sdk = makeSdk(async () => {
      throw new Error("connection reset by peer");
    });

    const { result } = renderHook(() =>
      useNameDetail({ sdk, documentId: DOCUMENT_ID }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.record?.label).toBe("phez");
    expect(result.current.error).toMatch(/connection reset/);
  });

  it("loads the timeline when history is available", async () => {
    const sdk = makeSdk(async () => [
      {
        id: "event-1",
        ownerId: "owner",
        createdAt: 1_700_000_000_000n,
        properties: { documentId: DOCUMENT_ID, price: 250_000_000n },
      },
    ]);

    const { result } = renderHook(() =>
      useNameDetail({ sdk, documentId: DOCUMENT_ID }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.record?.label).toBe("phez");
    // One event per stream: purchase + transfer land in ownership.
    expect(result.current.ownership).toHaveLength(2);
    expect(result.current.priceHistory).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });
});
