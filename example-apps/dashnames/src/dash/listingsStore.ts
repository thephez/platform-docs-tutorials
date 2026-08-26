/**
 * Atomic localStorage snapshot of the listings index plus every stream
 * watermark.
 *
 * SYNCHRONOUS by design — `load()` runs in a `useState` initializer before the
 * SDK exists. No SDK imports here.
 *
 * The invariant that drives this whole file: **never retain watermarks without
 * the listings they summarize.** A watermark says "every event up to here is
 * already folded into these listings". If the two are written separately, a
 * partial failure leaves cursors ahead of the data and listings silently
 * disappear until storage is cleared. So both go into ONE versioned snapshot
 * written with ONE `setItem`, and any failure to serialize, validate, or write
 * drops the persisted copy entirely so the next launch cold-syncs.
 */
import type {
  Listing,
  StreamName,
  StreamWatermark,
  SyncState,
} from "./listingTypes";
import { STREAM_NAMES } from "./listingTypes";

const SCHEMA_VERSION = 1;

/** Namespaced per network so switching networks can't mix indexes. */
export function storageKey(network: string): string {
  return `dashnames.index.${network}`;
}

export interface Snapshot {
  listings: Listing[];
  sync: SyncState;
}

/** Wire form: prices as decimal strings, since JSON.stringify throws on bigint. */
interface WireListing {
  documentId: string;
  label: string;
  normalizedLabel: string;
  parentDomainName: string;
  ownerId: string;
  resolvesTo: string | null;
  price: string;
  revision: string;
  seenAt: number;
}

interface WireSnapshot {
  schemaVersion: number;
  network: string;
  listings: WireListing[];
  streams: Record<string, StreamWatermark | null>;
  completedAt: number;
}

function isPositiveIntString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function parseWatermark(value: unknown): StreamWatermark | null {
  if (!value || typeof value !== "object") return null;
  const w = value as Record<string, unknown>;
  if (typeof w.createdAt !== "number" || !Number.isFinite(w.createdAt)) {
    return null;
  }
  const documentId = typeof w.documentId === "string" ? w.documentId : null;
  return { createdAt: w.createdAt, documentId };
}

function parseListing(value: unknown): Listing | null {
  if (!value || typeof value !== "object") return null;
  const l = value as Record<string, unknown>;
  if (
    typeof l.documentId !== "string" ||
    typeof l.label !== "string" ||
    typeof l.ownerId !== "string" ||
    !isPositiveIntString(l.price) ||
    !isPositiveIntString(l.revision)
  ) {
    return null;
  }
  const price = BigInt(l.price);
  // A stored listing must be for sale; a zero price means the snapshot is
  // inconsistent, so drop the row rather than surfacing a "free" name.
  if (price <= 0n) return null;

  return {
    documentId: l.documentId,
    label: l.label,
    normalizedLabel:
      typeof l.normalizedLabel === "string" ? l.normalizedLabel : l.label,
    parentDomainName:
      typeof l.parentDomainName === "string" ? l.parentDomainName : "dash",
    ownerId: l.ownerId,
    resolvesTo: typeof l.resolvesTo === "string" ? l.resolvesTo : null,
    price,
    revision: BigInt(l.revision),
    seenAt: typeof l.seenAt === "number" ? l.seenAt : 0,
  };
}

/**
 * Reads the persisted snapshot. Returns null on anything unexpected — a missing
 * key, a schema bump, a network mismatch, malformed JSON, or a partially
 * written record. A null return means "cold sync", which is always safe.
 */
export function load(network: string): Snapshot | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(network));
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as WireSnapshot;
    if (
      !parsed ||
      parsed.schemaVersion !== SCHEMA_VERSION ||
      parsed.network !== network ||
      !Array.isArray(parsed.listings)
    ) {
      return null;
    }

    const listings: Listing[] = [];
    for (const entry of parsed.listings) {
      const listing = parseListing(entry);
      // One bad row invalidates the snapshot: a silently shortened listing set
      // paired with advanced watermarks is exactly the divergence this guards.
      if (!listing) return null;
      listings.push(listing);
    }

    const streams = {} as Record<StreamName, StreamWatermark | null>;
    for (const name of STREAM_NAMES) {
      streams[name] = parseWatermark(parsed.streams?.[name]);
    }

    return {
      listings,
      sync: {
        schemaVersion: SCHEMA_VERSION,
        network,
        streams,
        completedAt:
          typeof parsed.completedAt === "number" ? parsed.completedAt : 0,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Persists listings and all watermarks together in a single write.
 *
 * Returns true when the snapshot is durable. On ANY failure — serialization,
 * quota, or a storage exception — the persisted copy is removed so the next
 * launch cold-syncs instead of trusting cursors whose listings never landed.
 * The caller keeps its in-memory result either way.
 */
export function save(network: string, snapshot: Snapshot): boolean {
  const wire: WireSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    network,
    listings: snapshot.listings.map((l) => ({
      documentId: l.documentId,
      label: l.label,
      normalizedLabel: l.normalizedLabel,
      parentDomainName: l.parentDomainName,
      ownerId: l.ownerId,
      resolvesTo: l.resolvesTo,
      price: l.price.toString(),
      revision: l.revision.toString(),
      seenAt: l.seenAt,
    })),
    streams: snapshot.sync.streams,
    completedAt: snapshot.sync.completedAt,
  };

  try {
    localStorage.setItem(storageKey(network), JSON.stringify(wire));
    return true;
  } catch {
    clear(network);
    return false;
  }
}

/** Drops the persisted snapshot; the next load cold-syncs. */
export function clear(network: string): void {
  try {
    localStorage.removeItem(storageKey(network));
  } catch {
    // Nothing further to do — a failed remove still leaves a snapshot that
    // load() will reject if it is malformed.
  }
}

const NETWORK_KEY = "dashnames.network";

/** Reads the persisted network preference. Synchronous. */
export function loadNetwork(): string | null {
  try {
    return localStorage.getItem(NETWORK_KEY);
  } catch {
    return null;
  }
}

export function saveNetwork(network: string): void {
  try {
    localStorage.setItem(NETWORK_KEY, network);
  } catch {
    // A non-persisted preference just means the default next launch.
  }
}
