import { describe, expect, it } from "vitest";
import {
  applyFilters,
  DEFAULT_FILTERS,
  describeFilters,
  sortListings,
  type Filters,
} from "../src/lib/filters";
import { CREDITS_PER_DASH } from "../src/lib/format";
import type { Listing } from "../src/dash/listingTypes";

function listing(label: string, dash: bigint, seenAt = 0): Listing {
  return {
    documentId: `doc-${label}`,
    label,
    normalizedLabel: label,
    parentDomainName: "dash",
    ownerId: "o1",
    resolvesTo: "o1",
    price: dash * CREDITS_PER_DASH,
    revision: 1n,
    seenAt,
  };
}

const pool = [
  listing("joe", 55n, 3),
  listing("app", 5n, 2),
  listing("bit-x", 95n, 1),
  listing("web2", 120n, 4),
  listing("longername", 200n, 5),
];

function withFilters(overrides: Partial<Filters>): Filters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

describe("price bands", () => {
  it("filters under 10 DASH", () => {
    const out = applyFilters(pool, withFilters({ priceBand: "under10" }));
    expect(out.map((l) => l.label)).toEqual(["app"]);
  });

  it("filters 10–100 DASH inclusively", () => {
    const out = applyFilters(pool, withFilters({ priceBand: "10to100" }));
    expect(out.map((l) => l.label)).toEqual(["joe", "bit-x"]);
  });

  it("filters above 100 DASH", () => {
    const out = applyFilters(pool, withFilters({ priceBand: "over100" }));
    expect(out.map((l) => l.label)).toEqual(["web2", "longername"]);
  });
});

describe("length filter", () => {
  it("matches an exact length", () => {
    const out = applyFilters(pool, withFilters({ lengths: [3] }));
    expect(out.map((l) => l.label).sort()).toEqual(["app", "joe"]);
  });

  it("treats 6 as an open-ended 6+ bucket", () => {
    const out = applyFilters(pool, withFilters({ lengths: [6] }));
    expect(out.map((l) => l.label)).toEqual(["longername"]);
  });
});

describe("character rules", () => {
  it("letters only excludes digits and hyphens", () => {
    const out = applyFilters(pool, withFilters({ charRules: ["lettersOnly"] }));
    expect(out.map((l) => l.label).sort()).toEqual([
      "app",
      "joe",
      "longername",
    ]);
  });

  it("no hyphens", () => {
    const out = applyFilters(pool, withFilters({ charRules: ["noHyphens"] }));
    expect(out.map((l) => l.label)).not.toContain("bit-x");
  });

  it("no digits", () => {
    const out = applyFilters(pool, withFilters({ charRules: ["noDigits"] }));
    expect(out.map((l) => l.label)).not.toContain("web2");
  });
});

describe("history rules", () => {
  it("excludes listings whose facts are unknown rather than passing them", () => {
    // An unevaluable filter must not silently behave as "no filter".
    const out = applyFilters(pool, withFilters({ historyRules: ["hasSold"] }));
    expect(out).toEqual([]);
  });

  it("applies the rule when facts are supplied", () => {
    const facts = new Map([
      ["doc-joe", { hasSold: true, priceDropped: false }],
      ["doc-app", { hasSold: false, priceDropped: true }],
    ]);
    expect(
      applyFilters(pool, withFilters({ historyRules: ["hasSold"] }), facts).map(
        (l) => l.label,
      ),
    ).toEqual(["joe"]);
    expect(
      applyFilters(
        pool,
        withFilters({ historyRules: ["priceDropped"] }),
        facts,
      ).map((l) => l.label),
    ).toEqual(["app"]);
  });
});

describe("sorting", () => {
  it("sorts by price ascending using bigint comparison", () => {
    // A subtraction comparator would throw on bigints; this must not.
    const out = sortListings([...pool], "priceAsc");
    expect(out.map((l) => l.label)).toEqual([
      "app",
      "joe",
      "bit-x",
      "web2",
      "longername",
    ]);
  });

  it("sorts unsafe-magnitude prices correctly", () => {
    const huge = listing("huge", 200_000n);
    const small = listing("small", 1n);
    const out = sortListings([huge, small], "priceAsc");
    expect(out.map((l) => l.label)).toEqual(["small", "huge"]);
  });

  it("sorts by price descending", () => {
    expect(sortListings([...pool], "priceDesc")[0].label).toBe("longername");
  });

  it("sorts by recency", () => {
    expect(sortListings([...pool], "recent")[0].label).toBe("longername");
  });

  it("sorts by length", () => {
    expect(sortListings([...pool], "lengthAsc")[0].normalizedLabel.length).toBe(
      3,
    );
  });
});

describe("describeFilters", () => {
  it("summarizes the active filters", () => {
    expect(
      describeFilters(
        withFilters({
          priceBand: "under10",
          lengths: [3],
          charRules: ["noDigits"],
        }),
      ),
    ).toBe("under 10 DASH · 3 characters · no digits");
  });

  it("is empty when nothing is filtered", () => {
    expect(describeFilters(DEFAULT_FILTERS)).toBe("");
  });
});
