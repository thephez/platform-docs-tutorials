import { describe, expect, it, vi } from "vitest";
import { DPNS_CONTRACT_ID } from "../src/dash/contracts";
import {
  fetchSalesStats,
  isEmptyAggregateError,
  last30Days,
} from "../src/dash/historyAggregates";
import type { DashSdk } from "../src/dash/types";

/**
 * The real grovedb messages, captured live on 2026-08-05 against a `purchase`
 * set with zero records.
 */
const EMPTY_COUNT_ERROR =
  "grovedb: invalid proof: aggregate-count proof missing lower layer for path key 64617461436f6e7472616374496";
const EMPTY_SUM_ERROR =
  "grovedb: invalid proof: aggregate-sum proof has 0 lower-layer entries at depth 4 (expected exactly one entry for path key 64617461436f6e7472616374496)";
/** A DIFFERENT failure: the where clause didn't match the index properties. */
const INDEX_MISMATCH_ERROR =
  "transport error: grpc error: code: 'Client specified an invalid argument', message: \"where clause on non indexed property error: prove count requires a `countable: true` index whose properties exactly match the where clause fields\"";

describe("isEmptyAggregateError", () => {
  it("matches the empty-set proof failures", () => {
    expect(isEmptyAggregateError(new Error(EMPTY_COUNT_ERROR))).toBe(true);
    expect(isEmptyAggregateError(new Error(EMPTY_SUM_ERROR))).toBe(true);
  });

  it("does NOT match an index mismatch — that is a real bug and must surface", () => {
    expect(isEmptyAggregateError(new Error(INDEX_MISMATCH_ERROR))).toBe(false);
  });

  it("does not match unrelated failures", () => {
    expect(isEmptyAggregateError(new Error("connection reset by peer"))).toBe(
      false,
    );
    expect(isEmptyAggregateError(new Error("timeout"))).toBe(false);
  });
});

/** Mirrors the aggregate call signature so `mock.calls[0][0]` stays typed. */
type AggregateCall = (args: {
  dataContractId: string;
  documentTypeName: string;
  where?: unknown[][];
}) => Promise<Map<string, bigint>>;

function makeSdk(overrides: { count?: AggregateCall; sum?: AggregateCall }) {
  const countSpy = vi.fn<AggregateCall>(
    overrides.count ?? (async () => new Map([["", 3n]])),
  );
  const sumSpy = vi.fn<AggregateCall>(
    overrides.sum ?? (async () => new Map([["", 350_000_000n]])),
  );
  const sdk = {
    documents: { count: countSpy, sum: sumSpy },
  } as unknown as DashSdk;
  return { sdk, countSpy, sumSpy };
}

const window = last30Days(1_700_000_000_000);

describe("fetchSalesStats", () => {
  it("returns nulls (the empty state) when the set is empty", async () => {
    // Critically NOT 0n — there is nothing to compute, so this is a rendering
    // branch, not an arithmetic fallback.
    const { sdk } = makeSdk({
      count: async () => {
        throw new Error(EMPTY_COUNT_ERROR);
      },
    });
    const stats = await fetchSalesStats({
      sdk,
      dataContractId: DPNS_CONTRACT_ID,
      window,
    });
    expect(stats).toEqual({ count: null, volumeCredits: null });
  });

  it("rethrows an index mismatch instead of swallowing it as 'no sales'", async () => {
    const { sdk } = makeSdk({
      count: async () => {
        throw new Error(INDEX_MISMATCH_ERROR);
      },
    });
    await expect(
      fetchSalesStats({ sdk, dataContractId: DPNS_CONTRACT_ID, window }),
    ).rejects.toThrow(/exactly match/);
  });

  it("returns real provable figures when records exist", async () => {
    const { sdk } = makeSdk({});
    const stats = await fetchSalesStats({
      sdk,
      dataContractId: DPNS_CONTRACT_ID,
      window,
    });
    expect(stats).toEqual({ count: 3n, volumeCredits: 350_000_000n });
  });

  it("always carries a $createdAt bound, because byContract requires it", async () => {
    // byContract is [dataContractId, $createdAt]; filtering on the contract alone
    // is rejected outright.
    const { sdk, countSpy } = makeSdk({});
    await fetchSalesStats({ sdk, dataContractId: DPNS_CONTRACT_ID, window });
    const args = countSpy.mock.calls[0][0];
    const where = args.where ?? [];
    const fields = where.map((w) => w[0]);
    expect(fields).toContain("dataContractId");
    expect(fields).toContain("$createdAt");
    const range = where.find((w) => w[0] === "$createdAt")!;
    expect(range[1]).toBe("between");
    expect(range[2]).toEqual([window.fromMs, window.toMs]);
  });

  it("flags unavailable — NOT 'no sales' — when the contract does not exist", async () => {
    // Mainnet (v12) has no History contract yet. An empty stat strip there would
    // wrongly read as "nobody is trading" rather than "not on this network".
    const { sdk } = makeSdk({
      count: async () => {
        throw new Error("Data contract not found");
      },
    });
    const stats = await fetchSalesStats({
      sdk,
      dataContractId: DPNS_CONTRACT_ID,
      window,
    });
    expect(stats).toEqual({
      count: null,
      volumeCredits: null,
      unavailable: true,
    });
  });

  it("flags unavailable when the sum call is the one that finds no contract", async () => {
    const { sdk } = makeSdk({
      sum: async () => {
        throw new Error("Data contract not found");
      },
    });
    const stats = await fetchSalesStats({
      sdk,
      dataContractId: DPNS_CONTRACT_ID,
      window,
    });
    expect(stats.unavailable).toBe(true);
  });

  it("keeps the count when only the volume aggregate is empty", async () => {
    const { sdk } = makeSdk({
      sum: async () => {
        throw new Error(EMPTY_SUM_ERROR);
      },
    });
    const stats = await fetchSalesStats({
      sdk,
      dataContractId: DPNS_CONTRACT_ID,
      window,
    });
    expect(stats.count).toBe(3n);
    expect(stats.volumeCredits).toBeNull();
  });
});
