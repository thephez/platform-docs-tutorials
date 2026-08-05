import { describe, expect, it } from "vitest";
import { explorerUrl } from "../src/lib/explorer";

describe("explorerUrl", () => {
  it("builds testnet identity and document links", () => {
    expect(explorerUrl("testnet", "identity", "identity-1")).toBe(
      "https://testnet.platform-explorer.com/identity/identity-1",
    );
    expect(explorerUrl("testnet", "document", "document-1")).toBe(
      "https://testnet.platform-explorer.com/document/document-1",
    );
  });

  it("uses the mainnet explorer host on mainnet", () => {
    expect(explorerUrl("mainnet", "document", "document-1")).toBe(
      "https://platform-explorer.com/document/document-1",
    );
  });
});
