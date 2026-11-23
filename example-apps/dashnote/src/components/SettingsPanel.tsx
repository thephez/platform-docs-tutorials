import { useCallback, useEffect, useState } from "react";

import { useContractRegistration } from "../hooks/useContractRegistration";
import { useTheme } from "../hooks/useTheme";
import { truncateId } from "../lib/format";
import { clearCachedNotes } from "../lib/notesCache";
import { useSession } from "../session/useSession";
import { OperationResultNotice } from "./OperationResultNotice";

const NETWORK = "testnet" as const;
const CREDITS_PER_DASH = 100_000_000_000;

function formatDash(credits: bigint): string {
  return (Number(credits) / CREDITS_PER_DASH).toFixed(4);
}

function allowanceText(remaining: bigint | null, total: bigint | null): string {
  if (remaining === null && total === null) return "no limit";
  if (total === null) return `${formatDash(remaining ?? 0n)} DASH`;
  return `${formatDash(remaining ?? 0n)} of ${formatDash(total)} DASH`;
}

interface CopyButtonProps {
  value: string | null;
  label: string;
}

function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onClick = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard API can fail in insecure contexts; surface no error here.
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!value}
      aria-label={label}
      className="rounded-md border border-line-2 bg-transparent px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition hover:border-accent-dim hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-4"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function ThemeToggleControl() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-md border border-line-2 bg-transparent px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition hover:border-accent-dim hover:text-ink"
    >
      {isDark ? "Switch to light theme" : "Switch to dark theme"}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-bg/40 p-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
        {title}
      </h3>
      {children}
    </section>
  );
}

interface SettingsPanelProps {
  onOpenLogin: () => void;
  onRenewInWallet: () => void;
}

export function SettingsPanel({
  onOpenLogin,
  onRenewInWallet,
}: SettingsPanelProps) {
  const session = useSession();
  const [refreshingGrant, setRefreshingGrant] = useState(false);
  const {
    register,
    registering,
    error: registerError,
  } = useContractRegistration();
  const [contractInput, setContractInput] = useState(session.contractId ?? "");
  const [lastSyncedContractId, setLastSyncedContractId] = useState(
    session.contractId,
  );
  const [cacheCleared, setCacheCleared] = useState(false);

  // Re-sync the local input whenever the upstream contract ID changes (e.g.
  // a fresh registration completes). Adjusting state during render is the
  // recommended pattern over a useEffect for prop-derived state.
  if (session.contractId !== lastSyncedContractId) {
    setLastSyncedContractId(session.contractId);
    setContractInput(session.contractId ?? "");
  }

  useEffect(() => {
    if (!cacheCleared) return;
    const id = window.setTimeout(() => setCacheCleared(false), 2000);
    return () => window.clearTimeout(id);
  }, [cacheCleared]);

  const isConnected =
    session.status === "authenticated" || session.status === "browsing";

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-md border border-line bg-bg/40 p-6 text-center text-[13px] text-ink-3">
        <p>
          Sign in to view and manage your identity, contract, and device data.
        </p>
        <button
          type="button"
          onClick={onOpenLogin}
          className="rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-bg transition hover:bg-accent-dim"
        >
          Sign in
        </button>
      </div>
    );
  }

  const trimmedContract = contractInput.trim();
  const canApplyContract =
    trimmedContract.length > 0 &&
    trimmedContract !== (session.contractId ?? "");
  const canRegister = Boolean(
    session.status === "authenticated" &&
    session.sdk &&
    session.keyManager &&
    !session.walletGrant,
  );

  return (
    <div className="flex flex-col gap-4">
      <Section title="Identity">
        <div data-testid="settings-identity-block">
          <div className="flex items-start gap-2">
            <div className="flex-1 break-all rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] text-accent">
              {session.identityId ?? "—"}
            </div>
            <CopyButton value={session.identityId} label="Copy identity ID" />
          </div>
          {session.dpnsName && (
            <div className="mt-1 text-[11px] text-ink-4">
              ✓ {session.dpnsName}.dash
            </div>
          )}
        </div>
        <div className="flex items-center justify-between text-[11px] text-ink-3">
          <span>Network</span>
          <span className="font-mono text-accent-dim">{NETWORK}</span>
        </div>
      </Section>

      {session.walletGrant && (
        <Section title="Wallet connection">
          {session.walletNotice === "renew" && (
            <OperationResultNotice tone="error" title="Renew needed">
              This browser&apos;s key ran out of allowance or expired, so the
              last write didn&apos;t go through. Renew the connection in DashPay
              to keep writing.
              <button
                type="button"
                onClick={session.dismissWalletNotice}
                className="ml-2 text-[11px] font-semibold underline underline-offset-2 opacity-80 transition hover:opacity-100"
              >
                Dismiss
              </button>
            </OperationResultNotice>
          )}
          <dl
            data-testid="wallet-connection"
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11px]"
          >
            <dt className="text-ink-3">Allowance left</dt>
            <dd className="text-right font-mono text-ink-2">
              {allowanceText(
                session.walletGrant.remainingBudget,
                session.walletGrant.totalBudget,
              )}
            </dd>
            <dt className="text-ink-3">Expires</dt>
            <dd className="text-right font-mono text-ink-2">
              {session.walletGrant.expiresAt === null
                ? "never"
                : new Date(session.walletGrant.expiresAt).toLocaleDateString()}
            </dd>
            <dt className="text-ink-3">Key id</dt>
            <dd className="text-right font-mono text-ink-2">
              {session.walletGrant.keyId}
            </dd>
            <dt className="text-ink-3">Contract</dt>
            <dd className="text-right font-mono text-accent-dim">
              {truncateId(session.walletGrant.contractId)}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                setRefreshingGrant(true);
                try {
                  await session.refreshWalletGrant();
                } finally {
                  setRefreshingGrant(false);
                }
              }}
              disabled={refreshingGrant}
              className="rounded-md border border-line-2 bg-transparent px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition hover:border-accent-dim hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-4"
            >
              {refreshingGrant ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={onRenewInWallet}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-accent-dim"
            >
              Renew in DashPay
            </button>
          </div>
          <p className="text-[11px] text-ink-4">
            DashPay granted this browser one key that can only write notes to
            this contract, within the allowance above.
          </p>
        </Section>
      )}

      <Section title="Contract">
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <input
              type="text"
              value={contractInput}
              onChange={(event) => setContractInput(event.target.value)}
              placeholder="Paste a note contract ID"
              className="flex-1 rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] text-ink outline-none transition focus:border-accent-dim"
            />
            <CopyButton value={session.contractId} label="Copy contract ID" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                session.setContractId(contractInput.trim() || null)
              }
              disabled={!canApplyContract}
              className="rounded-md border border-line-2 bg-transparent px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition hover:border-accent-dim hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-4"
            >
              Use this ID
            </button>
            <button
              type="button"
              onClick={() => {
                void register();
              }}
              disabled={registering || !canRegister}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4"
            >
              {registering ? "Registering…" : "Register a fresh contract"}
            </button>
          </div>
          <p className="text-[11px] text-ink-4">
            Registering deploys a fresh note contract to testnet and switches
            Dashnote to it immediately.
          </p>
          {session.walletGrant && (
            <p className="text-[11px] text-ink-4">
              Registering a contract needs a mnemonic or private-key sign-in; a
              wallet key only writes notes.
            </p>
          )}
          {registerError && (
            <OperationResultNotice tone="error" title="Error">
              {registerError}
            </OperationResultNotice>
          )}
        </div>
      </Section>

      <Section title="Data">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              if (!session.identityId) return;
              clearCachedNotes(session.identityId);
              setCacheCleared(true);
            }}
            disabled={!session.identityId}
            className="self-start rounded-md border border-line-2 bg-transparent px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition hover:border-accent-dim hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-4"
          >
            {cacheCleared
              ? "Cache cleared"
              : "Clear local cache for this device"}
          </button>
          <p className="text-[11px] text-ink-4">
            Removes cached note bodies stored in this browser. Notes on Platform
            are not affected; the cache rebuilds on the next refresh.
          </p>
        </div>
      </Section>

      <Section title="Appearance">
        <ThemeToggleControl />
      </Section>

      {session.rememberedIdentityId && (
        <Section title="Danger zone">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => session.forgetIdentity()}
              className="self-start rounded-md border border-[color:var(--color-danger)] bg-transparent px-3 py-1.5 text-[12px] font-semibold text-[color:var(--color-danger)] transition hover:bg-[color:var(--color-danger)] hover:text-bg"
            >
              Forget this device
            </button>
            <p className="text-[11px] text-ink-4">
              Removes the remembered identity and clears its cached notes from
              this browser.
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}
