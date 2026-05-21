import type { DashEncryptionKeyMaterial } from "../dash/types";
import { encryptNoteForStorage } from "./encryptedNotes";

export interface NoteWriteEncryptionOptions {
  network: "testnet" | "mainnet";
  keyMaterial: DashEncryptionKeyMaterial;
}

type DocumentConstructor = new (args: never) => unknown;

interface NoteDocumentBaseParams {
  Document: DocumentConstructor;
  contractId: string;
  ownerId: unknown;
  title?: string;
  message: string;
  encryption?: NoteWriteEncryptionOptions | null;
}

type CreateNoteDocumentParams = NoteDocumentBaseParams;

interface ReplaceNoteDocumentParams extends NoteDocumentBaseParams {
  noteId: string;
  revision: bigint;
}

export async function buildCreateNoteDocument({
  Document,
  contractId,
  ownerId,
  title,
  message,
  encryption,
}: CreateNoteDocumentParams): Promise<unknown> {
  const document = new Document({
    properties: noteProperties(title, message),
    documentTypeName: "note",
    dataContractId: contractId,
    ownerId,
  } as never);
  if (!encryption) return document;

  const noteId = directDocumentId(document);
  if (!noteId) {
    throw new Error(
      "SDK did not expose document.id before submit; refusing to create an encrypted note.",
    );
  }
  const entropy = documentEntropy(document);
  if (!entropy) {
    throw new Error(
      "SDK did not expose document entropy before submit; refusing to create an encrypted note.",
    );
  }

  return new Document({
    properties: await encryptedNoteProperties({
      title,
      message,
      contractId,
      ownerId,
      noteId,
      encryption,
    }),
    documentTypeName: "note",
    dataContractId: contractId,
    ownerId,
    id: noteId,
    entropy,
  } as never);
}

export async function buildReplaceNoteDocument({
  Document,
  contractId,
  ownerId,
  noteId,
  revision,
  title,
  message,
  encryption,
}: ReplaceNoteDocumentParams): Promise<unknown> {
  return new Document({
    properties: encryption
      ? await encryptedNoteProperties({
          title,
          message,
          contractId,
          ownerId,
          noteId,
          encryption,
        })
      : noteProperties(title, message),
    documentTypeName: "note",
    dataContractId: contractId,
    ownerId,
    revision,
    id: noteId,
  } as never);
}

export function documentId(document: unknown): string {
  const directId = directDocumentId(document);
  if (directId) return directId;
  const json =
    typeof (document as { toJSON?: unknown })?.toJSON === "function"
      ? ((
          document as { toJSON: () => Record<string, unknown> }
        ).toJSON() as Record<string, unknown>)
      : {};
  return stringish(json.$id) || stringish(json.id);
}

function noteProperties(title: string | undefined, message: string) {
  const trimmedTitle = title?.trim();
  return {
    ...(trimmedTitle ? { title: trimmedTitle } : {}),
    message,
  };
}

async function encryptedNoteProperties({
  title,
  message,
  contractId,
  ownerId,
  noteId,
  encryption,
}: {
  title?: string;
  message: string;
  contractId: string;
  ownerId: unknown;
  noteId: string;
  encryption: NoteWriteEncryptionOptions;
}): Promise<{ title: string; message: string }> {
  const stored = await encryptNoteForStorage({
    title: title?.trim(),
    message,
    keyMaterial: encryption.keyMaterial,
    context: {
      network: encryption.network,
      contractId,
      documentType: "note",
      ownerId: String(ownerId),
      documentId: noteId,
    },
  });
  return {
    title: stored.title,
    message: stored.message,
  };
}

function directDocumentId(document: unknown): string {
  return stringish((document as { id?: unknown })?.id);
}

function documentEntropy(document: unknown): Uint8Array | null {
  const entropy = (document as { entropy?: unknown })?.entropy;
  if (entropy instanceof Uint8Array) return entropy;
  if (Array.isArray(entropy)) return new Uint8Array(entropy);
  return null;
}

function stringish(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof (value as { toString?: unknown }).toString === "function"
  ) {
    const result = (value as { toString: () => string }).toString();
    return result === "[object Object]" ? "" : result;
  }
  return "";
}
