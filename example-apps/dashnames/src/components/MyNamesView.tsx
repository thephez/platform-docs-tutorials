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
import type { DomainRecord } from "../dash/dpnsQueries";
import { formatDash, shortId } from "../lib/format";
import { DpnsName } from "./DpnsName";
import { Price } from "./Price";
import { SkeletonPortfolio } from "./Skeleton";

export function MyNamesView({
  names,
  loading,
  identityName,
  identityId,
  balance,
  canWrite,
  primaryName,
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
  primaryName: string | null;
  onManage: (record: DomainRecord) => void;
  onTransfer: (record: DomainRecord) => void;
  onOpen: (record: DomainRecord) => void;
}) {
  const listed = names.filter((n) => n.price != null && n.price > 0n);

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
      <div className="page-head">
        <div>
          <h1 className="page-head__title">My names</h1>
          <p className="page-head__sub">
            {names.length} {names.length === 1 ? "name" : "names"} owned by{" "}
            {identityName ?? shortId(identityId)} · {listed.length} listed
            {balance != null && ` · balance ${formatDash(balance)} DASH`}
          </p>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={!canWrite || names.length === 0}
            onClick={() => names[0] && onTransfer(names[0])}
          >
            Transfer a name
          </button>
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
        <div className="portfolio">
          {names.map((record) => {
            const isListed = record.price != null && record.price > 0n;
            return (
              <div key={record.documentId} className="portfolio-row">
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
                    {primaryName ===
                      `${record.label}.${record.parentDomainName}` && (
                      <span className="badge badge--primary">Primary</span>
                    )}
                  </div>
                  <div className="portfolio-row__meta">
                    {isListed ? "Listed for sale" : "Not listed"} · rev{" "}
                    {String(record.revision)}
                    {record.resolvesTo === record.ownerId
                      ? " · resolves to your identity"
                      : ""}
                  </div>
                </div>

                <div className="portfolio-row__right">
                  <div className="portfolio-row__value">
                    {isListed && record.price != null ? (
                      <>
                        <Price
                          credits={record.price}
                          align="right"
                          className="portfolio-row__price"
                        />
                        <div className="portfolio-row__state">Listed</div>
                      </>
                    ) : (
                      <span className="portfolio-row__unlisted">
                        Not listed
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`btn btn--xs ${isListed ? "btn--outline" : "btn--primary"}`}
                    disabled={!canWrite}
                    onClick={() => onManage(record)}
                  >
                    {isListed ? "Manage" : "List for sale"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
