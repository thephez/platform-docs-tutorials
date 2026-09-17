import { describe, expect, it, vi } from "vitest";
import { DOMAIN_DOCUMENT_TYPE, DPNS_CONTRACT_ID } from "../src/dash/contracts";
import { classifyMarketplaceError } from "../src/dash/marketplaceErrors";
import { purchaseName } from "../src/dash/purchaseName";
import { setPrice } from "../src/dash/setPrice";
import { transferName } from "../src/dash/transferName";
import type { DashKeyManager, DashSdk } from "../src/dash/types";

function makeSdk(behaviour: { throwOn?: string; error?: unknown } = {}) {
  const doc = { id: "d1", revision: 4n, properties: { $price: 5n } };
  const calls: Record<string, unknown[]> = {};
  const record = (name: string) => (args: unknown) => {
    calls[name] = [args];
    if (behaviour.throwOn === name) throw behaviour.error ?? new Error("boom");
    return Promise.resolve(undefined);
  };

  const sdk = {
    documents: {
      get: vi.fn(async () => ({ ...doc })),
      setPrice: vi.fn(record("setPrice")),
      purchase: vi.fn(record("purchase")),
      transfer: vi.fn(record("transfer")),
    },
  } as unknown as DashSdk;

  const keyManager = {
    identityId: "buyer-1",
    getAuth: vi.fn(async () => ({
      identity: { id: "buyer-1" },
      identityKey: undefined,
      signer: {},
    })),
  } as unknown as DashKeyManager;

  return { sdk, keyManager, calls };
}

const common = {
  contractId: DPNS_CONTRACT_ID,
  documentTypeName: DOMAIN_DOCUMENT_TYPE,
  documentId: "d1",
};

describe("revision handling", () => {
  it("bumps the fetched revision by exactly one", async () => {
    const { sdk, keyManager, calls } = makeSdk();
    await setPrice({
      sdk,
      keyManager,
      ...common,
      price: 10n,
    });
    const args = calls.setPrice[0] as { document: { revision: bigint } };
    // Platform rejects mutations that don't strictly increase the revision.
    expect(args.document.revision).toBe(5n);
  });
});

describe("price fidelity", () => {
  it("passes an unsafe-magnitude price through as an exact bigint", async () => {
    // Regression guard for dashpay/platform#3786: the exact value must reach
    // sdk.documents.purchase without passing through a JS number.
    const unsafe = 20_000_000_000_000_000n;
    const { sdk, keyManager, calls } = makeSdk();
    await purchaseName({
      sdk,
      keyManager,
      ...common,
      price: unsafe,
    });
    const args = calls.purchase[0] as { price: bigint };
    expect(args.price).toBe(unsafe);
    expect(typeof args.price).toBe("bigint");
  });

  it("treats 0n as a delist rather than rejecting it", async () => {
    const { sdk, keyManager, calls } = makeSdk();
    const result = await setPrice({
      sdk,
      keyManager,
      ...common,
      price: 0n,
    });
    expect(result.ok).toBe(true);
    expect((calls.setPrice[0] as { price: bigint }).price).toBe(0n);
  });
});

describe("purchase identity", () => {
  it("buys as the signed-in identity", async () => {
    const { sdk, keyManager, calls } = makeSdk();
    await purchaseName({
      sdk,
      keyManager,
      ...common,
      price: 5n,
    });
    expect((calls.purchase[0] as { buyerId: string }).buyerId).toBe("buyer-1");
  });
});

describe("transfer validation", () => {
  it("requires a recipient", async () => {
    const { sdk, keyManager } = makeSdk();
    const result = await transferName({
      sdk,
      keyManager,
      ...common,
      recipientId: "",
    });
    expect(result.ok).toBe(false);
    expect(sdk.documents.transfer).not.toHaveBeenCalled();
  });
});

describe("failures return typed errors carrying the protocol message", () => {
  it("classifies a price mismatch", async () => {
    const { sdk, keyManager } = makeSdk({
      throwOn: "purchase",
      error: new Error("Invalid document purchase price: expected 6 got 5"),
    });
    const result = await purchaseName({
      sdk,
      keyManager,
      ...common,
      price: 5n,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PriceMismatch");
    // The raw message is always surfaced — that part of the design is achievable.
    expect(result.error.message).toContain("expected 6 got 5");
  });

  it("never fabricates a transaction id", async () => {
    const { sdk, keyManager } = makeSdk();
    const result = await purchaseName({
      sdk,
      keyManager,
      ...common,
      price: 5n,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The SDK resolves void, so no transition id is obtainable today.
    expect(result.transitionId).toBeUndefined();
  });
});

describe("classifyMarketplaceError", () => {
  it.each([
    ["Invalid document purchase price", "PriceMismatch"],
    ["document revision must be greater than 4", "StaleRevision"],
    ["identity is not the owner of this document", "NotOwner"],
    ["balance is not sufficient for this operation", "InsufficientBalance"],
    ["action is not allowed for this document type", "SalesDisabled"],
  ])("maps %j to %s", (message, kind) => {
    expect(classifyMarketplaceError(new Error(message)).kind).toBe(kind);
  });

  it("keeps an unrecognized error honest rather than guessing", () => {
    const error = classifyMarketplaceError(new Error("something novel broke"));
    expect(error.kind).toBe("Unknown");
    expect(error.message).toBe("something novel broke");
  });
});
