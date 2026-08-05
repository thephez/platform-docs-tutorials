import { describe, expect, it } from "vitest";
import {
  parseProtocolStatus,
  UNKNOWN_PROTOCOL_STATUS,
} from "../src/dash/protocolVersion";

/**
 * The live testnet response shape, verified 2026-08-05.
 *
 * Note `version` carries TWO unrelated kinds of version, and the fixtures keep
 * both so the parser is pinned to the right one:
 *   software.drive "4.1.0"  — Drive the software (semver)
 *   protocol.drive {…13}    — the platform PROTOCOL version (the gate)
 */
const testnetStatus = {
  version: {
    software: { dapi: "4.1.0", drive: "4.1.0", tenderdash: "1.6.0" },
    protocol: {
      tenderdash: { p2p: 10, block: 14 },
      drive: { latest: 13, current: 13 },
    },
  },
  // `chain` is a WASM handle whose fields are only reachable via toJSON().
  chain: {
    toJSON: () => ({
      latestBlockHeight: "485856",
      coreChainLockedHeight: 1528326,
    }),
  },
};

const mainnetStatus = {
  version: {
    software: { dapi: "4.1.0", drive: "4.1.0", tenderdash: "1.6.0" },
    protocol: {
      tenderdash: { p2p: 10, block: 14 },
      drive: { latest: 13, current: 12 },
    },
  },
  chain: { toJSON: () => ({ latestBlockHeight: "410574" }) },
};

describe("parseProtocolStatus", () => {
  it("enables sales on a v13 network", () => {
    const status = parseProtocolStatus(testnetStatus);
    expect(status.activeProtocolVersion).toBe(13);
    expect(status.salesEnabled).toBe(true);
  });

  it("disables sales on a v12 network even when it knows about v13", () => {
    // Keying off `latest` instead of `current` would wrongly enable mainnet.
    const status = parseProtocolStatus(mainnetStatus);
    expect(status.activeProtocolVersion).toBe(12);
    expect(status.knownProtocolVersion).toBe(13);
    expect(status.salesEnabled).toBe(false);
  });

  it("reads the PROTOCOL version, never the Drive software release", () => {
    // `version.software.drive` is "4.1.0"; `version.protocol.drive.current` is
    // 13. Reading the wrong one would compare a semver string to 13 and, being
    // non-numeric, fail closed — disabling sales on a perfectly capable network.
    const status = parseProtocolStatus(testnetStatus);
    expect(status.activeProtocolVersion).toBe(13);
    expect(status.activeProtocolVersion).not.toBe("4.1.0");
  });

  it("ignores the Tenderdash protocol versions", () => {
    // `protocol.tenderdash` is {p2p: 10, block: 14} — neither is the gate.
    const status = parseProtocolStatus(testnetStatus);
    expect(status.activeProtocolVersion).toBe(13);
    expect(status.knownProtocolVersion).toBe(13);
  });

  it("reads the block height through the WASM handle's toJSON", () => {
    expect(parseProtocolStatus(testnetStatus).blockHeight).toBe(485_856n);
  });

  it("reads a plain-object chain too", () => {
    const status = parseProtocolStatus({
      version: { protocol: { drive: { current: 13 } } },
      chain: { latestBlockHeight: 12345 },
    });
    expect(status.blockHeight).toBe(12_345n);
  });

  describe("fails closed", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty object", {}],
      ["missing drive", { version: { protocol: {} } }],
      ["empty drive", { version: { protocol: { drive: {} } } }],
      [
        "non-numeric current",
        { version: { protocol: { drive: { current: "13" } } } },
      ],
    ])("%s leaves sales disabled", (_label, input) => {
      const status = parseProtocolStatus(input);
      expect(status.activeProtocolVersion).toBeNull();
      expect(status.salesEnabled).toBe(false);
    });

    it("a throwing toJSON does not surface a block height", () => {
      const status = parseProtocolStatus({
        version: { protocol: { drive: { current: 13 } } },
        chain: {
          toJSON: () => {
            throw new Error("wasm boom");
          },
        },
      });
      expect(status.blockHeight).toBeNull();
      // The version is still readable, so the gate stays open on its own merit.
      expect(status.salesEnabled).toBe(true);
    });
  });

  it("the exported default is closed", () => {
    expect(UNKNOWN_PROTOCOL_STATUS.salesEnabled).toBe(false);
    expect(UNKNOWN_PROTOCOL_STATUS.activeProtocolVersion).toBeNull();
  });
});
