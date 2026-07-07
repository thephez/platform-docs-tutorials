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
      type: "FreezeItem",
      actionTaker,
    }),
    UnfreezeItem: (actionTaker: unknown) => ({
      type: "UnfreezeItem",
      actionTaker,
    }),
    DestroyFrozenFundsItem: (actionTaker: unknown) => ({
      type: "DestroyFrozenFundsItem",
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

function makeSdk() {
  return {
    contracts: {
      fetch: vi.fn(async () => ({
        groups: {
          0: { members: new Map([["access-panelist", 1]]), requiredPower: 2 },
          1: {
            members: new Map([["revocation-panelist", 1]]),
            requiredPower: 3,
          },
          2: { members: new Map([["backup-panelist", 1]]), requiredPower: 2 },
        },
        tokens: {
          0: {
            freezeRules: {
              authorizedToMakeChange: { type: "Group", position: 2 },
            },
            unfreezeRules: {
              authorizedToMakeChange: { type: "Group", position: 2 },
            },
            destroyFrozenFundsRules: {
              authorizedToMakeChange: { type: "Group", position: 1 },
            },
          },
        },
      })),
    },
    group: {
      info: vi.fn(),
    },
  } as never;
}

describe("fetchPanels", () => {
  it("labels all contract groups from current function assignments", async () => {
    const { fetchPanels } = await import("../src/dash/panel");
    const panels = await fetchPanels({
      sdk: makeSdk(),
      contractId: "contract-1",
    });

    expect(panels.map((panel) => panel.groupPosition)).toEqual([0, 1, 2]);
    expect(panels.map((panel) => panel.label)).toEqual([
      "Unassigned Group",
      "Revocation Authority",
      "Access Authority",
    ]);
    expect(panels[2].actions).toEqual(["freeze", "unfreeze"]);
  });
});

describe("panelForAction", () => {
  it("selects the panel assigned to an action", async () => {
    const { panelForAction, panelsFromGovernance } =
      await import("../src/dash/panel");
    const governance = {
      usedFallbackAssignments: false,
      assignments: { freeze: 2, unfreeze: 2, destroy: 1 },
      groups: [
        { groupPosition: 1, members: new Map(), requiredPower: 3 },
        { groupPosition: 2, members: new Map(), requiredPower: 2 },
      ],
    } as const;
    const panels = panelsFromGovernance(governance);

    expect(
      panelForAction(panels, governance.assignments, "freeze")?.groupPosition,
    ).toBe(2);
    expect(
      panelForAction(panels, governance.assignments, "destroy")?.groupPosition,
    ).toBe(1);
  });
});
