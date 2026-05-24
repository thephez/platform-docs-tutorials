/**
 * Update an existing note. Fetches the current document to bump its revision,
 * then submits a replace state transition.
 *
 * SDK methods:
 *   sdk.documents.get(contractId, documentTypeName, documentId)
 *   sdk.documents.replace({ document, identityKey, signer })
 */
import type { Logger } from "../lib/logger";
import {
  buildReplaceNoteDocument,
  type NoteWriteEncryptionOptions,
} from "../lib/noteWriteDocuments";
import { loadSdkModule } from "./sdkModule";
import type { DashKeyManager, DashSdk } from "./types";

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
  const document = await buildReplaceNoteDocument({
    Document,
    contractId,
    ownerId: identity.id,
    noteId,
    revision,
    title,
    message,
    encryption,
  });

  await sdk.documents.replace({
    document,
    identityKey,
    signer,
  });
  log?.("Note saved.", "success");
  return revision;
}
