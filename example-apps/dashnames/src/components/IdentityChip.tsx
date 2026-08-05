/**
 * Identity chip: 32px pill carrying the signed-in name
 * and live credit balance, plus a 28px gradient avatar.
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
}: {
  name: string | null;
  identityId: string | null;
  balance: bigint | null;
  onClick: () => void;
}) {
  const signedIn = Boolean(identityId);
  const label = signedIn ? (name ?? shortId(identityId)) : "Sign in";

  return (
    <button
      type="button"
      className="identity-chip"
      onClick={onClick}
      title={
        signedIn ? (identityId ?? undefined) : "Sign in with a recovery phrase"
      }
    >
      <span className="identity-chip__name">{label}</span>
      {signedIn && balance != null && (
        <span className="identity-chip__balance">
          {formatDash(balance, { minDecimals: 3, maxDecimals: 3 })} Ð
        </span>
      )}
      <span className="avatar" aria-hidden="true" />
    </button>
  );
}
