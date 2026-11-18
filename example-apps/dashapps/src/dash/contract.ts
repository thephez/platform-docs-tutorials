/** Dashapps registry data contract schema and production registration. */
import type { DashKeyManager } from "./types";
import type { Logger } from "../lib/logger";
import type { SessionSdk } from "../session/types";
import { loadSdkModule } from "./sdkModule";
import { seedSystemContractMetadata } from "./registryWrites";

/**
 * Registry contract v3 (protocol 14). Every `contractId` names the described
 * contract through `refersTo` and is frozen by `immutable`, so references are
 * checked once and aggregates never move between contracts.
 *
 * Registration is irreversible: test/contractSchema.test.ts pins every index
 * and the structural rules the 5.0.1 WASM parser does not enforce (it skips
 * meta-schema validation), so change the two together.
 */
export const DOCUMENT_TYPE = "appMetadata";
/** The target contract owner's pointer to its official publisher's entry. */
export const ENDORSEMENT_DOCUMENT_TYPE = "appEndorsement";
/** Star reviews. Replaces the v1 registry's `appRating` type. */
export const REVIEW_DOCUMENT_TYPE = "appReview";

const IDENTIFIER = {
  type: "array",
  byteArray: true,
  minItems: 32,
  maxItems: 32,
  contentMediaType: "application/x.dash.dpp.identifier",
} as const;

export const APP_METADATA_SCHEMAS = {
  [DOCUMENT_TYPE]: {
    type: "object",
    documentsMutable: true,
    canBeDeleted: true,
    // Never transferable or tradeable, and `contractId` immutable: the
    // endorsement's `findBy` keys ($ownerId, contractId) must never move.
    transferable: 0,
    tradeMode: 0,
    immutable: ["contractId"],
    properties: {
      contractId: {
        ...IDENTIFIER,
        position: 0,
        refersTo: { type: "contract" },
      },
      name: { type: "string", minLength: 1, maxLength: 63, position: 1 },
      description: { type: "string", maxLength: 1000, position: 2 },
      website: {
        type: "string",
        maxLength: 256,
        pattern: "^https?://",
        position: 3,
      },
      repository: {
        type: "string",
        maxLength: 256,
        pattern: "^https?://",
        position: 4,
      },
      docs: {
        type: "string",
        maxLength: 256,
        pattern: "^https?://",
        position: 5,
      },
      tagline: { type: "string", minLength: 1, maxLength: 120, position: 6 },
      category: {
        type: "string",
        maxLength: 63,
        enum: [
          "finance",
          "wallets-payments",
          "social",
          "messaging",
          "games",
          "marketplaces",
          "productivity",
          "developer-tools",
          "data-analytics",
          "identity",
          "governance-community",
          "media",
          "education",
          "utilities",
          "infrastructure",
          "other",
        ],
        position: 7,
      },
      tags: {
        type: "string",
        maxLength: 164,
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*(?:,[a-z0-9]+(?:-[a-z0-9]+)*){0,4}$",
        position: 8,
      },
      appUrl: {
        type: "string",
        maxLength: 256,
        pattern: "^https?://",
        position: 9,
      },
      iconUrl: {
        type: "string",
        maxLength: 256,
        pattern: "^https://",
        position: 10,
      },
    },
    required: [
      "$createdAt",
      "$updatedAt",
      "contractId",
      "name",
      "tagline",
      "category",
    ],
    additionalProperties: false,
    indices: [
      {
        // One entry per identity per contract; the official-entry lookup and
        // the index the endorsement's `findBy` resolves to.
        name: "ownerContract",
        unique: true,
        properties: [{ $ownerId: "asc" }, { contractId: "asc" }],
      },
      {
        // "N listings" for one contract. Unranked.
        name: "contractEntries",
        properties: [{ contractId: "asc" }],
        countable: "countable",
        rangeCountable: true,
      },
      {
        name: "contractRecent",
        properties: [{ contractId: "asc" }, { $updatedAt: "asc" }],
      },
      { name: "recent", properties: [{ $createdAt: "asc" }] },
      {
        name: "byCategoryRecent",
        properties: [{ category: "asc" }, { $createdAt: "asc" }],
      },
      { name: "byName", properties: [{ name: "asc" }] },
      {
        name: "byOwner",
        properties: [{ $ownerId: "asc" }, { $updatedAt: "asc" }],
      },
    ],
  },
  [ENDORSEMENT_DOCUMENT_TYPE]: {
    type: "object",
    // Mutable (re-point to another publisher) and deletable (withdraw), with
    // no history: a required `findBy` reference can't point at "nobody", so
    // deletion is the only way to withdraw an endorsement.
    documentsMutable: true,
    canBeDeleted: true,
    // A node refuses a transferable/tradeable type carrying an owner
    // requirement reference; the WASM parser does not.
    transferable: 0,
    tradeMode: 0,
    // `publisherId` must NOT be immutable: a node refuses an immutable
    // deletable-document reference resolved by `findBy`.
    immutable: ["contractId"],
    properties: {
      contractId: {
        ...IDENTIFIER,
        position: 0,
        // Only the target contract's owner may endorse (40135 otherwise).
        refersTo: { type: "contract", contractRequirements: { owner: "self" } },
      },
      publisherId: {
        ...IDENTIFIER,
        position: 1,
        // The publisher must hold an appMetadata entry for this same contract
        // (found on ownerContract). Re-checked on every replace, not on delete.
        refersTo: {
          type: "deletableDocument",
          documentType: DOCUMENT_TYPE,
          findBy: { $ownerId: ".", contractId: "contractId" },
        },
      },
    },
    required: ["$createdAt", "$updatedAt", "contractId", "publisherId"],
    additionalProperties: false,
    indices: [
      {
        name: "byContract",
        unique: true,
        properties: [{ contractId: "asc" }],
      },
      { name: "byPublisher", properties: [{ publisherId: "asc" }] },
      // The "Official only" Discover feed.
      { name: "recent", properties: [{ $createdAt: "asc" }] },
    ],
  },
  [REVIEW_DOCUMENT_TYPE]: {
    type: "object",
    documentsMutable: true,
    canBeDeleted: true,
    immutable: ["contractId"],
    properties: {
      contractId: {
        ...IDENTIFIER,
        position: 0,
        // A contract's owner can't review it (only blocks that one identity
        // — not Sybil resistance).
        refersTo: {
          type: "contract",
          contractRequirements: { owner: "other" },
        },
      },
      stars: { type: "integer", minimum: 1, maximum: 5, position: 1 },
      title: { type: "string", maxLength: 120, position: 2 },
      body: { type: "string", maxLength: 1000, position: 3 },
    },
    required: ["$createdAt", "$updatedAt", "contractId", "stars"],
    additionalProperties: false,
    indices: [
      {
        name: "ownerContract",
        unique: true,
        properties: [{ $ownerId: "asc" }, { contractId: "asc" }],
      },
      {
        name: "ownerRecent",
        properties: [{ $ownerId: "asc" }, { $updatedAt: "asc" }],
      },
      {
        // Proven average and count per contract, and top/bottom-K contracts
        // by average or by review count.
        name: "contractRating",
        properties: [{ contractId: "asc" }],
        averageable: "stars",
        rangeAverageable: true,
        rankedAverageable: true,
        rankedCountable: true,
      },
      {
        // Grouped star histogram and the `stars == N` filter. Must stay
        // UNRANKED: its [contractId] prefix terminates the aggregating
        // contractRating index (ranked-prefix rule).
        name: "contractStars",
        properties: [{ contractId: "asc" }, { stars: "asc" }],
        countable: "countable",
        rangeCountable: true,
      },
      {
        name: "contractRecent",
        properties: [{ contractId: "asc" }, { $updatedAt: "asc" }],
      },
      {
        name: "contractStarsRecent",
        properties: [
          { contractId: "asc" },
          { stars: "asc" },
          { $updatedAt: "asc" },
        ],
      },
    ],
  },
} as const;
export const CONTRACT_CONFIG = {
  canBeDeleted: false,
  readonly: false,
  keepsHistory: false,
  documentsKeepHistoryContractDefault: false,
  documentsMutableContractDefault: true,
  documentsCanBeDeletedContractDefault: true,
};
/**
 * Contract-level metadata. No `keywords` (D7): each costs 0.1 DASH at
 * registration and the registry is reached by its configured ID. The
 * description has no registration fee of its own (only the storage of its
 * Keyword Search short/full description documents) and must be 3–100 bytes.
 */
export const DECLARED_METADATA = {
  description: "Community metadata registry for Dash Platform applications",
};

/** The v3 schema uses protocol-14 keywords (refersTo, immutable, ranked*). */
export const REGISTRY_MIN_PROTOCOL_VERSION = 14;

type DataContractClass = Awaited<
  ReturnType<typeof loadSdkModule>
>["DataContract"];
type DataContractInstance = InstanceType<DataContractClass>;

/**
 * Builds the exact contract `registerContract` publishes: schemas, config and
 * declared metadata (the constructor doesn't take the latter, so it goes in
 * through `fromObject`). Pure — no network. Refuses a platform version below
 * 14, where those keywords don't parse.
 */
export function buildRegistryContract(
  DataContract: DataContractClass,
  {
    ownerId,
    identityNonce,
    platformVersion,
  }: {
    ownerId: ConstructorParameters<DataContractClass>[0]["ownerId"];
    identityNonce: bigint;
    platformVersion: number;
  },
): DataContractInstance {
  if (platformVersion < REGISTRY_MIN_PROTOCOL_VERSION)
    throw new Error(
      `The registry contract needs platform protocol ${REGISTRY_MIN_PROTOCOL_VERSION}; the SDK is on ${platformVersion}.`,
    );
  const candidate = new DataContract({
    ownerId,
    identityNonce,
    schemas: APP_METADATA_SCHEMAS,
    fullValidation: true,
    platformVersion,
  });
  candidate.setConfig(CONTRACT_CONFIG, platformVersion);
  return DataContract.fromObject(
    {
      ...candidate.toObject(platformVersion),
      ...DECLARED_METADATA,
      $formatVersion: "1",
    },
    true,
    platformVersion,
  );
}

export async function registerContract({
  sdk,
  keyManager,
  log,
}: {
  sdk: SessionSdk;
  keyManager: DashKeyManager;
  log?: Logger;
}): Promise<{
  id: string;
  seeded: number;
  seedFailures: Array<{ name: string; error: unknown }>;
}> {
  log?.("Registering Dashapps registry contract…");
  const { identity, identityKey, signer } = await keyManager.getAuth();
  if (!identityKey)
    throw new Error(
      "The identity has no usable authentication key for contract registration.",
    );
  const nonce = await sdk.identities.nonce(identity.id.toString());
  const { DataContract } = await loadSdkModule();
  const dataContract = buildRegistryContract(DataContract, {
    ownerId: identity.id,
    identityNonce: BigInt(nonce ?? 0) + 1n,
    platformVersion: sdk.version(),
  });
  const published = await sdk.contracts.publish({
    dataContract,
    identityKey,
    signer,
  });
  const contractId =
    published.id?.toString() || published.toJSON?.(sdk.version())?.id;
  if (!contractId) throw new Error("Contract publish returned no ID.");
  log?.(`Dashapps registry registered: ${contractId}`, "success");
  log?.("Adding curated system contract entries…");
  const { seeded, failures: seedFailures } = await seedSystemContractMetadata({
    sdk,
    keyManager,
    registryId: contractId,
  });
  log?.(
    `Added ${seeded} curated system contract ${seeded === 1 ? "entry" : "entries"}.`,
    seedFailures.length ? "info" : "success",
  );
  return { id: contractId, seeded, seedFailures };
}
