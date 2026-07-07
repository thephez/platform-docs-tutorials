/**
 * Discover pending Sift panel group actions and who has signed them.
 *
 * A "group action" is created the moment a panel member proposes suspend,
 * restore, or revoke — it stays ACTIVE until accumulated signing power
 * reaches the group's requiredPower, at which point Platform executes it.
 * `listActionSigners` is how the UI shows "1 of 2 required" progress and
 * disables the sign button for someone who already signed.
 *
 * Group actions live under a specific group position. Sift maps each
 * operation to an explicit group so future functions can use different
 * authorities.
 *
 * SDK methods: sdk.group.actions(...), sdk.group.actionSigners(...)
 */
import type { Logger } from "./logger";
import type { DashSdk } from "./types";

export interface PendingAction {
  actionId: string;
  proposerId: string;
  eventName: string;
}

/**
 * Best-effort human description of a group action's event. `GroupAction`
 * only exposes a raw `eventName()`/`tokenEvent()` pair — this maps the
 * common token-related event names into UI-friendly text, falling back to
 * the raw name for anything unrecognized.
 */
export function describeGroupAction(eventName: string): string {
  const lower = eventName.toLowerCase();
  if (lower.includes("freeze") && !lower.includes("unfreeze"))
    return "Suspend access proposal";
  if (lower.includes("unfreeze")) return "Restore access proposal";
  if (lower.includes("destroy")) return "Revoke tokens proposal";
  return eventName;
}

export async function listPendingActions({
  sdk,
  contractId,
  groupPosition,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  /** Explicit panel group position for this action family. */
  groupPosition: number;
  log?: Logger;
}): Promise<PendingAction[]> {
  log?.("Loading pending panel actions…");
  const actions = await sdk.group.actions({
    dataContractId: contractId,
    groupContractPosition: groupPosition,
    status: "ACTIVE",
  });

  const pending: PendingAction[] = [];
  for (const [actionId, action] of actions) {
    if (!action) continue;
    pending.push({
      actionId,
      proposerId: action.proposerId.toString(),
      eventName: action.event.eventName(),
    });
  }
  log?.(`Found ${pending.length} pending action(s).`);
  return pending;
}

export interface ActionSignerProgress {
  signers: Map<string, bigint>;
  signedPower: bigint;
  requiredPower: number;
  hasSigned: (identityId: string) => boolean;
}

export async function listActionSigners({
  sdk,
  contractId,
  groupPosition,
  actionId,
  requiredPower,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  /** Explicit panel group position for this action family. */
  groupPosition: number;
  actionId: string;
  requiredPower: number;
  log?: Logger;
}): Promise<ActionSignerProgress> {
  const signers = await sdk.group.actionSigners({
    dataContractId: contractId,
    groupContractPosition: groupPosition,
    // Only ever called for actions surfaced by listPendingActions, which
    // queries status: 'ACTIVE' — no UI path queries signers for a closed
    // action, so this doesn't need to be a parameter (yet).
    status: "ACTIVE",
    actionId,
  });
  let signedPower = 0n;
  for (const power of signers.values()) signedPower += power;
  log?.(`Action ${actionId}: ${signedPower}/${requiredPower} power signed.`);
  return {
    signers,
    signedPower,
    requiredPower,
    hasSigned: (identityId: string) => signers.has(identityId),
  };
}
