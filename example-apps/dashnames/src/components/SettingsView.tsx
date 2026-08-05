/**
 * Settings: sign in, switch network, rebuild the index.
 *
 * The mnemonic is submitted straight to `login()` and cleared from local state
 * immediately — it is never stored, and never leaves the key manager closure.
 */
import { useState, type FormEvent } from "react";
import type { Network } from "../dash/contracts";
import type { ProtocolStatus } from "../dash/protocolVersion";
import { formatBlock, formatDash, shortId } from "../lib/format";

export function SettingsView({
  network,
  onNetworkChange,
  identityId,
  identityName,
  balance,
  protocol,
  status,
  onLogin,
  onLogout,
  onRebuildIndex,
  indexSize,
  persistFailed,
}: {
  network: Network;
  onNetworkChange: (network: Network) => void;
  identityId: string | null;
  identityName: string | null;
  balance: bigint | null;
  protocol: ProtocolStatus;
  status: string;
  onLogin: (mnemonic: string) => Promise<void>;
  onLogout: () => void;
  onRebuildIndex: () => void;
  indexSize: number;
  persistFailed: boolean;
}) {
  const [mnemonic, setMnemonic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(mnemonic.trim());
      // Drop the secret from component state as soon as it has been handed off.
      setMnemonic("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prose">
      <h2>Network</h2>
      <p>
        DPNS name sales need protocol v13. testnet is on v13 today; mainnet is
        still on v12, so writes are disabled there.
      </p>
      <div className="network-toggle">
        {(["testnet", "mainnet"] as Network[]).map((n) => (
          <button
            key={n}
            type="button"
            className={`filter-chip${network === n ? " filter-chip--active" : ""}`}
            onClick={() => onNetworkChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="status-line status-line--info" style={{ marginTop: 10 }}>
        Active protocol:{" "}
        {protocol.activeProtocolVersion != null
          ? `v${protocol.activeProtocolVersion}`
          : "unknown"}
        {protocol.knownProtocolVersion != null &&
          ` (network knows v${protocol.knownProtocolVersion})`}
        {protocol.blockHeight != null &&
          ` · block ${formatBlock(protocol.blockHeight)}`}
        {" · sales "}
        {protocol.salesEnabled ? "enabled" : "disabled"}
      </p>

      <h2>Identity</h2>
      {identityId ? (
        <>
          <p>
            Signed in as <code>{identityName ?? shortId(identityId)}</code>
            {balance != null && ` · ${formatDash(balance)} DASH`}
          </p>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={onLogout}
          >
            Sign out
          </button>
        </>
      ) : (
        <form className="form-panel" onSubmit={handleSubmit}>
          <div className="field">
            <label className="label-caps" htmlFor="mnemonic">
              Recovery phrase
            </label>
            <textarea
              id="mnemonic"
              className="field__input field__textarea"
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              placeholder="twelve or twenty-four words"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="status-line status-line--info">
            Testnet only. The phrase is used to derive keys in memory and is
            never stored or transmitted anywhere but Platform.
          </p>
          {error && <p className="status-line status-line--error">{error}</p>}
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={busy || !mnemonic.trim()}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}

      <h2>Listings index</h2>
      <p>
        {indexSize} listing{indexSize === 1 ? "" : "s"} indexed locally for{" "}
        {network}. The index is rebuilt from price-update history — Platform has
        no index on <code>$price</code>, so there is no server-side "what is for
        sale" query.
      </p>
      {persistFailed && (
        <p className="status-line status-line--error">
          The index could not be saved to this browser, so the next visit will
          rebuild it from scratch.
        </p>
      )}
      <button
        type="button"
        className="btn btn--outline btn--sm"
        onClick={onRebuildIndex}
      >
        Rebuild index from history
      </button>

      {status && (
        <p className="status-line status-line--info" style={{ marginTop: 14 }}>
          {status}
        </p>
      )}
    </div>
  );
}
