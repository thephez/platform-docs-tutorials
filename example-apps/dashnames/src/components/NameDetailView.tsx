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

export function NameDetailView({
  record,
  ownership,
  priceHistory,
  loading,
  balance,
  isOwner,
  canWrite,
  onBack,
  onBuy,
  onManage,
}: {
  record: DomainRecord | null;
  ownership: HistoryEvent[];
  priceHistory: HistoryEvent[];
  loading: boolean;
  balance: bigint | null;
  isOwner: boolean;
  canWrite: boolean;
  onBack: () => void;
  onBuy: () => void;
  onManage: () => void;
}) {
  const [tab, setTab] = useState<"ownership" | "priceHistory">("ownership");

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

  return (
    <>
      <div className="breadcrumb">
        <button type="button" className="breadcrumb__link" onClick={onBack}>
          Discover
        </button>
        <span className="breadcrumb__sep">/</span>
        <span className="breadcrumb__link">Names</span>
        <span className="breadcrumb__sep">/</span>
        <span className="breadcrumb__current">
          {record.label}.{record.parentDomainName}
        </span>
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
            <span className="badge badge--meta">
              doc {shortId(record.documentId)}
            </span>
            <span className="badge badge--meta">
              rev {String(record.revision)}
            </span>
          </div>

          <div className="fact-strip">
            <div className="fact-cell">
              <span className="label-caps">Current owner</span>
              <span className="fact-cell__value mono" title={record.ownerId}>
                {shortId(record.ownerId)}
              </span>
            </div>
            <div className="fact-cell">
              <span className="label-caps">Resolves to</span>
              <span
                className="fact-cell__value mono"
                title={record.resolvesTo ?? undefined}
              >
                {shortId(record.resolvesTo)}
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
              Ownership &amp; sales
            </button>
            <button
              type="button"
              className={`tab${tab === "priceHistory" ? " tab--active" : ""}`}
              onClick={() => setTab("priceHistory")}
            >
              Asking-price history
            </button>
          </div>

          {tab === "ownership" ? (
            <Timeline events={ownership} />
          ) : (
            <Timeline events={priceHistory} showRegistrationNote={false} />
          )}

          <div className="block-warning" style={{ marginTop: 16 }}>
            Timeline merges protocol-created <strong>transfer</strong> and{" "}
            <strong>purchase</strong> records. Events before protocol v13 are
            not available — transfers and sales were blocked then.
          </div>
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
                  Buy this name
                </button>
              )}

              <div className="divider" />

              <div className="buy-panel__row">
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
                    : `${formatDash(balance)} DASH`}
                </span>
              </div>

              <div className="block-inset">
                The price is confirmed against Platform at checkout. If the
                owner has repriced, delisted, or sold since this page loaded,
                you'll be told before signing.
              </div>
            </>
          ) : (
            <>
              <span className="label-caps">Not for sale</span>
              <p className="modal__sub">
                This name is registered and held by{" "}
                <span className="mono">{shortId(record.ownerId)}</span>. It has
                no asking price, so it cannot be bought here.
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
