// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "../src/dash/listingsStore";
import type { Listing, SyncState } from "../src/dash/listingTypes";

const listing: Listing = {
  documentId: "d1",
  label: "alice",
  normalizedLabel: "alice",
  parentDomainName: "dash",
  ownerId: "o1",
  resolvesTo: "o1",
  // Deliberately above Number.MAX_SAFE_INTEGER to prove the string boundary is
  // lossless in both directions.
  price: 20_000_000_000_000_000n,
  revision: 3n,
  seenAt: 1234,
};

const sync: SyncState = {
  schemaVersion: 1,
  network: "testnet",
  streams: {
    priceUpdate: { createdAt: 100, documentId: "e1" },
    purchase: { createdAt: 90, documentId: null },
    transfer: null,
  },
  completedAt: 5678,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("save / load", () => {
  it("round-trips listings and every watermark", () => {
    expect(store.save("testnet", { listings: [listing], sync })).toBe(true);
    const loaded = store.load("testnet");
    expect(loaded?.listings).toEqual([listing]);
    expect(loaded?.sync.streams).toEqual(sync.streams);
  });

  it("preserves a price above Number.MAX_SAFE_INTEGER exactly", () => {
    store.save("testnet", { listings: [listing], sync });
    expect(store.load("testnet")?.listings[0].price).toBe(
      20_000_000_000_000_000n,
    );
  });

  it("writes the whole snapshot in ONE setItem so cursors can't outrun listings", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    store.save("testnet", { listings: [listing], sync });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("namespaces by network", () => {
    store.save("testnet", { listings: [listing], sync });
    expect(store.load("mainnet")).toBeNull();
    expect(store.load("testnet")).not.toBeNull();
  });

  it("drops the persisted copy when the write fails, so the next launch cold-syncs", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(store.save("testnet", { listings: [listing], sync })).toBe(false);
    // Nothing retained — never watermarks without their listings.
    expect(store.load("testnet")).toBeNull();
  });
});

describe("load rejects unusable snapshots", () => {
  it("returns null for a schema-version mismatch", () => {
    localStorage.setItem(
      store.storageKey("testnet"),
      JSON.stringify({
        schemaVersion: 999,
        network: "testnet",
        listings: [],
        streams: {},
      }),
    );
    expect(store.load("testnet")).toBeNull();
  });

  it("returns null for a network mismatch", () => {
    localStorage.setItem(
      store.storageKey("testnet"),
      JSON.stringify({
        schemaVersion: 1,
        network: "mainnet",
        listings: [],
        streams: {},
      }),
    );
    expect(store.load("testnet")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem(store.storageKey("testnet"), "{not json");
    expect(store.load("testnet")).toBeNull();
  });

  it("rejects the WHOLE snapshot when any single row is corrupt", () => {
    // A partially-readable snapshot paired with advanced watermarks is exactly
    // the divergence the atomic write exists to prevent.
    store.save("testnet", { listings: [listing], sync });
    const raw = JSON.parse(localStorage.getItem(store.storageKey("testnet"))!);
    raw.listings.push({ documentId: "d2", label: "bob" }); // missing price/owner
    localStorage.setItem(store.storageKey("testnet"), JSON.stringify(raw));
    expect(store.load("testnet")).toBeNull();
  });

  it("rejects a stored listing with a zero price rather than showing it free", () => {
    store.save("testnet", { listings: [listing], sync });
    const raw = JSON.parse(localStorage.getItem(store.storageKey("testnet"))!);
    raw.listings[0].price = "0";
    localStorage.setItem(store.storageKey("testnet"), JSON.stringify(raw));
    expect(store.load("testnet")).toBeNull();
  });
});

describe("network preference", () => {
  it("round-trips", () => {
    expect(store.loadNetwork()).toBeNull();
    store.saveNetwork("mainnet");
    expect(store.loadNetwork()).toBe("mainnet");
  });
});
