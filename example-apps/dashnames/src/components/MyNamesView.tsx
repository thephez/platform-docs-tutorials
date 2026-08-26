/**
 * My names / portfolio.
 *
 * Deviations, both because the data doesn't exist:
 *  - No "Register a name" button. Registration is deliberately out of scope —
 *    it needs the preorder/commit flow plus contested-name vote handling, and
 *    leaving it out keeps the v13 gate uniform across every write path. The
 *    tutorial `name-register.mjs` covers it.
 *  - Unlisted rows show no "Est. 3–6 DASH" estimate. Comparable-sales valuation
 *    needs data the protocol doesn't provide, so an invented range would be
 *    fabricated advice.
 */
import { useEffect, useState } from "react";
import type { DomainRecord } from "../dash/dpnsQueries";
import { formatDash, shortId } from "../lib/format";
import { DpnsName } from "./DpnsName";
import { Price } from "./Price";
import { SkeletonPortfolio } from "./Skeleton";

type PortfolioFilter = "all" | "listed" | "unlisted";

const FILTERS: Array<{ value: PortfolioFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "listed", label: "Listed" },
  { value: "unlisted", label: "Not listed" },
];

export function MyNamesView({
  names,
  loading,
  identityName,
  identityId,
  balance,
  canWrite,
  onManage,
  onTransfer,
  onOpen,
}: {
  names: DomainRecord[];
  loading: boolean;
  identityName: string | null;
  identityId: string | null;
  balance: bigint | null;
  canWrite: boolean;
  onManage: (record: DomainRecord) => void;
  onTransfer: (record: DomainRecord) => void;
  onOpen: (record: DomainRecord) => void;
}) {
  const [filter, setFilter] = useState<PortfolioFilter>("all");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const listed = names.filter((n) => n.price != null && n.price > 0n);
  const unlistedCount = names.length - listed.length;
  const totalAsked = listed.reduce(
    (sum, record) => sum + (record.price ?? 0n),
    0n,
  );
  const visible = names.filter((record) => {
    const isListed = record.price != null && record.price > 0n;
    if (filter === "listed") return isListed;
    if (filter === "unlisted") return !isListed;
    return true;
  });
  const filterCounts: Record<PortfolioFilter, number> = {
    all: names.length,
    listed: listed.length,
    unlisted: unlistedCount,
  };

  useEffect(() => {
    if (!openMenuId) return;

    function closeMenu(event: PointerEvent | KeyboardEvent) {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape")
        return;
      if (
        event.type === "pointerdown" &&
        event.target instanceof Element &&
        event.target.closest(".portfolio-row__menu")
      ) {
        return;
      }
      setOpenMenuId(null);
    }

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, [openMenuId]);

  async function copyDocumentId(documentId: string) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(documentId);
        setCopiedId(documentId);
      }
    } finally {
      setOpenMenuId(null);
    }
  }

  if (!identityId) {
    return (
      <div className="prose">
        <h2>My names</h2>
        <p>
          Sign in with a recovery phrase to see the names this identity owns and
          to list them for sale.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="page-head my-names-head">
        <div>
          <h1 className="page-head__title">My names</h1>
          <p className="page-head__sub">
            Held by <strong>{identityName ?? shortId(identityId)}</strong>{" "}
            <span className="mono">{shortId(identityId)}</span>
          </p>
        </div>
        <div className="portfolio-summary" aria-label="Portfolio summary">
          <div className="portfolio-summary__item">
            <strong>{names.length}</strong>
            <span>owned</span>
          </div>
          <div className="portfolio-summary__item portfolio-summary__item--listed">
            <strong>{listed.length}</strong>
            <span>listed</span>
          </div>
          <div className="portfolio-summary__item">
            <strong>{formatDash(totalAsked)}</strong>
            <span>DASH asked</span>
          </div>
          <div className="portfolio-summary__item portfolio-summary__item--balance">
            <strong>{balance == null ? "—" : formatDash(balance)}</strong>
            <span>DASH balance</span>
          </div>
        </div>
      </div>

      {loading && names.length === 0 ? (
        <SkeletonPortfolio count={4} />
      ) : names.length === 0 ? (
        <div className="prose">
          <p>
            This identity doesn't own any DPNS names yet. dashnames trades names
            that already exist — register one with the repo's{" "}
            <code>name-register.mjs</code> tutorial, then list it here.
          </p>
        </div>
      ) : (
        <>
          <div className="portfolio-filters" aria-label="Filter names">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`portfolio-filter${filter === item.value ? " portfolio-filter--active" : ""}`}
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
              >
                <span>{item.label}</span>
                <span className="portfolio-filter__count">
                  {filterCounts[item.value]}
                </span>
              </button>
            ))}
          </div>
          <div className="portfolio portfolio--my-names">
            {visible.map((record) => {
              const isListed = record.price != null && record.price > 0n;
              return (
                <div
                  key={record.documentId}
                  className={`portfolio-row portfolio-row--my-name${isListed ? " portfolio-row--listed" : ""}`}
                >
                  <div className="portfolio-row__left">
                    <div className="portfolio-row__name-line">
                      <button
                        type="button"
                        className="portfolio-row__name"
                        onClick={() => onOpen(record)}
                        style={{ background: "none", border: 0, padding: 0 }}
                      >
                        <DpnsName
                          label={record.label}
                          parentDomainName={record.parentDomainName}
                        />
                      </button>
                      <span
                        className={`portfolio-status${isListed ? " portfolio-status--listed" : ""}`}
                      >
                        {isListed ? "Listed" : "Idle"}
                      </span>
                    </div>
                    <div className="portfolio-row__meta">
                      rev {String(record.revision)}
                      {record.resolvesTo === record.ownerId
                        ? " · resolves to your identity"
                        : " · resolves elsewhere"}
                    </div>
                  </div>

                  <div className="portfolio-row__value">
                    {isListed && record.price != null ? (
                      <Price
                        credits={record.price}
                        align="right"
                        compactCredits
                        className="portfolio-row__price"
                      />
                    ) : (
                      <span className="portfolio-row__unlisted">
                        <strong>No price</strong>
                        <span>not for sale</span>
                      </span>
                    )}
                  </div>
                  <div className="portfolio-row__actions">
                    <button
                      type="button"
                      className={`btn btn--xs ${isListed ? "btn--outline" : "btn--primary"}`}
                      disabled={!canWrite}
                      onClick={() => onManage(record)}
                    >
                      {isListed ? "Manage" : "List for sale"}
                    </button>
                    <div className="portfolio-row__menu">
                      <button
                        type="button"
                        className="portfolio-row__menu-trigger"
                        aria-label={`More actions for ${record.label}.${record.parentDomainName}`}
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === record.documentId}
                        onClick={() =>
                          setOpenMenuId((current) =>
                            current === record.documentId
                              ? null
                              : record.documentId,
                          )
                        }
                      >
                        ⋮
                      </button>
                      {openMenuId === record.documentId && (
                        <div
                          className="portfolio-row__menu-popover"
                          role="menu"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            disabled={!canWrite}
                            onClick={() => {
                              setOpenMenuId(null);
                              onTransfer(record);
                            }}
                          >
                            Transfer
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuId(null);
                              onOpen(record);
                            }}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() =>
                              void copyDocumentId(record.documentId)
                            }
                          >
                            {copiedId === record.documentId
                              ? "Copied"
                              : "Copy ID"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
