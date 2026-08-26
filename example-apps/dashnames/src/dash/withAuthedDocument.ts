/**
 * Shared prelude for document mutations (setPrice / purchase / transfer).
 *
 * Generalized from dashmint-lab's `withAuthedCard`: the hardcoded `"card"`
 * document type became a `documentTypeName` parameter and `cardId` became
 * `documentId`. Otherwise the flow is unchanged, because trading a DPNS `domain`
 * is mechanically identical to trading an NFT `card`.
 *
 * Every mutation follows the same steps:
 *   1. Get an auth signer for the current identity.
 *   2. Fetch the current on-chain document (needed for its revision).
 *   3. Bump `document.revision` by 1 — Platform rejects mutations that do not
 *      strictly increase it.
 *   4. Call the one SDK method unique to the operation.
 *
 * EXTRACTABLE — this file must compile unchanged if moved to a shared module:
 * no DPNS knowledge, no `"domain"` literal, no `.dash` logic, generic parameter
 * names.
 *
 * NOTE the transfer path deliberately uses the AUTHENTICATION key, not the
 * TRANSFER-purpose key — Platform rejects TRANSFER-purpose keys for document
 * state transitions. `keyManager.getAuth()` already returns the right one.
 *
 * SDK methods: keyManager.getAuth(), sdk.documents.get(...)
 */
import {
  classifyMarketplaceError,
  marketplaceError,
} from "./marketplaceErrors";
import type { MarketplaceError } from "./marketplaceErrors";
import type { DashAuth, DashKeyManager, DashSdk } from "./types";
import type { DocumentHandle } from "../lib/safeDoc";
import type { Logger } from "../lib/logger";

export interface AuthedDocumentContext extends DashAuth {
  sdk: DashSdk;
  contractId: string;
  documentTypeName: string;
  /** The fetched document, revision already incremented. */
  doc: DocumentHandle;
}

export interface WithAuthedDocumentOptions {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  documentTypeName: string;
  documentId: string;
  log?: Logger;
}

/**
 * Runs `fn` with an authenticated, revision-bumped document.
 *
 * Returns a typed result rather than throwing, and never a UI string: callers
 * map `error.kind` to copy.
 */
export async function withAuthedDocument<T>(
  opts: WithAuthedDocumentOptions,
  fn: (ctx: AuthedDocumentContext) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: MarketplaceError }> {
  const { sdk, keyManager, contractId, documentTypeName, documentId, log } =
    opts;

  try {
    const { identity, identityKey, signer } = await keyManager.getAuth();

    const doc = await sdk.documents.get(
      contractId,
      documentTypeName,
      documentId,
    );
    if (!doc) {
      return {
        ok: false,
        error: marketplaceError(
          "Unknown",
          `Document ${documentId} was not found.`,
        ),
      };
    }

    doc.revision = BigInt(doc.revision ?? 0) + 1n;

    const value = await fn({
      sdk,
      identity,
      identityKey,
      signer,
      contractId,
      documentTypeName,
      doc,
    });

    return { ok: true, value };
  } catch (err) {
    const error = classifyMarketplaceError(err);
    log?.(error.message, "error");
    return { ok: false, error };
  }
}
