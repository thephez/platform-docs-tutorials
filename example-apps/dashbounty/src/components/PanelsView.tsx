import { useEffect, useState } from "react";

import { CopyableId } from "./CopyableId";
import { fetchContractOwnerId } from "../dash/contract";
import { errorMessage } from "../dash/logger";
import { fetchPanels, type PanelInfo } from "../dash/panel";
import { useSession } from "../session/useSession";

export function PanelsView() {
  const session = useSession();
  const [panels, setPanels] = useState<PanelInfo[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!session.sdk || !session.contractId) return;
    setError(null);
    try {
      const [panelInfo, owner] = await Promise.all([
        fetchPanels({
          sdk: session.sdk,
          contractId: session.contractId,
        }),
        fetchContractOwnerId({
          sdk: session.sdk,
          contractId: session.contractId,
        }),
      ]);
      setPanels(panelInfo);
      setOwnerId(owner);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sdk, session.contractId]);

  if (!session.contractId) {
    return <div className="notice info">Configure a Sift contract first.</div>;
  }

  return (
    <div>
      {error && <div className="notice error">{error}</div>}
      <div className="card">
        <h3>Sift panels</h3>
        <p className="muted">
          Sift uses explicit Platform groups so different token functions can
          have different thresholds. This PoC uses the same three panelists with
          stricter consensus for permanent revocation.
        </p>
        {ownerId && (
          <p className="muted row">
            Contract owner: <CopyableId id={ownerId} />
          </p>
        )}
      </div>

      <div className="list">
        {panels.map((panel) => (
          <div key={panel.kind} className="card">
            <div className="row between">
              <h3>{panel.label}</h3>
              <span className="badge">Group {panel.groupPosition}</span>
            </div>
            <p className="muted">{panel.description}</p>
            <p className="muted">
              Requires {panel.requiredPower} of {panel.members.size} members.
            </p>
            <ul>
              {[...panel.members.keys()].map((id) => (
                <li key={id}>
                  <CopyableId id={id} />
                  {id === session.identityId && " (you)"}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="notice info">
        Access Panel: suspend/restore access. Revocation Panel: revoke suspended
        Sift tokens.
      </div>
    </div>
  );
}
