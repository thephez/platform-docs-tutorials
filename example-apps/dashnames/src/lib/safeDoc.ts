/**
 * Lossless document field readers.
 *
 * THE most important correctness rule in this app: never read a numeric field
 * through `Document.toJSON()`.
 *
 * `toJSON()` runs a bulk JSON converter that cannot represent a u64 above
 * `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 credits ≈ 90,071 DASH). It
 * does not round — it THROWS, taking the whole document with it, so even the
 * document's `$id` becomes unreachable through that path:
 *
 *   WasmDppError: Failed to convert JSON to JsValue:
 *     Error: 20000000000000000 can't be represented as a JavaScript number
 *
 * Upstream bug: https://github.com/dashpay/platform/issues/3786 (open against
 * evo-sdk 4.1.0). Verified live on testnet against contract
 * CkAX4amndy33YxCyQ3op4QmWofsiW9TukoMh2nvHQk9B, which holds real cards priced
 * at 10,000,000,000,000,000 and 20,000,000,000,000,000 credits.
 *
 * The documented workaround (issue comment 4607194304) is that the per-field
 * WASM getters do NOT go through the broken serializer and return native types
 * directly — `bigint` for u64. So we hand-assemble every document from
 * `doc.id` / `doc.ownerId` / `doc.revision` / `doc.properties` and never call
 * `toJSON()` on a document at all.
 *
 * Note this is not merely a precision fix: stringifying an already-decoded
 * `number` cannot recover precision, because the rounding (or throw) has
 * already happened. `properties` is a genuinely lossless path.
 *
 * A second, separate reason to prefer these readers: identifier fields inside
 * `properties` are raw `Uint8Array(32)`, NOT base58 strings. Using them
 * directly as `Set`/`Map` keys silently treats every occurrence as distinct
 * (verified: three price events on ONE name looked like three candidates).
 * `readId()` normalizes them to base58 so dedup works.
 */

/** An SDK document handle, as returned by query/get. */
export interface DocumentHandle {
  id?: unknown;
  ownerId?: unknown;
  revision?: bigint | number | string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Base58 (Bitcoin/Dash alphabet) encoder for 32-byte Platform identifiers.
 *
 * The SDK exposes no standalone byte→base58 helper, and the `Identifier`
 * objects returned by the per-field getters already stringify to base58 — this
 * is only needed for identifier fields nested inside `properties`, which come
 * back as raw bytes.
 */
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function bytesToBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  // Count leading zero bytes — each maps to a literal "1".
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  // Convert base-256 digits to base-58 by repeated division.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      const value = digits[j] * 256 + carry;
      digits[j] = value % 58;
      carry = (value / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1)
    out += BASE58_ALPHABET[digits[i]];
  return out;
}

function isByteArray(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/**
 * Reads an identifier field as a base58 string, accepting every shape the SDK
 * uses: an `Identifier` handle (from `doc.id` / `doc.ownerId`), raw 32 bytes
 * (from `properties`), a plain array of byte values, or an existing string.
 */
export function readId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value || null;
  if (isByteArray(value)) return bytesToBase58(value);
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) {
    return bytesToBase58(Uint8Array.from(value as number[]));
  }
  if (typeof value === "object") {
    // Identifier handles stringify to base58. Guard against the default
    // "[object Object]" so a shape we don't understand fails loudly as null
    // rather than poisoning a Map key.
    try {
      const text = String(value);
      if (text && text !== "[object Object]") return text;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Reads an unsigned-integer field as `bigint` without going through the broken
 * serializer. Returns null when the field is absent.
 *
 * `$price` is CONDITIONAL on a domain document: a delisted name has `$price`
 * present and `0n`; a never-listed name omits the key entirely. Both mean "not
 * for sale", and callers must distinguish neither — but they must never write
 * `json.$price > 0` or `json.$price ?? 0`, both of which quietly coerce.
 */
export function readBigInt(value: unknown): bigint | null {
  if (value == null) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    // Once an integer exceeds Number.MAX_SAFE_INTEGER its exact u64 value may
    // already be rounded; converting that rounded number to bigint would make
    // the corruption look authoritative. Numeric fields must also be integers.
    if (!Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

/** Reads a string property, or null when absent/not a string. */
export function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** The document's own `$id`, base58. */
export function docId(doc: DocumentHandle): string | null {
  return readId(doc.id);
}

/** The document's owner identity, base58. */
export function docOwnerId(doc: DocumentHandle): string | null {
  return readId(doc.ownerId);
}

/** The document's revision as `bigint`. */
export function docRevision(doc: DocumentHandle): bigint | null {
  return readBigInt(doc.revision);
}

/** A property from `doc.properties`, unwrapped. */
export function docProp(doc: DocumentHandle, key: string): unknown {
  return doc.properties?.[key];
}

/**
 * True when `$price` is present AND positive — i.e. the document is currently
 * for sale. This is the only sanctioned "is it listed" predicate.
 */
export function hasSalePrice(doc: DocumentHandle): boolean {
  const price = readBigInt(docProp(doc, "$price"));
  return price != null && price > 0n;
}

/** Normalizes whatever shape a document query returned into an array. */
export function toDocumentArray(results: unknown): DocumentHandle[] {
  if (results == null) return [];
  if (Array.isArray(results)) return results as DocumentHandle[];
  if (results instanceof Map) {
    return [...results.values()].filter(Boolean) as DocumentHandle[];
  }
  if (typeof results === "object") {
    return Object.values(results as Record<string, DocumentHandle>).filter(
      Boolean,
    );
  }
  return [];
}
