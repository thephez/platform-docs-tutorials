import { describe, expect, it } from "vitest";
import {
  bytesToBase58,
  docId,
  hasSalePrice,
  readBigInt,
  readId,
  toDocumentArray,
  type DocumentHandle,
} from "../src/lib/safeDoc";

/**
 * These tests pin the two behaviours that silently corrupt the listings index if
 * they regress. Both were verified against live testnet data.
 */
describe("bytesToBase58", () => {
  it("matches the SDK's encoding for a real 32-byte identifier", () => {
    // The `documentId` bytes of a live testnet priceUpdate record, whose
    // toJSON() reported this base58 string.
    const bytes = Uint8Array.from([
      23, 251, 50, 7, 224, 74, 20, 243, 22, 58, 250, 246, 91, 132, 66, 97, 50,
      234, 229, 24, 223, 77, 143, 61, 53, 39, 165, 37, 155, 242, 95, 107,
    ]);
    expect(bytesToBase58(bytes)).toBe(
      "2ccY4dgkYvsoqiquGn5715fXRBHopkXwYiXp2NNxisMc",
    );
  });

  it("encodes leading zero bytes as leading ones", () => {
    expect(bytesToBase58(Uint8Array.from([0, 0, 1]))).toBe("112");
  });

  it("returns an empty string for empty input", () => {
    expect(bytesToBase58(new Uint8Array())).toBe("");
  });
});

describe("readId", () => {
  it("normalizes raw bytes so Set dedup collapses repeats", () => {
    // The regression this guards: identifier fields inside `properties` are
    // Uint8Array, and using them directly as Set keys made three price events on
    // ONE name look like three distinct candidates.
    const a = Uint8Array.from(Array(32).fill(7));
    const b = Uint8Array.from(Array(32).fill(7));
    expect(new Set([a, b]).size).toBe(2); // raw bytes: wrong
    expect(new Set([readId(a), readId(b)]).size).toBe(1); // normalized: right
  });

  it("passes through base58 strings", () => {
    expect(readId("GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec")).toBe(
      "GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec",
    );
  });

  it("reads an Identifier-like handle via toString", () => {
    const handle = { toString: () => "abc123" };
    expect(readId(handle)).toBe("abc123");
  });

  it("returns null rather than poisoning a key with [object Object]", () => {
    expect(readId({})).toBeNull();
    expect(readId(null)).toBeNull();
    expect(readId(undefined)).toBeNull();
  });
});

describe("readBigInt", () => {
  it("preserves a price above Number.MAX_SAFE_INTEGER exactly", () => {
    // A real on-chain value: 20,000,000,000,000,000 credits (200,000 DASH).
    const exact = 20_000_000_000_000_000n;
    expect(readBigInt(exact)).toBe(exact);
    // Round-tripping through Number would lose precision; the string path must not.
    expect(readBigInt("20000000000000000")).toBe(exact);
  });

  it("returns null for an absent field rather than coercing to zero", () => {
    expect(readBigInt(undefined)).toBeNull();
    expect(readBigInt(null)).toBeNull();
  });

  it("rejects unsafe or fractional numbers instead of preserving corruption", () => {
    expect(readBigInt(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(readBigInt(1.5)).toBeNull();
    expect(readBigInt(Number.POSITIVE_INFINITY)).toBeNull();
    expect(readBigInt(Number.MAX_SAFE_INTEGER)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
  });
});

describe("hasSalePrice", () => {
  const withProps = (properties: Record<string, unknown>): DocumentHandle => ({
    properties,
  });

  it("is true only for a present, positive price", () => {
    expect(hasSalePrice(withProps({ $price: 100n }))).toBe(true);
  });

  it("is false for a DELISTED name (key present, value 0n)", () => {
    // Verified live: a delisted domain has $price === 0n with the key present.
    expect(hasSalePrice(withProps({ $price: 0n }))).toBe(false);
  });

  it("is false for a NEVER-LISTED name (key absent)", () => {
    expect(hasSalePrice(withProps({ label: "alice" }))).toBe(false);
  });

  it("never treats a document without properties as for sale", () => {
    expect(hasSalePrice({})).toBe(false);
  });
});

describe("docId", () => {
  it("reads the id getter, which still works when toJSON() throws", () => {
    // A document with an unsafe price throws on toJSON() entirely, so the id
    // must come from the getter.
    const doc: DocumentHandle = {
      id: "4KUPbv72npj6vGHet7sjHtV7TQxkdxpoBwavHfVBLZAR",
      properties: { $price: 20_000_000_000_000_000n },
      toJSON: () => {
        throw new Error("Failed to convert JSON to JsValue");
      },
    };
    expect(docId(doc)).toBe("4KUPbv72npj6vGHet7sjHtV7TQxkdxpoBwavHfVBLZAR");
    expect(hasSalePrice(doc)).toBe(true);
  });
});

describe("toDocumentArray", () => {
  it("normalizes arrays, Maps, and plain objects", () => {
    const doc = { properties: {} };
    expect(toDocumentArray([doc])).toHaveLength(1);
    expect(toDocumentArray(new Map([["a", doc]]))).toHaveLength(1);
    expect(toDocumentArray({ a: doc })).toHaveLength(1);
    expect(toDocumentArray(null)).toHaveLength(0);
  });
});
