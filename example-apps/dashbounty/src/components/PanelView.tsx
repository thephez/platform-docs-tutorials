import { useEffect, useMemo, useState } from "react";

import { CopyableId } from "./CopyableId";
import { groupPositionForAction, type PanelActionKind } from "../dash/contract";
import { destroyFrozenCredit } from "../dash/destroyFrozenCredit";
import {
  describeGroupAction,
  listActionSigners,
  listPendingActions,
  type ActionSignerProgress,
  type PendingAction,
} from "../dash/groupActions";
import { freezeCredit } from "../dash/freezeCredit";
import { errorMessage } from "../dash/logger";
import {
  fetchPanels,
  isPanelMember,
  panelKindForAction,
  type PanelInfo,
} from "../dash/panel";
import { unfreezeCredit } from "../dash/unfreezeCredit";
import { useSession } from "../session/useSession";

type UiPendingAction = PendingAction & { panel: PanelInfo };

function actionKindFromName(eventName: string): PanelActionKind | null {
  const lower = eventName.toLowerCase();
  if (lower.includes("unfreeze")) return "unfreeze";
  if (lower.includes("freeze")) return "freeze";
  if (lower.includes("destroy")) return "destroy";
  return null;
}

function actionLabel(kind: PanelActionKind): string {
  if (kind === "freeze") return "Suspend access";
  if (kind === "unfreeze") return "Restore access";
  return "Revoke suspended tokens";
}

async function runAction(
  kind: PanelActionKind,
  args: {
    sdk: NonNullable<ReturnType<typeof useSession>["sdk"]>;
    keyManager: NonNullable<ReturnType<typeof useSession>["keyManager"]>;
    contractId: string;
    groupPosition: number;
    frozenIdentityId: string;
    actionId?: string;
    publicNote?: string;
    log: ReturnType<typeof useSession>["log"];
  },
) {
  if (kind === "freeze") return freezeCredit(args);
  if (kind === "unfreeze") return unfreezeCredit(args);
  return destroyFrozenCredit(args);
}

export function PanelView() {
  const session = useSession();
  const [panels, setPanels] = useState<PanelInfo[]>([]);
  const [pending, setPending] = useState<UiPendingAction[]>([]);
  const [signerProgress, setSignerProgress] = useState<
    Map<string, ActionSignerProgress>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [proposeKind, setProposeKind] = useState<PanelActionKind>("freeze");
  const [targetIdentityId, setTargetIdentityId] = useState("");
  const [note, setNote] = useState("");
  const [cosignTargets, setCosignTargets] = useState<Record<string, string>>(
    {},
  );

  const panelsByKind = useMemo(
    () => new Map(panels.map((panel) => [panel.kind, panel])),
    [panels],
  );
  const proposePanel = panelsByKind.get(panelKindForAction(proposeKind));
  const canPropose =
    proposePanel && session.identityId
      ? isPanelMember(proposePanel, session.identityId)
      : false;

  async function refresh() {
    if (!session.sdk || !session.contractId) return;
    setError(null);
    try {
      const nextPanels = await fetchPanels({
        sdk: session.sdk,
        contractId: session.contractId,
      });
      setPanels(nextPanels);

      const pendingWithPanels: UiPendingAction[] = [];
      const progress = new Map<string, ActionSignerProgress>();
      await Promise.all(
        nextPanels.map(async (panel) => {
          const actions = await listPendingActions({
            sdk: session.sdk!,
            contractId: session.contractId!,
            groupPosition: panel.groupPosition,
          });
          pendingWithPanels.push(
            ...actions.map((action) => ({ ...action, panel })),
          );
          await Promise.all(
            actions.map(async (action) => {
              const p = await listActionSigners({
                sdk: session.sdk!,
                contractId: session.contractId!,
                groupPosition: panel.groupPosition,
                actionId: action.actionId,
                requiredPower: panel.requiredPower,
              });
              progress.set(action.actionId, p);
            }),
          );
        }),
      );
      setPending(pendingWithPanels);
      setSignerProgress(progress);
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

  async function handlePropose(event: React.FormEvent) {
    event.preventDefault();
    if (!session.sdk || !session.keyManager || !session.contractId) return;
    setBusy(true);
    setError(null);
    try {
      await runAction(proposeKind, {
        sdk: session.sdk,
        keyManager: session.keyManager,
        contractId: session.contractId,
        groupPosition: groupPositionForAction(proposeKind),
        frozenIdentityId: targetIdentityId.trim(),
        publicNote: note.trim() || undefined,
        log: session.log,
      });
      setTargetIdentityId("");
      setNote("");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCosign(action: UiPendingAction) {
    if (!session.sdk || !session.keyManager || !session.contractId) return;
    const kind = actionKindFromName(action.eventName);
    if (!kind) {
      setError(`Unrecognized action type: ${action.eventName}`);
      return;
    }
    const frozenIdentityId = (cosignTargets[action.actionId] ?? "").trim();
    if (!frozenIdentityId) {
      setError("Confirm the target identity ID before co-signing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await runAction(kind, {
        sdk: session.sdk,
        keyManager: session.keyManager,
        contractId: session.contractId,
        groupPosition: action.panel.groupPosition,
        frozenIdentityId,
        actionId: action.actionId,
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

      <div className="card">
        <h3>Review Panel</h3>
        <p className="muted">
          Access actions require the 2-of-3 Access Panel. Revoking suspended
          tokens requires the stricter 3-of-3 Revocation Panel.
        </p>
        <div className="list">
          {panels.map((panel) => (
            <div key={panel.kind} className="card">
              <div className="row between">
                <strong>{panel.label}</strong>
                <span className="muted">
                  {panel.requiredPower}/{panel.members.size} required · group{" "}
                  {panel.groupPosition}
                </span>
              </div>
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
      </div>

      {session.status === "authenticated" && !canPropose && (
        <p className="notice info">
          You are signed in but are not a member of the selected action's panel.
        </p>
      )}

      {canPropose && (
        <div className="card">
          <h3>Propose an action</h3>
          <form onSubmit={handlePropose}>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="propose-kind">Action</label>
                <select
                  id="propose-kind"
                  value={proposeKind}
                  onChange={(event) =>
                    setProposeKind(event.target.value as PanelActionKind)
                  }
                >
                  <option value="freeze">Suspend access</option>
                  <option value="unfreeze">Restore access</option>
                  <option value="destroy">Revoke suspended tokens</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="target">Target identity ID</label>
                <input
                  id="target"
                  value={targetIdentityId}
                  onChange={(event) => setTargetIdentityId(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="note">Public note (optional)</label>
              <input
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <button type="submit" disabled={busy}>
              Propose {actionLabel(proposeKind)}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <h3>Pending actions</h3>
        <div className="list">
          {pending.map((action) => {
            const progress = signerProgress.get(action.actionId);
            const alreadySigned = session.identityId
              ? (progress?.hasSigned(session.identityId) ?? false)
              : false;
            const member = session.identityId
              ? isPanelMember(action.panel, session.identityId)
              : false;
            const pct = progress
              ? Math.min(
                  100,
                  (Number(progress.signedPower) / progress.requiredPower) * 100,
                )
              : 0;
            return (
              <div key={action.actionId} className="card">
                <div className="row between">
                  <strong>{describeGroupAction(action.eventName)}</strong>
                  <span className="muted row">
                    {action.panel.label} · proposed by{" "}
                    <CopyableId id={action.proposerId} len={6} />
                  </span>
                </div>
                {progress && (
                  <>
                    <div className="progress">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <p className="muted">
                      {progress.signedPower.toString()}/{progress.requiredPower}{" "}
                      power signed
                    </p>
                  </>
                )}
                {member && !alreadySigned && (
                  <div className="row">
                    <input
                      placeholder="Confirm target identity ID"
                      value={cosignTargets[action.actionId] ?? ""}
                      onChange={(event) =>
                        setCosignTargets((prev) => ({
                          ...prev,
                          [action.actionId]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleCosign(action)}
                    >
                      Co-sign
                    </button>
                  </div>
                )}
                {member && alreadySigned && (
                  <p className="muted">You have already signed this action.</p>
                )}
              </div>
            );
          })}
          {pending.length === 0 && (
            <p className="muted">No pending panel actions.</p>
          )}
        </div>
      </div>
    </div>
  );
}
