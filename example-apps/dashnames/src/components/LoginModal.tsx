import { useEffect, useMemo, useState, type FormEvent } from "react";
import { detectSecretShape, looksLikeWif } from "../lib/detectSecretShape";
import { shortId } from "../lib/format";
import { errorMessage } from "../lib/logger";
import { useSession } from "../session/useSession";
import { Modal } from "./Modal";

export function LoginModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const session = useSession();
  const [secret, setSecret] = useState("");
  const [identityIndex, setIdentityIndex] = useState("0");
  const [expectedIdentityId, setExpectedIdentityId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [preview, setPreview] = useState<
    | { state: "idle" | "checking" }
    | { state: "resolved"; identityId: string; name: string | null }
    | { state: "warning"; message: string }
  >({ state: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shape = useMemo(
    () => (secret.trim() ? detectSecretShape(secret) : null),
    [secret],
  );
  const isWif = shape === "wif";

  const formKey = `${open ? "1" : "0"}:${session.network}`;
  const [lastFormKey, setLastFormKey] = useState(formKey);
  if (formKey !== lastFormKey) {
    setLastFormKey(formKey);
    setSecret("");
    setIdentityIndex("0");
    setExpectedIdentityId("");
    setShowAdvanced(false);
    setAmbiguous(false);
    setPreview({ state: "idle" });
    setError(null);
    setSubmitting(false);
  }

  useEffect(() => {
    const trimmed = secret.trim();
    if (!open || !session.sdk || !isWif || !looksLikeWif(trimmed)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!cancelled) setPreview({ state: "checking" });
      try {
        const mod = await import("../dash/loginWithPrivateKey");
        const resolved = await mod.resolveIdentityFromWif(
          session.sdk!,
          trimmed,
          expectedIdentityId.trim() || undefined,
        );
        if (cancelled) return;
        const name = await session
          .sdk!.dpns.username(resolved.identityId)
          .catch(() => null);
        if (!cancelled) {
          setPreview({
            state: "resolved",
            identityId: resolved.identityId,
            name: name ?? null,
          });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "AmbiguousIdentityError") {
          setAmbiguous(true);
        }
        setPreview({ state: "warning", message: errorMessage(err) });
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, isWif, secret, expectedIdentityId, session.sdk, session.network]);

  function close() {
    if (submitting) return;
    setSecret("");
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const parsed = Number.parseInt(identityIndex, 10);
      await session.login(secret, {
        identityIndex: Number.isNaN(parsed) ? 0 : parsed,
        ...(isWif && expectedIdentityId.trim()
          ? { expectedIdentityId: expectedIdentityId.trim() }
          : {}),
      });
      setSecret("");
      onSuccess?.();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof Error && err.name === "AmbiguousIdentityError") {
        setAmbiguous(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Sign in to dashnames"
      subtitle="Use a testnet mnemonic or authentication WIF."
      className="modal--login"
      icon={
        <span className="login-key-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="7.5" cy="15.5" r="3.5" />
            <path d="M21 2 9.6 13.4M14.5 8.5l4 4M19 5l3 3" />
          </svg>
        </span>
      }
      onClose={close}
    >
      <form className="modal__body login-modal__body" onSubmit={submit}>
        <div className="login-network-row">
          <span>Selected network</span>
          <strong>{session.network}</strong>
        </div>
        <div className="login-field">
          <label className="login-label" htmlFor="login-secret">
            Mnemonic or private key
          </label>
          <input
            id="login-secret"
            className="recipient-input"
            type="password"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={secret}
            placeholder="Mnemonic phrase or WIF private key"
            onChange={(event) => {
              setSecret(event.target.value);
              setExpectedIdentityId("");
              setAmbiguous(false);
              setPreview({ state: "idle" });
              setError(null);
            }}
          />
          <p className="login-memory-hint">
            Stored in memory only. The secret is used locally to sign state
            transitions.
          </p>
        </div>
        {shape && (
          <p className="input-help">
            Detected: {isWif ? "authentication private key" : "recovery phrase"}
          </p>
        )}

        {isWif && preview.state === "checking" && (
          <p className="input-help">Resolving key to an identity…</p>
        )}
        {isWif && preview.state === "resolved" && (
          <div className="notice notice--info">
            Identity: {preview.name ?? shortId(preview.identityId)} ·{" "}
            {shortId(preview.identityId)}
          </div>
        )}
        {isWif && preview.state === "warning" && (
          <div className="block-warning">{preview.message}</div>
        )}

        {isWif && ambiguous && (
          <>
            <label className="login-label" htmlFor="login-identity-id">
              Identity ID
            </label>
            <input
              id="login-identity-id"
              className="recipient-input"
              value={expectedIdentityId}
              autoComplete="off"
              spellCheck={false}
              placeholder="Full Platform identity ID"
              onChange={(event) => setExpectedIdentityId(event.target.value)}
            />
          </>
        )}

        {!isWif && (
          <>
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => setShowAdvanced((value) => !value)}
            >
              {showAdvanced ? "Hide" : "Show"} advanced settings
            </button>
            {showAdvanced && (
              <div>
                <label className="login-label" htmlFor="identity-index">
                  Identity index
                </label>
                <input
                  id="identity-index"
                  className="recipient-input"
                  type="number"
                  min={0}
                  value={identityIndex}
                  onChange={(event) => setIdentityIndex(event.target.value)}
                />
              </div>
            )}
          </>
        )}

        {session.network === "testnet" && (
          <div className="login-bridge-callout">
            Don&apos;t have a testnet identity?{" "}
            <a
              href="https://bridge.thepasta.org/"
              target="_blank"
              rel="noreferrer"
            >
              Create one on Dash Bridge
            </a>{" "}
            — funded automatically in about 30 seconds.
          </div>
        )}
        {error && <div className="block-error">{error}</div>}
        <div className="modal__actions">
          <button
            type="submit"
            className="btn btn--primary btn--md"
            disabled={
              submitting ||
              !secret.trim() ||
              (isWif && ambiguous && !expectedIdentityId.trim())
            }
          >
            {submitting ? "Connecting…" : "Sign in"}
          </button>
          <button
            type="button"
            className="btn btn--outline btn--md"
            disabled={submitting}
            onClick={close}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
