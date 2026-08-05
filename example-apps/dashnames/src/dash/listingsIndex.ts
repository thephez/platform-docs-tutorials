/**
 * ★ The listings discovery algorithm.
 *
 * `$price` is not indexed on DPNS `domain`, so Platform cannot answer "what is
 * for sale". This module reconstructs that answer from the Document History
 * contract's append-only price-update stream, then confirms every candidate
 * against its CURRENT document.
 *
 * The load-bearing idea: **history nominates candidates, the current document
 * decides.** History says a name once had a price; only the live document says
 * whether it still does. That single rule is what makes the index correct across
 * delist, purchase, transfer, and reprice without special-casing any of them.
 *
 * Kept deliberately free of DPNS knowledge — contract ID and document type are
 * parameters — so it is the second extraction candidate after the write helpers.
 */
import { MAX_QUERY_LIMIT } from "./contracts";
import { fetchDomainsByIds, toListing, type DomainRecord } from "./dpnsQueries";
import { fetchStreamPage } from "./historyQueries";
import type {
  HistoryEvent,
  Listing,
  StreamName,
  StreamWatermark,
  SyncState,
} from "./listingTypes";
import { STREAM_NAMES } from "./listingTypes";
import type { Logger } from "../lib/logger";
import type { DashSdk } from "./types";

export interface SyncProgress {
  phase: "history" | "documents";
  stream?: StreamName;
  /** Pages of history fetched so far in this run. */
  historyPagesFetched: number;
  /** Candidate documents fetched / total, during the documents phase. */
  documentsFetched?: number;
  documentsTotal?: number;
}

export interface SyncResult {
  listings: Listing[];
  sync: SyncState;
  /** Pages fetched across all streams — asserted by the e2e incremental test. */
  historyPagesFetched: number;
  /** Distinct documents resolved against Platform this run. */
  documentsResolved: number;
}

export interface SyncParams {
  sdk: DashSdk;
  network: string;
  /** The contract whose documents are traded (DPNS). */
  dataContractId: string;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
  log?: Logger;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * Orders a (createdAt, id) pair. Used ONLY for watermark bookkeeping — it
 * decides where to resume, never whether a document is still listed.
 *
 * The `$id` component is stable but NOT causal: for events sharing a
 * millisecond it may order them differently than they were written.
 */
function isNewer(
  a: { createdAt: number; id: string },
  b: StreamWatermark | null,
): boolean {
  if (!b) return true;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  if (b.documentId == null) return true;
  return a.id > b.documentId;
}

function emptyStreams(): Record<StreamName, StreamWatermark | null> {
  return { priceUpdate: null, purchase: null, transfer: null };
}

/**
 * Pages one stream forward from `sinceMs` (inclusive), collecting every event.
 *
 * `startAfter` is used ONLY for forward pagination inside this single run — never
 * as a cross-run resume token. Cross-run resumption replays the whole boundary
 * timestamp bucket instead; see `incrementalSync`.
 *
 * Throws if the cursor fails to advance, rather than looping forever. Pagination
 * is never silently truncated: a caller that cannot finish must leave its
 * watermark untouched, because truncation followed by advancement permanently
 * loses events.
 */
async function drainStream({
  sdk,
  type,
  dataContractId,
  sinceMs,
  signal,
  onPage,
}: {
  sdk: DashSdk;
  type: StreamName;
  dataContractId: string;
  sinceMs?: number;
  signal?: AbortSignal;
  onPage?: (pageIndex: number) => void;
}): Promise<{ events: HistoryEvent[]; pages: number }> {
  const events: HistoryEvent[] = [];
  const seenIds = new Set<string>();
  let startAfter: string | undefined;
  let pages = 0;

  for (;;) {
    signal?.throwIfAborted();

    const page = await fetchStreamPage({
      sdk,
      type,
      dataContractId,
      sinceMs,
      startAfter,
      limit: MAX_QUERY_LIMIT,
      signal,
    });

    pages += 1;
    onPage?.(pages);

    if (page.length === 0) break;

    let added = 0;
    for (const event of page) {
      // Deduplicate by `$id`: the boundary bucket is replayed on purpose, and
      // a page can legitimately repeat the cursor row.
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      events.push(event);
      added += 1;
    }

    // Short page means the stream is exhausted.
    if (page.length < MAX_QUERY_LIMIT) break;

    const last = page[page.length - 1];
    if (startAfter === last.id) {
      throw new Error(
        `History pagination stalled on ${type} at ${last.id} — refusing to advance the watermark.`,
      );
    }
    // A full page that added nothing new would spin forever.
    if (added === 0) break;
    startAfter = last.id;
  }

  return { events, pages };
}

/** Advances a watermark to the newest event seen, or keeps the old one. */
function advanceWatermark(
  current: StreamWatermark | null,
  events: readonly HistoryEvent[],
): StreamWatermark | null {
  let next = current;
  for (const event of events) {
    if (isNewer(event, next)) {
      next = { createdAt: event.createdAt, documentId: event.id };
    }
  }
  return next;
}

/**
 * Resolves candidate document IDs against Platform and returns the listings.
 *
 * This is the authority step. Any candidate whose current document is missing,
 * unpriced, or zero-priced is simply not a listing — including candidates the
 * history stream nominated moments ago.
 */
async function resolveCandidates({
  sdk,
  candidateIds,
  signal,
  onProgress,
  now,
}: {
  sdk: DashSdk;
  candidateIds: readonly string[];
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
  now: () => number;
}): Promise<{ listings: Listing[]; resolved: Map<string, DomainRecord> }> {
  const resolved = await fetchDomainsByIds({
    sdk,
    documentIds: candidateIds,
    signal,
    onProgress,
  });

  const seenAt = now();
  const listings: Listing[] = [];
  for (const record of resolved.values()) {
    const listing = toListing(record, seenAt);
    if (listing) listings.push(listing);
  }
  return { listings, resolved };
}

/**
 * Full replay from genesis.
 *
 * Every document that has EVER had a positive price update stays a candidate
 * forever — a zero-price event does not disqualify it, because the name may have
 * been relisted since. Notably we do NOT reduce history to "the latest event per
 * document" and drop the zero ones: same-millisecond `$id` order is not causal,
 * so a zero event that happens to sort last could hide a currently-listed name.
 * Step 5 resolves the truth from the live document instead.
 *
 * Cold sync only needs the `priceUpdate` stream: purchase and transfer both end
 * listings, but a name they affected must already have had a positive price
 * update to have been listed at all, so it is already a candidate.
 */
export async function coldSync({
  sdk,
  network,
  dataContractId,
  signal,
  onProgress,
  log,
  now = Date.now,
}: SyncParams): Promise<SyncResult> {
  log?.("Cold sync: replaying price-update history…");

  let pages = 0;
  const { events } = await drainStream({
    sdk,
    type: "priceUpdate",
    dataContractId,
    signal,
    onPage: (pageIndex) => {
      pages = pageIndex;
      onProgress?.({
        phase: "history",
        stream: "priceUpdate",
        historyPagesFetched: pageIndex,
      });
    },
  });

  // Candidates: every document with at least one POSITIVE price event.
  const candidates = new Set<string>();
  for (const event of events) {
    if (event.price != null && event.price > 0n)
      candidates.add(event.documentId);
  }

  const candidateIds = [...candidates];
  log?.(
    `Replayed ${events.length} price update(s) over ${pages} page(s); ${candidateIds.length} lifetime candidate(s).`,
  );

  const { listings } = await resolveCandidates({
    sdk,
    candidateIds,
    signal,
    now,
    onProgress: (fetched, total) =>
      onProgress?.({
        phase: "documents",
        historyPagesFetched: pages,
        documentsFetched: fetched,
        documentsTotal: total,
      }),
  });

  // Watermarks advance only now, with a complete listing set in hand.
  const streams = emptyStreams();
  streams.priceUpdate = advanceWatermark(null, events);

  // Cold sync did not read purchase/transfer. Seed those watermarks to the
  // newest priceUpdate time so the first incremental run tails them from a
  // sensible point rather than replaying their full history.
  const seed = streams.priceUpdate;
  if (seed) {
    streams.purchase = { createdAt: seed.createdAt, documentId: null };
    streams.transfer = { createdAt: seed.createdAt, documentId: null };
  }

  log?.(
    `Cold sync complete: ${listings.length} current listing(s).`,
    "success",
  );

  return {
    listings,
    sync: {
      schemaVersion: 1,
      network,
      streams,
      completedAt: now(),
    },
    historyPagesFetched: pages,
    documentsResolved: candidateIds.length,
  };
}

export interface IncrementalParams extends SyncParams {
  /** The listings the caller already holds. */
  listings: readonly Listing[];
  /** Watermarks from the persisted snapshot. */
  sync: SyncState;
}

/**
 * Tails all three streams from their own watermarks.
 *
 * Two defects this deliberately avoids:
 *
 * **Per-stream watermarks.** `priceUpdate`, `purchase`, and `transfer` advance
 * independently. Purchase and transfer both clear `$price` WITHOUT writing a
 * zero-price `priceUpdate`, and a purchase does not also write a transfer. A
 * `$id` is only meaningful as `startAfter` within its own query, so one shared
 * cursor would apply one stream's document ID to another stream's query.
 *
 * **Boundary replay, not `startAfter` alone.** `$createdAt` is milliseconds, so
 * records routinely share a timestamp, and a record written later can sort
 * BEFORE the saved `$id` within that millisecond — `startAfter` would skip it
 * permanently. So we re-query `$createdAt >= watermark.createdAt` inclusively,
 * keep every row in the boundary bucket regardless of `$id` order, and
 * deduplicate. Reprocessing a boundary row is free because every downstream step
 * is idempotent: the affected-ID set is a set, and the live document is the
 * authority.
 */
export async function incrementalSync({
  sdk,
  // `network` is part of SyncParams but unused here: the network is already
  // recorded in the SyncState being carried forward.
  dataContractId,
  listings,
  sync,
  signal,
  onProgress,
  log,
  now = Date.now,
}: IncrementalParams): Promise<SyncResult> {
  const affected = new Set<string>();
  const nextStreams = { ...sync.streams };
  let pages = 0;

  for (const type of STREAM_NAMES) {
    const watermark = sync.streams[type] ?? null;
    const { events } = await drainStream({
      sdk,
      type,
      dataContractId,
      // Inclusive: replay the whole boundary bucket.
      sinceMs: watermark?.createdAt,
      signal,
      onPage: () => {
        pages += 1;
        onProgress?.({
          phase: "history",
          stream: type,
          historyPagesFetched: pages,
        });
      },
    });

    // Discard rows strictly older than the watermark, but KEEP every row sharing
    // its timestamp regardless of `$id` ordering.
    const fresh = watermark
      ? events.filter((e) => e.createdAt >= watermark.createdAt)
      : events;

    // Fold in EVERY event, including zero-price ones: a zero is precisely the
    // signal to re-fetch and potentially remove.
    for (const event of fresh) affected.add(event.documentId);

    nextStreams[type] = advanceWatermark(watermark, fresh);
  }

  if (affected.size === 0) {
    log?.("Incremental sync: no new events.");
    return {
      listings: [...listings],
      sync: { ...sync, streams: nextStreams, completedAt: now() },
      historyPagesFetched: pages,
      documentsResolved: 0,
    };
  }

  const affectedIds = [...affected];
  log?.(`Incremental sync: ${affectedIds.length} document(s) to re-check…`);

  const { listings: refreshed, resolved } = await resolveCandidates({
    sdk,
    candidateIds: affectedIds,
    signal,
    now,
    onProgress: (fetched, total) =>
      onProgress?.({
        phase: "documents",
        historyPagesFetched: pages,
        documentsFetched: fetched,
        documentsTotal: total,
      }),
  });

  // Upsert the still-listed; drop every affected document that is no longer
  // listed. Deletion is driven by the FETCHED documents — an affected ID absent
  // from the result set no longer exists and is removed too.
  const byId = new Map(listings.map((l) => [l.documentId, l]));
  for (const id of affectedIds) byId.delete(id);
  for (const listing of refreshed) byId.set(listing.documentId, listing);

  const removed = affectedIds.filter((id) => {
    const record = resolved.get(id);
    return !record || record.price == null || record.price <= 0n;
  }).length;
  log?.(
    `Incremental sync complete: ${refreshed.length} listed, ${removed} delisted/sold/transferred.`,
    "success",
  );

  return {
    listings: [...byId.values()],
    sync: { ...sync, streams: nextStreams, completedAt: now() },
    historyPagesFetched: pages,
    documentsResolved: affectedIds.length,
  };
}

/**
 * Catch-all repair: re-resolves every currently-held listing against Platform
 * without touching history or the watermarks.
 *
 * Cheap relative to a cold sync (no history replay) and it recovers from any
 * listing-ending transition the tails might have missed — including a future
 * transition type that clears `$price` without writing a record this app knows
 * about.
 */
export async function reconcile({
  sdk,
  listings,
  sync,
  signal,
  onProgress,
  log,
  now = Date.now,
}: Omit<IncrementalParams, "network" | "dataContractId"> & {
  network?: string;
  dataContractId?: string;
}): Promise<SyncResult> {
  const ids = listings.map((l) => l.documentId);
  log?.(`Reconciling ${ids.length} listing(s) against Platform…`);

  const { listings: refreshed } = await resolveCandidates({
    sdk,
    candidateIds: ids,
    signal,
    now,
    onProgress: (fetched, total) =>
      onProgress?.({
        phase: "documents",
        historyPagesFetched: 0,
        documentsFetched: fetched,
        documentsTotal: total,
      }),
  });

  log?.(
    `Reconcile complete: ${refreshed.length} of ${ids.length} still listed.`,
    "success",
  );

  return {
    listings: refreshed,
    // Watermarks are untouched: reconcile reads no history.
    sync: { ...sync, completedAt: now() },
    historyPagesFetched: 0,
    documentsResolved: ids.length,
  };
}
