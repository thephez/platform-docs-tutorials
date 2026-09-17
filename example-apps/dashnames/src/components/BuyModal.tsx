/**
 * Buy flow: revalidating → ready / insufficient / stale.
 *
 * THE rule this component exists to enforce: the index is for discovery, a fresh
 * fetch is for execution — and "fresh" means AT CONFIRM, not at open.
 *
 * The modal revalidates on open, but a user can leave a ready modal sitting for
 * minutes while the listing changes underneath them. So the confirm handler
 * re-fetches AGAIN and re-compares `$price` and `$revision` before signing,
 * transitioning to the stale state instead of submitting if either moved. The
 * quote also expires on a timer and auto-revalidates, so a long-open modal never
 * displays a price it can no longer honour.
 *
 * Platform's server-side price check is the final safeguard, not the user-facing
 * contract: the design promises the user is TOLD before signing, and only a
 * confirm-time fetch delivers that.
 *
 * Deviation — no fee rows. evo-sdk 4.1.0 has no fee-estimation or dry-run API,
 * so "Processing fee" / "Storage fee" / "Total required" / "Balance after" have
 * nothing real behind them. Affordability is checked against the price alone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DomainRecord } from "../dash/dpnsQueries";
import type { Listing } from "../dash/listingTypes";
import type { MarketplaceError } from "../dash/marketplaceErrors";
import { formatCredits, formatDash, shortId } from "../lib/format";
import { DpnsName } from "./DpnsName";
import { Modal } from "./Modal";

const QUOTE_TTL_MS = 30_000;

export type BuyStatus =
  | "revalidating"
  | "ready"
  | "insufficient"
  | "stale"
  | "signing"
  | "done"
  | "failed";

export interface StaleDiff {
  cachedPrice: bigint | null;
  cachedRevision: bigint | null;
  currentPrice: bigint | null;
  currentRevision: bigint | null;
  ownerChanged: { from: string | null; to: string | null } | null;
}

export function BuyModal({
  listing,
  open,
  identityName,
  identityId,
  balance,
  onClose,
  onRevalidate,
  onConfirm,
  onViewName,
}: {
  listing: Listing | null;
  open: boolean;
  identityName: string | null;
  identityId: string | null;
  balance: bigint | null;
  onClose: () => void;
  /** Re-fetches the live document. Used on open, on expiry, and at confirm. */
  onRevalidate: (documentId: string) => Promise<DomainRecord | null>;
  onConfirm: (
    listing: Listing,
    price: bigint,
  ) => Promise<{ ok: true } | { ok: false; error: MarketplaceError }>;
  onViewName: (documentId: string) => void;
}) {
  const [status, setStatus] = useState<BuyStatus>("revalidating");
  const [current, setCurrent] = useState<DomainRecord | null>(null);
  const [diff, setDiff] = useState<StaleDiff | null>(null);
  const [error, setError] = useState<MarketplaceError | null>(null);
  const requestId = useRef(0);

  /**
   * Fetches the live document and decides whether the cached quote still holds.
   * Returns the record when it is safe to proceed, or null when it is not.
   */
  const revalidate = useCallback(
    async (target: Listing): Promise<DomainRecord | null> => {
      const id = ++requestId.current;
      const record = await onRevalidate(target.documentId);
      if (requestId.current !== id) return null;

      const moved =
        !record ||
        record.price == null ||
        record.price !== target.price ||
        record.revision !== target.revision;

      if (moved) {
        setDiff({
          cachedPrice: target.price,
          cachedRevision: target.revision,
          currentPrice: record?.price ?? null,
          currentRevision: record?.revision ?? null,
          ownerChanged:
            record && record.ownerId !== target.ownerId
              ? { from: target.ownerId, to: record.ownerId }
              : null,
        });
        setCurrent(record);
        setStatus("stale");
        return null;
      }

      setCurrent(record);
      setDiff(null);
      const affordable = balance != null && balance >= record.price!;
      setStatus(affordable ? "ready" : "insufficient");
      return record;
    },
    [onRevalidate, balance],
  );

  // Revalidate on open.
  useEffect(() => {
    if (!open || !listing) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setStatus("revalidating");
      setError(null);
      setDiff(null);
      await revalidate(listing);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, listing, revalidate]);

  // Expire the quote so a long-open modal cannot show a price it can't honour.
  useEffect(() => {
    if (!open || !listing || status !== "ready") return;
    const handle = window.setTimeout(() => {
      setStatus("revalidating");
      void revalidate(listing);
    }, QUOTE_TTL_MS);
    return () => window.clearTimeout(handle);
  }, [open, listing, status, revalidate]);

  async function handleConfirm() {
    if (!listing) return;
    setStatus("revalidating");
    setError(null);

    // Re-fetch immediately before signing. This is the check that makes the
    // promise honest — the open-time quote is not trusted.
    const record = await revalidate(listing);
    if (!record || record.price == null) return; // already moved to `stale`

    setStatus("signing");
    const result = await onConfirm(listing, record.price);
    if (result.ok) {
      setStatus("done");
      return;
    }
    setError(result.error);
    setStatus("failed");
  }

  if (!listing) return null;

  const price = current?.price ?? listing.price;
  const shortfall = balance != null && price > balance ? price - balance : null;

  return (
    <Modal
      open={open}
      title={status === "stale" ? "Listing changed" : "Buy this name"}
      onClose={onClose}
    >
      {status === "stale" ? (
        <StaleState
          listing={listing}
          diff={diff}
          onBack={onClose}
          onViewName={() => onViewName(listing.documentId)}
        />
      ) : (
        <div className="modal__body">
          <div
            className={
              status === "revalidating"
                ? "notice notice--info"
                : "notice notice--info"
            }
          >
            <span
              className="sync-chip__dot"
              style={
                status === "revalidating"
                  ? { background: "var(--warning-amber)" }
                  : undefined
              }
            />
            {status === "revalidating"
              ? "Revalidating listing against Platform…"
              : `Listing revalidated against Platform · rev ${String(current?.revision ?? listing.revision)}`}
          </div>

          <div className="cost-row">
            <span className="cost-row__label">
              <DpnsName
                label={listing.label}
                parentDomainName={listing.parentDomainName}
              />
            </span>
            <span className="cost-row__value">
              {formatDash(price, { minDecimals: 6 })} DASH
            </span>
          </div>
          <div className="cost-credits">{formatCredits(price)} credits</div>

          {status === "insufficient" && shortfall != null && (
            <div className="block-error">
              <strong>Insufficient credits.</strong> You need{" "}
              {formatDash(shortfall)} DASH more in this identity's balance. Top
              up, then retry — the price is bound to revision{" "}
              {String(current?.revision ?? listing.revision)} and may change in
              the meantime.
            </div>
          )}

          {status === "failed" && error && (
            <div className="block-error">
              <strong>The purchase did not complete.</strong>
              <div style={{ marginTop: 6 }}>{error.message}</div>
              <div style={{ marginTop: 6 }}>
                {error.kind === "PriceMismatch" ||
                error.kind === "StaleRevision"
                  ? "The listing changed before the transition was accepted, so nothing was bought."
                  : "The outcome is unknown. Re-open the name to see its current owner and price."}
              </div>
            </div>
          )}

          {status === "done" && (
            <div className="notice notice--info">
              Purchase submitted. The name now resolves to your identity.
            </div>
          )}

          <div className="balance-after">
            <span>Your balance</span>
            <span
              className="balance-after__value"
              style={
                shortfall != null ? { color: "var(--danger-red)" } : undefined
              }
            >
              {balance == null ? "—" : `${formatDash(balance)} DASH`}
            </span>
          </div>

          {status === "done" ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={onClose}
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={
                status === "revalidating" ||
                status === "signing" ||
                status === "insufficient" ||
                !identityId
              }
              onClick={handleConfirm}
            >
              {status === "signing" ? "Signing…" : "Confirm purchase"}
            </button>
          )}

          {identityId && (
            <p className="signing-note">
              Signed by identity {shortId(identityId)}
              {identityName ? ` (${identityName})` : ""}. Bound to revision{" "}
              {String(current?.revision ?? listing.revision)} and this exact
              price.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function StaleState({
  listing,
  diff,
  onBack,
  onViewName,
}: {
  listing: Listing;
  diff: StaleDiff | null;
  onBack: () => void;
  onViewName: () => void;
}) {
  return (
    <div className="modal__body modal__body--centered">
      <span className="stale-badge">!</span>
      <h3 className="stale-headline">This listing is no longer available</h3>
      <p className="stale-body">
        The current document is at revision{" "}
        {diff?.currentRevision != null ? String(diff.currentRevision) : "—"} and{" "}
        {diff?.currentPrice != null && diff.currentPrice > 0n
          ? "carries a different price"
          : "no longer carries a price"}
        . The owner may have repriced, delisted, transferred, or already sold{" "}
        <DpnsName
          label={listing.label}
          parentDomainName={listing.parentDomainName}
        />
        .
      </p>

      <div className="diff-block">
        <div>
          Cached price · <strong>{formatDash(listing.price)} DASH</strong> (rev{" "}
          {String(listing.revision)})
        </div>
        <div>
          Current state ·{" "}
          <strong>
            {diff?.currentPrice != null && diff.currentPrice > 0n
              ? `${formatDash(diff.currentPrice)} DASH`
              : "no price"}
          </strong>{" "}
          (rev{" "}
          {diff?.currentRevision != null ? String(diff.currentRevision) : "—"})
        </div>
        {diff?.ownerChanged && (
          <div>
            Owner changed · {shortId(diff.ownerChanged.from)} →{" "}
            {shortId(diff.ownerChanged.to)}
          </div>
        )}
      </div>

      <div className="modal__actions">
        <button
          type="button"
          className="btn btn--outline btn--md"
          onClick={onBack}
        >
          Back to market
        </button>
        <button
          type="button"
          className="btn btn--primary btn--md"
          onClick={onViewName}
        >
          View name
        </button>
      </div>

      <p className="signing-note">
        Nothing was signed and no credits were spent.
      </p>
    </div>
  );
}
