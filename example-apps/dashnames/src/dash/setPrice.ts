/**
 * Set or remove the sale price on a document.
 *
 * Pricing adds a `$price` field to the on-chain document; `0n` removes it from
 * sale. Both go through the same SDK call — "delisting" is not a separate
 * transition, which is why the UI must gate the zero case behind an explicit
 * destructive action rather than a price field accepting 0.
 *
 * EXTRACTABLE: no DPNS knowledge, generic parameter names, typed result.
 *
 * SDK method: sdk.documents.setPrice({ document, price, identityKey, signer })
 */
import type { MarketplaceResult } from "./marketplaceErrors";
import type { DashKeyManager, DashSdk } from "./types";
import { withAuthedDocument } from "./withAuthedDocument";
import type { Logger } from "../lib/logger";

export interface SetPriceParams {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  documentTypeName: string;
  documentId: string;
  /** Price in credits. `0n` removes the document from sale. */
  price: bigint;
  salesEnabled: boolean;
  log?: Logger;
}

export async function setPrice({
  sdk,
  keyManager,
  contractId,
  documentTypeName,
  documentId,
  price,
  salesEnabled,
  log,
}: SetPriceParams): Promise<MarketplaceResult> {
  const removing = price === 0n;
  log?.(
    removing
      ? `Removing price from ${documentId}…`
      : `Setting price ${price} credits on ${documentId}…`,
  );

  const result = await withAuthedDocument(
    {
      sdk,
      keyManager,
      contractId,
      documentTypeName,
      documentId,
      salesEnabled,
      log,
    },
    async ({ doc, identityKey, signer }) => {
      await sdk.documents.setPrice({
        document: doc,
        price,
        identityKey,
        signer,
      });
    },
  );

  if (!result.ok) return result;
  log?.(removing ? "Listing removed." : "Price updated.", "success");
  return { ok: true };
}
