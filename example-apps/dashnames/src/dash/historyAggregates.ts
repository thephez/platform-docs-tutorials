/**
 * Provable aggregates over `purchase` records — the real numbers behind the
 * design's stat strip.
 *
 * TWO rules break these queries if ignored. Both verified live 2026-08-05.
 *
 * 1. The `where` clause must EXACTLY match the serving index's properties.
 *    `byContract` is [dataContractId, $createdAt], so filtering on
 *    `dataContractId` alone is REJECTED:
 *      "prove count requires a `countable: true` index whose properties
 *       exactly match the where clause fields"
 *    Every aggregate must therefore carry a `$createdAt between` bound. An
 *    all-time figure uses a deliberately wide range rather than omitting it.
 *
 * 2. An aggregate over an EMPTY set errors instead of returning zero. With 0
 *    `purchase` records, `count`/`sum`/`average` fail with a grovedb proof error
 *    ("missing lower layer" / "0 lower-layer entries"), NOT `0n`. An empty
 *    aggregate is an error path, not a zero result.
 *
 *    This looks like a platform/grovedb bug — a proof over an empty set should be
 *    provably empty, not unprovable — and is worth reporting upstream. For this
 *    app it needs no machinery: map that specific error to the empty state.
 *    There is nothing to compute when there are no records, so this is a
 *    rendering branch, NOT a client-side arithmetic fallback.
 *
 *    The match stays deliberately narrow (proof-shape errors only) so a real
 *    query bug still surfaces as an error rather than being swallowed as
 *    "no sales".
 *
 * SDK methods: sdk.documents.count / sdk.documents.sum
 */
import { HISTORY_CONTRACT_ID } from "./contracts";
import { isMissingContractError } from "./historyQueries";
import { errorMessage } from "../lib/logger";
import type { DashSdk, OrderByClause } from "./types";

const BY_CREATED_AT: OrderByClause[] = [["$createdAt", "asc"]];

/** Ungrouped aggregates come back as a one-entry Map keyed "". */
function firstMapValue<T>(map: Map<string, T>): T | undefined {
  for (const value of map.values()) return value;
  return undefined;
}

/**
 * True when the error is grovedb's empty-set proof failure.
 *
 * Matches the proof shape only — "missing lower layer" and "N lower-layer
 * entries" — so an index-mismatch or transport error is rethrown.
 */
export function isEmptyAggregateError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  if (!message.includes("proof")) return false;
  return (
    message.includes("missing lower layer") ||
    message.includes("lower-layer entries") ||
    message.includes("lower layer entries")
  );
}

export interface SalesWindow {
  /** Inclusive lower bound, ms. Use 0 for all-time. */
  fromMs: number;
  /** Inclusive upper bound, ms. */
  toMs: number;
}

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function last30Days(nowMs: number): SalesWindow {
  return { fromMs: Math.max(0, nowMs - THIRTY_DAYS_MS), toMs: nowMs };
}

/**
 * Sales count and volume for a window.
 *
 * `null` means "no sales recorded" — the caught empty-set proof error — and is
 * rendered as the empty state, never as a zero.
 */
export interface SalesStats {
  count: bigint | null;
  volumeCredits: bigint | null;
  /** True when the History contract doesn't exist on this network yet (v12). */
  unavailable?: boolean;
}

function windowWhere(dataContractId: string, window: SalesWindow): unknown[][] {
  return [
    ["dataContractId", "==", dataContractId],
    // Required: byContract is [dataContractId, $createdAt], and the where
    // fields must exactly match the index properties.
    ["$createdAt", "between", [window.fromMs, window.toMs]],
  ];
}

export async function fetchSalesStats({
  sdk,
  dataContractId,
  window,
  signal,
}: {
  sdk: DashSdk;
  dataContractId: string;
  window: SalesWindow;
  signal?: AbortSignal;
}): Promise<SalesStats> {
  const args = {
    dataContractId: HISTORY_CONTRACT_ID,
    documentTypeName: "purchase",
    where: windowWhere(dataContractId, window),
    orderBy: BY_CREATED_AT,
  };

  signal?.throwIfAborted();

  let count: bigint | null = null;
  try {
    count = firstMapValue(await sdk.documents.count(args)) ?? null;
  } catch (err) {
    if (isMissingContractError(err)) {
      return { count: null, volumeCredits: null, unavailable: true };
    }
    if (!isEmptyAggregateError(err)) throw err;
    // No purchase records in range — nothing to compute.
    return { count: null, volumeCredits: null };
  }

  signal?.throwIfAborted();

  let volumeCredits: bigint | null = null;
  try {
    volumeCredits =
      firstMapValue(await sdk.documents.sum(args, "price")) ?? null;
  } catch (err) {
    if (isMissingContractError(err)) {
      return { count: null, volumeCredits: null, unavailable: true };
    }
    if (!isEmptyAggregateError(err)) throw err;
    volumeCredits = null;
  }

  return { count, volumeCredits };
}
