import type { NoteRecord } from "../dash/queries";
import type { DashEncryptionKeyMaterial } from "../dash/types";
import { byteLength, FIELD_BYTE_LIMIT } from "./fieldLimits";

export const ENCRYPTED_NOTE_PREFIX = "dashnote:encrypted:v1:";
export const ENCRYPTED_NOTE_KIND = "dashnote-encrypted-note";
export const ENCRYPTED_NOTE_TITLE = "Encrypted note";
export const LOCKED_NOTE_MESSAGE =
  "Sign in with an encryption-capable session to decrypt this note.";
export const INVALID_NOTE_MESSAGE =
  "This encrypted note could not be decrypted.";

const ENVELOPE_VERSION = 1;
const CONTENT_ALG = "AES-256-GCM";
const KDF = "HKDF-SHA256";
const KEY_SOURCE = "identity-encryption-key";
const AES_GCM_IV_BYTES = 12;

export type NoteEncryptionState =
  | "plaintext"
  | "decrypted"
  | "locked"
  | "invalid";

export interface EncryptedNotePayload {
  title: string;
  message: string;
}

export interface NoteCryptoContext {
  network: "testnet" | "mainnet";
  contractId: string;
  documentType: "note";
  ownerId: string;
  documentId: string;
}

export interface EncryptedNoteEnvelope {
  v: 1;
  kind: typeof ENCRYPTED_NOTE_KIND;
  encryption: {
    contentAlg: typeof CONTENT_ALG;
    kdf: typeof KDF;
    keySource: typeof KEY_SOURCE;
    keyId: number;
    keyVersion: number;
  };
  encryptedPayload: {
    iv: string;
    ciphertext: string;
  };
  shares: [];
}

export interface DisplayNoteRecord extends NoteRecord {
  encryptionState: NoteEncryptionState;
  rawTitle: string | null;
  rawMessage: string;
}

export interface DecryptedNotePayloadCache {
  readonly totalBytes: number;
  get(key: string): EncryptedNotePayload | null;
  set(key: string, payload: EncryptedNotePayload): void;
  clear(): void;
}

export interface ResolveNoteDisplayOptions {
  network: "testnet" | "mainnet";
  contractId: string;
  encryptionKeyMaterial: DashEncryptionKeyMaterial | null;
  decryptedPayloadCache?: DecryptedNotePayloadCache;
}

export function isEncryptedNoteEnvelopeString(message: string): boolean {
  return message.startsWith(ENCRYPTED_NOTE_PREFIX);
}

export function isEncryptedNoteEnvelope(
  value: unknown,
): value is EncryptedNoteEnvelope {
  if (!isRecord(value)) return false;
  const encryption = value.encryption;
  const encryptedPayload = value.encryptedPayload;
  return (
    value.v === ENVELOPE_VERSION &&
    value.kind === ENCRYPTED_NOTE_KIND &&
    isRecord(encryption) &&
    encryption.contentAlg === CONTENT_ALG &&
    encryption.kdf === KDF &&
    encryption.keySource === KEY_SOURCE &&
    typeof encryption.keyId === "number" &&
    Number.isInteger(encryption.keyId) &&
    typeof encryption.keyVersion === "number" &&
    Number.isInteger(encryption.keyVersion) &&
    isRecord(encryptedPayload) &&
    typeof encryptedPayload.iv === "string" &&
    typeof encryptedPayload.ciphertext === "string" &&
    Array.isArray(value.shares) &&
    value.shares.length === 0
  );
}

export function serializeEncryptedNoteEnvelope(
  envelope: EncryptedNoteEnvelope,
): string {
  return `${ENCRYPTED_NOTE_PREFIX}${base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(envelope)),
  )}`;
}

export function parseEncryptedNoteEnvelope(
  message: string,
): EncryptedNoteEnvelope {
  if (!isEncryptedNoteEnvelopeString(message)) {
    throw new Error("Message is not a Dashnote encrypted-note envelope.");
  }
  const encoded = message.slice(ENCRYPTED_NOTE_PREFIX.length);
  const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
  if (!isEncryptedNoteEnvelope(parsed)) {
    throw new Error("Encrypted note envelope is malformed.");
  }
  return parsed;
}

export function assertEncryptedMessageFits(message: string): void {
  const bytes = byteLength(message);
  if (bytes > FIELD_BYTE_LIMIT) {
    throw new Error(
      `Encrypted note exceeds the ${FIELD_BYTE_LIMIT}-byte field limit (${bytes} B). Shorten the note and try again.`,
    );
  }
}

export function createDecryptedNotePayloadCache(
  maxBytes = 1024 * 1024,
): DecryptedNotePayloadCache {
  const entries = new Map<
    string,
    { payload: EncryptedNotePayload; bytes: number }
  >();
  let totalBytes = 0;

  return {
    get totalBytes() {
      return totalBytes;
    },
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      entries.set(key, entry);
      return { ...entry.payload };
    },
    set(key, payload) {
      if (maxBytes <= 0) return;
      const bytes = byteLength(payload.title) + byteLength(payload.message);
      if (bytes > maxBytes) return;
      const existing = entries.get(key);
      if (existing) {
        totalBytes -= existing.bytes;
        entries.delete(key);
      }
      entries.set(key, { payload: { ...payload }, bytes });
      totalBytes += bytes;
      for (const [oldestKey, oldest] of entries) {
        if (totalBytes <= maxBytes) break;
        entries.delete(oldestKey);
        totalBytes -= oldest.bytes;
      }
    },
    clear() {
      entries.clear();
      totalBytes = 0;
    },
  };
}

export async function encryptNotePayload({
  payload,
  context,
  keyMaterial,
}: {
  payload: EncryptedNotePayload;
  context: NoteCryptoContext;
  keyMaterial: DashEncryptionKeyMaterial;
}): Promise<EncryptedNoteEnvelope> {
  requireCryptoContext(context);
  const encryption = {
    contentAlg: CONTENT_ALG,
    kdf: KDF,
    keySource: KEY_SOURCE,
    keyId: keyMaterial.keyId,
    keyVersion: keyMaterial.keyVersion,
  } as const;
  const iv = getCrypto().getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const key = await deriveContentKey({
    context,
    encryption,
    keyMaterial,
  });
  const aad = canonicalAadBytes({ context, encryption });
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await getCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: bufferSource(iv),
      additionalData: bufferSource(aad),
    },
    key,
    bufferSource(plaintext),
  );

  return {
    v: ENVELOPE_VERSION,
    kind: ENCRYPTED_NOTE_KIND,
    encryption,
    encryptedPayload: {
      iv: base64UrlEncode(iv),
      ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    },
    shares: [],
  };
}

export async function decryptNotePayload({
  envelope,
  context,
  keyMaterial,
}: {
  envelope: EncryptedNoteEnvelope;
  context: NoteCryptoContext;
  keyMaterial: DashEncryptionKeyMaterial;
}): Promise<EncryptedNotePayload> {
  requireCryptoContext(context);
  if (keyMaterial.keyId !== envelope.encryption.keyId) {
    throw new Error("Encrypted note key ID does not match this session.");
  }
  if (keyMaterial.keyVersion !== envelope.encryption.keyVersion) {
    throw new Error("Encrypted note key version does not match this session.");
  }
  const key = await deriveContentKey({
    context,
    encryption: envelope.encryption,
    keyMaterial,
  });
  const aad = canonicalAadBytes({
    context,
    encryption: envelope.encryption,
  });
  const plaintext = await getCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bufferSource(base64UrlDecode(envelope.encryptedPayload.iv)),
      additionalData: bufferSource(aad),
    },
    key,
    bufferSource(base64UrlDecode(envelope.encryptedPayload.ciphertext)),
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  if (
    !isRecord(parsed) ||
    typeof parsed.title !== "string" ||
    typeof parsed.message !== "string"
  ) {
    throw new Error("Encrypted note payload is malformed.");
  }
  return {
    title: parsed.title,
    message: parsed.message,
  };
}

export async function encryptNoteForStorage({
  title,
  message,
  context,
  keyMaterial,
}: {
  title?: string;
  message: string;
  context: NoteCryptoContext;
  keyMaterial: DashEncryptionKeyMaterial;
}): Promise<{
  title: string;
  message: string;
  envelope: EncryptedNoteEnvelope;
}> {
  const envelope = await encryptNotePayload({
    payload: {
      title: title?.trim() ?? "",
      message,
    },
    context,
    keyMaterial,
  });
  const storedMessage = serializeEncryptedNoteEnvelope(envelope);
  assertEncryptedMessageFits(storedMessage);
  return {
    title: ENCRYPTED_NOTE_TITLE,
    message: storedMessage,
    envelope,
  };
}

export async function resolveNoteForDisplay(
  note: NoteRecord,
  options: ResolveNoteDisplayOptions,
): Promise<DisplayNoteRecord> {
  if (!isEncryptedNoteEnvelopeString(note.message)) {
    return {
      ...note,
      encryptionState: "plaintext",
      rawTitle: note.title,
      rawMessage: note.message,
    };
  }

  let envelope: EncryptedNoteEnvelope;
  try {
    envelope = parseEncryptedNoteEnvelope(note.message);
  } catch {
    return lockedDisplayNote(note, "invalid");
  }

  if (!options.encryptionKeyMaterial) {
    return lockedDisplayNote(note, "locked");
  }

  try {
    const context = {
      network: options.network,
      contractId: options.contractId,
      documentType: "note" as const,
      ownerId: note.ownerId,
      documentId: note.id,
    };
    const cacheKey = decryptedNoteCacheKey(note, envelope, context);
    const cachedPayload = options.decryptedPayloadCache?.get(cacheKey);
    const payload =
      cachedPayload ??
      (await decryptNotePayload({
        envelope,
        context,
        keyMaterial: options.encryptionKeyMaterial,
      }));
    if (!cachedPayload) {
      options.decryptedPayloadCache?.set(cacheKey, payload);
    }
    return {
      ...note,
      title: payload.title || null,
      message: payload.message,
      encryptionState: "decrypted",
      rawTitle: note.title,
      rawMessage: note.message,
    };
  } catch {
    return lockedDisplayNote(note, "invalid");
  }
}

export function resolveCachedNoteForDisplay(
  note: NoteRecord,
  options: ResolveNoteDisplayOptions,
): DisplayNoteRecord | null {
  if (!isEncryptedNoteEnvelopeString(note.message)) {
    return {
      ...note,
      encryptionState: "plaintext",
      rawTitle: note.title,
      rawMessage: note.message,
    };
  }
  if (!options.encryptionKeyMaterial || !options.decryptedPayloadCache) {
    return null;
  }

  try {
    const envelope = parseEncryptedNoteEnvelope(note.message);
    if (
      options.encryptionKeyMaterial.keyId !== envelope.encryption.keyId ||
      options.encryptionKeyMaterial.keyVersion !==
        envelope.encryption.keyVersion
    ) {
      return null;
    }
    const context = {
      network: options.network,
      contractId: options.contractId,
      documentType: "note" as const,
      ownerId: note.ownerId,
      documentId: note.id,
    };
    const payload = options.decryptedPayloadCache.get(
      decryptedNoteCacheKey(note, envelope, context),
    );
    if (!payload) return null;
    return {
      ...note,
      title: payload.title || null,
      message: payload.message,
      encryptionState: "decrypted",
      rawTitle: note.title,
      rawMessage: note.message,
    };
  } catch {
    return null;
  }
}

function decryptedNoteCacheKey(
  note: NoteRecord,
  envelope: EncryptedNoteEnvelope,
  context: NoteCryptoContext,
): string {
  return [
    context.network,
    context.contractId,
    context.ownerId,
    context.documentId,
    String(note.revision),
    String(envelope.encryption.keyId),
    String(envelope.encryption.keyVersion),
    note.message,
  ].join("\0");
}

export function noteDisplayFallback(note: NoteRecord): DisplayNoteRecord {
  if (isEncryptedNoteEnvelopeString(note.message)) {
    return lockedDisplayNote(note, "locked");
  }
  return {
    ...note,
    encryptionState: "plaintext",
    rawTitle: note.title,
    rawMessage: note.message,
  };
}

export async function resolveNotesForDisplay(
  notes: NoteRecord[],
  options: ResolveNoteDisplayOptions,
): Promise<DisplayNoteRecord[]> {
  return Promise.all(notes.map((note) => resolveNoteForDisplay(note, options)));
}

function lockedDisplayNote(
  note: NoteRecord,
  encryptionState: "locked" | "invalid",
): DisplayNoteRecord {
  return {
    ...note,
    title: ENCRYPTED_NOTE_TITLE,
    message:
      encryptionState === "locked" ? LOCKED_NOTE_MESSAGE : INVALID_NOTE_MESSAGE,
    encryptionState,
    rawTitle: note.title,
    rawMessage: note.message,
  };
}

function canonicalAadBytes({
  context,
  encryption,
}: {
  context: NoteCryptoContext;
  encryption: EncryptedNoteEnvelope["encryption"];
}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      network: context.network,
      contractId: context.contractId,
      documentType: context.documentType,
      ownerId: context.ownerId,
      documentId: context.documentId,
      keyId: encryption.keyId,
      keyVersion: encryption.keyVersion,
      contentAlg: encryption.contentAlg,
      envelopeVersion: ENVELOPE_VERSION,
    }),
  );
}

async function deriveContentKey({
  context,
  encryption,
  keyMaterial,
}: {
  context: NoteCryptoContext;
  encryption: EncryptedNoteEnvelope["encryption"];
  keyMaterial: DashEncryptionKeyMaterial;
}): Promise<CryptoKey> {
  const keyMaterialHandle = await getCrypto().subtle.importKey(
    "raw",
    bufferSource(keyMaterial.privateKeyBytes),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return getCrypto().subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bufferSource(canonicalAadBytes({ context, encryption })),
      info: bufferSource(
        new TextEncoder().encode("Dashnote encrypted note content key v1"),
      ),
    },
    keyMaterialHandle,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function requireCryptoContext(context: NoteCryptoContext): void {
  if (
    !context.network ||
    !context.contractId ||
    !context.documentType ||
    !context.ownerId ||
    !context.documentId
  ) {
    throw new Error("Encrypted notes require complete document context.");
  }
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is required for encrypted notes.");
  }
  return globalThis.crypto;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
