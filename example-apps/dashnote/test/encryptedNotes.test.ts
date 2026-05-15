// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { NoteRecord } from "../src/dash/queries";
import {
  ENCRYPTED_NOTE_PREFIX,
  ENCRYPTED_NOTE_TITLE,
  decryptNotePayload,
  decorateNotesForPassphrase,
  encryptedNotePayloadByteLength,
  encryptNotePayload,
  notesForCache,
  redactEncryptedNote,
} from "../src/lib/encryptedNotes";

function note(
  message: string,
  title: string | null = ENCRYPTED_NOTE_TITLE,
): NoteRecord {
  return {
    id: "note-1",
    ownerId: "identity-1",
    title,
    message,
    createdAt: 1000,
    updatedAt: 2000,
    revision: 1,
  };
}

function base64UrlEncode(value: string): string {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("encrypted note envelopes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encrypts and decrypts title and message without using contract changes", async () => {
    const encrypted = await encryptNotePayload({
      title: "Private title",
      message: "Private body",
      passphrase: "correct horse battery staple",
    });

    expect(encrypted.title).toBe(ENCRYPTED_NOTE_TITLE);
    expect(encrypted.message.startsWith(ENCRYPTED_NOTE_PREFIX)).toBe(true);
    expect(encrypted.message).not.toContain("Private title");
    expect(encrypted.message).not.toContain("Private body");

    await expect(
      decryptNotePayload(encrypted.message, "correct horse battery staple"),
    ).resolves.toEqual({ title: "Private title", message: "Private body" });
    expect(encrypted.message.length).toBe(
      encryptedNotePayloadByteLength({
        title: "Private title",
        message: "Private body",
      }),
    );
  });

  it("preserves decrypted titles exactly", async () => {
    const encrypted = await encryptNotePayload({
      title: "  Spaced title  ",
      message: "Private body",
      passphrase: "passphrase",
    });

    const [unlocked] = await decorateNotesForPassphrase(
      [note(encrypted.message)],
      "passphrase",
    );

    expect(unlocked.title).toBe("  Spaced title  ");
  });

  it("redacts encrypted notes until a passphrase is supplied", async () => {
    const encrypted = await encryptNotePayload({
      title: "Hidden title",
      message: "Hidden body",
      passphrase: "passphrase",
    });
    const redacted = redactEncryptedNote(note(encrypted.message));

    expect(redacted).toEqual(
      expect.objectContaining({
        encrypted: true,
        locked: true,
        title: ENCRYPTED_NOTE_TITLE,
        message: "",
        rawMessage: encrypted.message,
      }),
    );

    const [unlocked] = await decorateNotesForPassphrase(
      [redacted],
      "passphrase",
    );
    expect(unlocked).toEqual(
      expect.objectContaining({
        encrypted: true,
        locked: false,
        title: "Hidden title",
        message: "Hidden body",
        rawMessage: encrypted.message,
      }),
    );
  });

  it("does not treat plaintext prefix collisions as encrypted notes", async () => {
    const prefixedPlaintext = note(
      `${ENCRYPTED_NOTE_PREFIX}this is just plaintext`,
      "Plain prefix",
    );

    expect(redactEncryptedNote(prefixedPlaintext)).toBe(prefixedPlaintext);
    await expect(
      decorateNotesForPassphrase([prefixedPlaintext], "passphrase"),
    ).resolves.toEqual([prefixedPlaintext]);
  });

  it("does not redact schema-shaped plaintext unless it has a valid encrypted-note marker", async () => {
    const shapedEnvelope = `${ENCRYPTED_NOTE_PREFIX}${base64UrlEncode(
      JSON.stringify({
        v: 1,
        alg: "AES-GCM",
        kdf: "PBKDF2-SHA256",
        iterations: 250_000,
        salt: base64UrlEncode("too-short"),
        nonce: base64UrlEncode("too-short"),
        ciphertext: base64UrlEncode("too-short"),
      }),
    )}`;
    const prefixedPlaintext = note(shapedEnvelope, "Plain prefix");
    const malformedPlaceholder = note(shapedEnvelope);

    expect(redactEncryptedNote(prefixedPlaintext)).toBe(prefixedPlaintext);
    expect(redactEncryptedNote(malformedPlaceholder)).toBe(
      malformedPlaceholder,
    );
    await expect(
      decorateNotesForPassphrase([prefixedPlaintext], "passphrase"),
    ).resolves.toEqual([prefixedPlaintext]);
  });

  it("preserves actionable decrypt errors instead of treating every failure as a wrong passphrase", async () => {
    const encrypted = await encryptNotePayload({
      title: "Hidden title",
      message: "Hidden body",
      passphrase: "passphrase",
    });

    vi.stubGlobal("crypto", undefined);

    const [locked] = await decorateNotesForPassphrase(
      [note(encrypted.message)],
      "passphrase",
    );

    expect(locked).toEqual(
      expect.objectContaining({
        encrypted: true,
        locked: true,
        decryptError: true,
        decryptErrorMessage:
          "Web Crypto is required to decrypt notes in this browser.",
      }),
    );
  });

  it("keeps decrypted plaintext out of local cache payloads", async () => {
    const encrypted = await encryptNotePayload({
      title: "Secret cache title",
      message: "Secret cache body",
      passphrase: "cache-pass",
    });
    const [unlocked] = await decorateNotesForPassphrase(
      [note(encrypted.message)],
      "cache-pass",
    );

    const [cached] = notesForCache([unlocked]);
    expect(cached.title).toBe(ENCRYPTED_NOTE_TITLE);
    expect(cached.message).toBe(encrypted.message);
    expect(JSON.stringify(cached)).not.toContain("Secret cache title");
    expect(JSON.stringify(cached)).not.toContain("Secret cache body");
  });
});
