import { describe, expect, it, vi } from "vitest";

vi.mock("@dashevo/evo-sdk", () => ({
  DataContract: class DataContract {},
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
  TokenConfigurationChangeItem: {
    FreezeItem: (actionTaker: unknown) => ({
      item: "Freeze",
      actionTaker,
    }),
    UnfreezeItem: (actionTaker: unknown) => ({
      item: "Unfreeze",
      actionTaker,
    }),
    DestroyFrozenFundsItem: (actionTaker: unknown) => ({
      item: "DestroyFrozenFunds",
      actionTaker,
    }),
  },
  ChangeControlRules: class ChangeControlRules {
    constructor(public options: unknown) {}
  },
  TokenConfiguration: class TokenConfiguration {
    constructor(public options: unknown) {}
  },
  TokenConfigurationConvention: class TokenConfigurationConvention {},
  TokenConfigurationLocalization: class TokenConfigurationLocalization {},
  TokenDistributionRules: class TokenDistributionRules {},
  TokenKeepsHistoryRules: class TokenKeepsHistoryRules {},
  TokenMarketplaceRules: class TokenMarketplaceRules {},
  TokenTradeMode: { NotTradeable: () => ({ type: "NotTradeable" }) },
}));

const identityKey = { id: "key-1" } as never;
const signer = { id: "signer-1" } as never;

describe("fetchSiftGovernance", () => {
  it("reads groups and token function assignments from a fetched contract", async () => {
    const { fetchSiftGovernance } = await import("../src/dash/governance");
    const governance = await fetchSiftGovernance({
      sdk: {
        contracts: {
          fetch: vi.fn(async () => ({
            groups: {
              0: { members: new Map([["a", 1]]), requiredPower: 2 },
              1: { members: new Map([["b", 1]]), requiredPower: 3 },
            },
            tokens: {
              0: {
                freezeRules: {
                  authorizedToMakeChange: { type: "Group", position: 0 },
                },
                unfreezeRules: {
                  authorizedToMakeChange: { type: "Group", position: 0 },
                },
                destroyFrozenFundsRules: {
                  authorizedToMakeChange: { type: "Group", position: 1 },
                },
              },
            },
          })),
        },
        group: { info: vi.fn() },
      } as never,
      contractId: "contract-1",
    });

    expect(governance.usedFallbackAssignments).toBe(false);
    expect(governance.assignments).toEqual({
      freeze: 0,
      unfreeze: 0,
      destroy: 1,
    });
    expect(governance.groups.map((group) => group.groupPosition)).toEqual([
      0, 1,
    ]);
  });

  it("falls back to default assignments when token rules are unavailable", async () => {
    const { fetchSiftGovernance } = await import("../src/dash/governance");
    const governance = await fetchSiftGovernance({
      sdk: {
        contracts: {
          fetch: vi.fn(async () => ({
            groups: {
              0: { members: new Map([["a", 1]]), requiredPower: 2 },
              1: { members: new Map([["b", 1]]), requiredPower: 3 },
            },
            tokens: {},
          })),
        },
        group: { info: vi.fn() },
      } as never,
      contractId: "contract-1",
    });

    expect(governance.usedFallbackAssignments).toBe(true);
    expect(governance.assignments).toEqual({
      freeze: 0,
      unfreeze: 0,
      destroy: 1,
    });
  });
});

describe("appendSiftGroup", () => {
  it("preserves existing groups and appends the next contiguous position", async () => {
    const { appendSiftGroup } = await import("../src/dash/governance");
    const contract = {
      version: 7,
      groups: {
        0: { members: new Map([["a", 1]]), requiredPower: 2 },
        1: { members: new Map([["b", 1]]), requiredPower: 3 },
      },
    };
    const update = vi.fn();

    const position = await appendSiftGroup({
      sdk: {
        contracts: { fetch: vi.fn(async () => contract), update },
      } as never,
      contractId: "contract-1",
      ownerId: "owner-1",
      memberIds: ["c", "d", "e"],
      requiredPower: 2,
      identityKey,
      signer,
    });

    expect(position).toBe(2);
    expect(contract.version).toBe(8);
    expect(contract.groups[0].requiredPower).toBe(2);
    expect(contract.groups[1].requiredPower).toBe(3);
    expect(contract.groups[2].requiredPower).toBe(2);
    expect(update).toHaveBeenCalledWith({
      dataContract: contract,
      identityKey,
      signer,
    });
  });
});

describe("assignSiftFunctionGroup", () => {
  it.each([
    ["freeze", "Freeze"],
    ["unfreeze", "Unfreeze"],
    ["destroy", "DestroyFrozenFunds"],
  ] as const)("creates the %s config update item", async (actionKind, item) => {
    const { assignSiftFunctionGroup } = await import("../src/dash/governance");
    const configUpdate = vi.fn();

    await assignSiftFunctionGroup({
      sdk: { tokens: { configUpdate } } as never,
      contractId: "contract-1",
      ownerId: "owner-1",
      actionKind,
      groupPosition: 4,
      identityKey,
      signer,
    });

    expect(configUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: "owner-1",
        configurationChangeItem: {
          item,
          actionTaker: { type: "Group", position: 4 },
        },
      }),
    );
  });
});
