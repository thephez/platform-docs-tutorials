/**
 * Purchase a priced document from another identity.
 *
 * The signed-in identity pays `price` credits and becomes the new owner.
 * Platform enforces the price server-side, so a stale price fails — but that is
 * the last safeguard, not the user-facing contract. Callers must re-fetch and
 * re-compare immediately before calling this so the user is TOLD before signing.
 *
 * EXTRACTABLE: no DPNS knowledge, generic parameter names, typed result.
 *
 * SDK method: sdk.documents.purchase({ document, buyerId, price, identityKey, signer })
 */
import type { MarketplaceResult } from "./marketplaceErrors";
import type { DashKeyManager, DashSdk } from "./types";
import { withAuthedDocument } from "./withAuthedDocument";
import type { Logger } from "../lib/logger";

export interface PurchaseNameParams {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  documentTypeName: string;
  documentId: string;
  /** Must match the on-chain `$price` exactly. Carried as bigint end to end. */
  price: bigint;
  log?: Logger;
}

export async function purchaseName({
  sdk,
  keyManager,
  contractId,
  documentTypeName,
  documentId,
  price,
  log,
}: PurchaseNameParams): Promise<MarketplaceResult> {
  log?.(`Purchasing ${documentId} for ${price} credits…`);

  const result = await withAuthedDocument(
    {
      sdk,
      keyManager,
      contractId,
      documentTypeName,
      documentId,
      log,
    },
    async ({ doc, identity, identityKey, signer }) => {
      await sdk.documents.purchase({
        document: doc,
        buyerId: identity.id,
        price,
        identityKey,
        signer,
      });
    },
  );

  if (!result.ok) return result;
  log?.("Purchase complete.", "success");
  return { ok: true };
}
