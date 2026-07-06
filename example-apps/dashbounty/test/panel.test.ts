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

function makeSdk({
  groupInfo,
}: {
  groupInfo?: Record<
    number,
    { members: Map<string, number>; requiredPower: number }
  >;
}) {
  return {
    group: {
      info: vi.fn(
        async (_contractId: string, position: number) => groupInfo?.[position],
      ),
      members: vi.fn(async ({ groupContractPosition }) => {
        const info = groupInfo?.[groupContractPosition as number];
        return info ? new Map(info.members) : new Map();
      }),
    },
  } as never;
}

describe("fetchPanelInfo", () => {
  it("reads the explicit access group", async () => {
    const { fetchPanelInfo } = await import("../src/dash/panel");
    const info = await fetchPanelInfo({
      sdk: makeSdk({
        groupInfo: {
          0: { members: new Map([["access-panelist", 1]]), requiredPower: 2 },
          1: {
            members: new Map([["revocation-panelist", 1]]),
            requiredPower: 3,
          },
        },
      }),
      contractId: "contract-1",
      kind: "access",
    });

    expect(info.groupPosition).toBe(0);
    expect(info.requiredPower).toBe(2);
    expect([...info.members.keys()]).toEqual(["access-panelist"]);
  });

  it("reads the explicit revocation group", async () => {
    const { fetchPanelInfo } = await import("../src/dash/panel");
    const info = await fetchPanelInfo({
      sdk: makeSdk({
        groupInfo: {
          0: { members: new Map([["access-panelist", 1]]), requiredPower: 2 },
          1: {
            members: new Map([["revocation-panelist", 1]]),
            requiredPower: 3,
          },
        },
      }),
      contractId: "contract-1",
      kind: "revocation",
    });

    expect(info.groupPosition).toBe(1);
    expect(info.requiredPower).toBe(3);
    expect([...info.members.keys()]).toEqual(["revocation-panelist"]);
  });
});

describe("fetchPanels", () => {
  it("returns both Sift panels", async () => {
    const { fetchPanels } = await import("../src/dash/panel");
    const panels = await fetchPanels({
      sdk: makeSdk({
        groupInfo: {
          0: { members: new Map([["a", 1]]), requiredPower: 2 },
          1: { members: new Map([["a", 1]]), requiredPower: 3 },
        },
      }),
      contractId: "contract-1",
    });

    expect(panels.map((panel) => panel.kind)).toEqual(["access", "revocation"]);
    expect(panels.map((panel) => panel.requiredPower)).toEqual([2, 3]);
  });
});

describe("fetchPanelMembers", () => {
  it("queries the requested panel kind's group position", async () => {
    const { fetchPanelMembers } = await import("../src/dash/panel");
    const members = await fetchPanelMembers({
      sdk: makeSdk({
        groupInfo: {
          1: {
            members: new Map([
              ["panelist-a", 1],
              ["panelist-b", 1],
            ]),
            requiredPower: 3,
          },
        },
      }),
      contractId: "contract-1",
      kind: "revocation",
    });
    expect(members).toEqual(["panelist-a", "panelist-b"]);
  });
});
