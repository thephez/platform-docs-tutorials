/**
 * Sift token constants and helpers.
 *
 * The data contract defines token position 0 as the "Sift token". Spending
 * 1 token creates a submission, which gives the review queue a concrete
 * anti-slop cost. Separately, a submitter's remaining token balance is what
 * panel groups can suspend, restore, or permanently revoke.
 */
import type { DashSdk } from "./types";

export const SIFT_TOKEN_POSITION = 0;
export const SIFT_TOKEN_SUBMISSION_COST = 1n;
export const SIFT_TOKEN_BASE_SUPPLY = 100n;
export const SIFT_TOKEN_NAME = "SiftToken";
export const SIFT_TOKEN_PLURAL = "SiftTokens";

// Agreement passed to sdk.documents.create() to satisfy the contract's
// 1-token queue access cost for submission creation.
export const SIFT_TOKEN_PAYMENT_INFO = {
  tokenContractPosition: SIFT_TOKEN_POSITION,
  maximumTokenCost: SIFT_TOKEN_SUBMISSION_COST,
  gasFeesPaidBy: "documentOwner" as const,
};

export async function fetchSiftTokenId({
  sdk,
  contractId,
}: {
  sdk: DashSdk;
  contractId: string;
}): Promise<string> {
  return sdk.tokens.calculateId(contractId, SIFT_TOKEN_POSITION);
}

export async function fetchSiftTokenBalance({
  sdk,
  contractId,
  identityId,
}: {
  sdk: DashSdk;
  contractId: string;
  identityId: string;
}): Promise<bigint> {
  const tokenId = await fetchSiftTokenId({ sdk, contractId });
  const balances = await sdk.tokens.identityBalances(identityId, [tokenId]);
  return balances.get(tokenId) ?? 0n;
}
