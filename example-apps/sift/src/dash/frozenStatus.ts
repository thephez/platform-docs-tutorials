/**
 * Check whether a specific identity's Sift token balance is suspended.
 *
 * This is DISTINCT from `sdk.tokens.statuses()` → `TokenStatus.isPaused`,
 * which is a contract-wide pause flag unrelated to any one identity —
 * don't reach for that method here, it won't tell you what you want.
 * Per-identity frozen status only comes from `identityTokenInfos`.
 *
 * SDK method: sdk.tokens.identityTokenInfos(identityId, [tokenId])
 */
import { fetchSiftTokenId } from "./siftToken";
import type { DashSdk } from "./types";

export async function fetchFrozenStatus({
  sdk,
  contractId,
  identityId,
}: {
  sdk: DashSdk;
  contractId: string;
  identityId: string;
}): Promise<boolean> {
  const tokenId = await fetchSiftTokenId({ sdk, contractId });
  const infos = await sdk.tokens.identityTokenInfos(identityId, [tokenId]);
  return infos.get(tokenId)?.isFrozen ?? false;
}
