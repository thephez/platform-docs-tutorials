import { describe, expect, it } from "vitest";
import { fetchRecentEvents } from "../src/dash/historyQueries";
import type { DashSdk } from "../src/dash/types";

describe("fetchRecentEvents", () => {
  it("pages the ascending stream before selecting the newest records", async () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({
      id: `event-${String(index).padStart(3, "0")}`,
      ownerId: "owner",
      createdAt: BigInt(index),
      properties: { documentId: `document-${index}` },
    }));
    const starts: Array<string | undefined> = [];
    const sdk = {
      documents: {
        query: async ({
          startAfter,
          limit,
        }: {
          startAfter?: string;
          limit: number;
        }) => {
          starts.push(startAfter);
          const offset = startAfter
            ? rows.findIndex((row) => row.id === startAfter) + 1
            : 0;
          return rows.slice(offset, offset + limit);
        },
      },
    } as unknown as DashSdk;

    const result = await fetchRecentEvents({
      sdk,
      type: "purchase",
      dataContractId: "dpns",
      limit: 3,
    });

    expect(starts).toEqual([undefined, "event-099"]);
    expect(result.map((event) => event.id)).toEqual([
      "event-104",
      "event-103",
      "event-102",
    ]);
  });
});
