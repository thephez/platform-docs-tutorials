/**
 * Read Sift governance groups.
 *
 * Sift starts with group 0 for suspend/restore and group 1 for revocation,
 * but the contract owner can append groups and remap token functions later.
 *
 * SDK methods: sdk.contracts.fetch(...), sdk.group.info(...)
 */
import type { PanelActionKind } from "./contract";
import {
  fetchSiftGovernance,
  type SiftGovernance,
  type SiftGroupInfo,
} from "./governance";
import type { Logger } from "./logger";
import type { DashSdk } from "./types";

export interface PanelInfo extends SiftGroupInfo {
  label: string;
  description: string;
  actions: PanelActionKind[];
}

export function actionLabel(kind: PanelActionKind): string {
  if (kind === "freeze") return "Suspend access";
  if (kind === "unfreeze") return "Restore access";
  return "Revoke suspended tokens";
}

function groupActions(
  group: SiftGroupInfo,
  assignments: SiftGovernance["assignments"],
): PanelActionKind[] {
  return (Object.keys(assignments) as PanelActionKind[]).filter(
    (kind) => assignments[kind] === group.groupPosition,
  );
}

function panelLabel(actions: PanelActionKind[]): string {
  const hasAccess = actions.includes("freeze") || actions.includes("unfreeze");
  const hasRevocation = actions.includes("destroy");
  if (hasAccess && hasRevocation) return "Access + Revocation Authority";
  if (hasAccess) return "Access Authority";
  if (hasRevocation) return "Revocation Authority";
  return "Unassigned Group";
}

function panelDescription(actions: PanelActionKind[]): string {
  if (actions.length === 0) {
    return "Available for future Sift token authority assignment.";
  }
  return actions.map(actionLabel).join(", ");
}

export function panelsFromGovernance(governance: SiftGovernance): PanelInfo[] {
  return governance.groups.map((group) => {
    const actions = groupActions(group, governance.assignments);
    return {
      ...group,
      actions,
      label: panelLabel(actions),
      description: panelDescription(actions),
    };
  });
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
  return panelsFromGovernance(
    await fetchSiftGovernance({ sdk, contractId, log }),
  );
}

export function panelForAction(
  panels: PanelInfo[],
  assignments: SiftGovernance["assignments"],
  kind: PanelActionKind,
): PanelInfo | undefined {
  return panels.find((panel) => panel.groupPosition === assignments[kind]);
}

export function isPanelMember(panel: PanelInfo, identityId: string): boolean {
  return panel.members.has(identityId);
}
