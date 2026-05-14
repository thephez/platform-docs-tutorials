import type { NoteRecord } from "../dash/queries";

export const ENCRYPTED_NOTE_PREFIX = "dashnote:enc:v1:";
export const ENCRYPTED_NOTE_TITLE = "Encrypted note";

const ENCRYPTION_VERSION = 1;
const KDF_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const WRONG_PASSPHRASE_MESSAGE =
  "Unable to decrypt this note with the provided passphrase.";

interface PlainNotePayload {
  title: string;
  message: string;
}

interface EncryptedNoteEnvelope {
  v: typeof ENCRYPTION_VERSION;
  alg: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  nonce: string;
  ciphertext: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodedLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseEnvelope(message: string): EncryptedNoteEnvelope | null {
  if (!message.startsWith(ENCRYPTED_NOTE_PREFIX)) return null;
  try {
    const raw = base64UrlDecode(message.slice(ENCRYPTED_NOTE_PREFIX.length));
    const parsed = JSON.parse(
      decoder.decode(raw),
    ) as Partial<EncryptedNoteEnvelope>;
    if (
      parsed.v !== ENCRYPTION_VERSION ||
      parsed.alg !== "AES-GCM" ||
      parsed.kdf !== "PBKDF2-SHA256" ||
      parsed.iterations !== KDF_ITERATIONS ||
      typeof parsed.salt !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.ciphertext !== "string"
    ) {
      return null;
    }
    if (
      base64UrlDecode(parsed.salt).byteLength !== SALT_BYTES ||
      base64UrlDecode(parsed.nonce).byteLength !== NONCE_BYTES ||
      base64UrlDecode(parsed.ciphertext).byteLength <= 16
    ) {
      return null;
    }
    return parsed as EncryptedNoteEnvelope;
  } catch {
    return null;
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
) {
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      iterations,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isEncryptedNoteMessage(
  message: string | null | undefined,
): boolean {
  return typeof message === "string" && parseEnvelope(message) !== null;
}

export function isEncryptedNote(
  note: Pick<NoteRecord, "title" | "message">,
): boolean {
  return (
    "title" in note &&
    note.title === ENCRYPTED_NOTE_TITLE &&
    isEncryptedNoteMessage(note.message)
  );
}

export async function encryptNotePayload({
  title,
  message,
  passphrase,
}: PlainNotePayload & { passphrase: string }): Promise<{
  title: string;
  message: string;
}> {
  const trimmedPassphrase = passphrase.trim();
  if (!trimmedPassphrase) {
    throw new Error(
      "Enter an encryption passphrase before saving encrypted notes.",
    );
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required to encrypt notes in this browser.");
  }

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await deriveKey(trimmedPassphrase, salt, KDF_ITERATIONS);
  const plaintext = encoder.encode(JSON.stringify({ title, message }));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as unknown as BufferSource },
      key,
      plaintext,
    ),
  );
  const envelope: EncryptedNoteEnvelope = {
    v: ENCRYPTION_VERSION,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: base64UrlEncode(salt),
    nonce: base64UrlEncode(nonce),
    ciphertext: base64UrlEncode(ciphertext),
  };
  return {
    title: ENCRYPTED_NOTE_TITLE,
    message: `${ENCRYPTED_NOTE_PREFIX}${base64UrlEncode(encoder.encode(JSON.stringify(envelope)))}`,
  };
}

export function encryptedNotePayloadByteLength({
  title,
  message,
}: PlainNotePayload): number {
  const plaintextBytes = encoder.encode(
    JSON.stringify({ title, message }),
  ).byteLength;
  const envelope: EncryptedNoteEnvelope = {
    v: ENCRYPTION_VERSION,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: "A".repeat(base64UrlEncodedLength(SALT_BYTES)),
    nonce: "A".repeat(base64UrlEncodedLength(NONCE_BYTES)),
    ciphertext: "A".repeat(base64UrlEncodedLength(plaintextBytes + 16)),
  };
  return (
    ENCRYPTED_NOTE_PREFIX.length +
    base64UrlEncodedLength(encoder.encode(JSON.stringify(envelope)).byteLength)
  );
}

export async function decryptNotePayload(
  message: string,
  passphrase: string,
): Promise<PlainNotePayload> {
  const envelope = parseEnvelope(message);
  if (!envelope)
    throw new Error("This note uses an unsupported encrypted-note format.");
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required to decrypt notes in this browser.");
  }
  const key = await deriveKey(
    passphrase.trim(),
    base64UrlDecode(envelope.salt),
    envelope.iterations,
  );
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlDecode(envelope.nonce) as unknown as BufferSource,
    },
    key,
    base64UrlDecode(envelope.ciphertext) as unknown as BufferSource,
  );
  const parsed = JSON.parse(
    decoder.decode(plaintext),
  ) as Partial<PlainNotePayload>;
  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    message: typeof parsed.message === "string" ? parsed.message : "",
  };
}

function formatDecryptErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (
      error.message.includes("Web Crypto") ||
      error.message.includes("unsupported encrypted-note format")
    ) {
      return error.message;
    }
  }
  return WRONG_PASSPHRASE_MESSAGE;
}

export function redactEncryptedNote(note: NoteRecord): NoteRecord {
  if (!isEncryptedNote(note)) return note;
  return {
    ...note,
    encrypted: true,
    locked: true,
    decryptError: false,
    decryptErrorMessage: undefined,
    rawTitle: note.rawTitle ?? note.title,
    rawMessage: note.rawMessage ?? note.message,
    title: ENCRYPTED_NOTE_TITLE,
    message: "",
  };
}

export async function unlockEncryptedNote(
  note: NoteRecord,
  passphrase: string,
): Promise<NoteRecord> {
  const rawMessage = note.rawMessage ?? note.message;
  const rawTitle = note.rawTitle ?? note.title;
  if (
    rawTitle !== ENCRYPTED_NOTE_TITLE ||
    !isEncryptedNoteMessage(rawMessage)
  ) {
    return note;
  }
  try {
    const decrypted = await decryptNotePayload(rawMessage, passphrase);
    return {
      ...note,
      encrypted: true,
      locked: false,
      decryptError: false,
      decryptErrorMessage: undefined,
      rawTitle,
      rawMessage,
      title: decrypted.title,
      message: decrypted.message,
    };
  } catch (error) {
    return {
      ...note,
      encrypted: true,
      locked: true,
      decryptError: true,
      decryptErrorMessage: formatDecryptErrorMessage(error),
      rawTitle,
      rawMessage,
      title: "Unable to decrypt",
      message: "",
    };
  }
}

export async function decorateNotesForPassphrase(
  notes: NoteRecord[],
  passphrase: string | null,
): Promise<NoteRecord[]> {
  if (!passphrase) return notes.map(redactEncryptedNote);
  return Promise.all(
    notes.map((note) => unlockEncryptedNote(note, passphrase)),
  );
}

export function noteForCache(note: NoteRecord): NoteRecord {
  if (!note.encrypted && !note.rawMessage) return note;
  const rest: NoteRecord = { ...note };
  const { rawTitle, rawMessage } = rest;
  delete rest.encrypted;
  delete rest.locked;
  delete rest.decryptError;
  delete rest.decryptErrorMessage;
  delete rest.rawTitle;
  delete rest.rawMessage;
  return {
    ...rest,
    title: rawTitle ?? rest.title,
    message: rawMessage ?? rest.message,
  };
}

export function notesForCache(notes: NoteRecord[]): NoteRecord[] {
  return notes.map(noteForCache);
}
