/**
 * Owner-managed Sift governance helpers.
 *
 * Existing Platform groups are immutable after registration, but a contract
 * update can append new groups. Token config updates can then remap freeze,
 * unfreeze, and destroyFrozen authority to any existing group when the current
 * rule's admin action taker authorizes the update.
 *
 * SDK methods: sdk.contracts.fetch/update, sdk.tokens.configUpdate(...)
 */
import {
  AuthorizedActionTakers,
  TokenConfigurationChangeItem,
} from "@dashevo/evo-sdk";

import {
  ACCESS_GROUP_POSITION,
  DEFAULT_PANEL_ACTION_GROUP_POSITIONS,
  REVOCATION_GROUP_POSITION,
  createPanelGroup,
  type PanelActionKind,
} from "./contract";
import { SIFT_TOKEN_POSITION } from "./siftToken";
import type { DashContractLike, DashSdk } from "./types";
import type { Logger } from "./logger";
import type { IdentityPublicKey, IdentitySigner } from "@dashevo/evo-sdk";

export interface SiftGroupInfo {
  groupPosition: number;
  members: Map<string, number>;
  requiredPower: number;
}

export interface SiftGovernance {
  groups: SiftGroupInfo[];
  assignments: Record<PanelActionKind, number>;
  usedFallbackAssignments: boolean;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function toJsonRecord(value: unknown): UnknownRecord {
  if (isRecord(value) && typeof value.toJSON === "function") {
    const json = value.toJSON();
    return isRecord(json) ? json : {};
  }
  return isRecord(value) ? value : {};
}

function normalizeMembers(rawMembers: unknown): Map<string, number> {
  if (rawMembers instanceof Map) {
    return new Map(
      [...rawMembers.entries()].map(([id, power]) => [
        String(id),
        Number(power),
      ]),
    );
  }
  if (Array.isArray(rawMembers)) {
    return new Map(
      rawMembers.map((entry) => {
        if (Array.isArray(entry)) return [String(entry[0]), Number(entry[1])];
        const json = toJsonRecord(entry);
        return [
          String(json.id ?? json.identityId ?? json.identifier ?? ""),
          Number(json.power ?? json.weight ?? 1),
        ];
      }),
    );
  }
  if (isRecord(rawMembers)) {
    return new Map(
      Object.entries(rawMembers).map(([id, power]) => [
        id,
        Number(power as number | bigint | string),
      ]),
    );
  }
  return new Map();
}

function normalizeGroup(position: number, rawGroup: unknown): SiftGroupInfo {
  const group = toJsonRecord(rawGroup);
  return {
    groupPosition: position,
    members: normalizeMembers(
      group.members ?? (rawGroup as SiftGroupInfo)?.members,
    ),
    requiredPower: Number(group.requiredPower ?? group.required_power ?? 0),
  };
}

function normalizeGroups(rawGroups: unknown): SiftGroupInfo[] {
  if (rawGroups instanceof Map) {
    return [...rawGroups.entries()]
      .map(([position, group]) => normalizeGroup(Number(position), group))
      .sort((a, b) => a.groupPosition - b.groupPosition);
  }
  if (!isRecord(rawGroups)) return [];
  return Object.entries(rawGroups)
    .map(([position, group]) => normalizeGroup(Number(position), group))
    .filter((group) => Number.isInteger(group.groupPosition))
    .sort((a, b) => a.groupPosition - b.groupPosition);
}

function tokenConfigFromContract(contract: DashContractLike): UnknownRecord {
  const rawTokens = contract.tokens;
  if (rawTokens instanceof Map) {
    return toJsonRecord(rawTokens.get(SIFT_TOKEN_POSITION));
  }
  if (isRecord(rawTokens)) {
    const tokenRecord = rawTokens as Record<string, unknown>;
    return toJsonRecord(tokenRecord[String(SIFT_TOKEN_POSITION)]);
  }
  const json = toJsonRecord(contract);
  const jsonTokens = json.tokens;
  if (isRecord(jsonTokens)) {
    return toJsonRecord(jsonTokens[String(SIFT_TOKEN_POSITION)]);
  }
  return {};
}

function groupPositionFromActionTaker(actionTaker: unknown): number | null {
  if (typeof actionTaker === "number") return actionTaker;
  const record = toJsonRecord(actionTaker);
  const candidate =
    record.groupContractPosition ??
    record.group_contract_position ??
    record.groupPosition ??
    record.position ??
    record.value;
  if (typeof candidate === "number") return candidate;
  if (typeof candidate === "bigint") return Number(candidate);
  if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
    return Number(candidate);
  }
  return null;
}

function groupPositionFromRule(rule: unknown): number | null {
  const record = toJsonRecord(rule);
  return groupPositionFromActionTaker(
    record.authorizedToMakeChange ??
      record.authorized_to_make_change ??
      record.authorizedActionTakers ??
      record.actionTakers,
  );
}

function assignedGroupPosition(
  tokenConfig: UnknownRecord,
  ruleName: string,
): number | null {
  return groupPositionFromRule(
    tokenConfig[ruleName] ??
      tokenConfig[`${ruleName}_rules`] ??
      tokenConfig[ruleName.replace("Rules", "_rules")],
  );
}

function deriveAssignments(contract: DashContractLike): {
  assignments: Record<PanelActionKind, number>;
  usedFallbackAssignments: boolean;
} {
  const tokenConfig = tokenConfigFromContract(contract);
  const freeze = assignedGroupPosition(tokenConfig, "freezeRules");
  const unfreeze = assignedGroupPosition(tokenConfig, "unfreezeRules");
  const destroy = assignedGroupPosition(tokenConfig, "destroyFrozenFundsRules");

  const usedFallbackAssignments =
    freeze === null || unfreeze === null || destroy === null;
  return {
    assignments: {
      freeze: freeze ?? DEFAULT_PANEL_ACTION_GROUP_POSITIONS.freeze,
      unfreeze: unfreeze ?? DEFAULT_PANEL_ACTION_GROUP_POSITIONS.unfreeze,
      destroy: destroy ?? DEFAULT_PANEL_ACTION_GROUP_POSITIONS.destroy,
    },
    usedFallbackAssignments,
  };
}

async function fetchGroupIfMissing({
  sdk,
  contractId,
  position,
}: {
  sdk: DashSdk;
  contractId: string;
  position: number;
}): Promise<SiftGroupInfo | null> {
  const group = await sdk.group.info(contractId, position);
  if (!group) return null;
  return {
    groupPosition: position,
    members: new Map(
      [...group.members.entries()].map(([id, power]) => [
        String(id),
        Number(power),
      ]),
    ),
    requiredPower: Number(group.requiredPower),
  };
}

export async function fetchSiftGovernance({
  sdk,
  contractId,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  log?: Logger;
}): Promise<SiftGovernance> {
  const contract = await sdk.contracts.fetch(contractId);
  if (!contract) {
    throw new Error(`Sift contract ${contractId} not found`);
  }

  const { assignments, usedFallbackAssignments } = deriveAssignments(contract);
  const groupsByPosition = new Map<number, SiftGroupInfo>(
    normalizeGroups(contract.groups ?? toJsonRecord(contract).groups).map(
      (group) => [group.groupPosition, group],
    ),
  );

  const requiredPositions = new Set<number>([
    ACCESS_GROUP_POSITION,
    REVOCATION_GROUP_POSITION,
    ...Object.values(assignments),
  ]);
  await Promise.all(
    [...requiredPositions].map(async (position) => {
      if (groupsByPosition.has(position)) return;
      const group = await fetchGroupIfMissing({ sdk, contractId, position });
      if (group) groupsByPosition.set(position, group);
    }),
  );

  if (usedFallbackAssignments) {
    log?.(
      "Could not read all token function assignments; using Sift default group mapping.",
      "error",
    );
  }

  return {
    groups: [...groupsByPosition.values()].sort(
      (a, b) => a.groupPosition - b.groupPosition,
    ),
    assignments,
    usedFallbackAssignments,
  };
}

export async function appendSiftGroup({
  sdk,
  contractId,
  ownerId,
  memberIds,
  requiredPower,
  identityKey,
  signer,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  ownerId: string;
  memberIds: string[];
  requiredPower: number;
  identityKey: IdentityPublicKey | undefined;
  signer: IdentitySigner;
  log?: Logger;
}): Promise<number> {
  if (!ownerId.trim()) throw new Error("Contract owner ID is required.");
  const contract = await sdk.contracts.fetch(contractId);
  if (!contract) throw new Error(`Sift contract ${contractId} not found`);

  const existingGroups = normalizeGroups(
    contract.groups ?? toJsonRecord(contract).groups,
  );
  const nextPosition =
    existingGroups.length === 0
      ? 0
      : Math.max(...existingGroups.map((group) => group.groupPosition)) + 1;
  const nextGroup = createPanelGroup(
    memberIds.map((id) => id.trim()),
    requiredPower,
  );

  const rawGroups = contract.groups;
  if (rawGroups instanceof Map) {
    rawGroups.set(nextPosition, nextGroup);
  } else {
    contract.groups = {
      ...(isRecord(rawGroups) ? rawGroups : {}),
      [nextPosition]: nextGroup,
    };
  }
  contract.version =
    Number(contract.version ?? toJsonRecord(contract).version ?? 1) + 1;

  log?.(`Appending Sift group ${nextPosition}...`);
  await sdk.contracts.update({ dataContract: contract, identityKey, signer });
  log?.(`Sift group ${nextPosition} added.`, "success");
  return nextPosition;
}

function configurationChangeItemForAction(
  actionKind: PanelActionKind,
  groupPosition: number,
) {
  const actionTaker = AuthorizedActionTakers.Group(groupPosition);
  if (actionKind === "freeze") {
    return TokenConfigurationChangeItem.FreezeItem(actionTaker);
  }
  if (actionKind === "unfreeze") {
    return TokenConfigurationChangeItem.UnfreezeItem(actionTaker);
  }
  return TokenConfigurationChangeItem.DestroyFrozenFundsItem(actionTaker);
}

export async function assignSiftFunctionGroup({
  sdk,
  contractId,
  ownerId,
  actionKind,
  groupPosition,
  identityKey,
  signer,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  ownerId: string;
  actionKind: PanelActionKind;
  groupPosition: number;
  identityKey: IdentityPublicKey | undefined;
  signer: IdentitySigner;
  log?: Logger;
}) {
  log?.(`Assigning ${actionKind} authority to group ${groupPosition}...`);
  return sdk.tokens.configUpdate({
    dataContractId: contractId,
    tokenPosition: SIFT_TOKEN_POSITION,
    identityId: ownerId,
    configurationChangeItem: configurationChangeItemForAction(
      actionKind,
      groupPosition,
    ),
    publicNote: `Assign ${actionKind} authority to Sift group ${groupPosition}`,
    identityKey,
    signer,
  });
}
