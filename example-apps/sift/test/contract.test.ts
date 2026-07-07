import { afterEach, describe, expect, it, vi } from "vitest";

const { mockDataContractCtor } = vi.hoisted(() => ({
  mockDataContractCtor: vi.fn(function MockDataContract(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, args);
  }),
}));

vi.mock("@dashevo/evo-sdk", () => ({
  DataContract: mockDataContractCtor,
  Group: class Group {
    constructor(
      public members: Map<string, number>,
      public requiredPower: number,
    ) {}
  },
  AuthorizedActionTakers: {
    ContractOwner: () => ({ type: "ContractOwner" }),
    NoOne: () => ({ type: "NoOne" }),
    Group: (position: number) => ({ type: "Group", position }),
    MainGroup: () => ({ type: "MainGroup" }),
  },
  ChangeControlRules: class ChangeControlRules {
    constructor(public options: unknown) {}
  },
  TokenConfiguration: class TokenConfiguration {
    constructor(public options: unknown) {}
  },
  TokenConfigurationConvention: class TokenConfigurationConvention {
    constructor(
      public localizations: unknown,
      public decimals: number,
    ) {}
  },
  TokenConfigurationLocalization: class TokenConfigurationLocalization {
    constructor(
      public shouldCapitalize: boolean,
      public singularForm: string,
      public pluralForm: string,
    ) {}
  },
  TokenDistributionRules: class TokenDistributionRules {
    constructor(public options: unknown) {}
  },
  TokenKeepsHistoryRules: class TokenKeepsHistoryRules {
    constructor(public options: unknown) {}
  },
  TokenMarketplaceRules: class TokenMarketplaceRules {
    constructor(
      public tradeMode: unknown,
      public tradeModeChangeRules: unknown,
    ) {}
  },
  TokenTradeMode: {
    NotTradeable: () => ({ type: "NotTradeable" }),
  },
}));

describe("Sift contract schema", () => {
  it("charges 1 Sift token per submission", async () => {
    const { SUBMISSION_SCHEMAS } = await import("../src/dash/contract");
    const { SIFT_TOKEN_POSITION } = await import("../src/dash/siftToken");

    expect(SUBMISSION_SCHEMAS.submission.creationRestrictionMode).toBe(0);
    expect(SUBMISSION_SCHEMAS.submission.tokenCost.create).toEqual({
      tokenPosition: SIFT_TOKEN_POSITION,
      amount: 1,
      effect: 0,
      gasFeesPaidBy: 0,
    });
  });

  it("keeps submissions immutable by deletion but mutable with history", async () => {
    const { SUBMISSION_SCHEMAS } = await import("../src/dash/contract");
    expect(SUBMISSION_SCHEMAS.submission.canBeDeleted).toBe(false);
    expect(SUBMISSION_SCHEMAS.submission.documentsMutable).toBe(true);
    expect(SUBMISSION_SCHEMAS.submission.documentsKeepHistory).toBe(true);
  });
});

describe("Sift token configuration", () => {
  it("routes suspend/restore to access group and revoke to revocation group", async () => {
    const {
      ACCESS_GROUP_POSITION,
      REVOCATION_GROUP_POSITION,
      createSiftTokenConfiguration,
    } = await import("../src/dash/contract");

    const config = createSiftTokenConfiguration("owner-1") as unknown as {
      options: {
        freezeRules: {
          options: {
            authorizedToMakeChange: unknown;
            adminActionTakers: unknown;
          };
        };
        unfreezeRules: {
          options: {
            authorizedToMakeChange: unknown;
            adminActionTakers: unknown;
          };
        };
        destroyFrozenFundsRules: {
          options: {
            authorizedToMakeChange: unknown;
            adminActionTakers: unknown;
          };
        };
      };
    };

    expect(config.options.freezeRules.options.authorizedToMakeChange).toEqual({
      type: "Group",
      position: ACCESS_GROUP_POSITION,
    });
    expect(config.options.unfreezeRules.options.authorizedToMakeChange).toEqual(
      {
        type: "Group",
        position: ACCESS_GROUP_POSITION,
      },
    );
    expect(
      config.options.destroyFrozenFundsRules.options.authorizedToMakeChange,
    ).toEqual({
      type: "Group",
      position: REVOCATION_GROUP_POSITION,
    });
    expect(config.options.freezeRules.options.adminActionTakers).toEqual({
      type: "ContractOwner",
    });
    expect(config.options.unfreezeRules.options.adminActionTakers).toEqual({
      type: "ContractOwner",
    });
    expect(
      config.options.destroyFrozenFundsRules.options.adminActionTakers,
    ).toEqual({
      type: "ContractOwner",
    });
  });

  it("locks manual burning and main group rotation", async () => {
    const { createSiftTokenConfiguration } =
      await import("../src/dash/contract");
    const config = createSiftTokenConfiguration("owner-1") as unknown as {
      options: {
        manualBurningRules: { options: { authorizedToMakeChange: unknown } };
        mainControlGroupCanBeModified: unknown;
      };
    };

    expect(
      config.options.manualBurningRules.options.authorizedToMakeChange,
    ).toEqual({ type: "NoOne" });
    expect(config.options.mainControlGroupCanBeModified).toEqual({
      type: "NoOne",
    });
  });

  it("seeds a nonzero base supply so the owner has a working token pool", async () => {
    const { createSiftTokenConfiguration } =
      await import("../src/dash/contract");
    const config = createSiftTokenConfiguration("owner-1") as unknown as {
      options: { baseSupply: bigint };
    };
    expect(config.options.baseSupply).toBeGreaterThan(0n);
  });
});

describe("Sift panel groups", () => {
  it("builds access and revocation groups with different thresholds", async () => {
    const {
      ACCESS_GROUP_POSITION,
      REVOCATION_GROUP_POSITION,
      createSiftGroups,
    } = await import("../src/dash/contract");

    const groups = createSiftGroups(["panelist-a", "panelist-b", "panelist-c"]);

    expect(groups[ACCESS_GROUP_POSITION].requiredPower).toBe(2);
    expect(groups[REVOCATION_GROUP_POSITION].requiredPower).toBe(3);
    expect(groups[ACCESS_GROUP_POSITION].members.size).toBe(3);
    expect(groups[REVOCATION_GROUP_POSITION].members.size).toBe(3);
  });

  it("rejects panels without exactly 3 distinct members", async () => {
    const { createPanelGroup } = await import("../src/dash/contract");
    expect(() => createPanelGroup(["a", "b"], 2)).toThrow(/exactly 3/);
    expect(() => createPanelGroup(["a", "b", "c", "d"], 2)).toThrow(
      /exactly 3/,
    );
    expect(() => createPanelGroup(["a", "a", "b"], 2)).toThrow(/distinct/);
  });

  it("rejects panel thresholds outside 1-of-3 through 3-of-3", async () => {
    const { createPanelGroup } = await import("../src/dash/contract");
    expect(() => createPanelGroup(["a", "b", "c"], 0)).toThrow(
      /required power/,
    );
    expect(() => createPanelGroup(["a", "b", "c"], 4)).toThrow(
      /required power/,
    );
  });
});

describe("registerContract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("assigns both Sift panel groups before publishing", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown as Storage);

    const {
      ACCESS_GROUP_POSITION,
      REVOCATION_GROUP_POSITION,
      registerContract,
    } = await import("../src/dash/contract");

    const identity = { id: { toString: () => "owner-1" } };
    const identityKey = { id: "key-1" };
    const signer = { id: "signer-1" };
    const publish = vi.fn().mockResolvedValue({ id: "contract-1" });

    await registerContract({
      sdk: {
        identities: { nonce: vi.fn().mockResolvedValue(0n) },
        contracts: { publish },
      } as never,
      keyManager: {
        async getAuth() {
          return { identity, identityKey, signer };
        },
      } as never,
      panelMemberIds: ["panelist-a", "panelist-b", "panelist-c"],
    });

    const publishedArgs = publish.mock.calls[0][0];
    const dataContract = publishedArgs.dataContract as {
      groups: Record<
        number,
        { members: Map<string, number>; requiredPower: number }
      >;
    };
    expect(dataContract.groups[ACCESS_GROUP_POSITION].requiredPower).toBe(2);
    expect(dataContract.groups[REVOCATION_GROUP_POSITION].requiredPower).toBe(
      3,
    );
  });
});
