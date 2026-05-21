import { describe, expect, it, vi } from "vitest";

import {
  ENCRYPTED_NOTE_PREFIX,
  INVALID_NOTE_MESSAGE,
  createDecryptedNotePayloadCache,
  decryptNotePayload,
  encryptNoteForStorage,
  encryptNotePayload,
  estimateEncryptedStoredBytes,
  parseEncryptedNoteEnvelope,
  resolveCachedNoteForDisplay,
  resolveNoteForDisplay,
  serializeEncryptedNoteEnvelope,
} from "../src/lib/encryptedNotes";
import { byteLength } from "../src/lib/fieldLimits";
import type { NoteRecord } from "../src/dash/queries";
import type { DashEncryptionKeyMaterial } from "../src/dash/types";

const keyMaterial: DashEncryptionKeyMaterial = {
  keyId: 4,
  keyVersion: 1,
  privateKeyBytes: new Uint8Array(32).fill(7),
};

const context = {
  network: "testnet" as const,
  contractId: "contract-1",
  documentType: "note" as const,
  ownerId: "identity-1",
  documentId: "note-1",
};

function note(message: string): NoteRecord {
  return {
    id: "note-1",
    ownerId: "identity-1",
    title: "Encrypted note",
    message,
    createdAt: 1,
    updatedAt: 2,
    revision: 1,
  };
}

describe("encrypted note envelopes", () => {
  it("survives serialize and parse round trip", async () => {
    const envelope = await encryptNotePayload({
      payload: { title: "Private title", message: "Private body" },
      context,
      keyMaterial,
    });

    const serialized = serializeEncryptedNoteEnvelope(envelope);

    expect(serialized.startsWith(ENCRYPTED_NOTE_PREFIX)).toBe(true);
    expect(parseEncryptedNoteEnvelope(serialized)).toEqual(envelope);
  });

  it("does not crash display resolution for malformed prefixed messages", async () => {
    const display = await resolveNoteForDisplay(
      note(`${ENCRYPTED_NOTE_PREFIX}not-valid-base64url!`),
      {
        network: "testnet",
        contractId: "contract-1",
        encryptionKeyMaterial: keyMaterial,
      },
    );

    expect(display.encryptionState).toBe("invalid");
    expect(display.message).toBe(INVALID_NOTE_MESSAGE);
  });

  it("uses a fresh IV and ciphertext for each encryption", async () => {
    const first = await encryptNotePayload({
      payload: { title: "Same", message: "Same body" },
      context,
      keyMaterial,
    });
    const second = await encryptNotePayload({
      payload: { title: "Same", message: "Same body" },
      context,
      keyMaterial,
    });

    expect(first.encryptedPayload.iv).not.toBe(second.encryptedPayload.iv);
    expect(first.encryptedPayload.ciphertext).not.toBe(
      second.encryptedPayload.ciphertext,
    );
  });

  it("fails decrypt when document context changes", async () => {
    const envelope = await encryptNotePayload({
      payload: { title: "Private title", message: "Private body" },
      context,
      keyMaterial,
    });

    await expect(
      decryptNotePayload({
        envelope,
        context: { ...context, documentId: "other-note" },
        keyMaterial,
      }),
    ).rejects.toThrow();
    await expect(
      decryptNotePayload({
        envelope,
        context: { ...context, ownerId: "other-owner" },
        keyMaterial,
      }),
    ).rejects.toThrow();
  });

  it("fails decrypt when the session key id does not match the envelope", async () => {
    const envelope = await encryptNotePayload({
      payload: { title: "Private title", message: "Private body" },
      context,
      keyMaterial,
    });

    await expect(
      decryptNotePayload({
        envelope,
        context,
        keyMaterial: { ...keyMaterial, keyId: 5 },
      }),
    ).rejects.toThrow(/key ID/i);
  });

  it("resolves decrypted display while retaining the raw envelope", async () => {
    const cache = createDecryptedNotePayloadCache();
    const stored = await encryptNoteForStorage({
      title: "Private title",
      message: "Private body",
      context,
      keyMaterial,
    });

    const display = await resolveNoteForDisplay(note(stored.message), {
      network: "testnet",
      contractId: "contract-1",
      encryptionKeyMaterial: keyMaterial,
      decryptedPayloadCache: cache,
    });

    expect(display.encryptionState).toBe("decrypted");
    expect(display.title).toBe("Private title");
    expect(display.message).toBe("Private body");
    expect(display.rawMessage).toBe(stored.message);
    expect(cache.totalBytes).toBeGreaterThan(0);
  });

  it("uses cached decrypted payloads when available", async () => {
    const stored = await encryptNoteForStorage({
      title: "Private title",
      message: "Private body",
      context,
      keyMaterial,
    });
    const cache = {
      totalBytes: 0,
      get: vi.fn().mockReturnValue({
        title: "Cached title",
        message: "Cached body",
      }),
      set: vi.fn(),
      clear: vi.fn(),
    };

    const display = await resolveNoteForDisplay(note(stored.message), {
      network: "testnet",
      contractId: "contract-1",
      encryptionKeyMaterial: {
        ...keyMaterial,
        privateKeyBytes: new Uint8Array(32).fill(99),
      },
      decryptedPayloadCache: cache,
    });

    expect(display.encryptionState).toBe("decrypted");
    expect(display.title).toBe("Cached title");
    expect(display.message).toBe("Cached body");
    expect(cache.get).toHaveBeenCalledTimes(1);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("can resolve cached display synchronously", async () => {
    const cache = createDecryptedNotePayloadCache();
    const stored = await encryptNoteForStorage({
      title: "Private title",
      message: "Private body",
      context,
      keyMaterial,
    });
    await resolveNoteForDisplay(note(stored.message), {
      network: "testnet",
      contractId: "contract-1",
      encryptionKeyMaterial: keyMaterial,
      decryptedPayloadCache: cache,
    });

    const display = resolveCachedNoteForDisplay(note(stored.message), {
      network: "testnet",
      contractId: "contract-1",
      encryptionKeyMaterial: keyMaterial,
      decryptedPayloadCache: cache,
    });

    expect(display?.encryptionState).toBe("decrypted");
    expect(display?.title).toBe("Private title");
    expect(display?.message).toBe("Private body");
  });

  it("guards the final stored envelope size", async () => {
    await expect(
      encryptNoteForStorage({
        title: "Large",
        message: "x".repeat(10_000),
        context,
        keyMaterial,
      }),
    ).rejects.toThrow(/field limit/i);
  });
});

describe("estimateEncryptedStoredBytes", () => {
  const cases: Array<{ name: string; title: string; message: string }> = [
    { name: "empty note", title: "", message: "" },
    { name: "ASCII body only", title: "", message: "Hello world" },
    { name: "title only", title: "Meeting agenda", message: "" },
    {
      name: "ASCII title and body",
      title: "Meeting agenda",
      message: "Discuss roadmap, owners, and milestones.",
    },
    {
      name: "multi-byte UTF-8",
      title: "café 漢字",
      message: "🚀 Launch 👨‍👩‍👧",
    },
    {
      name: "title trimmed to match storage shape",
      title: "  padded  ",
      message: "body",
    },
  ];

  for (const { name, title, message } of cases) {
    it(`matches the actual envelope size for: ${name}`, async () => {
      const estimated = estimateEncryptedStoredBytes(
        title,
        message,
        keyMaterial,
      );
      const stored = await encryptNoteForStorage({
        title,
        message,
        context,
        keyMaterial,
      });
      expect(estimated).toBe(byteLength(stored.message));
    });
  }

  it("matches at the largest plaintext that still fits the 5120-byte cap", async () => {
    // Binary-search the maximum plaintext length whose serialized envelope
    // still fits, so the assertion stays valid as envelope overhead evolves
    // and the test never hand-tunes a number that drifts.
    let lo = 0;
    let hi = 5120;
    let largest = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const projected = estimateEncryptedStoredBytes(
        "",
        "a".repeat(mid),
        keyMaterial,
      );
      if (projected <= 5120) {
        largest = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const message = "a".repeat(largest);
    const stored = await encryptNoteForStorage({
      title: "",
      message,
      context,
      keyMaterial,
    });
    expect(byteLength(stored.message)).toBeLessThanOrEqual(5120);
    expect(estimateEncryptedStoredBytes("", message, keyMaterial)).toBe(
      byteLength(stored.message),
    );
  });

  it("includes the prefix and envelope skeleton for an empty note", () => {
    // Lower bound check — even a fully empty note pays the envelope overhead.
    const bytes = estimateEncryptedStoredBytes("", "", keyMaterial);
    expect(bytes).toBeGreaterThan(byteLength(ENCRYPTED_NOTE_PREFIX) + 100);
    expect(bytes).toBeLessThan(500);
  });

  it("grows monotonically as the message grows", () => {
    const a = estimateEncryptedStoredBytes("", "", keyMaterial);
    const b = estimateEncryptedStoredBytes("", "x".repeat(100), keyMaterial);
    const c = estimateEncryptedStoredBytes("", "x".repeat(1000), keyMaterial);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});
