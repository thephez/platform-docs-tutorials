// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuyModal } from "../src/components/BuyModal";
import type { DomainRecord } from "../src/dash/dpnsQueries";
import type { Listing } from "../src/dash/listingTypes";
import { CREDITS_PER_DASH } from "../src/lib/format";

const listing: Listing = {
  documentId: "d1",
  label: "alice",
  normalizedLabel: "alice",
  parentDomainName: "dash",
  ownerId: "seller-1",
  resolvesTo: "seller-1",
  price: 42n * CREDITS_PER_DASH,
  revision: 3n,
  seenAt: 0,
};

function record(overrides: Partial<DomainRecord> = {}): DomainRecord {
  return {
    documentId: "d1",
    label: "alice",
    normalizedLabel: "alice",
    parentDomainName: "dash",
    ownerId: "seller-1",
    resolvesTo: "seller-1",
    price: 42n * CREDITS_PER_DASH,
    revision: 3n,
    ...overrides,
  };
}

type Revalidate = (documentId: string) => Promise<DomainRecord | null>;
type Confirm = (
  listing: Listing,
  price: bigint,
) => Promise<
  | { ok: true }
  | { ok: false; error: { kind: "PriceMismatch"; message: string } }
>;

function renderModal(opts: {
  revalidate: Revalidate;
  confirm?: Confirm;
  balance?: bigint | null;
}) {
  const confirm = vi.fn<Confirm>(
    opts.confirm ?? (async () => ({ ok: true as const })),
  );
  render(
    <BuyModal
      listing={listing}
      open
      identityName="quinn.dash"
      identityId="buyer-1"
      balance={opts.balance ?? 500n * CREDITS_PER_DASH}
      onClose={vi.fn()}
      onRevalidate={opts.revalidate}
      onConfirm={confirm}
      onViewName={vi.fn()}
    />,
  );
  return { confirm };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const confirmButton = () =>
  screen.getByRole("button", {
    name: /confirm purchase/i,
  }) as HTMLButtonElement;

describe("BuyModal", () => {
  it("revalidates on open and reaches the ready state", async () => {
    const revalidate = vi.fn<Revalidate>(async () => record());
    renderModal({ revalidate });

    await waitFor(() =>
      expect(screen.getByText(/revalidated against Platform/i)).toBeTruthy(),
    );
    expect(revalidate).toHaveBeenCalledWith("d1");
    expect(confirmButton().disabled).toBe(false);
  });

  it("re-fetches AGAIN at confirm and refuses to sign when the price moved", async () => {
    // THE critical path: the modal reached "ready" against 42 DASH, then the
    // owner repriced. Pressing confirm must catch it rather than submit.
    const revalidate = vi
      .fn<Revalidate>()
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(
        record({ price: 99n * CREDITS_PER_DASH, revision: 4n }),
      );
    const { confirm } = renderModal({ revalidate });

    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByText(/no longer available/i)).toBeTruthy(),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(/Nothing was signed and no credits were spent/i),
    ).toBeTruthy();
  });

  it("refuses to sign when the name was delisted after the modal opened", async () => {
    const revalidate = vi
      .fn<Revalidate>()
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(record({ price: null, revision: 4n }));
    const { confirm } = renderModal({ revalidate });

    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByText(/no longer available/i)).toBeTruthy(),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/no price/i)).toBeTruthy();
  });

  it("shows the owner change in the diff when the name already sold", async () => {
    const revalidate = vi
      .fn<Revalidate>()
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(
        record({ price: null, revision: 4n, ownerId: "someone-else" }),
      );
    renderModal({ revalidate });

    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByText(/Owner changed/i)).toBeTruthy(),
    );
  });

  it("signs with the confirm-time price when nothing moved", async () => {
    const revalidate = vi.fn<Revalidate>(async () => record());
    const { confirm } = renderModal({ revalidate });

    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][1]).toBe(42n * CREDITS_PER_DASH);
  });

  it("blocks confirm when the balance cannot cover the price", async () => {
    const revalidate = vi.fn<Revalidate>(async () => record());
    renderModal({ revalidate, balance: 1n * CREDITS_PER_DASH });

    await waitFor(() =>
      expect(screen.getByText(/Insufficient credits/i)).toBeTruthy(),
    );
    // The shortfall is stated against the price alone — no invented fees.
    expect(screen.getByText(/41\.000 DASH more/)).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
  });

  it("shows no fee rows, because the SDK exposes no fee quote", async () => {
    const revalidate = vi.fn<Revalidate>(async () => record());
    renderModal({ revalidate });

    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    expect(screen.queryByText(/processing fee/i)).toBeNull();
    expect(screen.queryByText(/storage fee/i)).toBeNull();
    expect(screen.queryByText(/total required/i)).toBeNull();
  });

  it("names the signing identity", async () => {
    const revalidate = vi.fn<Revalidate>(async () => record());
    renderModal({ revalidate });
    await waitFor(() =>
      expect(screen.getByText(/Signed by identity/i)).toBeTruthy(),
    );
    expect(screen.getByText(/quinn\.dash/)).toBeTruthy();
  });

  it("surfaces the protocol message when the write fails", async () => {
    const revalidate = vi.fn<Revalidate>(async () => record());
    const { confirm } = renderModal({
      revalidate,
      confirm: async () => ({
        ok: false as const,
        error: {
          kind: "PriceMismatch" as const,
          message: "Invalid document purchase price: expected 43 got 42",
        },
      }),
    });

    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/expected 43 got 42/)).toBeTruthy(),
    );
  });
});
