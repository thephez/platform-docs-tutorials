import { useEffect, useMemo, useState } from "react";

import { CopyableId } from "./CopyableId";
import { fetchContractOwnerId, type PanelActionKind } from "../dash/contract";
import {
  appendSiftGroup,
  assignSiftFunctionGroup,
  fetchSiftGovernance,
  type SiftGovernance,
} from "../dash/governance";
import { errorMessage } from "../dash/logger";
import {
  actionLabel,
  panelsFromGovernance,
  type PanelInfo,
} from "../dash/panel";
import { useSession } from "../session/useSession";

const ACTION_OPTIONS: PanelActionKind[] = ["freeze", "unfreeze", "destroy"];

export function PanelsView() {
  const session = useSession();
  const [governance, setGovernance] = useState<SiftGovernance | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [memberIds, setMemberIds] = useState(["", "", ""]);
  const [requiredPower, setRequiredPower] = useState(2);
  const [assignAction, setAssignAction] = useState<PanelActionKind>("freeze");
  const [assignGroupPosition, setAssignGroupPosition] = useState(0);

  const panels = useMemo<PanelInfo[]>(
    () => (governance ? panelsFromGovernance(governance) : []),
    [governance],
  );
  const isOwner =
    session.status === "authenticated" &&
    Boolean(ownerId && session.identityId === ownerId);

  async function refresh() {
    if (!session.sdk || !session.contractId) return;
    setError(null);
    try {
      const [nextGovernance, owner] = await Promise.all([
        fetchSiftGovernance({
          sdk: session.sdk,
          contractId: session.contractId,
          log: session.log,
        }),
        fetchContractOwnerId({
          sdk: session.sdk,
          contractId: session.contractId,
        }),
      ]);
      setGovernance(nextGovernance);
      setOwnerId(owner);
      setAssignGroupPosition(nextGovernance.assignments.freeze);
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

  async function handleAddGroup(event: React.FormEvent) {
    event.preventDefault();
    if (
      !session.sdk ||
      !session.keyManager ||
      !session.contractId ||
      !ownerId
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { identityKey, signer } = await session.keyManager.getAuth();
      await appendSiftGroup({
        sdk: session.sdk,
        contractId: session.contractId,
        ownerId,
        memberIds,
        requiredPower,
        identityKey,
        signer,
        log: session.log,
      });
      setMemberIds(["", "", ""]);
      setRequiredPower(2);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(event: React.FormEvent) {
    event.preventDefault();
    if (
      !session.sdk ||
      !session.keyManager ||
      !session.contractId ||
      !ownerId
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { identityKey, signer } = await session.keyManager.getAuth();
      await assignSiftFunctionGroup({
        sdk: session.sdk,
        contractId: session.contractId,
        ownerId,
        actionKind: assignAction,
        groupPosition: assignGroupPosition,
        identityKey,
        signer,
        log: session.log,
      });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!session.contractId) {
    return <div className="notice info">Configure a Sift contract first.</div>;
  }

  return (
    <div>
      {error && <div className="notice error">{error}</div>}
      {governance?.usedFallbackAssignments && (
        <div className="notice info">
          Function assignment metadata could not be fully read. Showing Sift's
          default group mapping.
        </div>
      )}

      <div className="card">
        <h3>Sift groups</h3>
        <p className="muted">
          Sift groups are immutable once added. The contract owner can append a
          new 3-member group, then assign token functions to that group.
        </p>
        {ownerId && (
          <p className="muted row">
            Contract owner: <CopyableId id={ownerId} />
          </p>
        )}
      </div>

      <div className="list">
        {panels.map((panel) => (
          <div key={panel.groupPosition} className="card">
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

      {governance && (
        <div className="card">
          <h3>Function assignments</h3>
          <div className="list">
            {ACTION_OPTIONS.map((kind) => (
              <p key={kind} className="muted row">
                {actionLabel(kind)}: group {governance.assignments[kind]}
              </p>
            ))}
          </div>
        </div>
      )}

      {session.status === "authenticated" && !isOwner && (
        <div className="notice info">
          Only the contract owner can add groups or assign token functions.
        </div>
      )}

      {isOwner && governance && (
        <div className="grid-2">
          <div className="card">
            <h3>Add group</h3>
            <form onSubmit={handleAddGroup}>
              {memberIds.map((id, index) => (
                <div className="field" key={index}>
                  <label htmlFor={`member-${index}`}>Member {index + 1}</label>
                  <input
                    id={`member-${index}`}
                    value={id}
                    onChange={(event) =>
                      setMemberIds((prev) =>
                        prev.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      )
                    }
                    required
                  />
                </div>
              ))}
              <div className="field">
                <label htmlFor="required-power">Required power</label>
                <select
                  id="required-power"
                  value={requiredPower}
                  onChange={(event) =>
                    setRequiredPower(Number(event.target.value))
                  }
                >
                  <option value={1}>1 of 3</option>
                  <option value={2}>2 of 3</option>
                  <option value={3}>3 of 3</option>
                </select>
              </div>
              <button type="submit" disabled={busy}>
                Add group
              </button>
            </form>
          </div>

          <div className="card">
            <h3>Assign function</h3>
            <form onSubmit={handleAssign}>
              <div className="field">
                <label htmlFor="assign-action">Function</label>
                <select
                  id="assign-action"
                  value={assignAction}
                  onChange={(event) => {
                    const next = event.target.value as PanelActionKind;
                    setAssignAction(next);
                    setAssignGroupPosition(governance.assignments[next]);
                  }}
                >
                  {ACTION_OPTIONS.map((kind) => (
                    <option key={kind} value={kind}>
                      {actionLabel(kind)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="assign-group">Group</label>
                <select
                  id="assign-group"
                  value={assignGroupPosition}
                  onChange={(event) =>
                    setAssignGroupPosition(Number(event.target.value))
                  }
                >
                  {panels.map((panel) => (
                    <option
                      key={panel.groupPosition}
                      value={panel.groupPosition}
                    >
                      Group {panel.groupPosition} ({panel.requiredPower}/
                      {panel.members.size})
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" disabled={busy}>
                Assign function
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
