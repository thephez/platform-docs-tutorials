import { describe, expect, it } from "vitest";
import { DPNS_CONTRACT_ID } from "../src/dash/contracts";
import {
  coldSync,
  incrementalSync,
  reconcile,
} from "../src/dash/listingsIndex";
import type { Listing, SyncState } from "../src/dash/listingTypes";
import type { DashSdk } from "../src/dash/types";

/**
 * A fake SDK over in-memory history records and domain documents, shaped like the
 * real query surface: `byContract` filtering, ascending `$createdAt`, inclusive
 * `>=`, `startAfter` pagination, and `$id IN` batches.
 */
interface FakeEvent {
  id: string;
  type: "priceUpdate" | "purchase" | "transfer";
  documentId: string;
  createdAt: number;
  price?: bigint;
}

interface FakeDomain {
  id: string;
  label: string;
  ownerId: string;
  price?: bigint;
  revision?: bigint;
}

function makeSdk(events: FakeEvent[], domains: FakeDomain[]) {
  const calls = { queries: 0, inClauses: 0 };

  const sdk = {
    version: () => 13,
    system: { status: async () => ({}) },
    documents: {
      async query(args: {
        documentTypeName: string;
        where?: unknown[][];
        limit?: number;
        startAfter?: string;
      }) {
        calls.queries += 1;
        const where = (args.where ?? []) as Array<[string, string, unknown]>;

        if (args.documentTypeName === "domain") {
          const inClause = where.find((w) => w[0] === "$id" && w[1] === "in");
          if (!inClause) return [];
          calls.inClauses += 1;
          const ids = inClause[2] as string[];
          if (ids.length > 100) throw new Error("invalid IN clause error");
          return domains
            .filter((d) => ids.includes(d.id))
            .map((d) => ({
              id: d.id,
              ownerId: d.ownerId,
              revision: d.revision ?? 1n,
              properties: {
                label: d.label,
                normalizedLabel: d.label,
                normalizedParentDomainName: "dash",
                records: { identity: d.ownerId },
                // Absent key when never listed — matches the real conditional shape.
                ...(d.price === undefined ? {} : { $price: d.price }),
              },
            }));
        }

        const since = where.find((w) => w[0] === "$createdAt" && w[1] === ">=");
        let rows = events
          .filter((e) => e.type === args.documentTypeName)
          .filter((e) => (since ? e.createdAt >= (since[2] as number) : true))
          // Ascending by (createdAt, id) — deterministic forward pagination.
          .sort(
            (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
          );

        if (args.startAfter) {
          const at = rows.findIndex((r) => r.id === args.startAfter);
          rows = at >= 0 ? rows.slice(at + 1) : rows;
        }
        if (args.limit) rows = rows.slice(0, args.limit);

        return rows.map((e) => ({
          id: e.id,
          ownerId: "owner-1",
          createdAt: BigInt(e.createdAt),
          createdAtBlockHeight: 100n,
          properties: {
            documentId: e.documentId,
            dataContractId: DPNS_CONTRACT_ID,
            documentTypeName: "domain",
            ...(e.price === undefined ? {} : { price: e.price }),
          },
        }));
      },
      get: async () => undefined,
      count: async () => new Map(),
      sum: async () => new Map(),
      average: async () => new Map(),
      setPrice: async () => undefined,
      purchase: async () => undefined,
      transfer: async () => undefined,
    },
    identities: { balance: async () => 0n },
    dpns: { username: async () => null, resolveName: async () => null },
  } as unknown as DashSdk;

  return { sdk, calls };
}

const base = {
  network: "testnet",
  dataContractId: DPNS_CONTRACT_ID,
  now: () => 1_000,
};

describe("coldSync", () => {
  it("keeps a name whose latest price is positive", async () => {
    const { sdk } = makeSdk(
      [
        {
          id: "e1",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 10,
          price: 5n,
        },
      ],
      [{ id: "d1", label: "alice", ownerId: "o1", price: 5n }],
    );
    const result = await coldSync({ sdk, ...base });
    expect(result.listings.map((l) => l.label)).toEqual(["alice"]);
    expect(result.listings[0].price).toBe(5n);
  });

  it("drops a name that was delisted, even though it was once listed", async () => {
    const { sdk } = makeSdk(
      [
        {
          id: "e1",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 10,
          price: 5n,
        },
        {
          id: "e2",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 20,
          price: 0n,
        },
      ],
      // Delisted: key present, value 0n.
      [{ id: "d1", label: "alice", ownerId: "o1", price: 0n }],
    );
    const result = await coldSync({ sdk, ...base });
    expect(result.listings).toEqual([]);
  });

  it("never nominates a document that only ever had a zero price", async () => {
    const { sdk, calls } = makeSdk(
      [
        {
          id: "e1",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 10,
          price: 0n,
        },
      ],
      [{ id: "d1", label: "alice", ownerId: "o1", price: 0n }],
    );
    const result = await coldSync({ sdk, ...base });
    expect(result.listings).toEqual([]);
    // No candidates means no document fetch at all.
    expect(calls.inClauses).toBe(0);
  });

  it("deduplicates repeated events on one document into a single candidate", async () => {
    // The live testnet shape: 3 price events on 1 name.
    const { sdk } = makeSdk(
      [
        {
          id: "e1",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 10,
          price: 1n,
        },
        {
          id: "e2",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 20,
          price: 2n,
        },
        {
          id: "e3",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 30,
          price: 3n,
        },
      ],
      [{ id: "d1", label: "alice", ownerId: "o1", price: 3n }],
    );
    const result = await coldSync({ sdk, ...base });
    expect(result.documentsResolved).toBe(1);
    expect(result.listings).toHaveLength(1);
    // The CURRENT document supplies the price, not the newest event.
    expect(result.listings[0].price).toBe(3n);
  });

  it("keeps a relisted name even when a zero event sorts last within a millisecond", async () => {
    // `$id` order is stable but NOT causal. A reducer that took "the latest event
    // per document" using an $id tiebreak would pick the zero and hide this name.
    const { sdk } = makeSdk(
      [
        {
          id: "zz-zero",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 50,
          price: 0n,
        },
        {
          id: "aa-positive",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 50,
          price: 9n,
        },
      ],
      [{ id: "d1", label: "alice", ownerId: "o1", price: 9n }],
    );
    const result = await coldSync({ sdk, ...base });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].price).toBe(9n);
  });

  it("chunks the document fetch at 100 IDs", async () => {
    const events: FakeEvent[] = [];
    const domains: FakeDomain[] = [];
    for (let i = 0; i < 250; i += 1) {
      events.push({
        id: `e${String(i).padStart(4, "0")}`,
        type: "priceUpdate",
        documentId: `d${i}`,
        createdAt: 1000 + i,
        price: 1n,
      });
      domains.push({ id: `d${i}`, label: `n${i}`, ownerId: "o1", price: 1n });
    }
    const { sdk, calls } = makeSdk(events, domains);
    const result = await coldSync({ sdk, ...base });
    expect(result.listings).toHaveLength(250);
    // 250 IDs => 3 batches, and no batch may exceed the cap.
    expect(calls.inClauses).toBe(3);
    // 250 events at 100/page => 3 pages.
    expect(result.historyPagesFetched).toBe(3);
  });

  it("records a watermark at the newest processed event", async () => {
    const { sdk } = makeSdk(
      [
        {
          id: "e1",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 10,
          price: 5n,
        },
        {
          id: "e2",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 40,
          price: 7n,
        },
      ],
      [{ id: "d1", label: "alice", ownerId: "o1", price: 7n }],
    );
    const result = await coldSync({ sdk, ...base });
    expect(result.sync.streams.priceUpdate).toEqual({
      createdAt: 40,
      documentId: "e2",
    });
  });
});

function syncStateAt(createdAt: number, documentId: string | null): SyncState {
  return {
    schemaVersion: 1,
    network: "testnet",
    streams: {
      priceUpdate: { createdAt, documentId },
      purchase: { createdAt, documentId: null },
      transfer: { createdAt, documentId: null },
    },
    completedAt: 0,
  };
}

describe("incrementalSync", () => {
  const listed: Listing = {
    documentId: "d1",
    label: "alice",
    normalizedLabel: "alice",
    parentDomainName: "dash",
    ownerId: "o1",
    resolvesTo: "o1",
    price: 5n,
    revision: 1n,
    seenAt: 0,
  };

  it("removes a listing after a purchase, with no zero-price priceUpdate", async () => {
    // A sale clears $price WITHOUT writing a priceUpdate — this is why the
    // purchase stream must be tailed separately.
    const { sdk } = makeSdk(
      [
        {
          id: "p1",
          type: "purchase",
          documentId: "d1",
          createdAt: 100,
          price: 5n,
        },
      ],
      // New owner, price gone.
      [{ id: "d1", label: "alice", ownerId: "o2", revision: 2n }],
    );
    const result = await incrementalSync({
      sdk,
      ...base,
      listings: [listed],
      sync: syncStateAt(50, "e0"),
    });
    expect(result.listings).toEqual([]);
  });

  it("removes a listing after a transfer, with no zero-price priceUpdate", async () => {
    const { sdk } = makeSdk(
      [{ id: "t1", type: "transfer", documentId: "d1", createdAt: 100 }],
      [{ id: "d1", label: "alice", ownerId: "o2", revision: 2n }],
    );
    const result = await incrementalSync({
      sdk,
      ...base,
      listings: [listed],
      sync: syncStateAt(50, "e0"),
    });
    expect(result.listings).toEqual([]);
  });

  it("removes a listing whose document no longer exists", async () => {
    const { sdk } = makeSdk(
      [
        {
          id: "e9",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 100,
          price: 0n,
        },
      ],
      [], // absent from the IN result => delete
    );
    const result = await incrementalSync({
      sdk,
      ...base,
      listings: [listed],
      sync: syncStateAt(50, "e0"),
    });
    expect(result.listings).toEqual([]);
  });

  it("replays the boundary bucket instead of skipping past the saved $id", async () => {
    // The defect this guards: with `startAfter` alone, an event written later but
    // sorting BEFORE the saved $id in the same millisecond is skipped forever.
    const { sdk } = makeSdk(
      [
        {
          id: "mm-saved",
          type: "priceUpdate",
          documentId: "d0",
          createdAt: 100,
          price: 1n,
        },
        {
          id: "aa-later",
          type: "priceUpdate",
          documentId: "d1",
          createdAt: 100,
          price: 5n,
        },
      ],
      [{ id: "d1", label: "alice", ownerId: "o1", price: 5n }],
    );
    const result = await incrementalSync({
      sdk,
      ...base,
      listings: [],
      // Watermark sits exactly on the boundary timestamp.
      sync: syncStateAt(100, "mm-saved"),
    });
    // "aa-later" sorts before the watermark's $id but must still be processed.
    expect(result.listings.map((l) => l.label)).toEqual(["alice"]);
  });

  it("advances each stream's watermark independently", async () => {
    const { sdk } = makeSdk(
      [
        {
          id: "p1",
          type: "purchase",
          documentId: "d1",
          createdAt: 300,
          price: 5n,
        },
      ],
      [{ id: "d1", label: "alice", ownerId: "o2", revision: 2n }],
    );
    const before = syncStateAt(100, "e0");
    const result = await incrementalSync({
      sdk,
      ...base,
      listings: [listed],
      sync: before,
    });
    // Only the purchase stream saw a new record.
    expect(result.sync.streams.purchase).toEqual({
      createdAt: 300,
      documentId: "p1",
    });
    expect(result.sync.streams.priceUpdate).toEqual(before.streams.priceUpdate);
    expect(result.sync.streams.transfer).toEqual(before.streams.transfer);
  });

  it("keeps existing listings untouched when no events arrive", async () => {
    const { sdk } = makeSdk(
      [],
      [{ id: "d1", label: "alice", ownerId: "o1", price: 5n }],
    );
    const result = await incrementalSync({
      sdk,
      ...base,
      listings: [listed],
      sync: syncStateAt(50, "e0"),
    });
    expect(result.listings).toEqual([listed]);
    expect(result.documentsResolved).toBe(0);
  });
});

describe("reconcile", () => {
  it("drops listings that are no longer priced and leaves watermarks alone", async () => {
    const stillListed: Listing = {
      documentId: "d1",
      label: "alice",
      normalizedLabel: "alice",
      parentDomainName: "dash",
      ownerId: "o1",
      resolvesTo: "o1",
      price: 5n,
      revision: 1n,
      seenAt: 0,
    };
    const goneQuiet: Listing = {
      ...stillListed,
      documentId: "d2",
      label: "bob",
    };

    const { sdk } = makeSdk(
      [],
      [
        { id: "d1", label: "alice", ownerId: "o1", price: 5n },
        // d2 lost its price with no event this client saw.
        { id: "d2", label: "bob", ownerId: "o1" },
      ],
    );
    const sync = syncStateAt(100, "e0");
    const result = await reconcile({
      sdk,
      listings: [stillListed, goneQuiet],
      sync,
      now: () => 1_000,
    });
    expect(result.listings.map((l) => l.label)).toEqual(["alice"]);
    expect(result.sync.streams).toEqual(sync.streams);
    expect(result.historyPagesFetched).toBe(0);
  });
});
