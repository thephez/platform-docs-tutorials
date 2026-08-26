/**
 * Identity chip: signed-in name stacked above the live credit balance,
 * with a gradient avatar on the right. DPNS's `.dash` suffix is omitted in
 * this compact account context.
 *
 * Balance renders as a DASH figure with the Ð sign, matching the design's
 * "18.402 Ð".
 */
import { formatDash, shortId } from "../lib/format";

export function IdentityChip({
  name,
  identityId,
  balance,
  onClick,
  disabled = false,
}: {
  name: string | null;
  identityId: string | null;
  balance: bigint | null;
  onClick: () => void;
  disabled?: boolean;
}) {
  const signedIn = Boolean(identityId);
  const label = signedIn ? (name ?? shortId(identityId)) : "Sign in";
  const displayLabel = label.replace(/\.dash$/i, "");

  return (
    <button
      type="button"
      className={`identity-chip${signedIn ? " identity-chip--signed-in" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={
        signedIn
          ? (identityId ?? undefined)
          : disabled
            ? "Sign-in is disabled on mainnet. Switch to testnet to sign in."
            : "Sign in with a recovery phrase or authentication WIF"
      }
    >
      <span className="identity-chip__text">
        <span className="identity-chip__name">{displayLabel}</span>
        {signedIn && balance != null && (
          <span className="identity-chip__balance">
            {formatDash(balance, { minDecimals: 3, maxDecimals: 3 })} Ð
          </span>
        )}
      </span>
      <span className="avatar" aria-hidden="true" />
    </button>
  );
}
