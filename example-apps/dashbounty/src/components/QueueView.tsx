import { useEffect, useState } from "react";

import { CopyableId } from "./CopyableId";
import type { PanelPrefill } from "./PanelView";
import type { PanelActionKind } from "../dash/contract";
import { fetchFrozenStatus } from "../dash/frozenStatus";
import { fetchSiftGovernance } from "../dash/governance";
import { errorMessage } from "../dash/logger";
import {
  isPanelMember,
  panelForAction,
  panelsFromGovernance,
  type PanelInfo,
} from "../dash/panel";
import {
  listAllSubmissions,
  listSubmissionsByComponent,
  listSubmissionsBySeverity,
  type Submission,
} from "../dash/queries";
import { formatDate, severityLabel } from "../lib/format";
import { useSession } from "../session/useSession";
import type { SiftGovernance } from "../dash/governance";
import type { SubmissionSeverity } from "../dash/submitSubmission";

function actionLabel(kind: PanelActionKind): string {
  if (kind === "freeze") return "Suspend access";
  if (kind === "unfreeze") return "Restore access";
  return "Revoke suspended tokens";
}

export function QueueView({
  onRequestPanelAction,
}: {
  onRequestPanelAction?: (prefill: PanelPrefill) => void;
} = {}) {
  const session = useSession();
  const [severityFilter, setSeverityFilter] = useState<SubmissionSeverity | "">(
    "",
  );
  const [componentFilter, setComponentFilter] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [suspendedOwners, setSuspendedOwners] = useState<Set<string>>(
    new Set(),
  );
  const [panels, setPanels] = useState<PanelInfo[]>([]);
  const [assignments, setAssignments] = useState<
    SiftGovernance["assignments"] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { sdk, contractId } = session;
      if (!sdk || !contractId) {
        if (!cancelled) setSubmissions([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const trimmedComponent = componentFilter.trim();
        const results = trimmedComponent
          ? await listSubmissionsByComponent({
              sdk,
              contractId,
              component: trimmedComponent,
            })
          : severityFilter
            ? await listSubmissionsBySeverity({
                sdk,
                contractId,
                severity: severityFilter,
              })
            : await listAllSubmissions({ sdk, contractId });
        if (cancelled) return;
        setSubmissions(results);

        // Panel members can start reviewer actions from a card. Load the
        // current governance so we know who may act and which panel owns
        // each action. Only worth fetching when signed in.
        if (session.identityId) {
          try {
            const governance = await fetchSiftGovernance({ sdk, contractId });
            if (!cancelled) {
              setPanels(panelsFromGovernance(governance));
              setAssignments(governance.assignments);
            }
          } catch {
            // best-effort; cards simply won't offer action buttons
          }
        } else if (!cancelled) {
          setPanels([]);
          setAssignments(null);
        }

        const owners = [...new Set(results.map((r) => r.ownerId))];
        const suspended = new Set<string>();
        await Promise.all(
          owners.map(async (ownerId) => {
            try {
              const isSuspended = await fetchFrozenStatus({
                sdk,
                contractId,
                identityId: ownerId,
              });
              if (isSuspended) suspended.add(ownerId);
            } catch {
              // best-effort; leave unmarked on failure
            }
          }),
        );
        if (!cancelled) setSuspendedOwners(suspended);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, severityFilter, componentFilter]);

  // Which reviewer actions the signed-in viewer may propose against a given
  // submitter, given the owner's current suspension state. An action is
  // offered only when the viewer is a member of the panel that owns it and
  // the action is meaningful for the current state.
  function availableActions(ownerId: string): PanelActionKind[] {
    if (!session.identityId || !assignments || panels.length === 0) return [];
    const suspended = suspendedOwners.has(ownerId);
    const relevant: PanelActionKind[] = suspended
      ? ["unfreeze", "destroy"]
      : ["freeze"];
    return relevant.filter((kind) => {
      const panel = panelForAction(panels, assignments, kind);
      return panel ? isPanelMember(panel, session.identityId!) : false;
    });
  }

  return (
    <div>
      <div className="card">
        <p className="muted">
          Sift is a token-gated review queue for separating real security signal
          from AI slop. Submissions are public summaries plus optional evidence
          hashes.
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="filter-severity">Filter by severity</label>
            <select
              id="filter-severity"
              value={severityFilter}
              onChange={(event) => {
                setSeverityFilter(
                  event.target.value as SubmissionSeverity | "",
                );
                setComponentFilter("");
              }}
            >
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="filter-component">Filter by component</label>
            <input
              id="filter-component"
              value={componentFilter}
              onChange={(event) => {
                setComponentFilter(event.target.value);
                setSeverityFilter("");
              }}
              placeholder="e.g. Auth"
            />
          </div>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      <div className="list">
        {submissions.map((submission) => {
          const actions = availableActions(submission.ownerId);
          return (
            <div key={submission.id} className="card">
              <div className="row between">
                <strong>{submission.title}</strong>
                <span className={`badge ${submission.severity}`}>
                  {severityLabel(submission.severity)}
                </span>
              </div>
              <p className="muted">{submission.component}</p>
              <p>{submission.description}</p>
              <div className="row between">
                <span className="muted row">
                  <CopyableId id={submission.ownerId} len={6} /> ·{" "}
                  {formatDate(submission.createdAt)}
                </span>
                {suspendedOwners.has(submission.ownerId) && (
                  <span className="badge frozen">Access suspended</span>
                )}
              </div>
              {actions.length > 0 && (
                <div className="row">
                  {actions.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() =>
                        onRequestPanelAction?.({
                          kind,
                          targetIdentityId: submission.ownerId,
                        })
                      }
                    >
                      {actionLabel(kind)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!loading && submissions.length === 0 && (
          <p className="muted">No submissions found.</p>
        )}
      </div>
    </div>
  );
}
