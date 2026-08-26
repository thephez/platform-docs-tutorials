/**
 * Domain model for the listings index and history streams.
 *
 * Prices are `bigint` everywhere in memory. They become decimal strings only at
 * the localStorage boundary (JSON.stringify throws on bigint) and are parsed
 * straight back — the string is a serialization format, never the working
 * representation.
 */

/** A DPNS name currently offered for sale. */
export interface Listing {
  /** The `domain` document's `$id`, base58. */
  documentId: string;
  label: string;
  normalizedLabel: string;
  parentDomainName: string;
  /** Current owner identity, base58. */
  ownerId: string;
  /** Identity the name resolves to (`records.identity`), base58. */
  resolvesTo: string | null;
  /** Asking price in credits. Always > 0n for a listing. */
  price: bigint;
  revision: bigint;
  /** When the index last confirmed this listing against Platform. */
  seenAt: number;
}

/** The three independent history streams this app tails. */
export type StreamName = "priceUpdate" | "purchase" | "transfer";

export const STREAM_NAMES: readonly StreamName[] = [
  "priceUpdate",
  "purchase",
  "transfer",
];

/**
 * Resume point for one stream.
 *
 * `documentId` is a tiebreak for *bookkeeping only* — it decides where to
 * resume, never whether a document is still listed. The `$id` order is stable
 * but not causal.
 */
export interface StreamWatermark {
  /** `$createdAt` of the newest fully-processed record. */
  createdAt: number;
  /** That record's `$id`. */
  documentId: string | null;
}

export interface SyncState {
  schemaVersion: number;
  network: string;
  streams: Record<StreamName, StreamWatermark | null>;
  completedAt: number;
}

/** A history event, normalized across the three document types. */
export interface HistoryEvent {
  /** The history record's own `$id`. */
  id: string;
  type: StreamName;
  /** The `domain` document this event is about. */
  documentId: string;
  createdAt: number;
  createdAtBlockHeight: bigint | null;
  /** Whoever wrote the record: the price-setter, the buyer, or the sender. */
  ownerId: string | null;
  /** `priceUpdate` and `purchase` only. A zero `priceUpdate` is a delisting. */
  price: bigint | null;
  /** `purchase` only — the identity that sold the name. */
  sellerId: string | null;
  /** `transfer` only — the identity that received the name. */
  toIdentityId: string | null;
}

/** How an event renders in the activity feed. */
export type ActivityKind = "SALE" | "LISTED" | "TRANSFER" | "DELISTED";

export function activityKind(event: HistoryEvent): ActivityKind {
  if (event.type === "purchase") return "SALE";
  if (event.type === "transfer") return "TRANSFER";
  // A zero-price update is a delisting; a positive one is a listing/reprice.
  return event.price != null && event.price > 0n ? "LISTED" : "DELISTED";
}

/** True only for a transfer whose complete, non-empty identity IDs match. */
export function isSelfTransfer(event: HistoryEvent): boolean {
  return Boolean(
    event.type === "transfer" &&
    event.ownerId &&
    event.toIdentityId &&
    event.ownerId === event.toIdentityId,
  );
}
