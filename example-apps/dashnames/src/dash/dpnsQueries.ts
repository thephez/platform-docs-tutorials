/**
 * Reads over the DPNS `domain` document type.
 *
 * Index shapes (verified live 2026-08-05):
 *   parentNameAndLabel  [normalizedParentDomainName, normalizedLabel]  unique
 *   identityId          [records.identity]
 *
 * There is NO index on `$price` — `where` on it is rejected outright with
 * "where clause on non indexed property error". That absence is the whole reason
 * this app builds a local listings index from price-update history.
 *
 * `orderBy` must be the serving index's trailing property:
 *   parentNameAndLabel -> normalizedLabel
 * and `$id IN` takes no `orderBy` at all.
 *
 * SDK method: sdk.documents.query / sdk.documents.get
 */
import {
  DOMAIN_DOCUMENT_TYPE,
  DPNS_CONTRACT_ID,
  MAX_IN_CLAUSE,
  MAX_QUERY_LIMIT,
  PARENT_DOMAIN_NAME,
} from "./contracts";
import { chunk } from "../lib/chunk";
import {
  docId,
  docOwnerId,
  docProp,
  docRevision,
  hasSalePrice,
  readBigInt,
  readId,
  readString,
  toDocumentArray,
  type DocumentHandle,
} from "../lib/safeDoc";
import type { Listing } from "./listingTypes";
import type { DashSdk } from "./types";

/** The current on-chain state of a DPNS name, price included when listed. */
export interface DomainRecord {
  documentId: string;
  label: string;
  normalizedLabel: string;
  parentDomainName: string;
  ownerId: string;
  resolvesTo: string | null;
  /**
   * Asking price in credits, or null when NOT for sale.
   *
   * `$price` is conditional: a delisted name has the key present and `0n`; a
   * never-listed name omits it entirely. Both normalize to null here so callers
   * cannot accidentally treat 0 as a price.
   */
  price: bigint | null;
  revision: bigint;
}

/** Normalizes a `domain` document. Reads via getters/properties, never toJSON(). */
export function toDomainRecord(doc: DocumentHandle): DomainRecord | null {
  const documentId = docId(doc);
  const ownerId = docOwnerId(doc);
  const label = readString(docProp(doc, "label"));
  if (!documentId || !ownerId || !label) return null;

  const records = docProp(doc, "records");
  const resolvesTo =
    records && typeof records === "object"
      ? readId((records as Record<string, unknown>).identity)
      : null;

  const price = hasSalePrice(doc) ? readBigInt(docProp(doc, "$price")) : null;

  return {
    documentId,
    label,
    normalizedLabel:
      readString(docProp(doc, "normalizedLabel")) ?? label.toLowerCase(),
    parentDomainName:
      readString(docProp(doc, "normalizedParentDomainName")) ??
      readString(docProp(doc, "parentDomainName")) ??
      PARENT_DOMAIN_NAME,
    ownerId,
    resolvesTo,
    price,
    revision: docRevision(doc) ?? 0n,
  };
}

/** Promotes a for-sale domain record to a `Listing`. Returns null when unlisted. */
export function toListing(
  record: DomainRecord,
  seenAt: number,
): Listing | null {
  if (record.price == null || record.price <= 0n) return null;
  return {
    documentId: record.documentId,
    label: record.label,
    normalizedLabel: record.normalizedLabel,
    parentDomainName: record.parentDomainName,
    ownerId: record.ownerId,
    resolvesTo: record.resolvesTo,
    price: record.price,
    revision: record.revision,
    seenAt,
  };
}

/**
 * Batch-fetches current `domain` documents by `$id`.
 *
 * Chunked at exactly 100 (`MAX_IN_CLAUSE`) — 101 IDs is rejected as
 * "invalid IN clause error". Chunks run SEQUENTIALLY, not via Promise.all:
 * trusted nodes throttle, and wide fan-out surfaces as opaque connection resets.
 *
 * IDs absent from the result no longer exist and are simply missing from the
 * returned map — the caller treats absence as "delete from the index".
 */
export async function fetchDomainsByIds({
  sdk,
  documentIds,
  signal,
  onProgress,
}: {
  sdk: DashSdk;
  documentIds: readonly string[];
  signal?: AbortSignal;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<Map<string, DomainRecord>> {
  const out = new Map<string, DomainRecord>();
  const unique = [...new Set(documentIds)];
  if (unique.length === 0) return out;

  let done = 0;
  for (const batch of chunk(unique, MAX_IN_CLAUSE)) {
    signal?.throwIfAborted();

    // No orderBy on an `$id IN` query — there is no index to order against.
    const results = await sdk.documents.query({
      dataContractId: DPNS_CONTRACT_ID,
      documentTypeName: DOMAIN_DOCUMENT_TYPE,
      where: [["$id", "in", batch]],
      limit: MAX_IN_CLAUSE,
    });

    for (const doc of toDocumentArray(results)) {
      const record = toDomainRecord(doc);
      if (record) out.set(record.documentId, record);
    }

    done += batch.length;
    signal?.throwIfAborted();
    onProgress?.(done, unique.length);
  }

  return out;
}

/** Fetches one `domain` document by ID — the authority for execution paths. */
export async function fetchDomainById({
  sdk,
  documentId,
  signal,
}: {
  sdk: DashSdk;
  documentId: string;
  signal?: AbortSignal;
}): Promise<DomainRecord | null> {
  signal?.throwIfAborted();
  const doc = await sdk.documents.get(
    DPNS_CONTRACT_ID,
    DOMAIN_DOCUMENT_TYPE,
    documentId,
  );
  signal?.throwIfAborted();
  return doc ? toDomainRecord(doc) : null;
}

/**
 * Exact-label lookup under the `dash` parent, via the unique
 * `parentNameAndLabel` index.
 */
export async function fetchDomainByLabel({
  sdk,
  normalizedLabel,
  parentDomainName = PARENT_DOMAIN_NAME,
  signal,
}: {
  sdk: DashSdk;
  normalizedLabel: string;
  parentDomainName?: string;
  signal?: AbortSignal;
}): Promise<DomainRecord | null> {
  signal?.throwIfAborted();

  const results = await sdk.documents.query({
    dataContractId: DPNS_CONTRACT_ID,
    documentTypeName: DOMAIN_DOCUMENT_TYPE,
    where: [
      ["normalizedParentDomainName", "==", parentDomainName],
      ["normalizedLabel", "==", normalizedLabel],
    ],
    orderBy: [["normalizedLabel", "asc"]],
    limit: 1,
  });

  signal?.throwIfAborted();

  const [doc] = toDocumentArray(results);
  return doc ? toDomainRecord(doc) : null;
}

/**
 * Prefix search over labels using `startsWith` on the trailing index property.
 * Works without any local index, so it stays available on mainnet where the
 * listings index is legitimately empty.
 */
export async function searchDomainsByPrefix({
  sdk,
  prefix,
  parentDomainName = PARENT_DOMAIN_NAME,
  limit = 20,
  signal,
}: {
  sdk: DashSdk;
  prefix: string;
  parentDomainName?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<DomainRecord[]> {
  signal?.throwIfAborted();

  const results = await sdk.documents.query({
    dataContractId: DPNS_CONTRACT_ID,
    documentTypeName: DOMAIN_DOCUMENT_TYPE,
    where: [
      ["normalizedParentDomainName", "==", parentDomainName],
      ["normalizedLabel", "startsWith", prefix],
    ],
    orderBy: [["normalizedLabel", "asc"]],
    limit: Math.min(limit, MAX_QUERY_LIMIT),
  });

  signal?.throwIfAborted();

  return toDocumentArray(results)
    .map(toDomainRecord)
    .filter((r): r is DomainRecord => r != null);
}

/**
 * Names an identity resolves to, via the `identityId` index on
 * `records.identity`.
 *
 * NOTE this finds names that RESOLVE to the identity, which is what DPNS
 * indexes. It is not the same as `$ownerId`: a purchase rewrites both, but a
 * name could in principle be owned by one identity and resolve to another. The
 * portfolio treats owner as authoritative and filters accordingly.
 */
export async function fetchDomainsByIdentity({
  sdk,
  identityId,
  pageSize = MAX_QUERY_LIMIT,
  signal,
}: {
  sdk: DashSdk;
  identityId: string;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<DomainRecord[]> {
  const limit = Math.max(1, Math.min(pageSize, MAX_QUERY_LIMIT));
  const records: DomainRecord[] = [];
  const seenCursors = new Set<string>();
  let startAfter: string | undefined;

  while (true) {
    signal?.throwIfAborted();
    const results = await sdk.documents.query({
      dataContractId: DPNS_CONTRACT_ID,
      documentTypeName: DOMAIN_DOCUMENT_TYPE,
      where: [["records.identity", "==", identityId]],
      orderBy: [["records.identity", "asc"]],
      limit,
      ...(startAfter ? { startAfter } : {}),
    });
    signal?.throwIfAborted();

    const documents = toDocumentArray(results);
    records.push(
      ...documents
        .map(toDomainRecord)
        .filter((record): record is DomainRecord => record != null),
    );

    if (documents.length < limit) break;
    const lastDocument = documents.at(-1);
    const cursor = lastDocument ? docId(lastDocument) : null;
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
    startAfter = cursor;
  }

  return records;
}

/**
 * Trims user input to a bare label: lowercased, `.dash` suffix removed.
 *
 * NOT sufficient for a `normalizedLabel` query on its own — see
 * `toNormalizedLabel`, which additionally applies DPNS's homograph fold.
 */
export function normalizeLabelInput(input: string): string {
  const lower = input.trim().toLowerCase();
  return lower.endsWith(".dash") ? lower.slice(0, -".dash".length) : lower;
}

/**
 * Converts user input to the `normalizedLabel` DPNS actually stores.
 *
 * DPNS folds visually-confusable characters so lookalike names can't coexist:
 * `l`/`i` -> `1` and `o` -> `0`. So `latte` is stored as `1atte` and `hello` as
 * `he110`. Querying `normalizedLabel == "latte"` matches nothing — the reason
 * mainnet search appeared broken for such names.
 *
 * The fold is the SDK's own (`dpnsConvertToHomographSafe` in WASM), never
 * reimplemented here: a local copy would drift from consensus.
 *
 * SDK method: sdk.dpns.convertToHomographSafe
 */
export async function toNormalizedLabel(
  sdk: DashSdk,
  input: string,
): Promise<string> {
  return sdk.dpns.convertToHomographSafe(normalizeLabelInput(input));
}
