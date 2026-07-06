/**
 * Sift data contract schema + registerContract / ensureContract.
 *
 * Sift is a token-gated review queue for filtering useful security signal
 * from AI slop. Submitters spend 1 Sift token to create a public submission.
 * Two Platform groups govern access:
 *
 * - Access group: 3 members, requiredPower 2. Can suspend and restore a
 *   submitter's ability to spend Sift tokens.
 * - Revocation group: the same 3 members, requiredPower 3. Can permanently
 *   revoke a submitter's Sift tokens.
 *
 * The groups are explicit rule targets (`AuthorizedActionTakers.Group(n)`)
 * rather than `MainGroup()`, so future versions can add more groups and map
 * specific token functions to different authorities without changing the
 * operation helpers' call shape.
 *
 * SDK methods: new DataContract({ ... }), dataContract.groups = {...},
 * sdk.contracts.publish(...)
 */
import {
  AuthorizedActionTakers,
  ChangeControlRules,
  DataContract,
  Group,
  TokenConfiguration,
  TokenConfigurationConvention,
  TokenConfigurationLocalization,
  TokenDistributionRules,
  TokenKeepsHistoryRules,
  TokenMarketplaceRules,
  TokenTradeMode,
} from "@dashevo/evo-sdk";

import { loadStoredContractId, saveContractId } from "./contractStorage";
import type { Logger } from "./logger";
import {
  SIFT_TOKEN_BASE_SUPPLY,
  SIFT_TOKEN_NAME,
  SIFT_TOKEN_PLURAL,
  SIFT_TOKEN_POSITION,
} from "./siftToken";
import type { DashKeyManager, DashSdk } from "./types";

export {
  DEFAULT_CONTRACT_ID,
  clearStoredContractId,
  fetchContractOwnerId,
  loadStoredContractId,
  saveContractId,
} from "./contractStorage";

export const ACCESS_GROUP_POSITION = 0;
export const REVOCATION_GROUP_POSITION = 1;
export const ACCESS_GROUP_REQUIRED_POWER = 2;
export const REVOCATION_GROUP_REQUIRED_POWER = 3;

export const GROUP_DEFINITIONS = {
  access: {
    position: ACCESS_GROUP_POSITION,
    requiredPower: ACCESS_GROUP_REQUIRED_POWER,
    label: "Access Panel",
    description: "Suspends and restores queue access.",
  },
  revocation: {
    position: REVOCATION_GROUP_POSITION,
    requiredPower: REVOCATION_GROUP_REQUIRED_POWER,
    label: "Revocation Panel",
    description: "Permanently revokes already-suspended Sift tokens.",
  },
} as const;

export type PanelKind = keyof typeof GROUP_DEFINITIONS;
export type PanelActionKind = "freeze" | "unfreeze" | "destroy";

export const PANEL_ACTION_GROUPS: Record<PanelActionKind, PanelKind> = {
  freeze: "access",
  unfreeze: "access",
  destroy: "revocation",
};

export function groupPositionForAction(kind: PanelActionKind): number {
  return GROUP_DEFINITIONS[PANEL_ACTION_GROUPS[kind]].position;
}

export const SUBMISSION_SCHEMAS = {
  submission: {
    type: "object",
    documentsMutable: true,
    documentsKeepHistory: true,
    canBeDeleted: false,
    creationRestrictionMode: 0,
    tokenCost: {
      create: {
        tokenPosition: SIFT_TOKEN_POSITION,
        amount: 1,
        effect: 0, // TransferTokenToContractOwner: queue-access spend
        gasFeesPaidBy: 0, // DocumentOwner
      },
    },
    properties: {
      title: {
        type: "string",
        description: "Short summary of the submission",
        minLength: 1,
        maxLength: 128,
        position: 0,
      },
      severity: {
        type: "string",
        description: "Submitter-assessed severity",
        enum: ["low", "medium", "high", "critical"],
        maxLength: 8,
        position: 1,
      },
      component: {
        type: "string",
        description: "Affected component or area",
        minLength: 1,
        maxLength: 63,
        position: 2,
      },
      description: {
        type: "string",
        description:
          "Public summary for reviewers. Sensitive details should stay off-chain.",
        minLength: 1,
        maxLength: 2000,
        position: 3,
      },
      pocHash: {
        type: "string",
        description:
          "Optional base64 SHA-256 of local evidence, hashed client-side. Evidence itself stays off-chain.",
        minLength: 44,
        maxLength: 44,
        position: 4,
      },
    },
    required: [
      "$createdAt",
      "$updatedAt",
      "title",
      "severity",
      "component",
      "description",
    ],
    additionalProperties: false,
    indices: [
      {
        name: "byOwner",
        properties: [{ $ownerId: "asc" }, { $createdAt: "asc" }],
      },
      {
        name: "bySeverity",
        properties: [{ severity: "asc" }, { $createdAt: "asc" }],
      },
      {
        name: "byComponent",
        properties: [{ component: "asc" }, { $createdAt: "asc" }],
      },
    ],
  },
} as const;

export function createSiftTokenConfiguration(ownerId: string) {
  const contractOwner = AuthorizedActionTakers.ContractOwner();
  const noOne = AuthorizedActionTakers.NoOne();
  const accessGroup = AuthorizedActionTakers.Group(ACCESS_GROUP_POSITION);
  const revocationGroup = AuthorizedActionTakers.Group(
    REVOCATION_GROUP_POSITION,
  );

  const ownerRules = new ChangeControlRules({
    authorizedToMakeChange: contractOwner,
    adminActionTakers: contractOwner,
    isChangingAuthorizedActionTakersToNoOneAllowed: true,
    isChangingAdminActionTakersToNoOneAllowed: true,
    isSelfChangingAdminActionTakersAllowed: true,
  });
  const lockedRules = new ChangeControlRules({
    authorizedToMakeChange: noOne,
    adminActionTakers: noOne,
  });
  const accessRules = new ChangeControlRules({
    authorizedToMakeChange: accessGroup,
    adminActionTakers: accessGroup,
  });
  const revocationRules = new ChangeControlRules({
    authorizedToMakeChange: revocationGroup,
    adminActionTakers: revocationGroup,
  });

  return new TokenConfiguration({
    conventions: new TokenConfigurationConvention(
      {
        en: new TokenConfigurationLocalization(
          false,
          SIFT_TOKEN_NAME,
          SIFT_TOKEN_PLURAL,
        ),
      },
      0,
    ),
    conventionsChangeRules: ownerRules,
    baseSupply: SIFT_TOKEN_BASE_SUPPLY,
    maxSupply: undefined,
    keepsHistory: new TokenKeepsHistoryRules({
      isKeepingMintingHistory: true,
      isKeepingFreezingHistory: true,
    }),
    maxSupplyChangeRules: lockedRules,
    distributionRules: new TokenDistributionRules({
      newTokensDestinationIdentity: ownerId,
      newTokensDestinationIdentityRules: ownerRules,
      mintingAllowChoosingDestination: false,
      mintingAllowChoosingDestinationRules: ownerRules,
      perpetualDistributionRules: lockedRules,
      changeDirectPurchasePricingRules: lockedRules,
    }),
    marketplaceRules: new TokenMarketplaceRules(
      TokenTradeMode.NotTradeable(),
      lockedRules,
    ),
    manualMintingRules: ownerRules,
    manualBurningRules: lockedRules,
    freezeRules: accessRules,
    unfreezeRules: accessRules,
    destroyFrozenFundsRules: revocationRules,
    emergencyActionRules: lockedRules,
    // Kept for token config completeness, but the action rules above target
    // explicit group positions rather than MainGroup().
    mainControlGroup: ACCESS_GROUP_POSITION,
    mainControlGroupCanBeModified: noOne,
    description:
      "Sift token — queue-access token for filtering real security signal from AI slop.",
  });
}

export function createPanelGroup(
  panelMemberIds: string[],
  requiredPower: number,
) {
  if (panelMemberIds.length !== 3) {
    throw new Error(
      `Sift panels need exactly 3 members, got ${panelMemberIds.length}`,
    );
  }
  if (new Set(panelMemberIds).size !== panelMemberIds.length) {
    throw new Error(
      "Sift panel members must be 3 distinct identities (duplicate IDs would collapse the group below 3 signers)",
    );
  }
  const members = new Map<string, number>(panelMemberIds.map((id) => [id, 1]));
  return new Group(members, requiredPower);
}

export function createSiftGroups(panelMemberIds: string[]) {
  return {
    [ACCESS_GROUP_POSITION]: createPanelGroup(
      panelMemberIds,
      ACCESS_GROUP_REQUIRED_POWER,
    ),
    [REVOCATION_GROUP_POSITION]: createPanelGroup(
      panelMemberIds,
      REVOCATION_GROUP_REQUIRED_POWER,
    ),
  };
}

export async function registerContract({
  sdk,
  keyManager,
  panelMemberIds,
  log,
}: {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  panelMemberIds: string[];
  log?: Logger;
}): Promise<string> {
  log?.("Registering Sift contract...");
  const { identity, identityKey, signer } = await keyManager.getAuth();
  const identityNonce = await sdk.identities.nonce(identity.id.toString());
  const dataContract = new DataContract({
    ownerId: identity.id,
    identityNonce: (identityNonce || 0n) + 1n,
    schemas: SUBMISSION_SCHEMAS,
    tokens: {
      [SIFT_TOKEN_POSITION]: createSiftTokenConfiguration(
        identity.id.toString(),
      ),
    },
    fullValidation: true,
  });

  dataContract.groups = createSiftGroups(panelMemberIds);

  log?.("Publishing contract...");
  const published = await sdk.contracts.publish({
    dataContract,
    identityKey,
    signer,
  });
  const contractId = published.id?.toString() || published.toJSON?.()?.id;

  if (!contractId) {
    throw new Error(
      `Contract publish returned no id: ${JSON.stringify(published.toJSON?.() ?? published)}`,
    );
  }

  saveContractId(contractId);
  log?.(`Sift contract registered: ${contractId}`, "success");
  return contractId;
}

export async function ensureContract({
  sdk,
  keyManager,
  existingId,
  panelMemberIds,
  log,
}: {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  existingId?: string | null;
  panelMemberIds: string[];
  log?: Logger;
}): Promise<string> {
  const fromStorage = existingId ?? loadStoredContractId();
  if (fromStorage) {
    log?.(`Using saved contract ID: ${fromStorage}`);
    return fromStorage;
  }
  return registerContract({ sdk, keyManager, panelMemberIds, log });
}
