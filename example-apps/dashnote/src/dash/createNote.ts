/**
 * Create a new note document.
 *
 * SDK method: sdk.documents.create({ document, identityKey, signer })
 */
import type { Logger } from "../lib/logger";
import {
  buildCreateNoteDocument,
  documentId,
  type NoteWriteEncryptionOptions,
} from "../lib/noteWriteDocuments";
import { loadSdkModule } from "./sdkModule";
import type { DashKeyManager, DashSdk } from "./types";

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
  const document = await buildCreateNoteDocument({
    Document,
    contractId,
    ownerId: identity.id,
    title,
    message,
    encryption,
  });

  await sdk.documents.create({
    document,
    identityKey,
    signer,
  });

  const finalNoteId = documentId(document);
  if (!finalNoteId) {
    throw new Error("Created note returned no ID.");
  }
  log?.("Note created.", "success");
  return finalNoteId;
}
