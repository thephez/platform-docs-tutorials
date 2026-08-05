/**
 * Explains why writes are unavailable on a network below protocol v13.
 *
 * The network label is live rather than a hardcoded "MAINNET · BLOCK N": DPNS
 * sales do not work on mainnet yet (v12), so the app defaults to testnet and
 * renders whichever network is actually selected.
 */
import { SALES_MIN_PROTOCOL_VERSION, type Network } from "../dash/contracts";
import type { ProtocolStatus } from "../dash/protocolVersion";

export function ProtocolGateBanner({
  protocol,
  network,
  onSwitchNetwork,
}: {
  protocol: ProtocolStatus;
  network: Network;
  onSwitchNetwork?: (network: Network) => void;
}) {
  if (protocol.salesEnabled) return null;

  const known = protocol.activeProtocolVersion != null;

  return (
    <div className="gate-banner" role="status">
      <strong>
        {known
          ? `${network} is running protocol v${protocol.activeProtocolVersion}.`
          : "Protocol version unavailable."}
      </strong>{" "}
      {known
        ? `Buying, selling, and transferring DPNS names needs v${SALES_MIN_PROTOCOL_VERSION}, so every write is disabled here. Browsing, search, and history all still work.`
        : "The active protocol version could not be read, so writes stay disabled until it can be confirmed."}
      {network === "mainnet" && onSwitchNetwork && (
        <>
          {" "}
          <button
            type="button"
            className="sync-chip__refresh"
            onClick={() => onSwitchNetwork("testnet")}
          >
            Switch to testnet
          </button>
        </>
      )}
    </div>
  );
}
