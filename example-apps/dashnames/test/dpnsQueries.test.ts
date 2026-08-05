import { describe, expect, it, vi } from "vitest";
import {
  normalizeLabelInput,
  toNormalizedLabel,
} from "../src/dash/dpnsQueries";
import type { DashSdk } from "../src/dash/types";

/**
 * Stands in for the SDK's WASM fold. The mappings are the real ones, verified
 * live on 2026-08-05 via `sdk.dpns.convertToHomographSafe`:
 *   latte -> 1atte, hello -> he110, oreo -> 0re0, illinois -> 1111n01s
 */
function makeSdk() {
  const convertToHomographSafe = vi.fn(async (input: string) =>
    input.toLowerCase().replace(/[li]/g, "1").replace(/o/g, "0"),
  );
  return {
    sdk: { dpns: { convertToHomographSafe } } as unknown as DashSdk,
    convertToHomographSafe,
  };
}

describe("normalizeLabelInput", () => {
  it("lowercases and strips the .dash suffix", () => {
    expect(normalizeLabelInput("  Alice.dash ")).toBe("alice");
    expect(normalizeLabelInput("BOB")).toBe("bob");
  });

  it("does NOT fold homographs on its own", () => {
    // Guards the split: this function is for trimming input, not for building
    // a normalizedLabel query.
    expect(normalizeLabelInput("latte")).toBe("latte");
  });
});

describe("toNormalizedLabel", () => {
  it("applies the homograph fold DPNS actually stores", async () => {
    // The reported bug: `latte.dash` exists on mainnet but is stored as
    // `1atte`, so querying normalizedLabel == "latte" matched nothing.
    const { sdk } = makeSdk();
    expect(await toNormalizedLabel(sdk, "latte.dash")).toBe("1atte");
    expect(await toNormalizedLabel(sdk, "LATTE")).toBe("1atte");
    expect(await toNormalizedLabel(sdk, "hello")).toBe("he110");
    expect(await toNormalizedLabel(sdk, "oreo")).toBe("0re0");
  });

  it("leaves a label with no foldable characters untouched", async () => {
    const { sdk } = makeSdk();
    expect(await toNormalizedLabel(sdk, "phez")).toBe("phez");
  });

  it("strips .dash before folding", async () => {
    const { sdk, convertToHomographSafe } = makeSdk();
    await toNormalizedLabel(sdk, "Latte.dash");
    expect(convertToHomographSafe).toHaveBeenCalledWith("latte");
  });

  it("uses the SDK's fold rather than a local reimplementation", async () => {
    // A hand-rolled copy would drift from consensus, so the call must be made.
    const { sdk, convertToHomographSafe } = makeSdk();
    await toNormalizedLabel(sdk, "anything");
    expect(convertToHomographSafe).toHaveBeenCalledTimes(1);
  });
});
