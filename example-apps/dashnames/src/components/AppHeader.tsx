/**
 * Header: 60px, wordmark + nav left, persistent search + identity chip right.
 *
 * There is NO wallet-connect modal — the signed-in identity and its live credit
 * balance live permanently here, and every signing step names the identity.
 */
import { useEffect, useRef, type FormEvent } from "react";
import type { Network } from "../dash/contracts";
import { IdentityChip } from "./IdentityChip";

export type View =
  | "discover"
  | "browse"
  | "detail"
  /** The portfolio — also where listing a name starts. */
  | "my-names"
  | "activity"
  | "settings"
  | "how";

/**
 * The nav is Discover · Browse · My names · Activity. There is deliberately no
 * "Sell" entry.
 *
 * A Sell view would have been My names filtered to listable rows — a
 * near-duplicate sitting in the slot right beside it, same component and same
 * rows, just fewer — while the browse grid got no header entry at all,
 * reachable only through Discover's "See all N →". Browse takes that slot
 * instead. Listing is not lost: it starts from the per-row "List for sale"
 * button in My names, which is the real entry point. A dedicated list-a-name
 * picker would need a UI this app doesn't have.
 */
const NAV: Array<{ view: View; label: string }> = [
  { view: "discover", label: "Discover" },
  { view: "browse", label: "Browse" },
  { view: "my-names", label: "My names" },
  { view: "activity", label: "Activity" },
];

export function AppHeader({
  view,
  onNavigate,
  showSearch,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  identityName,
  identityId,
  balance,
  network,
  onNetworkChange,
  onSettingsClick,
  onIdentityClick,
}: {
  view: View;
  onNavigate: (view: View) => void;
  showSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
  identityName: string | null;
  identityId: string | null;
  balance: bigint | null;
  network: Network;
  onNetworkChange: (network: Network) => void;
  onSettingsClick: () => void;
  onIdentityClick: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showSearch) return;

    function focusSearch(event: KeyboardEvent) {
      if (
        event.key !== "/" ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, [role='textbox']"))
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    }

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [showSearch]);

  // A name-detail page is reached from the grid, so it keeps Browse lit.
  const activeFor = (item: View) =>
    item === view || (item === "browse" && view === "detail");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSearchSubmit?.();
  }

  return (
    <header className="app-header">
      <div className="app-header__left">
        <button
          type="button"
          className="wordmark"
          onClick={() => onNavigate("discover")}
        >
          dashnames
        </button>
        <nav className="app-nav">
          {NAV.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`app-nav__item${activeFor(item.view) ? " app-nav__item--active" : ""}`}
              onClick={() => onNavigate(item.view)}
              aria-current={activeFor(item.view) ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="app-header__right">
        {showSearch && (
          <form className="header-search" onSubmit={handleSubmit}>
            <button
              type="submit"
              className="header-search__glyph"
              aria-label="Submit name search"
            >
              ⌕
            </button>
            <input
              ref={searchInputRef}
              className="header-search__input"
              type="search"
              placeholder="Search any name"
              aria-label="Search any name"
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
            <kbd className="header-search__shortcut">/</kbd>
          </form>
        )}
        <select
          className="header-network"
          aria-label="Platform network"
          value={network}
          onChange={(event) => onNetworkChange(event.target.value as Network)}
        >
          <option value="testnet">TESTNET</option>
          <option value="mainnet">MAINNET</option>
        </select>
        <button
          type="button"
          className="header-settings"
          aria-label="Settings"
          title="Network and index settings"
          onClick={onSettingsClick}
        >
          Settings
        </button>
        <IdentityChip
          name={identityName}
          identityId={identityId}
          balance={balance}
          onClick={onIdentityClick}
          disabled={!identityId && network !== "testnet"}
        />
      </div>
    </header>
  );
}
