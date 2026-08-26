/**
 * Reads over the Document History system contract.
 *
 * Index shapes (verified live 2026-08-05 — all three document types):
 *   byContract  [dataContractId, $createdAt]
 *   byDocument  [dataContractId, documentId, $createdAt]
 *   purchase also has: buyer [$ownerId,$createdAt], seller [sellerId,$createdAt],
 *                      byPrice [dataContractId, price]
 *   transfer also has: from [$ownerId,$createdAt], to [toIdentityId,$createdAt]
 *
 * `orderBy` MUST be the serving index's TRAILING property — the index matcher
 * reserves the order-by field from the back. For both `byContract` and
 * `byDocument` that is `$createdAt`.
 *
 * SDK method: sdk.documents.query({ dataContractId, documentTypeName, where, orderBy, limit, startAfter })
 */
import { HISTORY_CONTRACT_ID, MAX_QUERY_LIMIT } from "./contracts";
import type { HistoryEvent, StreamName } from "./listingTypes";
import { errorMessage } from "../lib/logger";
import {
  docId,
  docOwnerId,
  docProp,
  readBigInt,
  readId,
  toDocumentArray,
  type DocumentHandle,
} from "../lib/safeDoc";
import type { DashSdk, OrderByClause } from "./types";

/**
 * True when the History contract doesn't exist on this network — it is created
 * by the v13 upgrade, which mainnet hasn't activated yet. Same contract ID once
 * it does. Matched narrowly so real query failures still surface.
 */
export function isMissingContractError(err: unknown): boolean {
  return errorMessage(err).toLowerCase().includes("contract not found");
}

/**
 * Normalizes one history document.
 *
 * Reads every field through the per-field getters / `properties`, never
 * `toJSON()`: identifier fields inside `properties` are raw `Uint8Array(32)`
 * and `price` is a u64 that overflows the JSON converter. See lib/safeDoc.ts.
 */
export function toHistoryEvent(
  type: StreamName,
  doc: DocumentHandle,
): HistoryEvent | null {
  const id = docId(doc);
  const documentId = readId(docProp(doc, "documentId"));
  const createdAt = readBigInt(doc.createdAt ?? docProp(doc, "$createdAt"));
  if (!id || !documentId || createdAt == null) return null;

  return {
    id,
    type,
    documentId,
    createdAt: Number(createdAt),
    createdAtBlockHeight: readBigInt(
      doc.createdAtBlockHeight ?? docProp(doc, "$createdAtBlockHeight"),
    ),
    ownerId: docOwnerId(doc),
    price: readBigInt(docProp(doc, "price")),
    sellerId: readId(docProp(doc, "sellerId")),
    toIdentityId: readId(docProp(doc, "toIdentityId")),
  };
}

const BY_CREATED_AT: OrderByClause[] = [["$createdAt", "asc"]];

export interface StreamPageParams {
  sdk: DashSdk;
  type: StreamName;
  /** The contract whose documents the events describe (DPNS). */
  dataContractId: string;
  /** Inclusive lower bound on `$createdAt`. */
  sinceMs?: number;
  /** Forward pagination WITHIN one sync run only — never a cross-run resume token. */
  startAfter?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * One ascending page of a history stream via `byContract`.
 *
 * Ascending order gives deterministic forward pagination. Callers must not infer
 * causal order from same-millisecond `$id` ordering.
 */
export async function fetchStreamPage({
  sdk,
  type,
  dataContractId,
  sinceMs,
  startAfter,
  limit = MAX_QUERY_LIMIT,
  signal,
}: StreamPageParams): Promise<HistoryEvent[]> {
  signal?.throwIfAborted();

  const where: unknown[][] = [["dataContractId", "==", dataContractId]];
  if (sinceMs != null) where.push(["$createdAt", ">=", sinceMs]);

  let results: unknown;
  try {
    results = await sdk.documents.query({
      dataContractId: HISTORY_CONTRACT_ID,
      documentTypeName: type,
      where,
      orderBy: BY_CREATED_AT,
      limit,
      ...(startAfter ? { startAfter } : {}),
    });
  } catch (err) {
    if (!isMissingContractError(err)) throw err;
    return [];
  }

  signal?.throwIfAborted();

  return toDocumentArray(results)
    .map((doc) => toHistoryEvent(type, doc))
    .filter((e): e is HistoryEvent => e != null);
}

export interface DocumentHistoryParams {
  sdk: DashSdk;
  type: StreamName;
  dataContractId: string;
  /** The `domain` document to fetch events for. */
  documentId: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Every event of one type for a single document, via `byDocument`.
 * Backs the name-detail timeline and the asking-price history tab.
 */
export async function fetchDocumentHistory({
  sdk,
  type,
  dataContractId,
  documentId,
  limit = MAX_QUERY_LIMIT,
  signal,
}: DocumentHistoryParams): Promise<HistoryEvent[]> {
  signal?.throwIfAborted();

  let results: unknown;
  try {
    results = await sdk.documents.query({
      dataContractId: HISTORY_CONTRACT_ID,
      documentTypeName: type,
      where: [
        ["dataContractId", "==", dataContractId],
        ["documentId", "==", documentId],
      ],
      orderBy: BY_CREATED_AT,
      limit,
    });
  } catch (err) {
    if (!isMissingContractError(err)) throw err;
    return [];
  }

  signal?.throwIfAborted();

  return toDocumentArray(results)
    .map((doc) => toHistoryEvent(type, doc))
    .filter((e): e is HistoryEvent => e != null);
}

/**
 * Newest-first events of one type across the contract. Backs recent sales and
 * the activity feed.
 *
 * Sorted CLIENT-SIDE. `orderBy: [["$createdAt","desc"]]` is accepted by the
 * query but not honoured — verified 2026-08-05: `asc` and `desc` return
 * identical ordering, and `desc` with `limit: 1` returns the OLDEST record, so a
 * server-side "newest N" is not available. `sortEventsDesc` therefore does the
 * ordering, and callers that need the true newest must page the whole stream
 * rather than trusting a small `limit`.
 */
export async function fetchRecentEvents({
  sdk,
  type,
  dataContractId,
  limit = MAX_QUERY_LIMIT,
  signal,
}: {
  sdk: DashSdk;
  type: StreamName;
  dataContractId: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<HistoryEvent[]> {
  const events: HistoryEvent[] = [];
  const seen = new Set<string>();
  let startAfter: string | undefined;

  // The server currently ignores descending order. Page the complete ascending
  // stream, then sort and take the requested newest N; one ascending page would
  // otherwise return the oldest records while calling them "recent".
  for (;;) {
    signal?.throwIfAborted();
    let results: unknown;
    try {
      results = await sdk.documents.query({
        dataContractId: HISTORY_CONTRACT_ID,
        documentTypeName: type,
        where: [["dataContractId", "==", dataContractId]],
        orderBy: BY_CREATED_AT,
        limit: MAX_QUERY_LIMIT,
        ...(startAfter ? { startAfter } : {}),
      });
    } catch (err) {
      if (!isMissingContractError(err)) throw err;
      return [];
    }
    signal?.throwIfAborted();

    const docs = toDocumentArray(results);
    if (docs.length === 0) break;

    let added = 0;
    for (const doc of docs) {
      const event = toHistoryEvent(type, doc);
      if (!event || seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
      added += 1;
    }

    if (docs.length < MAX_QUERY_LIMIT) break;
    const cursor = docId(docs[docs.length - 1]);
    if (!cursor || cursor === startAfter || added === 0) {
      throw new Error(
        `Recent ${type} pagination stalled — refusing to return an incomplete feed.`,
      );
    }
    startAfter = cursor;
  }

  return sortEventsDesc(events).slice(0, Math.max(0, limit));
}

/**
 * Newest-first ordering, with `$id` as a stable tiebreak for events sharing a
 * millisecond. The tiebreak is presentational only — it must never be used to
 * decide whether a document is still listed.
 */
export function sortEventsDesc(events: HistoryEvent[]): HistoryEvent[] {
  return [...events].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
