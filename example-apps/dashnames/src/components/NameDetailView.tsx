/**
 * Name detail: breadcrumb, title + badges, fact strip, tabs,
 * timeline, and the right-hand buy panel.
 *
 * Deviation — the buy panel has NO "Est. fees" row. evo-sdk 4.1.0 exposes no
 * fee-estimation, dry-run, or simulation method (the only fee-bearing types
 * belong to FinalizedEpochInfo, which is an epoch aggregate, not a per-transition
 * quote), so any figure here would be invented. Affordability is checked against
 * the price alone and Platform rejects a genuinely insufficient balance.
 *
 * The "Watch" button is also dropped — there is no watchlist view in this app,
 * so the button would have no destination.
 */
import { useState } from "react";
import type { DomainRecord } from "../dash/dpnsQueries";
import type { Network } from "../dash/contracts";
import type { HistoryEvent } from "../dash/listingTypes";
import {
  formatCredits,
  formatDash,
  formatMonthYear,
  shortId,
} from "../lib/format";
import { DpnsName } from "./DpnsName";
import { Timeline } from "./Timeline";
import { SkeletonRows } from "./Skeleton";
import { ExplorerId } from "./ExplorerId";
import { IdentityLink } from "./IdentityLink";

export function NameDetailView({
  record,
  network,
  ownership,
  priceHistory,
  loading,
  balance,
  isOwner,
  canWrite,
  backLabel,
  resultPosition,
  resultCount,
  onBack,
  onBuy,
  onManage,
  onOpenIdentity,
}: {
  record: DomainRecord | null;
  network: Network;
  ownership: HistoryEvent[];
  priceHistory: HistoryEvent[];
  loading: boolean;
  balance: bigint | null;
  isOwner: boolean;
  canWrite: boolean;
  backLabel: string;
  resultPosition: number | null;
  resultCount: number | null;
  onBack: () => void;
  onBuy: () => void;
  onManage: () => void;
  onOpenIdentity: (identityId: string) => void;
}) {
  const [tab, setTab] = useState<"ownership" | "priceHistory">("ownership");
  const [copied, setCopied] = useState(false);

  if (loading && !record) {
    return (
      <div className="table-wrap">
        <SkeletonRows count={6} />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="prose">
        <p>That name could not be found.</p>
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={onBack}
        >
          Back to market
        </button>
      </div>
    );
  }

  const forSale = record.price != null && record.price > 0n;
  const lastSale = ownership.find((e) => e.type === "purchase");
  const affordable =
    record.price != null && balance != null ? balance >= record.price : null;
  const shortfall =
    record.price != null && balance != null && balance < record.price
      ? record.price - balance
      : null;
  const documentId = record.documentId;

  async function copyDocumentId() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(documentId);
    setCopied(true);
  }

  return (
    <>
      <div className="breadcrumb">
        <button type="button" className="breadcrumb__link" onClick={onBack}>
          ← Back to {backLabel}
        </button>
        {resultPosition != null && resultCount != null && (
          <>
            <span className="breadcrumb__sep">·</span>
            <span className="breadcrumb__current">
              {resultPosition} of {resultCount} results
            </span>
          </>
        )}
      </div>

      <div className="detail">
        <div>
          <h1 className="detail__title">
            <DpnsName
              label={record.label}
              parentDomainName={record.parentDomainName}
            />
          </h1>
          <div className="detail__badges">
            {forSale && <span className="badge badge--sale">For sale</span>}
            <span className="badge badge--meta detail-doc">
              <ExplorerId
                network={network}
                kind="document"
                id={record.documentId}
                className="detail-doc__link"
              >
                doc {shortId(record.documentId)}
              </ExplorerId>
              <button
                type="button"
                className="detail-doc__copy"
                aria-label="Copy document ID"
                title={copied ? "Copied" : "Copy document ID"}
                onClick={() => void copyDocumentId()}
              >
                {copied ? "✓" : "⧉"}
              </button>
            </span>
            <span className="badge badge--meta">
              rev {String(record.revision)}
            </span>
          </div>

          <div className="fact-strip">
            <div className="fact-cell">
              <span className="label-caps">Owner</span>
              <IdentityLink
                id={record.ownerId}
                onOpen={onOpenIdentity}
                className="fact-cell__value mono"
              />
            </div>
            <div className="fact-cell">
              <span className="label-caps">Resolves to</span>
              <span className="fact-cell__value-line">
                <IdentityLink
                  id={record.resolvesTo}
                  onOpen={onOpenIdentity}
                  className="fact-cell__value mono"
                />
                {record.resolvesTo === record.ownerId && (
                  <span className="fact-cell__same">same as owner</span>
                )}
              </span>
            </div>
            <div className="fact-cell">
              <span className="label-caps">Last sale</span>
              <span className="fact-cell__value">
                {lastSale?.price != null
                  ? `${formatDash(lastSale.price)} DASH · ${formatMonthYear(lastSale.createdAt)}`
                  : "—"}
              </span>
            </div>
          </div>

          <div className="tabs">
            <button
              type="button"
              className={`tab${tab === "ownership" ? " tab--active" : ""}`}
              onClick={() => setTab("ownership")}
            >
              <span>Ownership &amp; sales</span>
              <span className="tab__count">{ownership.length + 1}</span>
            </button>
            <button
              type="button"
              className={`tab${tab === "priceHistory" ? " tab--active" : ""}`}
              onClick={() => setTab("priceHistory")}
            >
              <span>Asking price</span>
              <span className="tab__count">{priceHistory.length}</span>
            </button>
          </div>

          {tab === "ownership" ? (
            <Timeline events={ownership} onOpenIdentity={onOpenIdentity} />
          ) : (
            <Timeline
              events={priceHistory}
              onOpenIdentity={onOpenIdentity}
              showRegistrationNote={false}
            />
          )}

          <p className="timeline-footnote">
            History begins at protocol v13 — transfers and sales were blocked
            before it, so nothing earlier exists on chain.
          </p>
        </div>

        <aside className="buy-panel">
          {forSale && record.price != null ? (
            <>
              <span className="label-caps">Asking price</span>
              <div className="buy-panel__price">
                {formatDash(record.price)} DASH
              </div>
              <div className="buy-panel__credits">
                {formatCredits(record.price)} credits
              </div>

              {isOwner ? (
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  style={{ width: "100%" }}
                  onClick={onManage}
                  disabled={!canWrite}
                >
                  Manage listing
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  style={{ width: "100%" }}
                  onClick={onBuy}
                  disabled={!canWrite}
                >
                  Buy {record.label}.{record.parentDomainName}
                </button>
              )}

              <div className="divider" />

              <div
                className={`buy-panel__row${affordable === false ? " buy-panel__row--short" : affordable ? " buy-panel__row--covered" : ""}`}
              >
                <span className="buy-panel__row-label">Your balance</span>
                <span
                  className={
                    affordable === false
                      ? "buy-panel__row-value--short"
                      : "buy-panel__row-value--ok"
                  }
                >
                  {balance == null
                    ? "Sign in to see"
                    : affordable
                      ? `${formatDash(balance)} DASH · covers it`
                      : `${formatDash(balance)} DASH · ${formatDash(shortfall ?? 0n)} short`}
                </span>
              </div>

              <div className="buy-panel__notes">
                <p className="buy-panel__note buy-panel__note--check">
                  Price is re-checked against Platform when you confirm — if it
                  changed, you see the difference before anything is signed.
                </p>
                <p className="buy-panel__note">
                  Settles in credits. No network fee estimate is available from
                  the SDK, so none is shown.
                </p>
              </div>
            </>
          ) : (
            <>
              <span className="label-caps">Not for sale</span>
              <p className="modal__sub">
                This name is registered and held by{" "}
                <IdentityLink
                  id={record.ownerId}
                  onOpen={onOpenIdentity}
                  className="mono"
                />
                . It has no asking price, so it cannot be bought here.
              </p>
              {isOwner && (
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  style={{ width: "100%", marginTop: 12 }}
                  onClick={onManage}
                  disabled={!canWrite}
                >
                  List for sale
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
