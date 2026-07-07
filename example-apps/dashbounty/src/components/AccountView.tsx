import { useEffect, useState } from "react";

import { CopyableId } from "./CopyableId";
import { registerContract } from "../dash/contract";
import { errorMessage } from "../dash/logger";
import { fetchSiftTokenBalance } from "../dash/siftToken";
import { useSession } from "../session/useSession";

/**
 * The 3 initial panel member identity IDs, read from env vars rather than
 * hardcoded. Sift registers two groups with the same members: 2-of-3 for
 * suspend/restore, 3-of-3 for permanent token revocation.
 */
const PANELIST_IDS = [
  import.meta.env.VITE_PANELIST_1_ID,
  import.meta.env.VITE_PANELIST_2_ID,
  import.meta.env.VITE_PANELIST_3_ID,
].filter((id): id is string => Boolean(id));

export function AccountView() {
  const session = useSession();
  const [mnemonic, setMnemonic] = useState("");
  const [identityIndex, setIdentityIndex] = useState("0");
  const [contractInput, setContractInput] = useState(session.contractId ?? "");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { sdk, contractId, identityId } = session;
      if (!sdk || !contractId || !identityId) {
        if (!cancelled) setBalance(null);
        return;
      }
      try {
        const value = await fetchSiftTokenBalance({
          sdk,
          contractId,
          identityId,
        });
        if (!cancelled) setBalance(value);
      } catch {
        if (!cancelled) setBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      await session.login(mnemonic, Number(identityIndex) || 0);
      setMnemonic("");
    } catch (err) {
      setLocalError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleContractSubmit(event: React.FormEvent) {
    event.preventDefault();
    session.setContractId(contractInput.trim());
  }

  async function handleRegisterContract() {
    if (!session.sdk || !session.keyManager) {
      setLocalError("Sign in before registering a contract.");
      return;
    }
    if (PANELIST_IDS.length !== 3) {
      setLocalError(
        "Set VITE_PANELIST_1_ID/_2_ID/_3_ID (see scripts/bootstrap-identities.mjs) before registering a Sift contract.",
      );
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      const id = await registerContract({
        sdk: session.sdk,
        keyManager: session.keyManager,
        panelMemberIds: PANELIST_IDS,
        log: session.log,
      });
      session.setContractId(id);
      setContractInput(id);
    } catch (err) {
      setLocalError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Sift contract</h3>
        <form onSubmit={handleContractSubmit} className="row">
          <input
            value={contractInput}
            onChange={(event) => setContractInput(event.target.value)}
            placeholder="Contract ID"
          />
          <button type="submit">Use</button>
        </form>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="secondary"
            onClick={handleRegisterContract}
            disabled={busy || !session.keyManager}
          >
            Register new contract
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              session.setContractId(null);
              setContractInput("");
            }}
          >
            Clear override
          </button>
        </div>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Registering creates a fresh Sift token and two initial groups from
          VITE_PANELIST_1_ID/_2_ID/_3_ID: 2-of-3 for suspend/restore and 3-of-3
          for revoking suspended tokens. The owner can add groups and remap
          token functions later. The signing identity receives the initial 100
          Sift tokens.
        </p>
      </div>

      {session.status === "authenticated" ? (
        <div className="card">
          <h3>Signed in</h3>
          <p className="row">
            Identity: <CopyableId id={session.identityId} />
          </p>
          {balance != null && (
            <p>
              Sift token balance: <strong>{balance.toString()}</strong>
            </p>
          )}
          <button type="button" className="secondary" onClick={session.logout}>
            Sign out
          </button>
        </div>
      ) : (
        <div className="card">
          <h3>Sign in</h3>
          {localError && <div className="notice error">{localError}</div>}
          <form onSubmit={handleSignIn}>
            <div className="field">
              <label htmlFor="mnemonic">Mnemonic</label>
              <textarea
                id="mnemonic"
                rows={2}
                value={mnemonic}
                onChange={(event) => setMnemonic(event.target.value)}
                placeholder="twelve word mnemonic phrase…"
              />
            </div>
            <div className="field">
              <label htmlFor="identity-index">
                Identity index (0 = submitter, 1-3 = panelists — see
                scripts/bootstrap-identities.mjs)
              </label>
              <input
                id="identity-index"
                type="number"
                min={0}
                value={identityIndex}
                onChange={(event) => setIdentityIndex(event.target.value)}
              />
            </div>
            <button type="submit" disabled={busy || !mnemonic.trim()}>
              Sign in
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
