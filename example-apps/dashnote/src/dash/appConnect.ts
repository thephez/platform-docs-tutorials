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
import type { AppConnectGrant } from "../vendor/platform-auth/app-connect";
import type {
  AppConnectIdentityPort,
  AppConnectRequest,
  AppConnectResponsePort,
  AppConnectRejectReason,
} from "../vendor/platform-auth/app-connect";
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
  _sdk: DashSdk,
  _contractId: string,
): Promise<ChainClock> {
  throw new Error("not implemented");
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
export function newWalletLoginRequest(_params: {
  contractId: string;
  connectionId: Uint8Array;
  chainNow: number;
  identityHint?: string;
  now?: number;
}): WalletLoginRequest {
  throw new Error("not implemented");
}

export function disposeWalletLoginRequest(_req: WalletLoginRequest): void {
  throw new Error("not implemented");
}

/** Cuts a poll's wait short, e.g. when the tab regains focus. */
export class PollTrigger {
  fire(): void {
    throw new Error("not implemented");
  }

  wait(_ms: number, _signal?: AbortSignal): Promise<void> {
    throw new Error("not implemented");
  }
}

export type WalletPollStatus = "waiting" | "answered" | "incomplete-read";

export class RequestExpiredError extends Error {}
export class TooManyAnswersError extends Error {}
export class AmbiguousWalletAnswerError extends Error {
  identityIds: string[] = [];
}
export class WalletAnswerRefusedError extends Error {
  reason: AppConnectRejectReason = "framing";
}

export interface WalletAnswer {
  identityId: string;
  grant: AppConnectGrant;
}

/**
 * Polls the App Connect contract until one identity's answer verifies, then
 * returns it. Rejects with RequestExpiredError after 10 minutes, with
 * AmbiguousWalletAnswerError when two identities answered, with
 * WalletAnswerRefusedError when the only answer is unusable, and with an
 * AbortError DOMException on `signal`.
 */
export async function awaitWalletAnswer(
  _sdk: DashSdk,
  _req: WalletLoginRequest,
  _options: {
    signal?: AbortSignal;
    trigger?: PollTrigger;
    onStatus?: (status: WalletPollStatus) => void;
    settleMs?: number;
    now?: () => number;
  } = {},
): Promise<WalletAnswer> {
  throw new Error("not implemented");
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

/**
 * Turns a verified answer into a one-key session via loginWithPrivateKey,
 * exactly as a pasted WIF does, and wipes the grant's private key bytes.
 */
export async function loginWithWalletAnswer(
  _sdk: DashSdk,
  _answer: WalletAnswer,
): Promise<WalletLogin> {
  throw new Error("not implemented");
}

/** The grant's current limits, or null when the key is gone or disabled. */
export async function readWalletGrant(
  _sdk: DashSdk,
  _identityId: string,
  _keyId: number,
): Promise<WalletGrant | null> {
  throw new Error("not implemented");
}

export type WalletWriteAction = "renew" | "logout" | null;

/**
 * What a failed write means for a wallet session: "renew" when the key's
 * allowance or expiry stopped it, "logout" when the key is disabled or gone,
 * null for anything else.
 */
export function classifyWalletWriteError(_err: unknown): WalletWriteAction {
  throw new Error("not implemented");
}

export function identityPort(_sdk: DashSdk): AppConnectIdentityPort {
  throw new Error("not implemented");
}

export function responsePort(_sdk: DashSdk): AppConnectResponsePort {
  throw new Error("not implemented");
}
