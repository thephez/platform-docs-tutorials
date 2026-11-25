import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearWalletSession,
  loadWalletSession,
  peekWalletSession,
  saveWalletSession,
  walletSessionStorageAvailable,
  type StoredWalletSession,
} from "../src/lib/walletSessionStore";

const DB_NAME = "dashnote.walletSession";
const STORE = "records";

const SESSION: StoredWalletSession = {
  identityId: "5DbLwAxGBzUzo81VewMUwn4b5P4bpv9FNFybi25XB5Bk",
  keyId: 7,
  contractId: "8d6heK6CoskLBi6Rs7cChRG9RuckcZqZst28BdviBe8y",
  totalBudget: 10_000_000_000n,
  expiresAt: 1_790_000_000_000,
  grantedAt: 1_780_000_000_000,
};

function keyBytes(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => (seed + i * 7) & 0xff);
}

function openRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRaw(key: string): Promise<unknown> {
  const db = await openRaw();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeRaw(key: string, value: unknown): Promise<void> {
  const db = await openRaw();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("walletSessionStore", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is empty before anything is saved", async () => {
    expect(await peekWalletSession()).toBeNull();
    expect(await loadWalletSession()).toBeNull();
    await expect(clearWalletSession()).resolves.toBeUndefined();
  });

  it("peeks the metadata without key material", async () => {
    await saveWalletSession(SESSION, keyBytes(1));
    const peeked = await peekWalletSession();
    expect(peeked).toEqual(SESSION);
    expect(Object.keys(peeked ?? {}).sort()).toEqual(
      Object.keys(SESSION).sort(),
    );
  });

  it("loads equal bytes in a buffer the caller owns", async () => {
    const key = keyBytes(1);
    await saveWalletSession(SESSION, key);
    const loaded = await loadWalletSession();
    expect(loaded?.session).toEqual(SESSION);
    expect(loaded?.privateKey).toEqual(key);
    expect(loaded?.privateKey.buffer).not.toBe(key.buffer);
    expect(Array.from(key)).toEqual(Array.from(keyBytes(1)));
  });

  it("keeps a null budget and expiry", async () => {
    const session = { ...SESSION, totalBudget: null, expiresAt: null };
    await saveWalletSession(session, keyBytes(1));
    expect((await loadWalletSession())?.session).toEqual(session);
  });

  it("stores no plaintext", async () => {
    const key = keyBytes(9);
    await saveWalletSession(SESSION, key);
    const record = (await readRaw("session")) as {
      iv: Uint8Array;
      ciphertext: ArrayBuffer;
    };
    expect(record.iv).toHaveLength(12);
    const ciphertext = new Uint8Array(record.ciphertext);
    expect(ciphertext.length).toBeGreaterThanOrEqual(32);
    expect(contains(ciphertext, key)).toBe(false);
  });

  it("replaces an earlier session", async () => {
    await saveWalletSession(SESSION, keyBytes(1));
    const second = { ...SESSION, keyId: 8, grantedAt: SESSION.grantedAt + 1 };
    await saveWalletSession(second, keyBytes(2));
    const loaded = await loadWalletSession();
    expect(loaded?.session).toEqual(second);
    expect(loaded?.privateKey).toEqual(keyBytes(2));
  });

  it("clears the session but keeps the device key", async () => {
    await saveWalletSession(SESSION, keyBytes(1));
    const record = await readRaw("session");
    await clearWalletSession();
    expect(await readRaw("session")).toBeUndefined();
    expect(await peekWalletSession()).toBeNull();
    expect(await loadWalletSession()).toBeNull();

    // the device key that wrapped the old record is still there
    await writeRaw("session", record);
    expect((await loadWalletSession())?.privateKey).toEqual(keyBytes(1));

    await saveWalletSession(SESSION, keyBytes(3));
    expect((await loadWalletSession())?.privateKey).toEqual(keyBytes(3));
  });

  it("drops a record whose ciphertext was tampered with", async () => {
    await saveWalletSession(SESSION, keyBytes(1));
    const record = (await readRaw("session")) as { ciphertext: ArrayBuffer };
    const bytes = new Uint8Array(record.ciphertext);
    bytes[0] ^= 1;
    await writeRaw("session", { ...record, ciphertext: bytes.buffer });

    expect(await loadWalletSession()).toBeNull();
    expect(await readRaw("session")).toBeUndefined();
  });

  it("drops a record moved to another key id", async () => {
    await saveWalletSession(SESSION, keyBytes(1));
    const record = (await readRaw("session")) as StoredWalletSession;
    await writeRaw("session", { ...record, keyId: SESSION.keyId + 1 });

    expect(await loadWalletSession()).toBeNull();
    expect(await readRaw("session")).toBeUndefined();
  });

  it("drops a record whose device key is gone", async () => {
    await saveWalletSession(SESSION, keyBytes(1));
    await writeRaw("deviceKey", "not a key");

    expect(await loadWalletSession()).toBeNull();
    expect(await readRaw("session")).toBeUndefined();
  });

  it("drops a malformed record", async () => {
    expect(await walletSessionStorageAvailable()).toBe(true);
    await writeRaw("session", { identityId: SESSION.identityId });
    expect(await peekWalletSession()).toBeNull();
    expect(await loadWalletSession()).toBeNull();
    expect(await readRaw("session")).toBeUndefined();
  });

  it("keeps one device key when two saves race", async () => {
    await Promise.all([
      saveWalletSession(SESSION, keyBytes(1)),
      saveWalletSession(SESSION, keyBytes(2)),
    ]);
    const loaded = await loadWalletSession();
    expect(loaded).not.toBeNull();
    expect([keyBytes(1), keyBytes(2)]).toContainEqual(loaded?.privateKey);
  });

  it("keeps the device key non-extractable", async () => {
    await saveWalletSession(SESSION, keyBytes(1));
    const deviceKey = await readRaw("deviceKey");
    expect(deviceKey).toBeInstanceOf(CryptoKey);
    expect((deviceKey as CryptoKey).extractable).toBe(false);
    await expect(
      crypto.subtle.exportKey("raw", deviceKey as CryptoKey),
    ).rejects.toThrow();
  });

  it("reports availability", async () => {
    expect(await walletSessionStorageAvailable()).toBe(true);
  });

  describe("without IndexedDB", () => {
    beforeEach(() => {
      vi.stubGlobal("indexedDB", undefined);
    });

    it("reports storage unavailable and stays quiet", async () => {
      expect(await walletSessionStorageAvailable()).toBe(false);
      expect(await peekWalletSession()).toBeNull();
      expect(await loadWalletSession()).toBeNull();
      await expect(clearWalletSession()).resolves.toBeUndefined();
    });

    it("rejects a save with a plain error", async () => {
      await expect(saveWalletSession(SESSION, keyBytes(1))).rejects.toThrow(
        "Wallet session storage is unavailable",
      );
    });
  });

  it("reports storage unavailable when the database will not open", async () => {
    const failing = {
      open: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    vi.stubGlobal("indexedDB", failing);
    expect(await walletSessionStorageAvailable()).toBe(false);
    expect(await peekWalletSession()).toBeNull();
    await expect(saveWalletSession(SESSION, keyBytes(1))).rejects.toThrow(
      "Wallet session storage is unavailable",
    );
  });
});
