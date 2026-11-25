// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "../src/components/Modal";
import { WalletSignIn } from "../src/components/WalletSignIn";

const mocks = vi.hoisted(() => {
  class RequestExpiredError extends Error {}
  class AmbiguousWalletAnswerError extends Error {
    identityIds: string[] = [];
  }
  class WalletAnswerRefusedError extends Error {
    reason = "framing";
  }
  const fires: number[] = [];
  class PollTrigger {
    fire() {
      fires.push(Date.now());
    }
    wait() {
      return Promise.resolve();
    }
  }
  return {
    mockUseSession: vi.fn(),
    mockResolveDpnsName: vi.fn(),
    readChainClock: vi.fn(),
    newWalletLoginRequest: vi.fn(),
    disposeWalletLoginRequest: vi.fn(),
    awaitWalletAnswer: vi.fn(),
    loginWithWalletAnswer: vi.fn(),
    disposeWalletAnswer: vi.fn(),
    RequestExpiredError,
    AmbiguousWalletAnswerError,
    WalletAnswerRefusedError,
    PollTrigger,
    fires,
    walletSessionStorageAvailable: vi.fn(),
    saveWalletSession: vi.fn(),
    peekWalletSession: vi.fn(),
    clearWalletSession: vi.fn(),
  };
});

vi.mock("../src/lib/walletSessionStore", () => ({
  walletSessionStorageAvailable: mocks.walletSessionStorageAvailable,
  saveWalletSession: mocks.saveWalletSession,
  peekWalletSession: mocks.peekWalletSession,
  loadWalletSession: vi.fn().mockResolvedValue(null),
  clearWalletSession: mocks.clearWalletSession,
}));

vi.mock("../src/session/useSession", () => ({
  useSession: mocks.mockUseSession,
}));

vi.mock("../src/dash/resolveDpnsName", () => ({
  resolveDpnsName: mocks.mockResolveDpnsName,
}));

vi.mock("../src/dash/appConnect", () => ({
  APP_CONNECT_MIN_PROTOCOL: 14,
  readChainClock: mocks.readChainClock,
  newWalletLoginRequest: mocks.newWalletLoginRequest,
  disposeWalletLoginRequest: mocks.disposeWalletLoginRequest,
  awaitWalletAnswer: mocks.awaitWalletAnswer,
  loginWithWalletAnswer: mocks.loginWithWalletAnswer,
  disposeWalletAnswer: mocks.disposeWalletAnswer,
  PollTrigger: mocks.PollTrigger,
  RequestExpiredError: mocks.RequestExpiredError,
  AmbiguousWalletAnswerError: mocks.AmbiguousWalletAnswerError,
  WalletAnswerRefusedError: mocks.WalletAnswerRefusedError,
}));

vi.mock("qrcode", () => ({
  default: { toString: vi.fn().mockResolvedValue("<svg/>") },
}));

const IDENTITY = "4EfA9Jrvv3nnCFdSf7fad59851iiTRZ6Wcu6YVJ4iSeF";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let answers: Deferred<unknown>[];
let requestCount: number;

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sdk: { documents: {} },
    contractId: "contract-abc",
    walletSessionKept: false,
    log: vi.fn(),
    loginWithWallet: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderSignIn(props: Partial<Parameters<typeof WalletSignIn>[0]> = {}) {
  const onSignedIn = vi.fn();
  const onBack = vi.fn();
  const utils = render(
    <WalletSignIn
      identityHint={null}
      onSignedIn={onSignedIn}
      onBack={onBack}
      {...props}
    />,
  );
  return { ...utils, onSignedIn, onBack };
}

beforeEach(() => {
  answers = [];
  requestCount = 0;
  mocks.fires.length = 0;
  mocks.mockUseSession.mockReset();
  mocks.mockResolveDpnsName.mockReset();
  mocks.readChainClock.mockReset();
  mocks.newWalletLoginRequest.mockReset();
  mocks.disposeWalletLoginRequest.mockReset();
  mocks.awaitWalletAnswer.mockReset();
  mocks.loginWithWalletAnswer.mockReset();
  mocks.disposeWalletAnswer.mockReset();
  mocks.walletSessionStorageAvailable.mockReset();
  mocks.saveWalletSession.mockReset();
  mocks.peekWalletSession.mockReset();
  mocks.clearWalletSession.mockReset();
  mocks.walletSessionStorageAvailable.mockResolvedValue(true);
  mocks.saveWalletSession.mockResolvedValue(undefined);
  mocks.peekWalletSession.mockResolvedValue(null);
  mocks.clearWalletSession.mockResolvedValue(undefined);

  mocks.mockUseSession.mockReturnValue(makeSession());
  mocks.mockResolveDpnsName.mockResolvedValue("alice");
  mocks.readChainClock.mockResolvedValue({
    timeMs: 1_700_000_000_000,
    protocolVersion: 14,
  });
  mocks.newWalletLoginRequest.mockImplementation(() => {
    requestCount += 1;
    return {
      uri: `dash-connect:request-${requestCount}`,
      expiresAt: Date.now() + 10 * 60 * 1000,
      createdAt: Date.now(),
    };
  });
  mocks.awaitWalletAnswer.mockImplementation(() => {
    const next = deferred<unknown>();
    answers.push(next);
    return next.promise;
  });
  mocks.loginWithWalletAnswer.mockResolvedValue({
    identityId: IDENTITY,
    auth: {},
    grant: { keyId: 5 },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WalletSignIn", () => {
  it("renders the QR code, request link and poll status", async () => {
    renderSignIn();

    const uri = await screen.findByTestId("wallet-request-uri");
    expect((uri as HTMLInputElement).value).toBe("dash-connect:request-1");
    expect(screen.getByTestId("wallet-qr").innerHTML).toBe("<svg></svg>");
    expect(screen.getByText("Waiting for your wallet…")).toBeTruthy();
    expect(screen.getByText("10 minutes left")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(
      screen.getByText(/Android 11\.9\.2\+ or iOS 9\.1\.4\+/),
    ).toBeTruthy();
    expect(mocks.newWalletLoginRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: "contract-abc",
        chainNow: 1_700_000_000_000,
      }),
    );
    expect(mocks.newWalletLoginRequest.mock.calls[0][0]).not.toHaveProperty(
      "identityHint",
    );
    // Desktop: no deep link.
    expect(screen.queryByRole("link", { name: "Open in DashPay" })).toBeNull();
  });

  it("shows the Open in DashPay link on narrow viewports", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 767px)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderSignIn();

    const link = await screen.findByRole("link", { name: "Open in DashPay" });
    expect(link.getAttribute("href")).toBe("dash-connect:request-1");
  });

  it("follows the poll status the module reports", async () => {
    renderSignIn();
    await screen.findByTestId("wallet-request-uri");
    const { onStatus } = mocks.awaitWalletAnswer.mock.calls[0][2];

    act(() => onStatus("incomplete-read"));
    expect(
      screen.getByText("Couldn't read every answer, retrying…"),
    ).toBeTruthy();
    act(() => onStatus("answered"));
    expect(screen.getByText("Checking the answer…")).toBeTruthy();
  });

  it("wakes the poll when the window regains focus", async () => {
    renderSignIn();
    await screen.findByTestId("wallet-request-uri");

    fireEvent.focus(window);
    expect(mocks.fires).toHaveLength(1);
  });

  it("asks who answered, then signs in with that identity", async () => {
    const loginWithWallet = vi.fn().mockResolvedValue(undefined);
    mocks.mockUseSession.mockReturnValue(makeSession({ loginWithWallet }));
    const { onSignedIn } = renderSignIn();
    await screen.findByTestId("wallet-request-uri");

    const answer = { identityId: IDENTITY, grant: {} };
    await act(async () => answers[0].resolve(answer));

    expect(await screen.findByText("Is this you?")).toBeTruthy();
    expect(screen.getByText("@alice")).toBeTruthy();
    expect(screen.getByText(IDENTITY)).toBeTruthy();
    expect(mocks.disposeWalletLoginRequest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Continue as @alice" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(mocks.loginWithWalletAnswer).toHaveBeenCalledWith(
      expect.anything(),
      answer,
      { persist: expect.any(Function) },
    );
    expect(loginWithWallet).toHaveBeenCalledWith(
      { identityId: IDENTITY, auth: {}, grant: { keyId: 5 } },
      { rememberMe: true, staySignedIn: true },
    );
  });

  it("names the identity by a short id when it has no DPNS name", async () => {
    mocks.mockResolveDpnsName.mockResolvedValue(null);
    renderSignIn();
    await screen.findByTestId("wallet-request-uri");
    await act(async () =>
      answers[0].resolve({ identityId: IDENTITY, grant: {} }),
    );

    expect(
      await screen.findByRole("button", { name: "Continue as 4EfA9Jrv…iSeF" }),
    ).toBeTruthy();
  });

  it("starts a fresh request when the answer isn't the user's", async () => {
    renderSignIn();
    await screen.findByTestId("wallet-request-uri");
    await act(async () =>
      answers[0].resolve({ identityId: IDENTITY, grant: {} }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "That's not me" }),
    );

    await waitFor(() =>
      expect(
        (screen.getByTestId("wallet-request-uri") as HTMLInputElement).value,
      ).toBe("dash-connect:request-2"),
    );
    expect(screen.getByText(/someone else may have/i)).toBeTruthy();
    expect(mocks.loginWithWalletAnswer).not.toHaveBeenCalled();
  });

  it("skips the confirmation when the request names an identity", async () => {
    const loginWithWallet = vi.fn().mockResolvedValue(undefined);
    mocks.mockUseSession.mockReturnValue(makeSession({ loginWithWallet }));
    const { onSignedIn } = renderSignIn({ identityHint: IDENTITY });
    await screen.findByTestId("wallet-request-uri");
    expect(mocks.newWalletLoginRequest).toHaveBeenCalledWith(
      expect.objectContaining({ identityHint: IDENTITY }),
    );

    await act(async () =>
      answers[0].resolve({ identityId: IDENTITY, grant: {} }),
    );

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Is this you?")).toBeNull();
    expect(loginWithWallet).toHaveBeenCalledWith(expect.anything(), {
      rememberMe: true,
      staySignedIn: true,
    });
  });

  it("offers a new request after the old one expires", async () => {
    renderSignIn();
    await screen.findByTestId("wallet-request-uri");

    await act(async () =>
      answers[0].reject(new mocks.RequestExpiredError("expired")),
    );
    expect(
      await screen.findByText("No answer from your wallet yet."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(
        (screen.getByTestId("wallet-request-uri") as HTMLInputElement).value,
      ).toBe("dash-connect:request-2"),
    );
    expect(mocks.awaitWalletAnswer).toHaveBeenCalledTimes(2);
  });

  it("explains an ambiguous answer", async () => {
    renderSignIn();
    await screen.findByTestId("wallet-request-uri");
    await act(async () =>
      answers[0].reject(new mocks.AmbiguousWalletAnswerError("two")),
    );
    expect(
      await screen.findByText(/More than one wallet answered this code/),
    ).toBeTruthy();
  });

  it("shows why a wallet answer was refused", async () => {
    renderSignIn();
    await screen.findByTestId("wallet-request-uri");
    await act(async () =>
      answers[0].reject(
        new mocks.WalletAnswerRefusedError("The wallet granted the wrong key."),
      ),
    );
    expect(
      await screen.findByText("The wallet granted the wrong key."),
    ).toBeTruthy();
  });

  it("refuses to start on a network without App Connect", async () => {
    mocks.readChainClock.mockResolvedValue({
      timeMs: 1,
      protocolVersion: 13,
    });
    renderSignIn();
    expect(
      await screen.findByText(
        "This network does not support wallet sign-in yet.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.newWalletLoginRequest).not.toHaveBeenCalled();
  });

  it("waits for the SDK before building a request", async () => {
    mocks.mockUseSession.mockReturnValue(makeSession({ sdk: null }));
    const { rerender } = renderSignIn();
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(mocks.readChainClock).not.toHaveBeenCalled();

    mocks.mockUseSession.mockReturnValue(makeSession());
    rerender(
      <WalletSignIn
        identityHint={null}
        onSignedIn={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("wallet-request-uri")).toBeTruthy();
  });

  it("uses the renewal copy", async () => {
    renderSignIn({ renew: true, identityHint: IDENTITY });
    expect(
      screen.getByRole("heading", { name: "Renew in DashPay" }),
    ).toBeTruthy();
    expect(screen.getByText(/fresh key for this browser/)).toBeTruthy();
  });

  it("goes back", async () => {
    const { onBack } = renderSignIn();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  describe("wiping the answer", () => {
    async function reachConfirm(props = {}) {
      const utils = renderSignIn(props);
      await screen.findByTestId("wallet-request-uri");
      const answer = { identityId: IDENTITY, grant: {} };
      await act(async () => answers[0].resolve(answer));
      await screen.findByText("Is this you?");
      return { ...utils, answer };
    }

    it("wipes a declined answer", async () => {
      const { answer } = await reachConfirm();
      fireEvent.click(screen.getByRole("button", { name: "That's not me" }));
      expect(mocks.disposeWalletAnswer).toHaveBeenCalledTimes(1);
      expect(mocks.disposeWalletAnswer).toHaveBeenCalledWith(answer);
      await screen.findByDisplayValue("dash-connect:request-2");
      expect(mocks.disposeWalletAnswer).toHaveBeenCalledTimes(1);
    });

    it("wipes the answer on Back", async () => {
      const { answer, onBack } = await reachConfirm();
      fireEvent.click(screen.getByRole("button", { name: /back/i }));
      expect(mocks.disposeWalletAnswer).toHaveBeenCalledWith(answer);
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("wipes the answer when it unmounts while confirming", async () => {
      const { answer, unmount } = await reachConfirm();
      unmount();
      expect(mocks.disposeWalletAnswer).toHaveBeenCalledTimes(1);
      expect(mocks.disposeWalletAnswer).toHaveBeenCalledWith(answer);
    });

    it("wipes an answer that arrives while the name is still loading", async () => {
      const name = deferred<string | null>();
      mocks.mockResolveDpnsName.mockReturnValue(name.promise);
      const { unmount } = renderSignIn();
      await screen.findByTestId("wallet-request-uri");
      const answer = { identityId: IDENTITY, grant: {} };
      await act(async () => answers[0].resolve(answer));

      unmount();
      expect(mocks.disposeWalletAnswer).toHaveBeenCalledWith(answer);
      await act(async () => name.resolve("alice"));
      expect(mocks.disposeWalletAnswer).toHaveBeenCalledTimes(1);
    });

    it("hands the answer to the sign-in instead of wiping it", async () => {
      const { answer, onSignedIn, unmount } = await reachConfirm();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue as @alice" }),
      );
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(mocks.loginWithWalletAnswer).toHaveBeenCalledWith(
        expect.anything(),
        answer,
        expect.anything(),
      );
      unmount();
      expect(mocks.disposeWalletAnswer).not.toHaveBeenCalled();
    });
  });

  it("focuses the heading after the dialog takes focus", async () => {
    render(
      <Modal open title="Sign in" onClose={vi.fn()}>
        <WalletSignIn
          identityHint={null}
          onSignedIn={vi.fn()}
          onBack={vi.fn()}
        />
      </Modal>,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Sign in with DashPay" }),
      ),
    );
  });

  it("moves focus to Continue when asking who answered", async () => {
    renderSignIn();
    await screen.findByTestId("wallet-request-uri");
    await act(async () =>
      answers[0].resolve({ identityId: IDENTITY, grant: {} }),
    );
    const button = await screen.findByRole("button", {
      name: "Continue as @alice",
    });
    expect(document.activeElement).toBe(button);
  });

  describe("stay signed in", () => {
    const checkbox = () =>
      screen.getByRole("checkbox", {
        name: "Stay signed in on this device",
      }) as HTMLInputElement;

    async function confirmAnswer() {
      await screen.findByTestId("wallet-request-uri");
      const answer = { identityId: IDENTITY, grant: {} };
      await act(async () => answers[0].resolve(answer));
      fireEvent.click(
        await screen.findByRole("button", { name: "Continue as @alice" }),
      );
      return answer;
    }

    it("is on by default and says what it keeps", async () => {
      renderSignIn();
      await screen.findByTestId("wallet-request-uri");
      expect(checkbox().checked).toBe(true);
      expect(checkbox().disabled).toBe(false);
      expect(
        screen.getByText(
          "Keeps the wallet's key on this device until it expires. It can only write notes.",
        ),
      ).toBeTruthy();
    });

    it("defaults a renewal to whether a session is kept", async () => {
      mocks.peekWalletSession.mockResolvedValue(null);
      mocks.mockUseSession.mockReturnValue(
        makeSession({ walletSessionKept: true }),
      );
      renderSignIn({ renew: true, identityHint: IDENTITY });
      await screen.findByTestId("wallet-request-uri");
      await waitFor(() => expect(checkbox().checked).toBe(false));
      expect(mocks.peekWalletSession).toHaveBeenCalledTimes(1);
    });

    it("keeps a renewal on when a session is stored", async () => {
      mocks.peekWalletSession.mockResolvedValue({ identityId: IDENTITY });
      mocks.mockUseSession.mockReturnValue(
        makeSession({ identityId: IDENTITY }),
      );
      renderSignIn({ renew: true, identityHint: IDENTITY });
      await screen.findByTestId("wallet-request-uri");
      await waitFor(() => expect(checkbox().checked).toBe(true));
    });

    it("ignores a session stored for another identity on renewal", async () => {
      mocks.peekWalletSession.mockResolvedValue({ identityId: "someone-else" });
      mocks.mockUseSession.mockReturnValue(
        makeSession({ identityId: IDENTITY, walletSessionKept: true }),
      );
      renderSignIn({ renew: true, identityHint: IDENTITY });
      await screen.findByTestId("wallet-request-uri");
      await waitFor(() => expect(checkbox().checked).toBe(false));
      expect(mocks.peekWalletSession).toHaveBeenCalledTimes(1);
    });

    it("is unavailable when the browser can't keep a key", async () => {
      mocks.walletSessionStorageAvailable.mockResolvedValue(false);
      const loginWithWallet = vi.fn().mockResolvedValue(undefined);
      mocks.mockUseSession.mockReturnValue(makeSession({ loginWithWallet }));
      const { onSignedIn } = renderSignIn();
      await screen.findByTestId("wallet-request-uri");
      await waitFor(() => expect(checkbox().disabled).toBe(true));
      expect(checkbox().checked).toBe(false);
      expect(
        screen.getByText(
          "Your browser won't keep a key here (private window?)",
        ),
      ).toBeTruthy();

      const answer = await confirmAnswer();
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(mocks.loginWithWalletAnswer).toHaveBeenCalledWith(
        expect.anything(),
        answer,
        {},
      );
      expect(mocks.clearWalletSession).toHaveBeenCalled();
    });

    it("keeps the key through the persist hook", async () => {
      const { onSignedIn } = renderSignIn();
      await confirmAnswer();
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(mocks.clearWalletSession).not.toHaveBeenCalled();

      const { persist } = mocks.loginWithWalletAnswer.mock.calls[0][2];
      const grant = {
        keyId: 7,
        contractId: "contract-abc",
        totalBudget: 10n,
        remainingBudget: 4n,
        expiresAt: 1_800_000_000_000,
      };
      const key = new Uint8Array(32).fill(1);
      await persist(grant, key);
      expect(mocks.saveWalletSession).toHaveBeenCalledWith(
        {
          identityId: IDENTITY,
          keyId: 7,
          contractId: "contract-abc",
          totalBudget: 10n,
          expiresAt: 1_800_000_000_000,
          grantedAt: expect.any(Number),
        },
        key,
      );
    });

    it("keeps the old record when an unchecked sign-in fails", async () => {
      mocks.loginWithWalletAnswer.mockRejectedValue(new Error("key gone"));
      renderSignIn();
      await screen.findByTestId("wallet-request-uri");
      fireEvent.click(checkbox());
      await confirmAnswer();
      expect(await screen.findByText("key gone")).toBeTruthy();
      expect(mocks.clearWalletSession).not.toHaveBeenCalled();
    });

    it("signs in for this tab only when unchecked", async () => {
      const loginWithWallet = vi.fn().mockResolvedValue(undefined);
      mocks.mockUseSession.mockReturnValue(makeSession({ loginWithWallet }));
      const signedIn = deferred<unknown>();
      mocks.loginWithWalletAnswer.mockReturnValue(signedIn.promise);
      const { onSignedIn } = renderSignIn();
      await screen.findByTestId("wallet-request-uri");
      fireEvent.click(checkbox());
      expect(checkbox().checked).toBe(false);

      const answer = await confirmAnswer();
      await waitFor(() =>
        expect(mocks.loginWithWalletAnswer).toHaveBeenCalledTimes(1),
      );
      // The old record stays until the new key has signed in.
      expect(mocks.clearWalletSession).not.toHaveBeenCalled();
      await act(async () =>
        signedIn.resolve({
          identityId: IDENTITY,
          auth: {},
          grant: { keyId: 5 },
        }),
      );
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(mocks.clearWalletSession).toHaveBeenCalledTimes(1);
      expect(mocks.clearWalletSession).toHaveBeenCalledWith();
      expect(mocks.clearWalletSession.mock.invocationCallOrder[0]).toBeLessThan(
        loginWithWallet.mock.invocationCallOrder[0],
      );
      expect(mocks.loginWithWalletAnswer).toHaveBeenCalledWith(
        expect.anything(),
        answer,
        {},
      );
      expect(loginWithWallet).toHaveBeenCalledWith(expect.anything(), {
        rememberMe: false,
        staySignedIn: false,
      });
    });

    it("still signs in when the key can't be kept", async () => {
      mocks.saveWalletSession.mockRejectedValue(new Error("quota"));
      mocks.loginWithWalletAnswer.mockImplementation(
        async (_sdk, _answer, options) => {
          await options.persist(
            {
              keyId: 5,
              contractId: "contract-abc",
              totalBudget: null,
              remainingBudget: null,
              expiresAt: null,
            },
            new Uint8Array(32),
          );
          return { identityId: IDENTITY, auth: {}, grant: { keyId: 5 } };
        },
      );
      const log = vi.fn();
      const loginWithWallet = vi.fn().mockResolvedValue(undefined);
      mocks.mockUseSession.mockReturnValue(
        makeSession({ log, loginWithWallet }),
      );
      const { onSignedIn } = renderSignIn();
      await confirmAnswer();

      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(log).toHaveBeenCalledWith(
        "Couldn't keep the key on this device; you'll sign in again after a reload.",
      );
      // An older key kept for this identity must not outlive the new one.
      expect(mocks.clearWalletSession).toHaveBeenCalledTimes(1);
      expect(mocks.clearWalletSession).toHaveBeenCalledWith();
      expect(loginWithWallet).toHaveBeenCalledWith(expect.anything(), {
        rememberMe: true,
        staySignedIn: false,
      });
    });
  });

  it("removes only the key it kept when closed during the sign-in", async () => {
    const finished = deferred<unknown>();
    mocks.loginWithWalletAnswer.mockImplementation(
      async (_sdk, _answer, options) => {
        await options.persist(
          {
            keyId: 7,
            contractId: "contract-abc",
            totalBudget: null,
            remainingBudget: null,
            expiresAt: null,
          },
          new Uint8Array(32),
        );
        await finished.promise;
        return { identityId: IDENTITY, auth: {}, grant: { keyId: 7 } };
      },
    );
    const loginWithWallet = vi.fn().mockResolvedValue(undefined);
    mocks.mockUseSession.mockReturnValue(makeSession({ loginWithWallet }));
    const { unmount } = renderSignIn({ identityHint: IDENTITY });
    await screen.findByTestId("wallet-request-uri");
    await act(async () =>
      answers[0].resolve({ identityId: IDENTITY, grant: {} }),
    );
    await waitFor(() =>
      expect(mocks.saveWalletSession).toHaveBeenCalledTimes(1),
    );
    unmount();
    await act(async () => finished.resolve(undefined));

    await waitFor(() =>
      expect(mocks.clearWalletSession).toHaveBeenCalledTimes(1),
    );
    expect(mocks.clearWalletSession).toHaveBeenCalledWith({
      identityId: IDENTITY,
      keyId: 7,
    });
    expect(loginWithWallet).not.toHaveBeenCalled();
  });

  it("aborts the poll when it unmounts", async () => {
    const { unmount } = renderSignIn();
    await screen.findByTestId("wallet-request-uri");
    const { signal } = mocks.awaitWalletAnswer.mock.calls[0][2];
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
  });
});
