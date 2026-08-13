import { describe, expect, it } from "vitest";
import {
  CREDITS_PER_DASH,
  formatCredits,
  formatCreditsCompact,
  formatDash,
  parseDashToCredits,
  relativeTime,
  shortId,
} from "../src/lib/format";

describe("formatDash", () => {
  it("formats whole DASH with the design's three decimals", () => {
    expect(formatDash(128n * CREDITS_PER_DASH)).toBe("128.000");
  });

  it("uses integer math for values above Number.MAX_SAFE_INTEGER", () => {
    // 200,000 DASH = 2e16 credits, well past the float-safe range.
    expect(formatDash(20_000_000_000_000_000n)).toBe("200,000.000");
  });

  it("keeps sub-credit precision without float error", () => {
    expect(formatDash(1n, { minDecimals: 0, maxDecimals: 11 })).toBe(
      "0.00000000001",
    );
  });

  it("trims trailing zeros down to minDecimals", () => {
    expect(formatDash(2_500_000_000n, { minDecimals: 0, maxDecimals: 6 })).toBe(
      "0.025",
    );
  });
});

describe("formatCredits", () => {
  it("renders the exact credit figure", () => {
    expect(formatCredits(12_800_000_000_000n)).toBe("12,800,000,000,000");
  });
});

describe("formatCreditsCompact", () => {
  it("collapses large amounts to a single decimal", () => {
    expect(formatCreditsCompact(31_000_000_000_000n)).toBe("31T");
    expect(formatCreditsCompact(31_500_000_000_000n)).toBe("31.5T");
  });

  it("leaves small amounts readable", () => {
    expect(formatCreditsCompact(999n)).toBe("999");
  });

  it("switches to a suffix at the compact-format boundary", () => {
    expect(formatCreditsCompact(9_999_999n)).toBe("9,999,999");
    expect(formatCreditsCompact(10_000_000n)).toBe("10M");
    expect(formatCreditsCompact(10_500_000n)).toBe("10.5M");
  });
});

describe("parseDashToCredits", () => {
  it("converts a decimal DASH amount to exact credits", () => {
    expect(parseDashToCredits("24.5")).toEqual({
      ok: true,
      credits: 2_450_000_000_000n,
    });
  });

  it("rejects zero — there is no zero-price path in the UI", () => {
    expect(parseDashToCredits("0")).toEqual({ ok: false, reason: "zero" });
    expect(parseDashToCredits("0.0")).toEqual({ ok: false, reason: "zero" });
  });

  it("rejects empty and non-numeric input", () => {
    expect(parseDashToCredits("")).toEqual({ ok: false, reason: "empty" });
    expect(parseDashToCredits("abc")).toEqual({ ok: false, reason: "invalid" });
    expect(parseDashToCredits(".")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects more precision than a credit can hold", () => {
    expect(parseDashToCredits("1.000000000001")).toEqual({
      ok: false,
      reason: "too-precise",
    });
  });

  it("round-trips an unsafe-magnitude price exactly", () => {
    const parsed = parseDashToCredits("200000");
    expect(parsed.ok && parsed.credits).toBe(20_000_000_000_000_000n);
    expect(parsed.ok && formatDash(parsed.credits)).toBe("200,000.000");
  });
});

describe("shortId", () => {
  it("truncates as XXXX…XXXX", () => {
    expect(shortId("4vqKabcdefghijklmnop9mTz")).toBe("4vqK…9mTz");
  });

  it("renders an em dash for a missing id", () => {
    expect(shortId(null)).toBe("—");
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000_000;
  it("formats recent spans", () => {
    expect(relativeTime(now - 12_000, now)).toBe("12s ago");
    expect(relativeTime(now - 6 * 3600_000, now)).toBe("6h ago");
    expect(relativeTime(now - 86_400_000, now)).toBe("yesterday");
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
  });
});
