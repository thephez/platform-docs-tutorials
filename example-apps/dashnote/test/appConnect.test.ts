import * as secp256k1 from "@noble/secp256k1";
import { describe, expect, it, vi } from "vitest";

import {
  APP_CONNECT_CONTRACT_ID,
  APP_CONNECT_LABEL,
  AmbiguousWalletAnswerError,
  DEFAULT_BUDGET_CREDITS,
  DEFAULT_LIFETIME_MS,
  PollTrigger,
  RequestExpiredError,
  TooManyAnswersError,
  WalletAnswerRefusedError,
  awaitWalletAnswer,
  classifyWalletWriteError,
  identityPort,
  loginWithWalletAnswer,
  newWalletLoginRequest,
  readChainClock,
  readWalletGrant,
  responsePort,
  restoreWalletLogin,
  type WalletLoginRequest,
  type WalletPollStatus,
} from "../src/dash/appConnect";
import { loginWithPrivateKey } from "../src/dash/loginWithPrivateKey";
import type { DashSdk } from "../src/dash/types";
import {
  KeySecurityLevel,
  parseAppConnectUri,
  sealAppConnectPayload,
  type AppConnectGrant,
} from "../src/vendor/platform-auth/app-connect";
import {
  decodeBase58,
  encodeBase58,
  hash160,
} from "../src/vendor/platform-auth/app-connect/primitives";
import { seed } from "../src/vendor/platform-auth/app-connect/test-helpers";

const fromBytes = vi.fn((bytes: Uint8Array, network: string) => {
  void bytes;
  void network;
  return { toWIF: () => "cWIF" };
});

vi.mock("../src/dash/sdkModule", () => ({
  loadSdkModule: async () => ({ PrivateKey: { fromBytes } }),
}));

vi.mock("../src/dash/loginWithPrivateKey", () => ({
  loginWithPrivateKey: vi.fn(
    async (_sdk: unknown, _wif: string, id: string) => ({
      identity: { id },
      identityKey: { keyId: 3 },
      signer: { kind: "signer" },
      identityId: id,
    }),
  ),
}));

const CONTRACT_ID = encodeBase58(seed("dashnote contract"));
const OWNER = encodeBase58(seed("owner"));
const OTHER = encodeBase58(seed("other owner"));
const CREATED_AT = 1_800_000_000_000;
const CHAIN_NOW = 1_799_999_990_000;
const GRANT_EXPIRES = CHAIN_NOW + DEFAULT_LIFETIME_MS;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function pub(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateKey, true);
}

interface StubKey {
  keyId: number;
  keyTypeNumber: number;
  purposeNumber: number;
  securityLevelNumber: number;
  data: string;
  disabledAt?: bigint;
  totalBudget?: bigint;
  expiresAt?: bigint;
  contractBounds?: {
    contractBoundsType: string;
    identifier: unknown;
    documentTypeName?: string;
  };
}

function grantKey(
  privateKey: Uint8Array,
  overrides: Partial<StubKey> = {},
): StubKey {
  return {
    keyId: 3,
    keyTypeNumber: 0,
    purposeNumber: 0,
    securityLevelNumber: KeySecurityLevel.HIGH,
    data: hex(pub(privateKey)),
    contractBounds: {
      contractBoundsType: "singleContract",
      identifier: { toString: () => CONTRACT_ID },
    },
    totalBudget: DEFAULT_BUDGET_CREDITS,
    expiresAt: BigInt(GRANT_EXPIRES),
    ...overrides,
  };
}

const masterKey: StubKey = {
  keyId: 0,
  keyTypeNumber: 0,
  purposeNumber: 0,
  securityLevelNumber: KeySecurityLevel.MASTER,
  data: hex(pub(seed("master"))),
};

interface StubOptions {
  identities?: Record<string, StubKey[]>;
  budgets?: Record<number, bigint | null>;
  documents?: unknown;
  query?: (args: { where?: unknown[][] }) => Promise<unknown>;
  contractKeys?: StubKey[];
  /** Block time the proved identity read reports. */
  chainTimeMs?: bigint;
}

function stubSdk(options: StubOptions = {}) {
  const identities = options.identities ?? {};
  const sdk = {
    contracts: {
      fetchWithProof: vi.fn(async () => ({
        data: {},
        metadata: { timeMs: 1_799_999_990_123n, protocolVersion: 14 },
      })),
    },
    documents: {
      query: vi.fn(options.query ?? (async () => options.documents ?? [])),
    },
    identities: {
      fetchWithProof: vi.fn(async (id: string) => ({
        data: identities[id] ? { publicKeys: identities[id] } : undefined,
        metadata: {
          timeMs: options.chainTimeMs ?? BigInt(CHAIN_NOW),
          protocolVersion: 14,
        },
      })),
      keysRemainingBudgets: vi.fn(
        async (_id: string, keyIds: number[]) =>
          new Map(keyIds.map((k) => [k, options.budgets?.[k] ?? null])),
      ),
      contractKeys: vi.fn(async () =>
        options.contractKeys
          ? [{ identityId: OWNER, keys: options.contractKeys }]
          : [],
      ),
    },
  };
  return { sdk, asSdk: sdk as unknown as DashSdk };
}

function newRequest(identityHint?: string): WalletLoginRequest {
  return newWalletLoginRequest({
    contractId: CONTRACT_ID,
    connectionId: seed("connection").slice(0, 16),
    chainNow: CHAIN_NOW,
    identityHint,
    now: CREATED_AT,
  });
}

async function answerDoc(
  req: WalletLoginRequest,
  ownerId: string,
  privateKey: Uint8Array,
) {
  const sealed = await sealAppConnectPayload({
    appEphemeralPubKey: req.request.appEphemeralPubKey,
    ownerId: decodeBase58(ownerId),
    slots: [privateKey.slice()],
  });
  return {
    ownerId: { toString: () => ownerId },
    properties: sealed,
  };
}

function byOwner<T extends { ownerId: unknown }>(docs: T[]): T[] {
  return docs.sort((a, b) => {
    const x = decodeBase58(String(a.ownerId));
    const y = decodeBase58(String(b.ownerId));
    for (let i = 0; i < 32; i += 1) {
      if (x[i] !== y[i]) return x[i]! - y[i]!;
    }
    return 0;
  });
}

/** A trigger that advances the fake clock by each delay instead of sleeping. */
function clockTrigger(clock: { t: number; waits?: number[] }) {
  return {
    fire() {},
    async wait(ms: number) {
      clock.waits?.push(ms);
      clock.t += ms;
    },
  } as unknown as PollTrigger;
}

function spamDoc(label: string) {
  return {
    ownerId: encodeBase58(seed(label)),
    properties: {
      walletEphemeralPubKey: new Uint8Array(33),
      encryptedPayload: new Uint8Array(60),
    },
  };
}

describe("readChainClock", () => {
  it("reads block time and protocol version from a proved contract read", async () => {
    const { sdk, asSdk } = stubSdk();
    await expect(readChainClock(asSdk, CONTRACT_ID)).resolves.toEqual({
      timeMs: 1_799_999_990_123,
      protocolVersion: 14,
    });
    expect(sdk.contracts.fetchWithProof).toHaveBeenCalledWith(CONTRACT_ID);
  });
});

describe("identityPort", () => {
  it("maps keys of every bounds kind, hash160 keys, limits and disabled keys", async () => {
    const point = pub(seed("a"));
    const keys: StubKey[] = [
      masterKey,
      grantKey(seed("a")),
      {
        keyId: 4,
        keyTypeNumber: 2,
        purposeNumber: 0,
        securityLevelNumber: KeySecurityLevel.HIGH,
        data: hex(hash160(point)),
        contractBounds: {
          contractBoundsType: "documentType",
          identifier: CONTRACT_ID,
          documentTypeName: "note",
        },
      },
      {
        keyId: 5,
        keyTypeNumber: 0,
        purposeNumber: 0,
        securityLevelNumber: KeySecurityLevel.CRITICAL,
        data: hex(pub(seed("b"))),
        disabledAt: 1234n,
        contractBounds: {
          contractBoundsType: "contractGroup",
          identifier: OTHER,
        },
      },
    ];
    const { asSdk } = stubSdk({ identities: { [OWNER]: keys } });
    const record = await identityPort(asSdk).getIdentityFresh(OWNER);

    expect(record?.id).toBe(OWNER);
    const [master, single, docType, group] = record!.publicKeys;
    expect(master).toMatchObject({ id: 0, securityLevel: 0 });
    expect(master!.bounds).toBeUndefined();
    expect(master!.disabledAt).toBeUndefined();
    expect(single).toEqual({
      id: 3,
      type: 0,
      purpose: 0,
      securityLevel: KeySecurityLevel.HIGH,
      data: point,
      disabledAt: undefined,
      totalBudget: DEFAULT_BUDGET_CREDITS,
      expiresAt: GRANT_EXPIRES,
      bounds: { kind: "singleContract", contractId: CONTRACT_ID },
    });
    expect(docType!.type).toBe(2);
    expect(docType!.data).toEqual(hash160(point));
    expect(docType!.data).toHaveLength(20);
    expect(docType!.bounds).toEqual({
      kind: "documentType",
      contractId: CONTRACT_ID,
      documentTypeName: "note",
    });
    expect(group!.disabledAt).toBe(1234);
    expect(group!.bounds).toEqual({ kind: "contractGroup", groupId: OTHER });
  });

  it("returns null for an unknown identity", async () => {
    const { asSdk } = stubSdk();
    await expect(identityPort(asSdk).getIdentityFresh(OWNER)).resolves.toBe(
      null,
    );
  });

  it("turns a null remaining budget into undefined", async () => {
    const { sdk, asSdk } = stubSdk({ budgets: { 3: 42n } });
    const budgets = await identityPort(asSdk).remainingBudgets(OWNER, [3, 4]);
    expect(budgets.get(3)).toBe(42n);
    expect(budgets.has(4)).toBe(true);
    expect(budgets.get(4)).toBeUndefined();
    expect(sdk.identities.keysRemainingBudgets).toHaveBeenCalledWith(
      OWNER,
      [3, 4],
    );
  });

  it("maps contract keys and returns an empty list when there are none", async () => {
    const withKeys = stubSdk({ contractKeys: [grantKey(seed("a"))] });
    const keys = await identityPort(withKeys.asSdk).contractKeys(
      OWNER,
      CONTRACT_ID,
      1,
    );
    expect(keys.map((k) => k.id)).toEqual([3]);
    expect(withKeys.sdk.identities.contractKeys).toHaveBeenCalledWith({
      identityIds: [OWNER],
      contractId: CONTRACT_ID,
      purposes: [1],
    });

    const empty = stubSdk();
    await expect(
      identityPort(empty.asSdk).contractKeys(OWNER, CONTRACT_ID, 1),
    ).resolves.toEqual([]);
    await expect(identityPort(empty.asSdk).groupInfo(OTHER)).resolves.toBe(
      null,
    );
  });
});

describe("responsePort", () => {
  const hash = hash160(pub(seed("app")));
  const base64 = btoa(String.fromCharCode(...hash));
  const doc = {
    ownerId: { toString: () => OWNER },
    properties: {
      walletEphemeralPubKey: new Uint8Array(33).fill(2),
      encryptedPayload: new Uint8Array(60).fill(7),
    },
  };

  it("queries by base64 hash, then by cursor, and normalizes an array", async () => {
    const { sdk, asSdk } = stubSdk({ documents: [doc, undefined] });
    const port = responsePort(asSdk);

    const page = await port.listCandidates(hash, undefined, undefined, 10);
    expect(page).toEqual([
      {
        ownerId: OWNER,
        walletEphemeralPubKey: doc.properties.walletEphemeralPubKey,
        encryptedPayload: doc.properties.encryptedPayload,
      },
    ]);
    expect(sdk.documents.query).toHaveBeenLastCalledWith({
      dataContractId: APP_CONNECT_CONTRACT_ID,
      documentTypeName: "loginKeyResponse",
      where: [["appEphemeralPubKeyHash", "==", base64]],
      orderBy: [["$ownerId", "asc"]],
      limit: 10,
    });

    await port.listCandidates(hash, undefined, OTHER, 5);
    expect(sdk.documents.query.mock.lastCall![0]).toMatchObject({
      where: [
        ["appEphemeralPubKeyHash", "==", base64],
        ["$ownerId", ">", OTHER],
      ],
      limit: 5,
    });
  });

  it("filters by the hint and normalizes a Map with base64 properties", async () => {
    const encoded = {
      ownerId: OWNER,
      properties: {
        walletEphemeralPubKey: btoa(String.fromCharCode(...new Uint8Array(33))),
        encryptedPayload: btoa("payload"),
      },
    };
    const { sdk, asSdk } = stubSdk({
      documents: new Map<string, unknown>([
        ["doc-1", encoded],
        ["doc-2", undefined],
      ]),
    });
    const page = await responsePort(asSdk).listCandidates(
      hash,
      OWNER,
      OTHER,
      10,
    );
    expect(sdk.documents.query.mock.lastCall![0]).toMatchObject({
      where: [
        ["appEphemeralPubKeyHash", "==", base64],
        ["$ownerId", "==", OWNER],
      ],
    });
    expect(page).toHaveLength(1);
    expect(page[0]!.walletEphemeralPubKey).toEqual(new Uint8Array(33));
    expect(new TextDecoder().decode(page[0]!.encryptedPayload)).toBe("payload");
  });
});

describe("newWalletLoginRequest", () => {
  it("builds one HIGH singleContract binding with the default limits", () => {
    const req = newRequest();
    const parsed = parseAppConnectUri(req.uri);

    expect(parsed.network).toBe("testnet");
    expect(parsed.callbackUrl).toBeUndefined();
    expect(parsed.request.label).toBe(APP_CONNECT_LABEL);
    expect(encodeBase58(parsed.request.appId)).toBe(CONTRACT_ID);
    expect(parsed.request.authBindings).toHaveLength(1);
    const [binding] = parsed.request.authBindings;
    expect(binding!.kind).toBe("singleContract");
    expect(encodeBase58(binding!.id)).toBe(CONTRACT_ID);
    expect(binding!.securityLevel).toBe(KeySecurityLevel.HIGH);
    expect(binding!.totalBudget).toBe(DEFAULT_BUDGET_CREDITS);
    expect(binding!.expiresAt).toBe(GRANT_EXPIRES);
    expect(parsed.request.encBindings).toEqual([]);
    expect(parsed.request.connectionId).toEqual(
      seed("connection").slice(0, 16),
    );
    expect(parsed.request.identityHint).toBeUndefined();
    expect(parsed.request.createdAt).toBe(CREATED_AT);

    expect(req.createdAt).toBe(CREATED_AT);
    expect(req.expiresAt).toBe(CREATED_AT + 10 * 60_000);
    expect(req.chainTimeAtCreation).toBe(CHAIN_NOW);
    expect(req.identityHint).toBeNull();
    expect(req.requestHash).toEqual(hash160(req.request.appEphemeralPubKey));
    expect(pub(req.appEphemeralPrivateKey)).toEqual(
      req.request.appEphemeralPubKey,
    );
  });

  it("carries the identity hint and a fresh key each time", () => {
    const req = newRequest(OWNER);
    const parsed = parseAppConnectUri(req.uri);
    expect(encodeBase58(parsed.request.identityHint!)).toBe(OWNER);
    expect(req.identityHint).toBe(OWNER);
    expect(newRequest().appEphemeralPrivateKey).not.toEqual(
      req.appEphemeralPrivateKey,
    );
  });
});

describe("PollTrigger", () => {
  it("resolves after the delay", async () => {
    await expect(new PollTrigger().wait(5)).resolves.toBeUndefined();
  });

  it("wakes a pending wait at once", async () => {
    const trigger = new PollTrigger();
    const waiting = trigger.wait(60_000);
    trigger.fire();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("makes the next wait return at once when fired early", async () => {
    const trigger = new PollTrigger();
    trigger.fire();
    await expect(trigger.wait(60_000)).resolves.toBeUndefined();
  });

  it("rejects with an AbortError on abort", async () => {
    const trigger = new PollTrigger();
    const controller = new AbortController();
    const waiting = trigger.wait(60_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await expect(trigger.wait(60_000, controller.signal)).rejects.toThrow(
      DOMException,
    );
  });
});

describe("awaitWalletAnswer", () => {
  it("returns a verified answer and disposes the request", async () => {
    const req = newRequest();
    const privateKey = seed("granted key");
    const doc = await answerDoc(req, OWNER, privateKey);
    const { asSdk } = stubSdk({
      identities: { [OWNER]: [masterKey, grantKey(privateKey)] },
      budgets: { 3: 9_000_000_000n },
      documents: [doc],
    });
    const statuses: WalletPollStatus[] = [];

    const answer = await awaitWalletAnswer(asSdk, req, {
      settleMs: 0,
      now: () => CREATED_AT + 5_000,
      onStatus: (s) => statuses.push(s),
    });

    expect(answer.identityId).toBe(OWNER);
    const [granted] = answer.grant.authKeys;
    expect(granted!.privateKey).toEqual(privateKey);
    expect(granted!.key.id).toBe(3);
    expect(granted!.remainingBudget).toBe(9_000_000_000n);
    expect(statuses).toEqual(["answered"]);
    expect(req.appEphemeralPrivateKey.every((b) => b === 0)).toBe(true);
  });

  it("ignores answers to other requests and keeps polling", async () => {
    const req = newRequest();
    const other = newRequest();
    const privateKey = seed("granted key");
    const foreign = await answerDoc(other, OTHER, seed("foreign"));
    const ours = await answerDoc(req, OWNER, privateKey);
    let round = 0;
    const { asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(privateKey)] },
      budgets: { 3: 1n },
      query: async () => {
        round += 1;
        if (round === 1) throw new Error("node unavailable");
        return round === 2 ? [foreign] : [foreign, ours];
      },
    });
    const clock = { t: CREATED_AT };
    const statuses: WalletPollStatus[] = [];

    const answer = await awaitWalletAnswer(asSdk, req, {
      settleMs: 0,
      now: () => clock.t,
      trigger: clockTrigger(clock),
      onStatus: (s) => statuses.push(s),
    });

    expect(answer.identityId).toBe(OWNER);
    expect(statuses).toEqual(["incomplete-read", "waiting", "answered"]);
  });

  it("waits out the settle window and notices a second answerer", async () => {
    const req = newRequest();
    const first = await answerDoc(req, OWNER, seed("granted key"));
    const second = await answerDoc(req, OTHER, seed("other key"));
    let round = 0;
    const { asSdk } = stubSdk({
      identities: {
        [OWNER]: [grantKey(seed("granted key"))],
        [OTHER]: [grantKey(seed("other key"))],
      },
      budgets: { 3: 1n },
      query: async () => {
        round += 1;
        return round === 1 ? [first] : byOwner([first, second]);
      },
    });
    const clock = { t: CREATED_AT };

    const error = await awaitWalletAnswer(asSdk, req, {
      settleMs: 3_000,
      now: () => clock.t,
      trigger: clockTrigger(clock),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AmbiguousWalletAnswerError);
    expect((error as AmbiguousWalletAnswerError).identityIds.sort()).toEqual(
      [OWNER, OTHER].sort(),
    );
    expect(req.appEphemeralPrivateKey.every((b) => b === 0)).toBe(true);
  });

  it("returns after the settle window when nobody else answers", async () => {
    const req = newRequest();
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    const { sdk, asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      documents: [doc],
    });
    const clock = { t: CREATED_AT };

    const answer = await awaitWalletAnswer(asSdk, req, {
      settleMs: 3_000,
      now: () => clock.t,
      trigger: clockTrigger(clock),
    });

    expect(answer.identityId).toBe(OWNER);
    expect(sdk.documents.query).toHaveBeenCalledTimes(3);
  });

  it("returns at once for a hinted request", async () => {
    const req = newRequest(OWNER);
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    const { sdk, asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      documents: [doc],
    });

    const answer = await awaitWalletAnswer(asSdk, req, {
      now: () => CREATED_AT + 1_000,
    });

    expect(answer.identityId).toBe(OWNER);
    expect(sdk.documents.query).toHaveBeenCalledTimes(1);
    expect(sdk.documents.query.mock.lastCall![0].where).toContainEqual([
      "$ownerId",
      "==",
      OWNER,
    ]);
  });

  it("refuses a key without the requested limits", async () => {
    const req = newRequest();
    const privateKey = seed("granted key");
    const doc = await answerDoc(req, OWNER, privateKey);
    const { asSdk } = stubSdk({
      identities: {
        [OWNER]: [grantKey(privateKey, { expiresAt: undefined })],
      },
      budgets: { 3: 1n },
      documents: [doc],
    });

    const error = await awaitWalletAnswer(asSdk, req, {
      settleMs: 0,
      now: () => CREATED_AT,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WalletAnswerRefusedError);
    expect((error as WalletAnswerRefusedError).reason).toBe("key-limits");
    expect((error as Error).message).toBe(
      "The key your wallet sent has no spending limit or no expiry.",
    );
  });

  it("gives up before reading once the request has expired", async () => {
    const req = newRequest(OWNER);
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    const { sdk, asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      documents: [doc],
    });

    await expect(
      awaitWalletAnswer(asSdk, req, {
        now: () => CREATED_AT + 10 * 60_000,
      }),
    ).rejects.toBeInstanceOf(RequestExpiredError);
    expect(sdk.documents.query).not.toHaveBeenCalled();
    expect(req.appEphemeralPrivateKey.every((b) => b === 0)).toBe(true);
  });

  it("rejects an answer that only becomes readable after the deadline", async () => {
    const req = newRequest(OWNER);
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    const clock = { t: req.expiresAt - 1_000 };
    const { sdk, asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      query: async () => (clock.t >= req.expiresAt ? [doc] : []),
    });

    await expect(
      awaitWalletAnswer(asSdk, req, {
        now: () => clock.t,
        trigger: clockTrigger(clock),
      }),
    ).rejects.toBeInstanceOf(RequestExpiredError);
    expect(sdk.documents.query).toHaveBeenCalledTimes(1);
  });

  it("reports a slow read while a round's reads hang", async () => {
    const req = newRequest(OWNER);
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    const { asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      query: () =>
        new Promise((resolve) => setTimeout(() => resolve([doc]), 40)),
    });
    const statuses: WalletPollStatus[] = [];

    await awaitWalletAnswer(asSdk, req, {
      slowReadMs: 5,
      onStatus: (s) => statuses.push(s),
    });

    expect(statuses).toEqual(["slow-read", "answered"]);
  });

  it("rejects an answer whose read straddled the deadline", async () => {
    const req = newRequest(OWNER);
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    const clock = { t: req.expiresAt - 1_000 };
    const { asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      query: async () => {
        clock.t = req.expiresAt + 1;
        return [doc];
      },
    });

    await expect(
      awaitWalletAnswer(asSdk, req, {
        now: () => clock.t,
        trigger: clockTrigger(clock),
      }),
    ).rejects.toBeInstanceOf(RequestExpiredError);
  });

  it("returns an unhinted answer only on a complete round after the settle window", async () => {
    const req = newRequest();
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    let round = 0;
    const { sdk, asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      query: async () => {
        round += 1;
        if (round === 2 || round === 3) throw new Error("node unavailable");
        return [doc];
      },
    });
    const clock = { t: CREATED_AT, waits: [] as number[] };
    const statuses: WalletPollStatus[] = [];

    const answer = await awaitWalletAnswer(asSdk, req, {
      settleMs: 3_000,
      now: () => clock.t,
      trigger: clockTrigger(clock),
      onStatus: (s) => statuses.push(s),
    });

    expect(answer.identityId).toBe(OWNER);
    expect(sdk.documents.query).toHaveBeenCalledTimes(4);
    expect(statuses).toEqual([
      "answered",
      "incomplete-read",
      "incomplete-read",
      "answered",
    ]);
    expect(clock.waits).toEqual([2_000, 2_000, 2_000]);
  });

  it("treats a failed identity read as an incomplete round", async () => {
    const req = newRequest(OWNER);
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    const { sdk, asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      documents: [doc],
    });
    sdk.identities.fetchWithProof.mockRejectedValueOnce(new Error("timeout"));
    const clock = { t: CREATED_AT };
    const statuses: WalletPollStatus[] = [];

    const answer = await awaitWalletAnswer(asSdk, req, {
      now: () => clock.t,
      trigger: clockTrigger(clock),
      onStatus: (s) => statuses.push(s),
    });

    expect(answer.identityId).toBe(OWNER);
    expect(statuses).toEqual(["incomplete-read", "answered"]);
  });

  it("waits the protocol delay after a failed read", async () => {
    const req = newRequest(OWNER);
    const doc = await answerDoc(req, OWNER, seed("granted key"));
    let round = 0;
    const { asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 1n },
      query: async () => {
        round += 1;
        if (round < 3) throw new Error("node unavailable");
        return [doc];
      },
    });
    const clock = { t: CREATED_AT + 59_000, waits: [] as number[] };

    const answer = await awaitWalletAnswer(asSdk, req, {
      now: () => clock.t,
      trigger: clockTrigger(clock),
    });

    expect(answer.identityId).toBe(OWNER);
    expect(clock.waits).toEqual([2_000, 4_000]);
  });

  it("caps distinct answering identities across rounds", async () => {
    const req = newRequest();
    let round = 0;
    const { sdk, asSdk } = stubSdk({
      query: async () => {
        round += 1;
        return [spamDoc(`republished ${round}`)];
      },
    });
    const clock = { t: CREATED_AT };

    await expect(
      awaitWalletAnswer(asSdk, req, {
        now: () => clock.t,
        trigger: clockTrigger(clock),
      }),
    ).rejects.toBeInstanceOf(TooManyAnswersError);
    expect(sdk.documents.query).toHaveBeenCalledTimes(21);
  });

  it("stops when the read is truncated by spam", async () => {
    const req = newRequest();
    const docs = Array.from({ length: 21 }, (_, i) =>
      spamDoc(`spam ${String(i).padStart(2, "0")}`),
    );
    byOwner(docs);
    const { asSdk } = stubSdk({
      query: async (args) => {
        const after = args.where?.find((w) => w[1] === ">")?.[2];
        const start = after
          ? docs.findIndex((d) => d.ownerId === after) + 1
          : 0;
        return docs.slice(start, start + 10);
      },
    });

    await expect(
      awaitWalletAnswer(asSdk, req, { now: () => CREATED_AT }),
    ).rejects.toBeInstanceOf(TooManyAnswersError);
  });

  it("rejects with an AbortError when aborted", async () => {
    const req = newRequest();
    const { asSdk } = stubSdk();
    const controller = new AbortController();
    controller.abort();

    await expect(
      awaitWalletAnswer(asSdk, req, {
        signal: controller.signal,
        now: () => CREATED_AT,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(req.appEphemeralPrivateKey.every((b) => b === 0)).toBe(true);
  });
});

function testGrant(privateKey: Uint8Array): AppConnectGrant {
  return {
    identityId: OWNER,
    authKeys: [
      {
        role: "singleContract",
        bindingIndex: 0,
        privateKey,
        key: {
          id: 3,
          type: 0,
          purpose: 0,
          securityLevel: KeySecurityLevel.HIGH,
          data: pub(seed("granted key")),
          bounds: { kind: "singleContract", contractId: CONTRACT_ID },
          totalBudget: DEFAULT_BUDGET_CREDITS,
          expiresAt: GRANT_EXPIRES,
        },
        remainingBudget: 7n,
      },
    ],
    encryptionKeys: [],
  };
}

describe("loginWithWalletAnswer", () => {
  const FRESH_EXPIRES = GRANT_EXPIRES - 86_400_000;

  it("logs in with the granted key as a WIF and wipes it", async () => {
    const privateKey = seed("granted key").slice();
    const { sdk, asSdk } = stubSdk({
      identities: {
        [OWNER]: [
          masterKey,
          grantKey(seed("granted key"), { expiresAt: BigInt(FRESH_EXPIRES) }),
        ],
      },
      budgets: { 3: 55n },
    });

    const login = await loginWithWalletAnswer(asSdk, {
      identityId: OWNER,
      grant: testGrant(privateKey),
    });

    expect(fromBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "testnet");
    expect(fromBytes.mock.lastCall![0]).toHaveLength(32);
    expect(loginWithPrivateKey).toHaveBeenCalledWith(asSdk, "cWIF", OWNER);
    expect(login.identityId).toBe(OWNER);
    expect(login.auth).toEqual({
      identity: { id: OWNER },
      identityKey: { keyId: 3 },
      signer: { kind: "signer" },
    });
    expect(sdk.identities.fetchWithProof).toHaveBeenCalledWith(OWNER);
    expect(sdk.identities.keysRemainingBudgets).toHaveBeenCalledWith(
      OWNER,
      [3],
    );
    expect(login.grant).toEqual({
      keyId: 3,
      contractId: CONTRACT_ID,
      totalBudget: DEFAULT_BUDGET_CREDITS,
      remainingBudget: 55n,
      expiresAt: FRESH_EXPIRES,
    });
    expect(privateKey.every((b) => b === 0)).toBe(true);
  });

  it.each([
    {
      name: "a key that now expires within the hour",
      reason: "key-expired",
      keys: [grantKey(seed("granted key"))],
      budgets: { 3: 55n },
      chainTimeMs: BigInt(GRANT_EXPIRES - 60 * 60_000),
    },
    {
      name: "a spent allowance",
      reason: "budget-exhausted",
      keys: [grantKey(seed("granted key"))],
      budgets: { 3: 0n },
    },
    {
      name: "an unreadable allowance",
      reason: "budget-unknown",
      keys: [grantKey(seed("granted key"))],
      budgets: {},
    },
    {
      name: "a disabled key",
      reason: "key-disabled",
      keys: [grantKey(seed("granted key"), { disabledAt: 5n })],
      budgets: { 3: 55n },
    },
    {
      name: "a key that is gone",
      reason: "key-disabled",
      keys: [masterKey],
      budgets: {},
    },
    {
      name: "a key bound to another contract",
      reason: "key-unmatched",
      keys: [
        grantKey(seed("granted key"), {
          contractBounds: {
            contractBoundsType: "singleContract",
            identifier: OTHER,
          },
        }),
      ],
      budgets: { 3: 55n },
    },
  ])("refuses $name when the user confirms", async (c) => {
    vi.mocked(loginWithPrivateKey).mockClear();
    fromBytes.mockClear();
    const privateKey = seed("granted key").slice();
    const { asSdk } = stubSdk({
      identities: { [OWNER]: c.keys },
      budgets: c.budgets,
      chainTimeMs: c.chainTimeMs,
    });

    const error = await loginWithWalletAnswer(asSdk, {
      identityId: OWNER,
      grant: testGrant(privateKey),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WalletAnswerRefusedError);
    expect((error as WalletAnswerRefusedError).reason).toBe(c.reason);
    expect(fromBytes).not.toHaveBeenCalled();
    expect(loginWithPrivateKey).not.toHaveBeenCalled();
    expect(privateKey.every((b) => b === 0)).toBe(true);
  });

  it("wipes the key when the login fails", async () => {
    vi.mocked(loginWithPrivateKey).mockRejectedValueOnce(new Error("nope"));
    const privateKey = seed("granted key").slice();
    const { asSdk } = stubSdk({
      identities: { [OWNER]: [grantKey(seed("granted key"))] },
      budgets: { 3: 55n },
    });

    await expect(
      loginWithWalletAnswer(asSdk, {
        identityId: OWNER,
        grant: testGrant(privateKey),
      }),
    ).rejects.toThrow("nope");
    expect(privateKey.every((b) => b === 0)).toBe(true);
  });
});

describe("loginWithWalletAnswer persist hook", () => {
  const FRESH_EXPIRES = GRANT_EXPIRES - 86_400_000;

  it("hands the checked grant and the key bytes to persist before wiping them", async () => {
    const privateKey = seed("granted key").slice();
    const { asSdk } = stubSdk({
      identities: {
        [OWNER]: [
          grantKey(seed("granted key"), { expiresAt: BigInt(FRESH_EXPIRES) }),
        ],
      },
      budgets: { 3: 55n },
    });
    const seen: { grant: unknown; bytes: Uint8Array }[] = [];
    const persist = vi.fn(async (grant: unknown, bytes: Uint8Array) => {
      seen.push({ grant, bytes: bytes.slice() });
    });

    await loginWithWalletAnswer(
      asSdk,
      { identityId: OWNER, grant: testGrant(privateKey) },
      { persist },
    );

    expect(persist).toHaveBeenCalledTimes(1);
    expect(seen[0]!.grant).toEqual({
      keyId: 3,
      contractId: CONTRACT_ID,
      totalBudget: DEFAULT_BUDGET_CREDITS,
      remainingBudget: 55n,
      expiresAt: FRESH_EXPIRES,
    });
    expect(seen[0]!.bytes).toEqual(seed("granted key"));
    expect(privateKey.every((b) => b === 0)).toBe(true);
  });

  it("does not persist a refused key, and a failing persist still wipes", async () => {
    const refused = seed("granted key").slice();
    const persist = vi.fn(async () => {});
    const { asSdk: refusing } = stubSdk({
      identities: {
        [OWNER]: [grantKey(seed("granted key"), { disabledAt: 5n })],
      },
    });
    await expect(
      loginWithWalletAnswer(
        refusing,
        { identityId: OWNER, grant: testGrant(refused) },
        { persist },
      ),
    ).rejects.toBeInstanceOf(WalletAnswerRefusedError);
    expect(persist).not.toHaveBeenCalled();

    const failing = seed("granted key").slice();
    const { asSdk } = stubSdk({
      identities: {
        [OWNER]: [
          grantKey(seed("granted key"), { expiresAt: BigInt(FRESH_EXPIRES) }),
        ],
      },
      budgets: { 3: 55n },
    });
    await expect(
      loginWithWalletAnswer(
        asSdk,
        { identityId: OWNER, grant: testGrant(failing) },
        {
          persist: async () => {
            throw new Error("storage blocked");
          },
        },
      ),
    ).rejects.toThrow("storage blocked");
    expect(failing.every((b) => b === 0)).toBe(true);
  });

  it("does not persist a key whose sign-in failed", async () => {
    const privateKey = seed("granted key").slice();
    const persist = vi.fn(async () => {});
    const { asSdk } = stubSdk({
      identities: {
        [OWNER]: [
          grantKey(seed("granted key"), { expiresAt: BigInt(FRESH_EXPIRES) }),
        ],
      },
      budgets: { 3: 55n },
    });
    vi.mocked(loginWithPrivateKey).mockRejectedValueOnce(
      new Error("identity read failed"),
    );

    await expect(
      loginWithWalletAnswer(
        asSdk,
        { identityId: OWNER, grant: testGrant(privateKey) },
        { persist },
      ),
    ).rejects.toThrow("identity read failed");
    expect(persist).not.toHaveBeenCalled();
    expect(privateKey.every((b) => b === 0)).toBe(true);
  });
});

describe("restoreWalletLogin", () => {
  const FRESH_EXPIRES = GRANT_EXPIRES - 86_400_000;
  const stored = { identityId: OWNER, keyId: 3, contractId: CONTRACT_ID };

  it("signs in again with a kept key that can still write", async () => {
    const privateKey = seed("granted key").slice();
    const { asSdk } = stubSdk({
      identities: {
        [OWNER]: [
          grantKey(seed("granted key"), { expiresAt: BigInt(FRESH_EXPIRES) }),
        ],
      },
      budgets: { 3: 55n },
    });

    const result = await restoreWalletLogin(asSdk, stored, privateKey);

    expect(result?.renewNeeded).toBe(false);
    expect(result?.login.identityId).toBe(OWNER);
    expect(result?.login.grant.remainingBudget).toBe(55n);
    expect(loginWithPrivateKey).toHaveBeenCalledWith(asSdk, "cWIF", OWNER);
    expect(privateKey.every((b) => b === 0)).toBe(true);
  });

  it.each([
    {
      name: "an expiring key",
      keys: [grantKey(seed("granted key"))],
      budgets: { 3: 55n },
      chainTimeMs: BigInt(GRANT_EXPIRES - 60 * 60_000),
    },
    {
      name: "a spent allowance",
      keys: [grantKey(seed("granted key"))],
      budgets: { 3: 0n },
    },
  ])("restores $name but asks for a renewal", async (c) => {
    const privateKey = seed("granted key").slice();
    const { asSdk } = stubSdk({
      identities: { [OWNER]: c.keys },
      budgets: c.budgets,
      ...(c.chainTimeMs ? { chainTimeMs: c.chainTimeMs } : {}),
    });

    const result = await restoreWalletLogin(asSdk, stored, privateKey);

    expect(result?.renewNeeded).toBe(true);
    expect(result?.login.identityId).toBe(OWNER);
    expect(privateKey.every((b) => b === 0)).toBe(true);
  });

  it.each([
    {
      name: "a disabled key",
      keys: [grantKey(seed("granted key"), { disabledAt: 5n })],
    },
    { name: "a key that is gone", keys: [masterKey] },
    {
      name: "a key bound to another contract",
      keys: [
        grantKey(seed("granted key"), {
          contractBounds: {
            contractBoundsType: "singleContract",
            identifier: { toString: () => OTHER },
          },
        }),
      ],
    },
  ])("forgets $name", async (c) => {
    const privateKey = seed("granted key").slice();
    const { asSdk } = stubSdk({
      identities: { [OWNER]: c.keys },
      budgets: { 3: 55n },
    });

    expect(await restoreWalletLogin(asSdk, stored, privateKey)).toBeNull();
    expect(loginWithPrivateKey).not.toHaveBeenCalledWith(asSdk, "cWIF", OWNER);
    expect(privateKey.every((b) => b === 0)).toBe(true);
  });
});

describe("readWalletGrant", () => {
  it("reads the key's limits and remaining budget", async () => {
    const { asSdk } = stubSdk({
      identities: { [OWNER]: [masterKey, grantKey(seed("granted key"))] },
      budgets: { 3: 123n },
    });
    await expect(readWalletGrant(asSdk, OWNER, 3)).resolves.toEqual({
      keyId: 3,
      contractId: CONTRACT_ID,
      totalBudget: DEFAULT_BUDGET_CREDITS,
      remainingBudget: 123n,
      expiresAt: GRANT_EXPIRES,
    });
  });

  it("returns null when the key is missing or disabled", async () => {
    const { asSdk } = stubSdk({
      identities: {
        [OWNER]: [grantKey(seed("granted key"), { disabledAt: 5n })],
      },
    });
    await expect(readWalletGrant(asSdk, OWNER, 3)).resolves.toBeNull();
    await expect(readWalletGrant(asSdk, OWNER, 9)).resolves.toBeNull();
    await expect(readWalletGrant(asSdk, OTHER, 3)).resolves.toBeNull();
  });
});

describe("classifyWalletWriteError", () => {
  it("maps key-ring consensus codes to renew or logout", () => {
    expect(classifyWalletWriteError({ code: 20015 })).toBe("renew");
    expect(classifyWalletWriteError({ code: 20006 })).toBe("logout");
    expect(classifyWalletWriteError({ code: 40105 })).toBeNull();
    expect(classifyWalletWriteError({ code: 20013 })).toBeNull();
  });

  it("reads a WasmSdkError-shaped object and nested codes", () => {
    expect(
      classifyWalletWriteError({ code: 40218, message: "insufficient" }),
    ).toBe("renew");
    expect(
      classifyWalletWriteError({ code: -1, consensusError: { code: 20003 } }),
    ).toBe("logout");
    expect(classifyWalletWriteError({ cause: { code: 20016 } })).toBe("renew");
    expect(
      classifyWalletWriteError({ code: -1, message: "timeout" }),
    ).toBeNull();
  });

  it("finds the code in the message only next to the word code", () => {
    expect(
      classifyWalletWriteError(
        new Error("Identity key 3 budget exhausted (code 20015)"),
      ),
    ).toBe("renew");
    expect(
      classifyWalletWriteError(new Error("consensus error code: 20016")),
    ).toBe("renew");
    expect(
      classifyWalletWriteError(
        new Error("Document revision 20006 does not match the stored one"),
      ),
    ).toBeNull();
    expect(classifyWalletWriteError(new Error("code -20006"))).toBeNull();
    expect(classifyWalletWriteError(new Error("timeout"))).toBeNull();
    expect(classifyWalletWriteError(null)).toBeNull();
  });
});
