import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  WalletAnswer,
  WalletLoginRequest,
  WalletPollStatus,
} from "../dash/appConnect";
import { resolveDpnsName } from "../dash/resolveDpnsName";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { loadConnectionId } from "../lib/connectionId";
import { truncateId } from "../lib/format";
import { errorMessage } from "../lib/logger";
import { useSession } from "../session/useSession";
import { OperationResultNotice } from "./OperationResultNotice";

// appConnect pulls in loginWithPrivateKey and with it @dashevo/evo-sdk, so
// it loads on demand when this view opens, never with the app shell.
type AppConnectModule = typeof import("../dash/appConnect");
let appConnectPromise: Promise<AppConnectModule> | null = null;
function loadAppConnect(): Promise<AppConnectModule> {
  if (!appConnectPromise) {
    appConnectPromise = import("../dash/appConnect").catch((err) => {
      appConnectPromise = null;
      throw err;
    });
  }
  return appConnectPromise;
}

export interface WalletSignInProps {
  identityHint: string | null;
  rememberMe: boolean;
  renew?: boolean;
  onSignedIn: () => void;
  onBack: () => void;
}

type Phase =
  | { kind: "preparing" }
  | { kind: "waiting"; uri: string; svg: string; expiresAt: number }
  | { kind: "confirm"; answer: WalletAnswer; name: string | null }
  | { kind: "signing-in" }
  | { kind: "error"; message: string; retry: boolean };

const STATUS_COPY: Record<WalletPollStatus, string> = {
  waiting: "Waiting for your wallet…",
  answered: "Checking the answer…",
  "incomplete-read": "Couldn't read every answer, retrying…",
};

const secondaryButton =
  "min-h-11 rounded-md border border-line bg-transparent px-4 py-2 text-[13px] font-semibold text-ink-3 transition hover:border-line-2 hover:text-ink-2";
const primaryButton =
  "min-h-11 flex-1 rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-bg transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4";

export function WalletSignIn({
  identityHint,
  rememberMe,
  renew = false,
  onSignedIn,
  onBack,
}: WalletSignInProps) {
  const session = useSession();
  const { sdk, contractId } = session;
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const [phase, setPhase] = useState<Phase>({ kind: "preparing" });
  const [pollStatus, setPollStatus] = useState<WalletPollStatus>("waiting");
  const [now, setNow] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [replacedCode, setReplacedCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const aliveRef = useRef(true);

  // Read through a ref so the poll effect doesn't restart whenever the
  // session object changes identity.
  const sessionRef = useRef(session);
  const propsRef = useRef({ rememberMe, onSignedIn });
  useEffect(() => {
    sessionRef.current = session;
    propsRef.current = { rememberMe, onSignedIn };
  });

  useEffect(() => {
    aliveRef.current = true;
    headingRef.current?.focus();
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const signIn = useCallback(async (answer: WalletAnswer) => {
    const connected = sessionRef.current.sdk;
    if (!connected) return;
    setPhase({ kind: "signing-in" });
    try {
      const { loginWithWalletAnswer } = await loadAppConnect();
      const login = await loginWithWalletAnswer(connected, answer);
      if (!aliveRef.current) return;
      await sessionRef.current.loginWithWallet(login, {
        rememberMe: propsRef.current.rememberMe,
      });
      if (!aliveRef.current) return;
      propsRef.current.onSignedIn();
    } catch (err) {
      if (!aliveRef.current) return;
      setPhase({ kind: "error", message: errorMessage(err), retry: true });
    }
  }, []);

  useEffect(() => {
    if (!sdk || !contractId) return;
    const controller = new AbortController();
    const { signal } = controller;
    let trigger: InstanceType<AppConnectModule["PollTrigger"]> | null = null;
    const wake = () => trigger?.fire();
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", onVisibility);

    void (async () => {
      let mod: AppConnectModule | null = null;
      let req: WalletLoginRequest | null = null;
      setPhase({ kind: "preparing" });
      setPollStatus("waiting");
      try {
        mod = await loadAppConnect();
        if (signal.aborted) return;
        const clock = await mod.readChainClock(sdk, contractId);
        if (signal.aborted) return;
        if (clock.protocolVersion < mod.APP_CONNECT_MIN_PROTOCOL) {
          setPhase({
            kind: "error",
            message: "This network does not support wallet sign-in yet.",
            retry: false,
          });
          return;
        }
        req = mod.newWalletLoginRequest({
          contractId,
          connectionId: loadConnectionId(),
          chainNow: clock.timeMs,
          ...(identityHint ? { identityHint } : {}),
        });
        const svg = await QRCode.toString(req.uri, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 1,
        });
        if (signal.aborted) return;
        trigger = new mod.PollTrigger();
        setNow(Date.now());
        setPhase({
          kind: "waiting",
          uri: req.uri,
          svg,
          expiresAt: req.expiresAt,
        });
        const answer = await mod.awaitWalletAnswer(sdk, req, {
          signal,
          trigger,
          onStatus: (status) => {
            if (!signal.aborted) setPollStatus(status);
          },
        });
        if (signal.aborted) return;
        if (identityHint) {
          void signIn(answer);
          return;
        }
        const name = await resolveDpnsName(sdk, answer.identityId).catch(
          () => null,
        );
        if (signal.aborted) return;
        setPhase({ kind: "confirm", answer, name });
      } catch (err) {
        if (signal.aborted) return;
        setPhase(describeError(err, mod));
      } finally {
        if (req && mod) mod.disposeWalletLoginRequest(req);
      }
    })();

    return () => {
      controller.abort();
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sdk, contractId, identityHint, attempt, signIn]);

  const waiting = phase.kind === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [waiting]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  function startOver(afterReject: boolean) {
    setReplacedCode(afterReject);
    setAttempt((n) => n + 1);
  }

  async function copyLink(uri: string) {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
    } catch {
      // Clipboard API can fail in insecure contexts; the field stays selectable.
    }
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <h3
          ref={headingRef}
          tabIndex={-1}
          // Focused on mount so screen readers land here; it isn't a control,
          // so it skips the global focus ring.
          style={{ outline: "none" }}
          className="text-[14px] font-semibold text-ink"
        >
          {renew ? "Renew in DashPay" : "Sign in with DashPay"}
        </h3>
        <p className="mt-1 text-[12px] text-ink-3">
          {renew
            ? "DashPay will issue a fresh key for this browser. The old one stops working once you approve."
            : "Approve the connection on your phone and Dashnote gets a key that can only write notes."}
        </p>
      </div>

      {!sdk ? (
        <p aria-live="polite" className="text-[12px] text-ink-4">
          Connecting…
        </p>
      ) : !contractId ? (
        <OperationResultNotice tone="error" title="Error">
          Choose a note contract in Settings first.
        </OperationResultNotice>
      ) : phase.kind === "preparing" ? (
        <p aria-live="polite" className="text-[12px] text-ink-4">
          Preparing a sign-in code…
        </p>
      ) : phase.kind === "waiting" ? (
        <div className="flex flex-col gap-3">
          {replacedCode && (
            <p className="rounded-md border border-line bg-bg/40 px-3 py-2 text-[11px] text-ink-3">
              New code ready. If you didn&apos;t scan the old one, someone else
              may have — don&apos;t approve anything you didn&apos;t start.
            </p>
          )}
          <p className="text-[12px] text-ink-2">
            Scan with DashPay on testnet, then approve the connection.
          </p>
          <div
            data-testid="wallet-qr"
            role="img"
            aria-label="Sign-in QR code"
            className="mx-auto h-[200px] w-[200px] rounded-lg bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: phase.svg }}
          />
          <p className="text-center text-[11px] text-ink-4">
            Needs the DashPay mobile wallet on testnet (Android 11.9.2+ or iOS
            9.1.4+).
          </p>
          {isNarrow && (
            <a
              href={phase.uri}
              className="flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-bg transition hover:bg-accent-dim"
            >
              Open in DashPay
            </a>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
              Request link
            </span>
            <div className="flex items-start gap-2">
              <input
                type="text"
                readOnly
                data-testid="wallet-request-uri"
                value={phase.uri}
                onFocus={(event) => event.target.select()}
                className="min-w-0 flex-1 rounded-md border border-line bg-bg/40 px-3 py-2 font-mono text-[11px] text-ink-3 outline-none focus:border-accent-dim"
              />
              <button
                type="button"
                onClick={() => void copyLink(phase.uri)}
                className="min-h-9 rounded-md border border-line-2 bg-transparent px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition hover:border-accent-dim hover:text-ink"
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>
          </label>
          <div
            aria-live="polite"
            className="flex items-center justify-between text-[11px]"
          >
            <span data-testid="wallet-status" className="text-ink-3">
              {STATUS_COPY[pollStatus]}
            </span>
            <span className="text-ink-4">
              {minutesLeft(phase.expiresAt, now)}
            </span>
          </div>
        </div>
      ) : phase.kind === "confirm" ? (
        <div className="flex flex-col gap-3">
          <div className="text-[13px] font-semibold text-ink">Is this you?</div>
          <div className="rounded-md border border-line bg-bg/40 px-3 py-2">
            {phase.name && (
              <div className="text-[13px] font-semibold text-accent">
                @{phase.name}
              </div>
            )}
            <div className="break-all font-mono text-[12px] text-ink-3">
              {phase.answer.identityId}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void signIn(phase.answer)}
              className={primaryButton}
            >
              {phase.name
                ? `Continue as @${phase.name}`
                : `Continue as ${truncateId(phase.answer.identityId, 8, 4)}`}
            </button>
            <button
              type="button"
              onClick={() => startOver(true)}
              className={secondaryButton}
            >
              That&apos;s not me
            </button>
          </div>
        </div>
      ) : phase.kind === "signing-in" ? (
        <p aria-live="polite" className="text-[12px] text-ink-4">
          Signing in…
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <OperationResultNotice tone="error" title="Error">
            {phase.message}
          </OperationResultNotice>
          {phase.retry && (
            <button
              type="button"
              onClick={() => startOver(false)}
              className={primaryButton}
            >
              Try again
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="self-start text-[11px] font-medium text-accent-dim underline-offset-2 hover:text-accent hover:underline"
      >
        ← Back
      </button>
    </div>
  );
}

function minutesLeft(expiresAt: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  return minutes === 1 ? "1 minute left" : `${minutes} minutes left`;
}

function describeError(err: unknown, mod: AppConnectModule | null): Phase {
  if (mod && err instanceof mod.RequestExpiredError) {
    return {
      kind: "error",
      message: "No answer from your wallet yet.",
      retry: true,
    };
  }
  if (mod && err instanceof mod.AmbiguousWalletAnswerError) {
    return {
      kind: "error",
      message:
        "More than one wallet answered this code. Start again and keep the code private.",
      retry: true,
    };
  }
  if (mod && err instanceof mod.WalletAnswerRefusedError) {
    return { kind: "error", message: err.message, retry: true };
  }
  return { kind: "error", message: errorMessage(err), retry: true };
}
