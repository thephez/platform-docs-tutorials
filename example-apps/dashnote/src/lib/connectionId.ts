// A 16-byte id for this browser, sent with every App Connect request so the
// wallet can disable the key of its previous grant to this device when it
// approves a new one. It survives logout on purpose: a re-login supersedes.
const STORAGE_KEY = "dashnote.appConnect.connectionId";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function loadConnectionId(): Uint8Array {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && /^[0-9a-f]{32}$/.test(raw)) return hexToBytes(raw);
  } catch {
    // fall through to a fresh id
  }
  const fresh = crypto.getRandomValues(new Uint8Array(16));
  try {
    localStorage.setItem(STORAGE_KEY, bytesToHex(fresh));
  } catch {
    // ignore — quota or disabled storage
  }
  return fresh;
}

export function clearConnectionId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
