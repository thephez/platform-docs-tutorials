import { useEffect, useState } from "react";

import { fetchFrozenStatus } from "../dash/frozenStatus";
import { errorMessage } from "../dash/logger";
import { fetchSiftTokenBalance } from "../dash/siftToken";
import {
  submitSubmission,
  type SubmissionSeverity,
} from "../dash/submitSubmission";
import { bytesToBase64, hashFile } from "../lib/hash";
import { useSession } from "../session/useSession";

const SEVERITIES: SubmissionSeverity[] = ["low", "medium", "high", "critical"];

export function SubmitSubmissionForm({
  onSubmitted,
}: {
  onSubmitted?: () => void;
}) {
  const session = useSession();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<SubmissionSeverity>("medium");
  const [component, setComponent] = useState("");
  const [description, setDescription] = useState("");
  const [pocFile, setPocFile] = useState<File | null>(null);
  const [pocHash, setPocHash] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { sdk, contractId, identityId } = session;
      if (!sdk || !contractId || !identityId) {
        if (!cancelled) {
          setBalance(null);
          setIsSuspended(false);
        }
        return;
      }
      try {
        const [nextBalance, suspended] = await Promise.all([
          fetchSiftTokenBalance({ sdk, contractId, identityId }),
          fetchFrozenStatus({ sdk, contractId, identityId }),
        ]);
        if (!cancelled) {
          setBalance(nextBalance);
          setIsSuspended(suspended);
        }
      } catch {
        if (!cancelled) {
          setBalance(null);
          setIsSuspended(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, status]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPocFile(file);
    setPocHash(null);
    if (!file) return;
    try {
      const bytes = await hashFile(file);
      setPocHash(bytesToBase64(bytes));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!session.sdk || !session.keyManager) {
      setError("Sign in before submitting.");
      return;
    }
    if (!session.contractId) {
      setError("Register or select a Sift contract first (Account tab).");
      return;
    }
    if (isSuspended) {
      setError("Your access is suspended. A Review Panel must restore it.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await submitSubmission({
        sdk: session.sdk,
        keyManager: session.keyManager,
        contractId: session.contractId,
        submission: {
          title,
          severity,
          component,
          description,
          pocHash: pocHash ?? undefined,
        },
        log: session.log,
      });
      setStatus("Submission filed.");
      setTitle("");
      setComponent("");
      setDescription("");
      setPocFile(null);
      setPocHash(null);
      onSubmitted?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const noTokens = balance != null && balance <= 0n;

  return (
    <div className="card">
      <h3>Submit to Sift</h3>
      <p className="muted">
        Spend 1 Sift token to enter the review queue. Keep sensitive exploit
        detail off-chain; use the evidence hash for local proof material.
      </p>
      {balance != null && (
        <p className="muted">
          Sift token balance: <strong>{balance.toString()}</strong>
        </p>
      )}
      {error && <div className="notice error">{error}</div>}
      {status && <div className="notice info">{status}</div>}
      {isSuspended && (
        <div className="notice error">
          Access suspended — you cannot spend Sift tokens until the Review Panel
          restores access.
        </div>
      )}
      {noTokens && (
        <div className="notice error">
          No Sift tokens remaining — ask the operator to transfer more before
          submitting.
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={128}
            />
          </div>
          <div className="field">
            <label htmlFor="severity">Severity</label>
            <select
              id="severity"
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as SubmissionSeverity)
              }
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="component">Affected component</label>
          <input
            id="component"
            value={component}
            onChange={(event) => setComponent(event.target.value)}
            required
            maxLength={63}
          />
        </div>
        <div className="field">
          <label htmlFor="description">Public summary</label>
          <textarea
            id="description"
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
            maxLength={2000}
          />
        </div>
        <div className="field">
          <label htmlFor="poc">Evidence file (optional, hashed locally)</label>
          <input id="poc" type="file" onChange={handleFileChange} />
          {pocFile && pocHash && (
            <p className="muted">
              SHA-256 (base64): <code>{pocHash}</code>
            </p>
          )}
        </div>
        <button type="submit" disabled={busy || noTokens || isSuspended}>
          {busy ? "Submitting..." : "Spend 1 Sift token"}
        </button>
      </form>
    </div>
  );
}
