/**
 * Sign in with a DashPay mobile wallet (App Connect v2).
 *
 * SDK methods: sdk.contracts.fetchWithProof (chain clock), sdk.documents.query
 * on the App Connect system contract (the wallet's answer),
 * sdk.identities.fetchWithProof / keysRemainingBudgets / contractKeys (the
 * granted key, verified on chain).
 *
 * The protocol itself is the vendored module under src/vendor/platform-auth.
 * This file is the Evo SDK side of it: the two ports the verifier and poller
 * read through, the request Dashnote makes, the poll loop, and the step that
 * turns a verified grant into the same one-key session a pasted WIF gives.
 *
 * This file is only ever loaded through a dynamic import (see the load-anchor
 * rules in CLAUDE.md): it pulls in loginWithPrivateKey, which has top-level
 * @dashevo/evo-sdk value imports.
 */
import * as secp256k1 from "@noble/secp256k1";
import {
  APP_CONNECT_EXPIRY_MARGIN_MS,
  APP_CONNECT_MAX_CANDIDATES,
  APP_CONNECT_MAX_REQUEST_AGE_MS,
  KeySecurityLevel,
  appConnectCandidateKey,
  appConnectPollDelayMs,
  appConnectRequestHash,
  buildAppConnectUri,
  classifyAppConnectError,
  listAppConnectCandidates,
  verifyAppConnectCandidate,
} from "../vendor/platform-auth/app-connect";
import type {
  AppConnectCandidate,
  AppConnectGrant,
  AppConnectIdentityKey,
  AppConnectIdentityPort,
  AppConnectKeyBounds,
  AppConnectRequest,
  AppConnectResponsePort,
  AppConnectRejectReason,
} from "../vendor/platform-auth/app-connect";
import { decodeBase58 } from "../vendor/platform-auth/app-connect/primitives";
import { loginWithPrivateKey } from "./loginWithPrivateKey";
import { loadSdkModule } from "./sdkModule";
import type { DashAuth, DashSdk } from "./types";

/** The App Connect system contract: where wallets publish `loginKeyResponse`. */
export const APP_CONNECT_CONTRACT_ID =
  "H8F9mP1BM55TE1ShsxPZHzhyinaMdY9bMmP85mkDhcJJ";
/** The name a wallet shows on its approval sheet. */
export const APP_CONNECT_LABEL = "Dashnote";
/** The response contract and limited keys exist from protocol 14. */
export const APP_CONNECT_MIN_PROTOCOL = 14;
/** Proposed lifetime allowance: 0.1 DASH in credits (a wallet preset). */
export const DEFAULT_BUDGET_CREDITS = 10_000_000_000n;
/** Proposed key lifetime. */
export const DEFAULT_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export const NETWORK = "testnet" as const;

export interface ChainClock {
  /** Latest block time, ms. */
  timeMs: number;
  protocolVersion: number;
}

/** Chain time and protocol version, from a proved read of `contractId`. */
export async function readChainClock(
  sdk: DashSdk,
  contractId: string,
): Promise<ChainClock> {
  const result = await sdk.contracts.fetchWithProof(contractId);
  return {
    timeMs: Number(result.metadata.timeMs),
    protocolVersion: result.metadata.protocolVersion,
  };
}

export interface WalletLoginRequest {
  request: AppConnectRequest;
  /** What the QR code and the "Open in DashPay" link carry. */
  uri: string;
  /** hash160(appEphemeralPubKey): what answers are stored under. */
  requestHash: Uint8Array;
  /** `CREATED_AT`, this device's clock (ms). */
  createdAt: number;
  /** When the poll gives up: the protocol's 10 minutes after `createdAt`. */
  expiresAt: number;
  /** Chain time at creation; the verifier's clock is this plus elapsed time. */
  chainTimeAtCreation: number;
  /** The identity a renewal is for (`IDENTITY_HINT`); null for a sign-in. */
  identityHint: string | null;
  /** Memory only; zeroed by {@link disposeWalletLoginRequest}. */
  appEphemeralPrivateKey: Uint8Array;
}

/**
 * A fresh request: one HIGH authentication key bound to `contractId` (which
 * is also the app id), with the default allowance and lifetime proposed.
 */
export function newWalletLoginRequest(params: {
  contractId: string;
  connectionId: Uint8Array;
  chainNow: number;
  identityHint?: string;
  now?: number;
}): WalletLoginRequest {
  const { contractId, connectionId, chainNow, identityHint } = params;
  const createdAt = params.now ?? Date.now();
  const appEphemeralPrivateKey = secp256k1.utils.randomSecretKey();
  const request: AppConnectRequest = {
    appEphemeralPubKey: secp256k1.getPublicKey(appEphemeralPrivateKey, true),
    appId: decodeBase58(contractId),
    label: APP_CONNECT_LABEL,
    authBindings: [
      {
        kind: "singleContract",
        id: decodeBase58(contractId),
        securityLevel: KeySecurityLevel.HIGH,
        totalBudget: DEFAULT_BUDGET_CREDITS,
        expiresAt: chainNow + DEFAULT_LIFETIME_MS,
      },
    ],
    encBindings: [],
    createdAt,
    connectionId,
  };
  if (identityHint) request.identityHint = decodeBase58(identityHint);

  return {
    request,
    uri: buildAppConnectUri(request, NETWORK),
    requestHash: appConnectRequestHash(request),
    createdAt,
    expiresAt: createdAt + APP_CONNECT_MAX_REQUEST_AGE_MS,
    chainTimeAtCreation: chainNow,
    identityHint: identityHint ?? null,
    appEphemeralPrivateKey,
  };
}

export function disposeWalletLoginRequest(req: WalletLoginRequest): void {
  req.appEphemeralPrivateKey.fill(0);
}

function abortError(): DOMException {
  return new DOMException("cancelled", "AbortError");
}

/** Cuts a poll's wait short, e.g. when the tab regains focus. */
export class PollTrigger {
  private pending = false;
  private wake: (() => void) | null = null;

  fire(): void {
    if (this.wake) this.wake();
    else this.pending = true;
  }

  wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      if (this.pending) {
        this.pending = false;
        resolve();
        return;
      }
      const settle = (aborted: boolean) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (this.wake === onWake) this.wake = null;
        if (aborted) reject(abortError());
        else resolve();
      };
      const onWake = () => settle(false);
      const onAbort = () => settle(true);
      const timer = setTimeout(onWake, ms);
      this.wake = onWake;
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export type WalletPollStatus =
  | "waiting"
  | "answered"
  | "incomplete-read"
  | "slow-read";

/** A round's reads taking longer than this are reported as `slow-read`. */
export const SLOW_READ_MS = 10_000;

export class RequestExpiredError extends Error {
  constructor() {
    super("No answer from your wallet yet. Start again for a fresh code.");
    this.name = "RequestExpiredError";
  }
}

export class TooManyAnswersError extends Error {
  constructor() {
    super("Too many answers arrived for this request. Start again.");
    this.name = "TooManyAnswersError";
  }
}

export class AmbiguousWalletAnswerError extends Error {
  identityIds: string[];

  constructor(identityIds: string[]) {
    super(
      "More than one identity answered this request, so none was used. Start again.",
    );
    this.name = "AmbiguousWalletAnswerError";
    this.identityIds = identityIds;
  }
}

const REFUSAL_MESSAGES: Partial<Record<AppConnectRejectReason, string>> = {
  "invalid-key": "Your wallet sent a key that is not valid.",
  "key-disabled": "The key your wallet sent is already disabled.",
  "key-master": "Your wallet sent a master key; Dashnote never accepts one.",
  "key-purpose": "The key your wallet sent is not an authentication key.",
  "key-type": "The key your wallet sent has a type Dashnote cannot sign with.",
  "key-unbound": "The key your wallet sent is not limited to Dashnote.",
  "key-unmatched": "The key your wallet sent is limited to another app.",
  "key-level": "The key your wallet sent has the wrong security level.",
  "key-limits": "The key your wallet sent has no spending limit or no expiry.",
  "key-expired": "The key your wallet sent expires too soon.",
  "budget-exhausted": "The key your wallet sent has no allowance left.",
  "budget-unknown":
    "The allowance left on your wallet's key could not be read.",
  "duplicate-binding": "Your wallet sent the same key twice.",
  "primary-missing": "Your wallet did not send a key for Dashnote.",
};

export class WalletAnswerRefusedError extends Error {
  reason: AppConnectRejectReason;

  constructor(reason: AppConnectRejectReason) {
    super(
      REFUSAL_MESSAGES[reason] ??
        `Your wallet's answer could not be used (${reason}).`,
    );
    this.name = "WalletAnswerRefusedError";
    this.reason = reason;
  }
}

export interface WalletAnswer {
  identityId: string;
  grant: AppConnectGrant;
}

// Rejections that mean "this response is for some other request".
const NOT_AN_ANSWER: ReadonlySet<AppConnectRejectReason> = new Set([
  "decrypt",
  "framing",
  "hint-mismatch",
]);

function wipeGrant(grant: AppConnectGrant): void {
  for (const granted of [...grant.authKeys, ...grant.encryptionKeys]) {
    granted.privateKey.fill(0);
  }
}

/**
 * Polls the App Connect contract until one identity's answer verifies, then
 * returns it. Rejects with RequestExpiredError after 10 minutes, with
 * AmbiguousWalletAnswerError when two identities answered, with
 * TooManyAnswersError past 20 answering identities, with
 * WalletAnswerRefusedError when the only answer is unusable, and with an
 * AbortError DOMException on `signal`. An answer is only accepted on a round
 * whose read was complete: at once with an identity hint, otherwise once
 * `settleMs` has passed since it first appeared.
 */
export async function awaitWalletAnswer(
  sdk: DashSdk,
  req: WalletLoginRequest,
  options: {
    signal?: AbortSignal;
    trigger?: PollTrigger;
    onStatus?: (status: WalletPollStatus) => void;
    settleMs?: number;
    now?: () => number;
    slowReadMs?: number;
  } = {},
): Promise<WalletAnswer> {
  const {
    signal,
    onStatus,
    settleMs = 3000,
    now = Date.now,
    slowReadMs = SLOW_READ_MS,
  } = options;
  const trigger = options.trigger ?? new PollTrigger();
  const responses = responsePort(sdk);
  const identity = identityPort(sdk);
  const hint = req.identityHint ?? undefined;

  const decided = new Set<string>();
  const owners = new Set<string>();
  const responders = new Set<string>();
  const answers = new Map<string, WalletAnswer | WalletAnswerRefusedError>();
  let returned: WalletAnswer | null = null;
  let firstAnswerAt: number | null = null;

  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const delay = appConnectPollDelayMs(now() - req.createdAt);
      if (delay === null || now() >= req.expiresAt) {
        throw new RequestExpiredError();
      }

      // One timer for the whole round: a node that hangs on any of its reads
      // shows as slow, and the SDK moves on to another node by itself.
      const slowTimer = setTimeout(() => onStatus?.("slow-read"), slowReadMs);
      let complete: boolean;
      try {
        const page = await listAppConnectCandidates(
          responses,
          req.requestHash,
          hint ? { hint } : {},
        ).catch(() => null);
        if (signal?.aborted) throw abortError();
        if (page?.truncated) throw new TooManyAnswersError();
        complete = page !== null;

        for (const candidate of page?.candidates ?? []) {
          // Owners can delete and republish between polls, so the cap spans rounds.
          owners.add(candidate.ownerId);
          if (owners.size > APP_CONNECT_MAX_CANDIDATES) {
            throw new TooManyAnswersError();
          }
          const key = appConnectCandidateKey(candidate);
          if (decided.has(key)) continue;
          const verdict = await verifyAppConnectCandidate({
            request: req.request,
            appEphemeralPrivateKey: req.appEphemeralPrivateKey,
            candidate,
            identity,
            now: req.chainTimeAtCreation + (now() - req.createdAt),
          }).catch(() => null);
          if (signal?.aborted) {
            // Not recorded yet, so the finally below would not wipe it.
            if (verdict?.ok) wipeGrant(verdict.grant);
            throw abortError();
          }
          if (verdict && !verdict.ok && NOT_AN_ANSWER.has(verdict.reason)) {
            decided.add(key);
            continue;
          }
          // Past decryption, so this identity did answer this request.
          responders.add(candidate.ownerId);
          if (verdict === null) {
            complete = false;
            continue;
          }
          if (!verdict.ok && verdict.retryable) {
            // The node lags the wallet: this round settles nothing.
            complete = false;
            continue;
          }
          decided.add(key);
          const previous = answers.get(candidate.ownerId);
          if (previous && !(previous instanceof Error)) {
            wipeGrant(previous.grant);
          }
          answers.set(
            candidate.ownerId,
            verdict.ok
              ? { identityId: candidate.ownerId, grant: verdict.grant }
              : new WalletAnswerRefusedError(verdict.reason),
          );
        }
      } finally {
        clearTimeout(slowTimer);
      }

      if (responders.size > 1) {
        throw new AmbiguousWalletAnswerError([...responders]);
      }

      const answer = answers.values().next().value;
      if (answer && complete && firstAnswerAt === null) firstAnswerAt = now();
      onStatus?.(
        !complete ? "incomplete-read" : answer ? "answered" : "waiting",
      );

      const settled =
        answer !== undefined &&
        complete &&
        (hint !== undefined || now() - (firstAnswerAt ?? 0) >= settleMs);
      // The reads above may have straddled the deadline.
      if (now() >= req.expiresAt) throw new RequestExpiredError();
      if (answer && settled) {
        if (answer instanceof Error) throw answer;
        returned = answer;
        return answer;
      }

      await trigger.wait(delay, signal);
    }
  } finally {
    for (const answer of answers.values()) {
      if (answer !== returned && !(answer instanceof Error)) {
        wipeGrant(answer.grant);
      }
    }
    disposeWalletLoginRequest(req);
  }
}

/** What the wallet granted, as the Settings panel shows it. */
export interface WalletGrant {
  keyId: number;
  contractId: string;
  totalBudget: bigint | null;
  remainingBudget: bigint | null;
  /** Block time, ms. */
  expiresAt: number | null;
}

export interface WalletLogin {
  identityId: string;
  auth: DashAuth;
  grant: WalletGrant;
}

function boundContractId(bounds: AppConnectKeyBounds | undefined): string {
  if (!bounds || bounds.kind === "contractGroup") return "";
  return bounds.contractId;
}

/** One key of an identity as a proved read sees it, with the block time. */
interface KeyReading {
  key: AppConnectIdentityKey | null;
  remainingBudget: bigint | null;
  /** Latest block time, ms. */
  chainTimeMs: number;
}

async function readIdentityKey(
  sdk: DashSdk,
  identityId: string,
  keyId: number,
): Promise<KeyReading> {
  const { data, metadata } = await sdk.identities.fetchWithProof(identityId);
  const chainTimeMs = Number(metadata.timeMs);
  const raw = (data?.publicKeys as unknown as SdkKey[] | undefined)?.find(
    (k) => k.keyId === keyId,
  );
  if (!raw) return { key: null, remainingBudget: null, chainTimeMs };
  const key = toIdentityKey(raw);
  let remainingBudget: bigint | null = null;
  if (key.disabledAt === undefined && key.totalBudget !== undefined) {
    const budgets = await sdk.identities.keysRemainingBudgets(identityId, [
      keyId,
    ]);
    remainingBudget = budgets.get(keyId) ?? null;
  }
  return { key, remainingBudget, chainTimeMs };
}

function toWalletGrant(
  key: AppConnectIdentityKey,
  remainingBudget: bigint | null,
): WalletGrant {
  return {
    keyId: key.id,
    contractId: boundContractId(key.bounds),
    totalBudget: key.totalBudget ?? null,
    remainingBudget,
    expiresAt: key.expiresAt ?? null,
  };
}

/** How a wallet key stands on chain right now. */
type WalletKeyStanding =
  | { kind: "usable"; grant: WalletGrant; renewNeeded: boolean }
  | { kind: "refused"; reason: AppConnectRejectReason };

/**
 * Reads the key fresh with a proved fetch and says whether it can still sign
 * for `contractId`. `renewNeeded` is set when it is within an hour of expiry
 * or has no allowance left: reads still work, writes will not.
 */
async function checkWalletKey(
  sdk: DashSdk,
  identityId: string,
  keyId: number,
  contractId: string,
): Promise<WalletKeyStanding> {
  const { key, remainingBudget, chainTimeMs } = await readIdentityKey(
    sdk,
    identityId,
    keyId,
  );
  if (!key || key.disabledAt !== undefined) {
    return { kind: "refused", reason: "key-disabled" };
  }
  if (
    key.bounds?.kind !== "singleContract" ||
    key.bounds.contractId !== contractId
  ) {
    return { kind: "refused", reason: "key-unmatched" };
  }
  const expiring =
    key.expiresAt !== undefined &&
    key.expiresAt - chainTimeMs <= APP_CONNECT_EXPIRY_MARGIN_MS;
  const spent =
    key.totalBudget !== undefined &&
    (remainingBudget === null || remainingBudget <= 0n);
  return {
    kind: "usable",
    grant: toWalletGrant(key, remainingBudget),
    renewNeeded: expiring || spent,
  };
}

async function signInWithWalletKey(
  sdk: DashSdk,
  identityId: string,
  privateKey: Uint8Array,
  grant: WalletGrant,
): Promise<WalletLogin> {
  const { PrivateKey } = await loadSdkModule();
  const wif = PrivateKey.fromBytes(privateKey, NETWORK).toWIF();
  const resolved = await loginWithPrivateKey(sdk, wif, identityId);
  const { identityId: resolvedId, ...auth } = resolved;
  return { identityId: resolvedId, auth, grant };
}

export interface LoginWithWalletAnswerOptions {
  /**
   * Called with the accepted key before it is wiped, so the app can keep it
   * for the next reload. Runs after the on-chain checks; its errors propagate.
   */
  persist?: (grant: WalletGrant, privateKey: Uint8Array) => Promise<void>;
}

/**
 * Turns a verified answer into a one-key session via loginWithPrivateKey,
 * exactly as a pasted WIF does, and wipes the grant's private key bytes.
 * The "Is this you?" step can stay open for any time, so the key is read
 * again first and refused if it has since been disabled, run out or come
 * within an hour of expiring.
 */
export async function loginWithWalletAnswer(
  sdk: DashSdk,
  answer: WalletAnswer,
  options: LoginWithWalletAnswerOptions = {},
): Promise<WalletLogin> {
  const { grant } = answer;
  try {
    const granted = grant.authKeys[0];
    if (!granted) throw new Error("The wallet's answer carries no key.");
    const standing = await checkWalletKey(
      sdk,
      answer.identityId,
      granted.key.id,
      boundContractId(granted.key.bounds),
    );
    if (standing.kind === "refused") {
      throw new WalletAnswerRefusedError(standing.reason);
    }
    if (standing.renewNeeded) {
      const reason: AppConnectRejectReason =
        standing.grant.remainingBudget !== null &&
        standing.grant.remainingBudget <= 0n
          ? "budget-exhausted"
          : standing.grant.totalBudget !== null &&
              standing.grant.remainingBudget === null
            ? "budget-unknown"
            : "key-expired";
      throw new WalletAnswerRefusedError(reason);
    }
    if (options.persist) {
      await options.persist(standing.grant, granted.privateKey);
    }
    return await signInWithWalletKey(
      sdk,
      answer.identityId,
      granted.privateKey,
      standing.grant,
    );
  } finally {
    wipeGrant(grant);
  }
}

export interface StoredWalletKey {
  identityId: string;
  keyId: number;
  contractId: string;
}

/**
 * Signs in again with a key kept from an earlier wallet grant, after
 * reading it fresh on chain. Null when the key is gone, disabled or bound
 * elsewhere (the caller forgets it); `renewNeeded` when it still exists but
 * can no longer write. Wipes `privateKey` either way.
 */
export async function restoreWalletLogin(
  sdk: DashSdk,
  stored: StoredWalletKey,
  privateKey: Uint8Array,
): Promise<{ login: WalletLogin; renewNeeded: boolean } | null> {
  try {
    const standing = await checkWalletKey(
      sdk,
      stored.identityId,
      stored.keyId,
      stored.contractId,
    );
    if (standing.kind === "refused") return null;
    const login = await signInWithWalletKey(
      sdk,
      stored.identityId,
      privateKey,
      standing.grant,
    );
    return { login, renewNeeded: standing.renewNeeded };
  } finally {
    privateKey.fill(0);
  }
}

/** Wipes an answer the app will not sign in with (declined, closed, abandoned). */
export function disposeWalletAnswer(answer: WalletAnswer): void {
  wipeGrant(answer.grant);
}

/** The grant's current limits, or null when the key is gone or disabled. */
export async function readWalletGrant(
  sdk: DashSdk,
  identityId: string,
  keyId: number,
): Promise<WalletGrant | null> {
  const { key, remainingBudget } = await readIdentityKey(
    sdk,
    identityId,
    keyId,
  );
  if (!key || key.disabledAt !== undefined) return null;
  return toWalletGrant(key, remainingBudget);
}

export type WalletWriteAction = "renew" | "logout" | null;

interface ErrorShape {
  code?: unknown;
  message?: unknown;
  consensusError?: { code?: unknown };
  cause?: { code?: unknown };
}

// WasmSdkError carries the consensus code as `code` (-1 when there is none);
// the nested codes and the "code 20015" message form are defensive.
function consensusCodeOf(err: unknown): number | null {
  const shape: ErrorShape =
    typeof err === "object" && err !== null ? (err as ErrorShape) : {};
  for (const code of [
    shape.code,
    shape.consensusError?.code,
    shape.cause?.code,
  ]) {
    if (typeof code === "number" && Number.isInteger(code) && code > 0) {
      return code;
    }
  }
  const message =
    typeof shape.message === "string" ? shape.message : String(err ?? "");
  const match = /\bcode\b[^0-9-]{0,6}(\d{5})\b/i.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * What a failed write means for a wallet session: "renew" when the key's
 * allowance or expiry stopped it, "logout" when the key is disabled or gone,
 * null for anything else.
 */
export function classifyWalletWriteError(err: unknown): WalletWriteAction {
  const action = classifyAppConnectError(consensusCodeOf(err))?.action;
  if (action === "renew" || action === "logout") return action;
  return null;
}

/** The fields of the SDK's IdentityPublicKey this file reads. */
interface SdkKey {
  keyId: number;
  keyTypeNumber: number;
  purposeNumber: number;
  securityLevelNumber: number;
  /** Hex. */
  data: string;
  disabledAt?: bigint | number;
  totalBudget?: bigint;
  expiresAt?: bigint | number;
  contractBounds?: {
    contractBoundsType: string;
    identifier: unknown;
    documentTypeName?: string;
  };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toBounds(
  bounds: SdkKey["contractBounds"],
): AppConnectKeyBounds | undefined {
  if (!bounds) return undefined;
  const id = String(bounds.identifier);
  switch (bounds.contractBoundsType) {
    case "singleContract":
      return { kind: "singleContract", contractId: id };
    case "documentType":
      return {
        kind: "documentType",
        contractId: id,
        documentTypeName: bounds.documentTypeName ?? "",
      };
    case "contractGroup":
      return { kind: "contractGroup", groupId: id };
    default:
      return undefined;
  }
}

function toIdentityKey(k: SdkKey): AppConnectIdentityKey {
  return {
    id: k.keyId,
    type: k.keyTypeNumber,
    purpose: k.purposeNumber,
    securityLevel: k.securityLevelNumber,
    data: hexToBytes(k.data),
    disabledAt: k.disabledAt === undefined ? undefined : Number(k.disabledAt),
    totalBudget: k.totalBudget,
    expiresAt: k.expiresAt === undefined ? undefined : Number(k.expiresAt),
    bounds: toBounds(k.contractBounds),
  };
}

export function identityPort(sdk: DashSdk): AppConnectIdentityPort {
  return {
    async getIdentityFresh(identityId) {
      const { data } = await sdk.identities.fetchWithProof(identityId);
      if (data === undefined) return null;
      const keys = data.publicKeys as unknown as SdkKey[];
      return { id: identityId, publicKeys: keys.map(toIdentityKey) };
    },
    async remainingBudgets(identityId, keyIds) {
      const budgets = await sdk.identities.keysRemainingBudgets(
        identityId,
        keyIds,
      );
      return new Map(
        [...budgets].map(([keyId, left]) => [keyId, left ?? undefined]),
      );
    },
    async contractKeys(identityId, contractId, purpose) {
      const result = await sdk.identities.contractKeys({
        identityIds: [identityId],
        contractId,
        purposes: [purpose],
      });
      const keys = (result[0]?.keys ?? []) as unknown as SdkKey[];
      return keys.map(toIdentityKey);
    },
    // Dashnote asks for no contractGroup binding, so no group is ever read.
    async groupInfo() {
      return null;
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    try {
      return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }
  return null;
}

interface ResponseDocument {
  ownerId?: unknown;
  properties?: Record<string, unknown>;
}

function toCandidate(doc: ResponseDocument): AppConnectCandidate | null {
  const walletEphemeralPubKey = toBytes(doc.properties?.walletEphemeralPubKey);
  const encryptedPayload = toBytes(doc.properties?.encryptedPayload);
  if (!doc.ownerId || !walletEphemeralPubKey || !encryptedPayload) return null;
  return {
    ownerId: String(doc.ownerId),
    walletEphemeralPubKey,
    encryptedPayload,
  };
}

export function responsePort(sdk: DashSdk): AppConnectResponsePort {
  return {
    async listCandidates(requestHash, hint, startAfter, limit) {
      const where: unknown[][] = [
        ["appEphemeralPubKeyHash", "==", bytesToBase64(requestHash)],
      ];
      if (hint !== undefined) where.push(["$ownerId", "==", hint]);
      else if (startAfter !== undefined) {
        where.push(["$ownerId", ">", startAfter]);
      }
      const results: unknown = await sdk.documents.query({
        dataContractId: APP_CONNECT_CONTRACT_ID,
        documentTypeName: "loginKeyResponse",
        where,
        orderBy: [["$ownerId", "asc"]],
        limit,
      });
      const docs = Array.isArray(results)
        ? results
        : results instanceof Map
          ? [...results.values()]
          : Object.values((results ?? {}) as Record<string, unknown>);
      return docs
        .filter(Boolean)
        .map((doc) => toCandidate(doc as ResponseDocument))
        .filter((c): c is AppConnectCandidate => c !== null);
    },
  };
}
