import { describe, expect, it, vi } from "vitest";

const { mockDocumentCtor } = vi.hoisted(() => ({
  mockDocumentCtor: vi.fn(function MockDocument(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, args);
  }),
}));

vi.mock("@dashevo/evo-sdk", () => ({
  Document: mockDocumentCtor,
}));

describe("submitSubmission", () => {
  it("charges 1 Sift token via tokenPaymentInfo", async () => {
    const { submitSubmission } = await import("../src/dash/submitSubmission");
    const { SIFT_TOKEN_PAYMENT_INFO } = await import("../src/dash/siftToken");
    const identity = { id: "identity-1" };
    const identityKey = { id: "key-1" };
    const signer = { id: "signer-1" };
    const create = vi.fn().mockResolvedValue(undefined);

    await submitSubmission({
      sdk: { documents: { create } } as never,
      keyManager: {
        async getAuth() {
          return { identity, identityKey, signer };
        },
      } as never,
      contractId: "contract-1",
      submission: {
        title: "SQLi in login form",
        severity: "high",
        component: "Auth",
        description: "Public summary of suspicious input handling.",
      },
    });

    expect(mockDocumentCtor).toHaveBeenCalledWith({
      properties: {
        title: "SQLi in login form",
        severity: "high",
        component: "Auth",
        description: "Public summary of suspicious input handling.",
      },
      documentTypeName: "submission",
      dataContractId: "contract-1",
      ownerId: identity.id,
    });
    expect(create).toHaveBeenCalledWith({
      document: mockDocumentCtor.mock.instances[0],
      identityKey,
      signer,
      tokenPaymentInfo: SIFT_TOKEN_PAYMENT_INFO,
    });
  });

  it("includes the optional evidence hash when provided", async () => {
    const { submitSubmission } = await import("../src/dash/submitSubmission");
    const create = vi.fn().mockResolvedValue(undefined);

    await submitSubmission({
      sdk: { documents: { create } } as never,
      keyManager: {
        async getAuth() {
          return {
            identity: { id: "identity-1" },
            identityKey: { id: "key-1" },
            signer: { id: "signer-1" },
          };
        },
      } as never,
      contractId: "contract-1",
      submission: {
        title: "XSS in comment field",
        severity: "medium",
        component: "Frontend",
        description: "Public summary of unsafe rendering.",
        pocHash: "a".repeat(44),
      },
    });

    expect(mockDocumentCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ pocHash: "a".repeat(44) }),
      }),
    );
  });

  it("rejects an empty title, component, or summary", async () => {
    const { submitSubmission } = await import("../src/dash/submitSubmission");
    const base = {
      sdk: { documents: { create: vi.fn() } } as never,
      keyManager: {
        async getAuth() {
          return {
            identity: { id: "identity-1" },
            identityKey: { id: "key-1" },
            signer: { id: "signer-1" },
          };
        },
      } as never,
      contractId: "contract-1",
    };

    await expect(
      submitSubmission({
        ...base,
        submission: {
          title: "  ",
          severity: "low",
          component: "X",
          description: "Y",
        },
      }),
    ).rejects.toThrow(/title/i);

    await expect(
      submitSubmission({
        ...base,
        submission: {
          title: "T",
          severity: "low",
          component: "  ",
          description: "Y",
        },
      }),
    ).rejects.toThrow(/component/i);

    await expect(
      submitSubmission({
        ...base,
        submission: {
          title: "T",
          severity: "low",
          component: "X",
          description: "  ",
        },
      }),
    ).rejects.toThrow(/summary/i);
  });
});
