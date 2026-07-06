/**
 * Propose or co-sign a Review Panel suspension of a submitter's Sift tokens.
 *
 * `freezeRules` gates this on the access group (2-of-3). A single call from
 * `sdk.tokens.freeze(...)`
 * covers both roles depending on `groupInfo`:
 *   - Proposer (first signer): pass no `actionId`. Uses
 *     `GroupStateTransitionInfoStatus.proposer(groupContractPosition)`,
 *     which creates a new pending group action at power 1 — not yet
 *     executed, since 1 < requiredPower (2).
 *   - Other signer (second+): pass the pending action's `actionId`
 *     (discovered via groupActions.ts's `listPendingActions`). Uses
 *     `GroupStateTransitionInfoStatus.otherSigner(groupContractPosition, actionId)`.
 *     Once accumulated power reaches requiredPower, Platform executes the
 *     freeze in this same call.
 *
 * One file (not two) handles both roles: the SDK call shape is identical
 * modulo `groupInfo`, and "do I have a pending actionId to co-sign, or am I
 * originating?" is a single decision the caller needs to make once per
 * click — splitting it into two files would just relocate an if/else into
 * an import statement.
 *
 * The result's `groupPower` field is present while the action is still
 * accumulating signatures; `document` is present once it has executed —
 * branch UI logic on which is present rather than re-querying.
 *
 * SDK method: sdk.tokens.freeze({ ..., groupInfo })
 */
import { GroupStateTransitionInfoStatus } from "@dashevo/evo-sdk";

import { errorMessage, type Logger } from "./logger";
import { SIFT_TOKEN_POSITION } from "./siftToken";
import type {
  DashKeyManager,
  DashSdk,
  DashTokenGroupActionResult,
} from "./types";

export async function freezeCredit({
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
  /** Access group position for suspend access actions. */
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
        ? `Co-signing suspend access proposal for ${frozenIdentityId}...`
        : `Proposing suspend access for ${frozenIdentityId}...`,
    );

    const result = await sdk.tokens.freeze({
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
        `Access suspended — ${frozenIdentityId} cannot spend Sift tokens.`,
        "success",
      );
    } else {
      log?.(
        `Suspend access proposal recorded (power ${result.groupPower ?? "?"}), awaiting more signatures.`,
      );
    }
    return result;
  } catch (e) {
    log?.(`Suspend access error: ${errorMessage(e)}`, "error");
    throw e;
  }
}
