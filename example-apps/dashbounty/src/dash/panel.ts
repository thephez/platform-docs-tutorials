/**
 * Read Sift panel groups.
 *
 * Sift uses explicit group positions rather than a dynamic main control
 * group: access actions use group 0, revocation actions use group 1.
 *
 * SDK methods: sdk.group.info(...), sdk.group.members(...)
 */
import {
  GROUP_DEFINITIONS,
  PANEL_ACTION_GROUPS,
  type PanelKind,
  type PanelActionKind,
} from "./contract";
import type { Logger } from "./logger";
import type { DashSdk } from "./types";

export interface PanelInfo {
  kind: PanelKind;
  label: string;
  description: string;
  groupPosition: number;
  members: Map<string, number>;
  requiredPower: number;
}

export async function fetchPanelInfo({
  sdk,
  contractId,
  kind,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  kind: PanelKind;
  log?: Logger;
}): Promise<PanelInfo> {
  const definition = GROUP_DEFINITIONS[kind];
  const group = await sdk.group.info(contractId, definition.position);
  if (!group) {
    log?.(`${definition.label} not found on this contract.`, "error");
    return {
      kind,
      label: definition.label,
      description: definition.description,
      groupPosition: definition.position,
      members: new Map(),
      requiredPower: definition.requiredPower,
    };
  }
  return {
    kind,
    label: definition.label,
    description: definition.description,
    groupPosition: definition.position,
    members: group.members,
    requiredPower: group.requiredPower,
  };
}

export async function fetchPanels({
  sdk,
  contractId,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  log?: Logger;
}): Promise<PanelInfo[]> {
  return Promise.all(
    (Object.keys(GROUP_DEFINITIONS) as PanelKind[]).map((kind) =>
      fetchPanelInfo({ sdk, contractId, kind, log }),
    ),
  );
}

export async function fetchPanelMembers({
  sdk,
  contractId,
  kind,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  kind: PanelKind;
  log?: Logger;
}): Promise<string[]> {
  const definition = GROUP_DEFINITIONS[kind];
  const members = await sdk.group.members({
    dataContractId: contractId,
    groupContractPosition: definition.position,
  });
  const ids = [...members.keys()];
  log?.(`${definition.label} has ${ids.length} member(s).`);
  return ids;
}

export function panelKindForAction(kind: PanelActionKind): PanelKind {
  return PANEL_ACTION_GROUPS[kind];
}

export function isPanelMember(panel: PanelInfo, identityId: string): boolean {
  return panel.members.has(identityId);
}
