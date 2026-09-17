import type { DomainRecord } from "../dash/dpnsQueries";
import type { Network } from "../dash/contracts";
import { shortId } from "../lib/format";
import { DpnsName } from "./DpnsName";
import { ExplorerId } from "./ExplorerId";
import { IdentityLink } from "./IdentityLink";
import { SkeletonPortfolio } from "./Skeleton";

export function IdentityView({
  identityId,
  names,
  loading,
  error,
  network,
  onBack,
  onOpenName,
  onOpenIdentity,
}: {
  identityId: string;
  names: DomainRecord[];
  loading: boolean;
  error: string | null;
  network: Network;
  onBack: () => void;
  onOpenName: (record: DomainRecord) => void;
  onOpenIdentity: (identityId: string) => void;
}) {
  return (
    <>
      <div className="page-head identity-head">
        <div className="identity-head__content">
          <button
            type="button"
            className="breadcrumb__link identity-head__back"
            onClick={onBack}
          >
            ← Back
          </button>
          <h1 className="page-head__title">Identity {shortId(identityId)}</h1>
          <code className="identity-head__id">{identityId}</code>
          <p className="page-head__sub">
            {loading
              ? "Loading resolving names…"
              : `${names.length} ${names.length === 1 ? "name resolves" : "names resolve"} to this identity`}
          </p>
        </div>
        <ExplorerId
          network={network}
          kind="identity"
          id={identityId}
          className="btn btn--outline btn--sm"
        >
          View identity in Explorer ↗
        </ExplorerId>
      </div>

      {loading ? (
        <SkeletonPortfolio count={4} />
      ) : error ? (
        <div className="prose identity-state" role="alert">
          <h2>Couldn’t load identity names</h2>
          <p>{error}</p>
        </div>
      ) : names.length === 0 ? (
        <div className="prose identity-state">
          <h2>No resolving names</h2>
          <p>No DPNS names currently point to this identity.</p>
        </div>
      ) : (
        <div className="portfolio">
          {names.map((record) => {
            const ownedHere = record.ownerId === identityId;
            return (
              <div key={record.documentId} className="portfolio-row">
                <div className="portfolio-row__left">
                  <div className="portfolio-row__name-line">
                    <button
                      type="button"
                      className="portfolio-row__name"
                      onClick={() => onOpenName(record)}
                    >
                      <DpnsName
                        label={record.label}
                        parentDomainName={record.parentDomainName}
                      />
                    </button>
                  </div>
                  <div className="portfolio-row__meta">
                    Resolves to this identity · rev {String(record.revision)}
                  </div>
                </div>
                <div className="identity-owner">
                  <span className="label-caps">Owner</span>
                  {ownedHere ? (
                    <span className="identity-owner__same">This identity</span>
                  ) : (
                    <IdentityLink
                      id={record.ownerId}
                      onOpen={onOpenIdentity}
                      className="mono"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
