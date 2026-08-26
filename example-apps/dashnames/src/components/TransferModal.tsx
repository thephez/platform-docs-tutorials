/**
 * Transfer: recipient input, warnings, consent checkbox.
 *
 * Transferring a LISTED name clears the listing without writing a zero-price
 * price-update record, so the amber warning is shown whenever the name is
 * listed — that is a real consequence the user cannot otherwise see.
 *
 * Submit stays disabled until the consent checkbox is ticked.
 */
import { useState } from "react";
import { classifyRecipientInput } from "../dash/classifyRecipientInput";
import type { DomainRecord } from "../dash/dpnsQueries";
import type { MarketplaceError } from "../dash/marketplaceErrors";
import { formatDash, shortId } from "../lib/format";
import { DpnsName } from "./DpnsName";
import { Modal } from "./Modal";

export function TransferModal({
  record,
  open,
  busy,
  error,
  resolving,
  resolvedId,
  resolvedName,
  resolveError,
  onClose,
  onRecipientChange,
  onTransfer,
}: {
  record: DomainRecord | null;
  open: boolean;
  busy: boolean;
  error: MarketplaceError | null;
  resolving: boolean;
  /** Identity the input resolved to — the value actually submitted. */
  resolvedId: string | null;
  resolvedName: string | null;
  resolveError: string | null;
  onClose: () => void;
  onRecipientChange: (value: string) => void;
  onTransfer: (recipientId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [consent, setConsent] = useState(false);

  // Reset when a different name is opened — derived during render rather than
  // in an effect, so there is no cascading re-render.
  const formKey = `${open ? "1" : "0"}:${record?.documentId ?? ""}`;
  const [lastKey, setLastKey] = useState(formKey);
  if (formKey !== lastKey) {
    setLastKey(formKey);
    setInput("");
    setConsent(false);
  }

  if (!record) return null;

  const isListed = record.price != null && record.price > 0n;
  const mode = classifyRecipientInput(input.trim());
  const canSubmit = Boolean(resolvedId) && consent && !busy && !resolving;

  return (
    <Modal
      open={open}
      title={`Transfer ${record.label}.${record.parentDomainName}`}
      onClose={onClose}
    >
      <div className="modal__body">
        <span className="label-caps">Recipient identity or name</span>
        <input
          className="recipient-input"
          value={input}
          spellCheck={false}
          autoCapitalize="none"
          placeholder="Identity ID or alice.dash"
          aria-label="Recipient identity or name"
          onChange={(e) => {
            setInput(e.target.value);
            onRecipientChange(e.target.value);
          }}
        />

        {input.trim() && mode === "invalid" && (
          <div className="input-help input-help--error">
            That is not a valid identity ID or DPNS name.
          </div>
        )}
        {resolving && <div className="input-help">Resolving…</div>}
        {resolveError && (
          <div className="input-help input-help--error">{resolveError}</div>
        )}
        {resolvedId && (
          <div className="input-help">
            Resolves to {shortId(resolvedId)}
            {resolvedName ? ` · ${resolvedName}` : ""}
          </div>
        )}

        {isListed && record.price != null && (
          <div className="block-warning">
            <strong>
              This name is currently listed for {formatDash(record.price)} DASH
            </strong>
            <div style={{ marginTop: 5 }}>
              Transferring removes the listing and hands the name over for free.
              The recipient becomes the owner and the name resolves to their
              identity immediately.
            </div>
          </div>
        )}

        <div className="block-error">
          Transfers are permanent. There is no way to reverse one — check the
          identity ID character by character.
        </div>

        {error && (
          <div className="block-error">
            <strong>The transfer did not complete.</strong>
            <div style={{ marginTop: 6 }}>{error.message}</div>
          </div>
        )}

        <button
          type="button"
          className="consent"
          aria-pressed={consent}
          onClick={() => setConsent((c) => !c)}
        >
          <span className={`consent__box${consent ? " consent__box--on" : ""}`}>
            {consent ? "✓" : ""}
          </span>
          <span>
            I understand this gives{" "}
            <DpnsName
              label={record.label}
              parentDomainName={record.parentDomainName}
            />{" "}
            away permanently{isListed ? " and removes the listing" : ""}.
          </span>
        </button>

        <button
          type="button"
          className="btn btn--primary btn--lg"
          disabled={!canSubmit}
          onClick={() => resolvedId && onTransfer(resolvedId)}
        >
          {busy ? "Transferring…" : "Transfer name"}
        </button>
      </div>
    </Modal>
  );
}
