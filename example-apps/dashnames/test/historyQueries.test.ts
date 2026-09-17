import { describe, expect, it, vi } from "vitest";
import {
  fetchDocumentHistory,
  fetchRecentEvents,
  fetchStreamPage,
  isMissingContractError,
} from "../src/dash/historyQueries";
import type { DashSdk } from "../src/dash/types";

/**
 * The real error, captured live against mainnet on 2026-08-05. The History
 * contract is created by the v13 upgrade and can be unavailable on older or
 * partially upgraded networks.
 */
const MISSING_CONTRACT_ERROR = "Data contract not found";

/** An SDK whose every history query fails the way mainnet's does today. */
function makeMissingContractSdk() {
  const query = vi.fn(async () => {
    throw new Error(MISSING_CONTRACT_ERROR);
  });
  return { sdk: { documents: { query } } as unknown as DashSdk, query };
}

describe("isMissingContractError", () => {
  it("matches the not-found failure", () => {
    expect(isMissingContractError(new Error(MISSING_CONTRACT_ERROR))).toBe(
      true,
    );
  });

  it("does NOT match unrelated failures — those are real bugs and must surface", () => {
    expect(isMissingContractError(new Error("connection reset by peer"))).toBe(
      false,
    );
    expect(isMissingContractError(new Error("document not found"))).toBe(false);
    expect(
      isMissingContractError(new Error("where clause on non indexed property")),
    ).toBe(false);
  });
});

describe("history reads when the contract does not exist yet", () => {
  it("fetchStreamPage returns empty instead of throwing", async () => {
    const { sdk } = makeMissingContractSdk();
    await expect(
      fetchStreamPage({ sdk, type: "priceUpdate", dataContractId: "dpns" }),
    ).resolves.toEqual([]);
  });

  it("fetchDocumentHistory returns empty instead of throwing", async () => {
    const { sdk } = makeMissingContractSdk();
    await expect(
      fetchDocumentHistory({
        sdk,
        type: "purchase",
        dataContractId: "dpns",
        documentId: "doc-1",
      }),
    ).resolves.toEqual([]);
  });

  it("fetchRecentEvents returns empty without looping", async () => {
    const { sdk, query } = makeMissingContractSdk();
    await expect(
      fetchRecentEvents({ sdk, type: "transfer", dataContractId: "dpns" }),
    ).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("still propagates a genuine query failure", async () => {
    const sdk = {
      documents: {
        query: async () => {
          throw new Error("connection reset by peer");
        },
      },
    } as unknown as DashSdk;

    await expect(
      fetchStreamPage({ sdk, type: "priceUpdate", dataContractId: "dpns" }),
    ).rejects.toThrow("connection reset");
  });
});

describe("fetchRecentEvents", () => {
  it("pages the ascending stream before selecting the newest records", async () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({
      id: `event-${String(index).padStart(3, "0")}`,
      ownerId: "owner",
      createdAt: BigInt(index),
      properties: { documentId: `document-${index}` },
    }));
    const starts: Array<string | undefined> = [];
    const sdk = {
      documents: {
        query: async ({
          startAfter,
          limit,
        }: {
          startAfter?: string;
          limit: number;
        }) => {
          starts.push(startAfter);
          const offset = startAfter
            ? rows.findIndex((row) => row.id === startAfter) + 1
            : 0;
          return rows.slice(offset, offset + limit);
        },
      },
    } as unknown as DashSdk;

    const result = await fetchRecentEvents({
      sdk,
      type: "purchase",
      dataContractId: "dpns",
      limit: 3,
    });

    expect(starts).toEqual([undefined, "event-099"]);
    expect(result.map((event) => event.id)).toEqual([
      "event-104",
      "event-103",
      "event-102",
    ]);
  });
});
