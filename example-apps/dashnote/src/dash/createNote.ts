/**
 * Create a new note document.
 *
 * SDK method: sdk.documents.create({ document, identityKey, signer })
 */
import type { Logger } from "../lib/logger";
import { encryptNoteForStorage } from "../lib/encryptedNotes";
import { loadSdkModule } from "./sdkModule";
import type {
  DashEncryptionKeyMaterial,
  DashKeyManager,
  DashSdk,
} from "./types";

interface NoteWriteEncryptionOptions {
  network: "testnet" | "mainnet";
  keyMaterial: DashEncryptionKeyMaterial;
}

export interface CreateNoteParams {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  title?: string;
  message: string;
  encryption?: NoteWriteEncryptionOptions | null;
  log?: Logger;
}

export async function createNote({
  sdk,
  keyManager,
  contractId,
  title,
  message,
  encryption,
  log,
}: CreateNoteParams): Promise<string> {
  log?.("Creating note…");
  const { identity, identityKey, signer } = await keyManager.getAuth();
  const { Document } = await loadSdkModule();
  const trimmedTitle = title?.trim();
  const initialProperties = {
    ...(trimmedTitle ? { title: trimmedTitle } : {}),
    message,
  };
  let document = new Document({
    properties: {
      ...initialProperties,
    },
    documentTypeName: "note",
    dataContractId: contractId,
    ownerId: identity.id,
  });
  const noteId = getDirectDocumentId(document);

  if (encryption) {
    if (!noteId) {
      throw new Error(
        "SDK did not expose document.id before submit; refusing to create an encrypted note.",
      );
    }
    const entropy = getDocumentEntropy(document);
    if (!entropy) {
      throw new Error(
        "SDK did not expose document entropy before submit; refusing to create an encrypted note.",
      );
    }
    const stored = await encryptNoteForStorage({
      title: trimmedTitle,
      message,
      keyMaterial: encryption.keyMaterial,
      context: {
        network: encryption.network,
        contractId,
        documentType: "note",
        ownerId: String(identity.id),
        documentId: noteId,
      },
    });
    document = new Document({
      properties: {
        title: stored.title,
        message: stored.message,
      },
      documentTypeName: "note",
      dataContractId: contractId,
      ownerId: identity.id,
      id: noteId,
      entropy,
    });
  }

  await sdk.documents.create({
    document,
    identityKey,
    signer,
  });

  const finalNoteId = getDocumentId(document);
  if (!finalNoteId) {
    throw new Error("Created note returned no ID.");
  }
  log?.("Note created.", "success");
  return finalNoteId;
}

function getDocumentId(document: unknown): string {
  const directId = getDirectDocumentId(document);
  if (directId) return directId;
  const json =
    typeof (document as { toJSON?: unknown })?.toJSON === "function"
      ? ((
          document as { toJSON: () => Record<string, unknown> }
        ).toJSON() as Record<string, unknown>)
      : {};
  return getStringish(json.$id) || getStringish(json.id);
}

function getDirectDocumentId(document: unknown): string {
  return getStringish((document as { id?: unknown })?.id);
}

function getDocumentEntropy(document: unknown): Uint8Array | null {
  const entropy = (document as { entropy?: unknown })?.entropy;
  if (entropy instanceof Uint8Array) return entropy;
  if (Array.isArray(entropy)) return new Uint8Array(entropy);
  return null;
}

function getStringish(value: unknown): string {
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
