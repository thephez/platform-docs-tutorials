// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { clearConnectionId, loadConnectionId } from "../src/lib/connectionId";

const STORAGE_KEY = "dashnote.appConnect.connectionId";

describe("connectionId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is 16 bytes and stable across calls", () => {
    const first = loadConnectionId();
    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toHaveLength(16);
    expect(loadConnectionId()).toEqual(first);
  });

  it("survives in localStorage as hex", () => {
    const id = loadConnectionId();
    const hex = Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(hex);
  });

  it("reads a stored id and replaces a malformed one", () => {
    localStorage.setItem(STORAGE_KEY, "00ff".repeat(8));
    expect(Array.from(loadConnectionId())).toEqual(
      Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 0 : 255)),
    );

    localStorage.setItem(STORAGE_KEY, "not hex");
    const fresh = loadConnectionId();
    expect(fresh).toHaveLength(16);
    expect(localStorage.getItem(STORAGE_KEY)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("starts over after clearConnectionId", () => {
    const first = loadConnectionId();
    clearConnectionId();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadConnectionId()).not.toEqual(first);
  });
});
