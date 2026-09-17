/**
 * Manage listing: reprice, remove listing, or transfer.
 *
 * "Price 0 is never free" — there is NO zero-price field. The input rejects 0
 * and empty with inline helper text, and delisting is only reachable through the
 * destructive **Remove listing** action.
 */
import { useState } from "react";
import type { DomainRecord } from "../dash/dpnsQueries";
import type { MarketplaceError } from "../dash/marketplaceErrors";
import { formatCredits, formatDash, parseDashToCredits } from "../lib/format";
import { Modal } from "./Modal";

const HELP_BY_REASON: Record<string, string> = {
  empty: "Enter an asking price.",
  invalid: "Enter a number, for example 12.5",
  zero: "The price must be above zero. To take the name off the market, use Remove listing.",
  "too-precise": "Platform credits allow at most 11 decimal places.",
};

export function ManageListingModal({
  record,
  open,
  busy,
  error,
  onClose,
  onSetPrice,
  onRemoveListing,
  onTransfer,
}: {
  record: DomainRecord | null;
  open: boolean;
  busy: boolean;
  error: MarketplaceError | null;
  onClose: () => void;
  onSetPrice: (credits: bigint) => void;
  onRemoveListing: () => void;
  onTransfer: () => void;
}) {
  const [input, setInput] = useState("");
  const [touched, setTouched] = useState(false);

  const initialPrice =
    record?.price != null && record.price > 0n
      ? formatDash(record.price, { minDecimals: 0, maxDecimals: 11 })
      : "";

  // Reset the form whenever a different name is opened. Keyed off primitives so
  // this doesn't re-run on every parent render.
  const formKey = `${open ? "1" : "0"}:${record?.documentId ?? ""}:${initialPrice}`;
  const [lastKey, setLastKey] = useState(formKey);
  if (formKey !== lastKey) {
    setLastKey(formKey);
    setInput(initialPrice);
    setTouched(false);
  }

  if (!record) return null;

  const isListed = record.price != null && record.price > 0n;
  const parsed = parseDashToCredits(input);
  const helper = !parsed.ok && touched ? HELP_BY_REASON[parsed.reason] : null;

  return (
    <Modal
      open={open}
      title={
        isListed
          ? `Manage ${record.label}.${record.parentDomainName}`
          : `List ${record.label}.${record.parentDomainName}`
      }
      subtitle={
        isListed && record.price != null
          ? `Listed for ${formatDash(record.price)} DASH · revision ${String(record.revision)} · you own this name`
          : `Not listed · revision ${String(record.revision)} · you own this name`
      }
      onClose={onClose}
    >
      <div className="modal__body">
        <span className="label-caps">Asking price</span>
        <div
          className={`price-input-wrap${helper ? " price-input-wrap--invalid" : ""}`}
        >
          <input
            className="price-input"
            value={input}
            inputMode="decimal"
            autoFocus
            aria-label="Asking price in DASH"
            onChange={(e) => {
              setInput(e.target.value);
              setTouched(true);
            }}
          />
          <span className="price-input__unit">DASH</span>
        </div>

        {helper ? (
          <div className="input-help input-help--error">{helper}</div>
        ) : (
          <div className="input-help">
            {parsed.ok
              ? `= ${formatCredits(parsed.credits)} credits`
              : "= — credits"}{" "}
            · minimum {formatDash(1n, { minDecimals: 0, maxDecimals: 11 })} DASH
          </div>
        )}

        <div className="balance-after">
          <span>You receive on sale</span>
          <span className="balance-after__value">
            {parsed.ok ? `${formatDash(parsed.credits)} DASH` : "—"}
          </span>
        </div>

        {error && (
          <div className="block-error">
            <strong>That change did not go through.</strong>
            <div style={{ marginTop: 6 }}>{error.message}</div>
          </div>
        )}

        <button
          type="button"
          className="btn btn--primary btn--lg"
          disabled={!parsed.ok || busy}
          onClick={() => parsed.ok && onSetPrice(parsed.credits)}
        >
          {busy ? "Working…" : isListed ? "Update price" : "List for sale"}
        </button>

        <div className="divider" />

        {isListed && (
          <div className="action-row">
            <div>
              <div className="action-row__label">Remove listing</div>
              <div className="action-row__hint">
                Takes the name off the market. You keep it.
              </div>
            </div>
            <button
              type="button"
              className="btn btn--danger-outline btn--xs"
              disabled={busy}
              onClick={onRemoveListing}
            >
              Remove
            </button>
          </div>
        )}

        <div className="action-row">
          <div>
            <div className="action-row__label">Transfer to an identity</div>
            <div className="action-row__hint">
              Gives the name away for free.
            </div>
          </div>
          <button
            type="button"
            className="btn btn--outline btn--xs"
            disabled={busy}
            onClick={onTransfer}
          >
            Transfer
          </button>
        </div>
      </div>
    </Modal>
  );
}
