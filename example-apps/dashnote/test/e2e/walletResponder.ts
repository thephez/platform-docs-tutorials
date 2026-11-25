/**
 * A scripted DashPay wallet for the "Sign in with DashPay" e2e spec.
 *
 * Answers an App Connect v2 request the way the mobile wallet does, using
 * the PLATFORM_MNEMONIC identity: one master-signed identity update adds a
 * fresh HIGH authentication key bound to the requested contract, with the
 * requested budget and expiry (disabling this connection's previous key if
 * it is still live), then a `loginKeyResponse` document in the App Connect
 * system contract carries that key's private bytes, sealed to the app's
 * ephemeral key.
 *
 * Runs in the Playwright (Node) process against real testnet. Every key it
 * adds stays on the identity for good, so specs call disableWalletKeys in
 * afterAll.
 */
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as secp256k1 from "@noble/secp256k1";
import { sealAppConnectPayload } from "../../src/vendor/platform-auth/app-connect/crypto";
import {
  encodeBase58,
  decodeIdentityId,
} from "../../src/vendor/platform-auth/app-connect/primitives";
import {
  appConnectRequestHash,
  checkAppConnectRequestAge,
  parseAppConnectUri,
  type AppConnectRequest,
} from "../../src/vendor/platform-auth/app-connect/request";
import { KeySecurityLevel } from "../../src/vendor/platform-auth/app-connect/types";

export const APP_CONNECT_CONTRACT_ID =
  "H8F9mP1BM55TE1ShsxPZHzhyinaMdY9bMmP85mkDhcJJ";

type EvoModule = typeof import("@dashevo/evo-sdk");
type Sdk = InstanceType<EvoModule["EvoSDK"]>;
type Identity = InstanceType<EvoModule["Identity"]>;
type IdentityPublicKey = InstanceType<EvoModule["IdentityPublicKey"]>;
type IdentitySigner = InstanceType<EvoModule["IdentitySigner"]>;

interface Signing {
  identity: Identity;
  identityKey: IdentityPublicKey | undefined;
  signer: IdentitySigner;
}

interface KeyManager {
  identityId: string;
  getMaster(additionalKeyWifs?: string[]): Promise<Signing>;
  getAuthHigh(): Promise<Signing>;
}

interface Wallet {
  evo: EvoModule;
  sdk: Sdk;
  km: KeyManager;
}

// The shared core imports @dashevo/evo-sdk from the repo root, which is a
// different copy (and WASM instance) from this app's node_modules. Keys,
// documents and signers must all come from the instance the SDK runs on,
// so the SDK classes are loaded from the root copy too.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

function rootModuleUrl(path: string): string {
  return pathToFileURL(realpathSync(resolve(repoRoot, path))).href;
}

let walletPromise: Promise<Wallet> | null = null;

function wallet(): Promise<Wallet> {
  walletPromise ??= (async () => {
    const mnemonic = process.env.PLATFORM_MNEMONIC?.trim();
    if (!mnemonic) throw new Error("PLATFORM_MNEMONIC is required");
    const core = await import(rootModuleUrl("setupDashClient-core.mjs"));
    const evo: EvoModule = await import(
      rootModuleUrl("node_modules/@dashevo/evo-sdk/dist/evo-sdk.module.js")
    );
    const sdk: Sdk = await core.createClient("testnet");
    if (!(sdk instanceof evo.EvoSDK)) {
      throw new Error("the shared core loaded a different @dashevo/evo-sdk");
    }
    const km: KeyManager = await core.IdentityKeyManager.create({
      sdk,
      mnemonic,
      network: "testnet",
    });
    return { evo, sdk, km };
  })();
  walletPromise.catch(() => {
    walletPromise = null;
  });
  return walletPromise;
}

/** Key ids this process added, in order; disableWalletKeys cleans them up. */
const addedKeyIds: number[] = [];
/** Connection id (hex) → the key granted to it, as the wallet remembers. */
const grantsByConnection = new Map<string, number>();
let lastKeyId = -1;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function walletIdentity(): Promise<string> {
  return (await wallet()).km.identityId;
}

/** Key ids added by approveWalletRequest in this process. */
export function addedWalletKeyIds(): number[] {
  return [...addedKeyIds];
}

/** Ids of the identity's keys that are not disabled, read from chain. */
export async function liveIdentityKeyIds(): Promise<number[]> {
  const { sdk, km } = await wallet();
  const identity = await sdk.identities.fetch(km.identityId);
  if (!identity) throw new Error(`identity ${km.identityId} not found`);
  return identity.publicKeys
    .filter((k) => k.disabledAt == null)
    .map((k) => k.keyId)
    .sort((a, b) => a - b);
}

/** The wallet's checks; throws on any request DashPay would refuse. */
function checkRequest(
  request: AppConnectRequest,
  network: string,
  identityId: string,
) {
  if (network !== "testnet") {
    throw new Error(`wallet refuses a ${network} request on testnet`);
  }
  const age = checkAppConnectRequestAge(request.createdAt, Date.now());
  if (age) throw new Error(`wallet refuses a ${age} request`);
  if (request.encBindings.length !== 0) {
    throw new Error("wallet expected no encryption binding");
  }
  if (request.authBindings.length !== 1) {
    throw new Error(
      `wallet expected one auth binding, got ${request.authBindings.length}`,
    );
  }
  const [binding] = request.authBindings;
  if (binding.kind !== "singleContract") {
    throw new Error(`wallet expected singleContract, got ${binding.kind}`);
  }
  if (binding.securityLevel !== KeySecurityLevel.HIGH) {
    throw new Error(
      `wallet expected security level HIGH, got ${binding.securityLevel}`,
    );
  }
  if (binding.totalBudget === undefined) {
    throw new Error("wallet expected a proposed budget");
  }
  if (binding.expiresAt === undefined || binding.expiresAt <= Date.now()) {
    throw new Error("wallet expected a proposed expiry in the future");
  }
  if (
    request.identityHint &&
    encodeBase58(request.identityHint) !== identityId
  ) {
    throw new Error("request is for another identity");
  }
  return binding;
}

/**
 * Approve a `dash-key:` request: add the granted key and publish the
 * sealed `loginKeyResponse`. `budget` / `expiresAt` replace the request's
 * proposal, as a user editing the approval sheet would.
 */
export async function approveWalletRequest(
  uri: string,
  options: { budget?: bigint; expiresAt?: number } = {},
): Promise<{ identityId: string; keyId: number; requestHash: string }> {
  const { evo, sdk, km } = await wallet();
  const identityId = km.identityId;
  const { request, network } = parseAppConnectUri(uri);
  const binding = checkRequest(request, network, identityId);
  const contractId = encodeBase58(binding.id);

  const privateKey = secp256k1.utils.randomSecretKey();
  const newKey = evo.PrivateKey.fromBytes(privateKey, "testnet");
  const { identity, signer } = await km.getMaster([newKey.toWIF()]);

  const chainKeyIds = identity.publicKeys.map((k) => k.keyId);
  const keyId = Math.max(lastKeyId, ...chainKeyIds) + 1;

  // A wallet re-answering the same connection retires the key it granted
  // before, in the same update.
  const disablePublicKeys: number[] = [];
  const connection = request.connectionId
    ? toHex(request.connectionId)
    : undefined;
  const previous =
    connection === undefined ? undefined : grantsByConnection.get(connection);
  if (previous !== undefined) {
    const live = identity.publicKeys.find(
      (k) => k.keyId === previous && k.disabledAt == null,
    );
    if (live) disablePublicKeys.push(previous);
  }

  const key = new evo.IdentityPublicKeyInCreation({
    keyId,
    purpose: "authentication",
    securityLevel: "high",
    keyType: "ecdsa_secp256k1",
    data: newKey.getPublicKey().toBytes(),
    contractBounds: evo.ContractBounds.SingleContract(contractId),
    totalBudget: options.budget ?? binding.totalBudget,
    expiresAt: BigInt(options.expiresAt ?? binding.expiresAt!),
  });

  await sdk.identities.update({
    identity,
    addPublicKeys: [key],
    ...(disablePublicKeys.length > 0 ? { disablePublicKeys } : {}),
    signer,
  });
  lastKeyId = keyId;
  addedKeyIds.push(keyId);
  if (connection !== undefined) grantsByConnection.set(connection, keyId);

  const requestHash = appConnectRequestHash(request);
  const sealed = await sealAppConnectPayload({
    appEphemeralPubKey: request.appEphemeralPubKey,
    ownerId: decodeIdentityId(identityId),
    slots: [privateKey],
  });
  privateKey.fill(0);

  const document = new evo.Document({
    properties: {
      appEphemeralPubKeyHash: requestHash,
      walletEphemeralPubKey: sealed.walletEphemeralPubKey,
      encryptedPayload: sealed.encryptedPayload,
    },
    documentTypeName: "loginKeyResponse",
    dataContractId: APP_CONNECT_CONTRACT_ID,
    ownerId: identityId,
  });
  const auth = await km.getAuthHigh();
  if (!auth.identityKey) throw new Error("identity has no HIGH auth key");
  await sdk.documents.create({
    document,
    identityKey: auth.identityKey,
    signer: auth.signer,
  });

  return { identityId, keyId, requestHash: toHex(requestHash) };
}

/**
 * Disable the given keys in one master-signed update, skipping any that
 * are already disabled. A disabled key can never be re-enabled.
 */
export async function disableWalletKeys(keyIds: number[]): Promise<void> {
  if (keyIds.length === 0) return;
  const { sdk, km } = await wallet();
  const { identity, signer } = await km.getMaster();
  const live = keyIds.filter((id) =>
    identity.publicKeys.some((k) => k.keyId === id && k.disabledAt == null),
  );
  if (live.length === 0) return;
  await sdk.identities.update({ identity, disablePublicKeys: live, signer });
}
