import { useEffect, useState } from "react";

import { errorMessage } from "../dash/logger";
import { listSubmissionsByOwner, type Submission } from "../dash/queries";
import { updateSubmission } from "../dash/updateSubmission";
import { formatDate, severityLabel } from "../lib/format";
import { useSession } from "../session/useSession";

export function MySubmissionsView() {
  const session = useSession();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!session.sdk || !session.contractId || !session.identityId) {
      setSubmissions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await listSubmissionsByOwner({
        sdk: session.sdk,
        contractId: session.contractId,
        ownerId: session.identityId,
      });
      setSubmissions(results);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sdk, session.contractId, session.identityId]);

  function startEdit(submission: Submission) {
    setEditingId(submission.id);
    setEditDescription(submission.description);
  }

  async function saveEdit(submissionId: string) {
    if (!session.sdk || !session.keyManager || !session.contractId) return;
    setBusy(true);
    setError(null);
    try {
      await updateSubmission({
        sdk: session.sdk,
        keyManager: session.keyManager,
        contractId: session.contractId,
        submissionId,
        updates: { description: editDescription },
        log: session.log,
      });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (session.status !== "authenticated") {
    return <div className="notice info">Sign in to see your submissions.</div>;
  }

  return (
    <div>
      {error && <div className="notice error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      <div className="list">
        {submissions.map((submission) => (
          <div key={submission.id} className="card">
            <div className="row between">
              <strong>{submission.title}</strong>
              <span className={`badge ${submission.severity}`}>
                {severityLabel(submission.severity)}
              </span>
            </div>
            <p className="muted">
              {submission.component} · filed {formatDate(submission.createdAt)}
            </p>
            {editingId === submission.id ? (
              <>
                <textarea
                  rows={4}
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                />
                <div className="row" style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveEdit(submission.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>{submission.description}</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => startEdit(submission)}
                >
                  Edit
                </button>
              </>
            )}
          </div>
        ))}
        {!loading && submissions.length === 0 && (
          <p className="muted">You haven't filed any submissions yet.</p>
        )}
      </div>
    </div>
  );
}
