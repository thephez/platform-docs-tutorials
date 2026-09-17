/**
 * Transfer a document to another identity.
 *
 * Transfer clears any `$price` WITHOUT writing a zero-price price-update record,
 * which is why the listings index must tail the `transfer` stream separately and
 * why the UI warns that transferring a listed name cancels the listing.
 *
 * Uses the AUTHENTICATION key, not the TRANSFER-purpose key — Platform rejects
 * TRANSFER-purpose keys for document state transitions. `getAuth()` inside
 * `withAuthedDocument` already resolves the correct key.
 *
 * EXTRACTABLE: no DPNS knowledge, generic parameter names, typed result.
 *
 * SDK method: sdk.documents.transfer({ document, recipientId, identityKey, signer })
 */
import { marketplaceError, type MarketplaceResult } from "./marketplaceErrors";
import type { DashKeyManager, DashSdk } from "./types";
import { withAuthedDocument } from "./withAuthedDocument";
import type { Logger } from "../lib/logger";

export interface TransferNameParams {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  documentTypeName: string;
  documentId: string;
  recipientId: string;
  log?: Logger;
}

export async function transferName({
  sdk,
  keyManager,
  contractId,
  documentTypeName,
  documentId,
  recipientId,
  log,
}: TransferNameParams): Promise<MarketplaceResult> {
  if (!recipientId) {
    return {
      ok: false,
      error: marketplaceError("Unknown", "Recipient identity ID is required."),
    };
  }

  log?.(`Transferring ${documentId} to ${recipientId}…`);

  const result = await withAuthedDocument(
    {
      sdk,
      keyManager,
      contractId,
      documentTypeName,
      documentId,
      log,
    },
    async ({ doc, identityKey, signer }) => {
      await sdk.documents.transfer({
        document: doc,
        recipientId,
        identityKey,
        signer,
      });
    },
  );

  if (!result.ok) return result;
  log?.("Transfer complete.", "success");
  return { ok: true };
}
