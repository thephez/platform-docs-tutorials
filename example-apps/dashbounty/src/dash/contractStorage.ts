/**
 * Contract ID persistence + owner lookup. Split from contract.ts so the
 * session bootstrap can import these helpers without dragging the
 * @dashevo/evo-sdk module (and its WASM bundle) into the entry chunk.
 *
 * SDK method (fetchContractOwnerId): sdk.contracts.fetch(...)
 */
import type { DashSdk } from "./types";

const STORAGE_KEY = "sift.contractId";

/**
 * Default contract ID baked into the tutorial so browse-only mode works on
 * a fresh machine without any setup. Points at the published submission-based
 * Sift contract on testnet.
 */
export const DEFAULT_CONTRACT_ID: string | null =
  "27awnGucyBQ9odPHX2JB3e2nLVmRMxMcCmiAWpwFaPqb";

export function loadStoredContractId(): string | null {
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CONTRACT_ID;
}

export function saveContractId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}

export function clearStoredContractId(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function fetchContractOwnerId({
  sdk,
  contractId,
}: {
  sdk: DashSdk;
  contractId: string;
}): Promise<string | null> {
  const contract = await sdk.contracts.fetch(contractId);
  if (!contract) return null;
  const json =
    typeof contract.toJSON === "function" ? contract.toJSON() : contract;
  const ownerId = json.$ownerId ?? json.ownerId ?? null;
  return ownerId ? String(ownerId) : null;
}
