/**
 * Propose or co-sign a Review Panel restoration of suspended access.
 *
 * Same propose/co-sign unification as freezeCredit.ts — see that file's
 * header for the full explanation of `groupInfo`. This is the safety valve:
 * if the panel suspended the wrong submitter (or new evidence clears them),
 * unfreeze restores their ability to spend Sift tokens without requiring
 * a revocation action. `unfreezeRules` is gated on the same access group
 * as suspend.
 *
 * SDK method: sdk.tokens.unfreeze({ ..., groupInfo })
 */
import { GroupStateTransitionInfoStatus } from "@dashevo/evo-sdk";

import { errorMessage, type Logger } from "./logger";
import { SIFT_TOKEN_POSITION } from "./siftToken";
import type {
  DashKeyManager,
  DashSdk,
  DashTokenGroupActionResult,
} from "./types";

export async function unfreezeCredit({
  sdk,
  keyManager,
  contractId,
  groupPosition,
  frozenIdentityId,
  actionId,
  publicNote,
  log,
}: {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  /** Access group position for restore access actions. */
  groupPosition: number;
  frozenIdentityId: string;
  /** Pass the pending action's ID to co-sign; omit to propose a new one. */
  actionId?: string;
  publicNote?: string;
  log?: Logger;
}): Promise<DashTokenGroupActionResult> {
  try {
    const { identity, identityKey, signer } = await keyManager.getAuth();

    const groupInfo = actionId
      ? GroupStateTransitionInfoStatus.otherSigner(groupPosition, actionId)
      : GroupStateTransitionInfoStatus.proposer(groupPosition);

    log?.(
      actionId
        ? `Co-signing restore access proposal for ${frozenIdentityId}...`
        : `Proposing restore access for ${frozenIdentityId}...`,
    );

    const result = await sdk.tokens.unfreeze({
      dataContractId: contractId,
      tokenPosition: SIFT_TOKEN_POSITION,
      authorityId: identity.id.toString(),
      frozenIdentityId,
      publicNote,
      identityKey,
      signer,
      groupInfo,
    });

    if (result.document) {
      log?.(
        `Access restored — ${frozenIdentityId} can spend Sift tokens again.`,
        "success",
      );
    } else {
      log?.(
        `Restore access proposal recorded (power ${result.groupPower ?? "?"}), awaiting more signatures.`,
      );
    }
    return result;
  } catch (e) {
    log?.(`Restore access error: ${errorMessage(e)}`, "error");
    throw e;
  }
}
