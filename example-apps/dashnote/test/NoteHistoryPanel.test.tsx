// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteHistoryPanel } from "../src/components/NoteHistoryPanel";
import type { NoteHistoryEntry } from "../src/dash/fetchNoteHistory";

const entries: NoteHistoryEntry[] = [
  {
    blockTimeMs: Date.now() - 1_000,
    revision: 2,
    title: "Second",
    message: "new body",
    updatedAt: Date.now() - 1_000,
  },
  {
    blockTimeMs: Date.now() - 2_000,
    revision: 1,
    title: "First",
    message: "old body",
    updatedAt: Date.now() - 2_000,
  },
];

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof NoteHistoryPanel>> = {},
) {
  const props: React.ComponentProps<typeof NoteHistoryPanel> = {
    open: true,
    entries,
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    canRestore: true,
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onLoadMore: vi.fn(),
    onRestore: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<NoteHistoryPanel {...props} />) };
}

afterEach(() => {
  cleanup();
});

describe("NoteHistoryPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = renderPanel({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders a loading state", () => {
    renderPanel({ entries: [], loading: true });
    expect(screen.getByLabelText(/loading note history/i)).toBeTruthy();
  });

  it("renders an error and retries", () => {
    const onRetry = vi.fn();
    renderPanel({ entries: [], error: "Data contract not found", onRetry });

    expect(screen.getByText(/history unavailable/i)).toBeTruthy();
    expect(screen.getByText(/data contract not found/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders an empty state", () => {
    renderPanel({ entries: [] });
    expect(screen.getByText(/no history entries found/i)).toBeTruthy();
  });

  it("expands a revision preview and restores it", () => {
    const onRestore = vi.fn();
    renderPanel({ onRestore });

    fireEvent.click(screen.getByRole("button", { name: /revision 1/i }));

    expect(screen.getAllByText("old body").length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", { name: /restore this version/i }),
    );
    expect(onRestore).toHaveBeenCalledWith(entries[1]);
  });

  it("loads newer revisions when more history is available", () => {
    const onLoadMore = vi.fn();
    renderPanel({ hasMore: true, onLoadMore });

    fireEvent.click(
      screen.getByRole("button", { name: /load newer revisions/i }),
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
