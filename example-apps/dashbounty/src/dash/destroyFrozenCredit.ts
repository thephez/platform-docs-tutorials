/**
 * Propose or co-sign a revocation-authority action that permanently revokes a
 * submitter's suspended Sift tokens.
 *
 * Same propose/co-sign unification as freezeCredit.ts — see that file's
 * header for the full explanation of `groupInfo` and why one function
 * covers both roles.
 *
 * `sdk.tokens.destroyFrozen(...)` has no destination/effect parameter at
 * the protocol level: it is an unconditional burn. Nobody receives the
 * revoked tokens.
 *
 * A destroy only ever targets an identity that is already frozen — Platform
 * will reject destroyFrozen against a balance that was never frozen.
 *
 * SDK method: sdk.tokens.destroyFrozen({ ..., groupInfo })
 */
import { GroupStateTransitionInfoStatus } from "@dashevo/evo-sdk";

import { errorMessage, type Logger } from "./logger";
import { SIFT_TOKEN_POSITION } from "./siftToken";
import type {
  DashKeyManager,
  DashSdk,
  DashTokenGroupActionResult,
} from "./types";

export async function destroyFrozenCredit({
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
  /** Revocation group position for revoke suspended token actions. */
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
        ? `Co-signing revoke suspended tokens proposal for ${frozenIdentityId}...`
        : `Proposing revoke suspended tokens for ${frozenIdentityId}...`,
    );

    const result = await sdk.tokens.destroyFrozen({
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
        `Suspended tokens revoked — ${frozenIdentityId} needs new Sift tokens before submitting again.`,
        "success",
      );
    } else {
      log?.(
        `Revoke suspended tokens proposal recorded (power ${result.groupPower ?? "?"}), awaiting more signatures.`,
      );
    }
    return result;
  } catch (e) {
    log?.(`Revoke suspended tokens error: ${errorMessage(e)}`, "error");
    throw e;
  }
}
