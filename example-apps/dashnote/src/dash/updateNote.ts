/**
 * Update an existing note. Fetches the current document to bump its revision,
 * then submits a replace state transition.
 *
 * SDK methods:
 *   sdk.documents.get(contractId, documentTypeName, documentId)
 *   sdk.documents.replace({ document, identityKey, signer })
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

export interface UpdateNoteParams {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  noteId: string;
  title?: string;
  message: string;
  encryption?: NoteWriteEncryptionOptions | null;
  log?: Logger;
}

export async function updateNote({
  sdk,
  keyManager,
  contractId,
  noteId,
  title,
  message,
  encryption,
  log,
}: UpdateNoteParams): Promise<bigint> {
  log?.(`Saving note ${noteId}…`);
  const { identity, identityKey, signer } = await keyManager.getAuth();
  const existingDoc = await sdk.documents.get(contractId, "note", noteId);
  if (!existingDoc) {
    throw new Error(`Note ${noteId} not found.`);
  }

  const { Document } = await loadSdkModule();
  const revision = BigInt(existingDoc.revision ?? 0) + 1n;
  const trimmedTitle = title?.trim();
  const stored = encryption
    ? await encryptNoteForStorage({
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
      })
    : null;
  const document = new Document({
    properties: {
      ...(stored
        ? { title: stored.title, message: stored.message }
        : {
            ...(trimmedTitle ? { title: trimmedTitle } : {}),
            message,
          }),
    },
    documentTypeName: "note",
    dataContractId: contractId,
    ownerId: identity.id,
    revision,
    id: noteId,
  });

  await sdk.documents.replace({
    document,
    identityKey,
    signer,
  });
  log?.("Note saved.", "success");
  return revision;
}
