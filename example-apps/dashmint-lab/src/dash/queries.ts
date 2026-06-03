/**
 * Read queries over the card data contract.
 *
 * Three variants backing the Collection tab's sub-tabs:
 *   listMyCards — cards owned by the signed-in identity (uses where $ownerId)
 *   listAllCards — every card across the network (capped limit)
 *   listMarketplaceCards — every card that has a non-null $price
 *
 * normalizeCards() hides the three possible shapes the SDK may return
 * (Array, Map, or plain object) so UI code always sees a plain array of
 * { id, ownerId, data, $price }.
 *
 * SDK method: sdk.documents.query({ dataContractId, documentTypeName, where?, limit })
 */
import type { Logger } from "./logger.js";
import type {
  DashCardQueryDocument,
  DashCardQueryResults,
  DashSdk,
} from "./types";

// Platform caps document queries at 100 results per request.
const MAX_QUERY_LIMIT = 100;

export interface Card {
  id: string;
  ownerId: string;
  data: {
    name?: string;
    description?: string;
    attack?: number;
    defense?: number;
  };
  $price?: number | bigint;
}

// Fingerprint of the dashpay/platform#3786 failure: Document.toJSON()
// throws when a numeric field exceeds Number.MAX_SAFE_INTEGER. We only
// silence this specific shape — every other toJSON() failure propagates
// so real bugs stay visible.
const ISSUE_3786_FINGERPRINT = /can't be represented as a JavaScript number/i;

// Returns null when toJSON() trips the known #3786 overflow. One bad
// document must not poison the whole batch. Any other failure rethrows.
function toCard(id: string | null, raw: DashCardQueryDocument): Card | null {
  let j: Record<string, unknown>;
  try {
    j = typeof raw?.toJSON === "function" ? raw.toJSON() : raw;
  } catch (e) {
    // WasmDppError exposes message/name as lazy getters that only resolve
    // on access — logging the object alone shows __wbg_ptr. Pull the
    // readable fields explicitly.
    const err = e as { message?: string; name?: string };
    const message = err?.message ?? "";
    if (!ISSUE_3786_FINGERPRINT.test(message)) throw e;
    const skippedId = id ?? "<unknown>";
    console.warn(
      `normalizeCards: skipping document ${skippedId} — ${err?.name ?? "Error"}: ${message}`,
    );
    return null;
  }
  return {
    id: (id ?? (j.$id as string) ?? (j.id as string)) as string,
    ownerId: j.$ownerId as string,
    data: {
      name: j.name as string | undefined,
      description: j.description as string | undefined,
      attack: j.attack as number | undefined,
      defense: j.defense as number | undefined,
    },
    $price: j.$price as number | bigint | undefined,
  };
}

function isCard(c: Card | null): c is Card {
  return c !== null;
}

export function normalizeCards(results: DashCardQueryResults): Card[] {
  if (Array.isArray(results))
    return results.map((d) => toCard(null, d)).filter(isCard);
  const entries =
    results instanceof Map ? Object.fromEntries(results) : results;
  return Object.entries(entries)
    .map(([id, d]) => toCard(id, d))
    .filter(isCard);
}

interface BaseParams {
  sdk: DashSdk;
  contractId: string;
  limit?: number;
  log?: Logger;
}

export async function listMyCards({
  sdk,
  contractId,
  identityId,
  limit = MAX_QUERY_LIMIT,
  log,
}: BaseParams & { identityId: string }): Promise<Card[]> {
  log?.("Loading your cards…");
  const results = await sdk.documents.query({
    dataContractId: contractId,
    documentTypeName: "card",
    where: [["$ownerId", "==", identityId]],
    limit,
  });
  const cards = normalizeCards(results);
  log?.(`Found ${cards.length} card(s).`);
  return cards;
}

export async function listAllCards({
  sdk,
  contractId,
  limit = MAX_QUERY_LIMIT,
  log,
}: BaseParams): Promise<Card[]> {
  log?.("Loading all cards (any owner)…");
  const results = await sdk.documents.query({
    dataContractId: contractId,
    documentTypeName: "card",
    limit,
  });
  const cards = normalizeCards(results);
  log?.(`Found ${cards.length} card(s) total.`);
  return cards;
}

export async function listMarketplaceCards({
  sdk,
  contractId,
  limit = MAX_QUERY_LIMIT,
  log,
}: BaseParams): Promise<Card[]> {
  log?.("Loading marketplace…");
  const results = await sdk.documents.query({
    dataContractId: contractId,
    documentTypeName: "card",
    limit,
  });
  const cards = normalizeCards(results).filter((c) => c.$price);
  log?.(`Found ${cards.length} card(s) for sale.`);
  return cards;
}
