/**
 * App orchestrator: owns view routing, modal state, and the write handlers.
 *
 * LOAD ANCHOR: nothing reachable from here may take a top-level *value* import
 * of `@dashevo/evo-sdk` (type-only is fine). The SDK arrives through the cached
 * dynamic loaders inside SessionContext.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOMAIN_DOCUMENT_TYPE, DPNS_CONTRACT_ID } from "./dash/contracts";
import {
  fetchDomainById,
  toListing,
  type DomainRecord,
} from "./dash/dpnsQueries";
import type { Listing } from "./dash/listingTypes";
import type { MarketplaceError } from "./dash/marketplaceErrors";
import { purchaseName } from "./dash/purchaseName";
import { setPrice as setDocumentPrice } from "./dash/setPrice";
import { transferName } from "./dash/transferName";
import { resolveDpnsName } from "./dash/resolveRecipient";
import { classifyRecipientInput } from "./dash/classifyRecipientInput";
import { useActivity } from "./hooks/useActivity";
import { useDocumentLabels } from "./hooks/useDocumentLabels";
import { isStale, useListings } from "./hooks/useListings";
import { useMyNames } from "./hooks/useMyNames";
import { useIdentityNames } from "./hooks/useIdentityNames";
import { useNameSearch } from "./hooks/useNameSearch";
import { useNameDetail } from "./hooks/useNameDetail";
import { useSalesStats } from "./hooks/useSalesStats";
import { SessionProvider } from "./session/SessionContext";
import { useSession } from "./session/useSession";
import { consoleLogger, errorMessage } from "./lib/logger";
import { applyFilters, DEFAULT_FILTERS, type Filters } from "./lib/filters";
import { ActivityView, type ActivityFilter } from "./components/ActivityView";
import { AppHeader, type View } from "./components/AppHeader";
import { BrowseView } from "./components/BrowseView";
import { BuyModal } from "./components/BuyModal";
import { DiscoverView } from "./components/DiscoverView";
import { HowItWorks } from "./components/HowItWorks";
import { IdentityView } from "./components/IdentityView";
import { ManageListingModal } from "./components/ManageListingModal";
import { LoginModal } from "./components/LoginModal";
import { MyNamesView } from "./components/MyNamesView";
import { NameDetailView } from "./components/NameDetailView";
import { SettingsView } from "./components/SettingsView";
import { TransferModal } from "./components/TransferModal";

function Shell() {
  const session = useSession();
  const {
    sdk,
    network,
    keyManager,
    identityId,
    identityName,
    balance,
    protocol,
  } = session;

  const [view, setView] = useState<View>("discover");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [identityDetailId, setIdentityDetailId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const settingsReturnView = useRef<View>("discover");
  const identityReturnView = useRef<View>("discover");
  const [detailReturn, setDetailReturn] = useState<{
    view: View;
    label: string;
    position: number | null;
    total: number | null;
  }>({ view: "discover", label: "discover", position: null, total: null });

  // Modal state
  const [buyTarget, setBuyTarget] = useState<Listing | null>(null);
  const [pendingBuy, setPendingBuy] = useState<Listing | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [manageTarget, setManageTarget] = useState<DomainRecord | null>(null);
  const [transferTarget, setTransferTarget] = useState<DomainRecord | null>(
    null,
  );
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeError, setWriteError] = useState<MarketplaceError | null>(null);

  // Recipient resolution for the transfer modal
  const [resolving, setResolving] = useState(false);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const recipientRequestId = useRef(0);

  const listingsState = useListings({ sdk, network, log: consoleLogger });
  const { listings, phase, progress, lastSyncedAt, refresh, rebuild } =
    listingsState;

  const search = useNameSearch(sdk);
  const salesStats = useSalesStats({ sdk, enabled: Boolean(sdk) });
  const activity = useActivity({
    sdk,
    enabled: Boolean(sdk) && (view === "activity" || view === "discover"),
  });
  const myNames = useMyNames({
    sdk,
    identityId,
    enabled: Boolean(sdk) && Boolean(identityId),
  });
  const identityNames = useIdentityNames({
    sdk,
    identityId: identityDetailId,
    enabled: Boolean(sdk) && view === "identity" && Boolean(identityDetailId),
  });
  const detail = useNameDetail({ sdk, documentId: detailId });

  // Drives the "synced Ns ago" / stale transition without a re-render storm.
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(handle);
  }, []);

  const handleNetworkChange = useCallback(
    (next: typeof network) => {
      setLoginOpen(false);
      setPendingBuy(null);
      session.setNetwork(next);
    },
    [session],
  );

  const stale = isStale(lastSyncedAt, now);
  const canWrite = Boolean(keyManager && identityId);
  const canOfferBuy = true;

  const navigateSettings = useCallback((behavior: "open" | "toggle") => {
    setView((current) => {
      if (behavior === "toggle" && current === "settings") {
        return settingsReturnView.current;
      }
      if (current !== "settings") settingsReturnView.current = current;
      return "settings";
    });
  }, []);

  const openLogin = useCallback(() => {
    if (network !== "testnet") {
      navigateSettings("open");
      return;
    }
    setLoginOpen(true);
  }, [network, navigateSettings]);

  const requestBuy = useCallback(
    (listing: Listing) => {
      if (listing.ownerId === identityId) return;
      if (!keyManager || !identityId) {
        setPendingBuy(listing);
        setLoginOpen(true);
        return;
      }
      setBuyTarget(listing);
    },
    [identityId, keyManager],
  );

  const sales = useMemo(
    () => activity.events.filter((e) => e.type === "purchase"),
    [activity.events],
  );

  // History records reference names only by documentId, so tables resolve the
  // label separately. Sorted for a stable cache key across renders.
  const eventDocumentIds = useMemo(
    () => [...new Set(activity.events.map((e) => e.documentId))].sort(),
    [activity.events],
  );
  const lookupName = useDocumentLabels(sdk, eventDocumentIds);

  const browseResults = useMemo(
    () => applyFilters(listings, filters),
    [listings, filters],
  );

  const openDetail = useCallback(
    (documentId: string) => {
      const returnView = view === "detail" ? "discover" : view;
      const labels: Partial<Record<View, string>> = {
        browse: "browse",
        discover: "discover",
        activity: "activity",
        "my-names": "my names",
        identity: "identity",
      };
      const browseIndex =
        returnView === "browse"
          ? browseResults.findIndex(
              (listing) => listing.documentId === documentId,
            )
          : -1;
      setDetailReturn({
        view: returnView,
        label: labels[returnView] ?? "discover",
        position: browseIndex >= 0 ? browseIndex + 1 : null,
        total: browseIndex >= 0 ? browseResults.length : null,
      });
      setDetailId(documentId);
      setView("detail");
    },
    [browseResults, view],
  );

  const openIdentity = useCallback(
    (targetIdentityId: string) => {
      if (view !== "identity") identityReturnView.current = view;
      setIdentityDetailId(targetIdentityId);
      setView("identity");
    },
    [view],
  );

  const handleSearchSubmit = useCallback(async () => {
    const outcome = await search.search(searchInput);
    if (outcome.kind === "found") openDetail(outcome.record.documentId);
  }, [search, searchInput, openDetail]);

  /** Re-fetch used by the buy modal on open, on expiry, and at confirm. */
  const revalidate = useCallback(
    async (documentId: string): Promise<DomainRecord | null> => {
      if (!sdk) return null;
      try {
        return await fetchDomainById({ sdk, documentId });
      } catch {
        return null;
      }
    },
    [sdk],
  );

  const handleConfirmPurchase = useCallback(
    async (listing: Listing, price: bigint) => {
      if (!sdk || !keyManager) {
        return {
          ok: false as const,
          error: { kind: "Unknown" as const, message: "Not signed in." },
        };
      }
      const result = await purchaseName({
        sdk,
        keyManager,
        contractId: DPNS_CONTRACT_ID,
        documentTypeName: DOMAIN_DOCUMENT_TYPE,
        documentId: listing.documentId,
        price,
        log: consoleLogger,
      });
      if (result.ok) {
        // The bought name is no longer for sale; drop it locally rather than
        // waiting for the next sync, then reconcile against Platform.
        listingsState.applyLocal(listing.documentId, null);
        void session.refreshBalance();
        void myNames.refresh();
        void refresh();
      }
      return result;
    },
    [sdk, keyManager, listingsState, session, myNames, refresh],
  );

  const handleSetPrice = useCallback(
    async (credits: bigint) => {
      if (!sdk || !keyManager || !manageTarget) return;
      setWriteBusy(true);
      setWriteError(null);
      const result = await setDocumentPrice({
        sdk,
        keyManager,
        contractId: DPNS_CONTRACT_ID,
        documentTypeName: DOMAIN_DOCUMENT_TYPE,
        documentId: manageTarget.documentId,
        price: credits,
        log: consoleLogger,
      });
      setWriteBusy(false);
      if (!result.ok) {
        setWriteError(result.error);
        return;
      }
      // Re-read the document so the local index carries the true revision.
      const fresh = await revalidate(manageTarget.documentId);
      if (fresh) {
        listingsState.applyLocal(
          fresh.documentId,
          credits > 0n ? toListing(fresh, Date.now()) : null,
        );
      }
      setStatus(credits > 0n ? "Price updated." : "Listing removed.");
      setManageTarget(null);
      void myNames.refresh();
      void refresh();
    },
    [
      sdk,
      keyManager,
      manageTarget,
      revalidate,
      listingsState,
      myNames,
      refresh,
    ],
  );

  const handleTransfer = useCallback(
    async (recipientId: string) => {
      if (!sdk || !keyManager || !transferTarget) return;
      setWriteBusy(true);
      setWriteError(null);
      const result = await transferName({
        sdk,
        keyManager,
        contractId: DPNS_CONTRACT_ID,
        documentTypeName: DOMAIN_DOCUMENT_TYPE,
        documentId: transferTarget.documentId,
        recipientId,
        log: consoleLogger,
      });
      setWriteBusy(false);
      if (!result.ok) {
        setWriteError(result.error);
        return;
      }
      // A transfer clears any price without writing a priceUpdate record.
      listingsState.applyLocal(transferTarget.documentId, null);
      setStatus("Name transferred.");
      setTransferTarget(null);
      void myNames.refresh();
      void refresh();
    },
    [sdk, keyManager, transferTarget, listingsState, myNames, refresh],
  );

  const handleRecipientChange = useCallback(
    async (value: string) => {
      const requestId = ++recipientRequestId.current;
      const trimmed = value.trim();
      setResolvedId(null);
      setResolveError(null);
      setResolving(false);
      if (!sdk || !trimmed) return;

      const mode = classifyRecipientInput(trimmed);
      if (mode === "invalid") return;
      if (mode === "ambiguous") {
        // Looks like a base58 identity ID — use it directly.
        setResolvedId(trimmed);
        return;
      }

      setResolving(true);
      try {
        const id = await resolveDpnsName(sdk, trimmed);
        if (recipientRequestId.current !== requestId) return;
        if (id) setResolvedId(id);
        else setResolveError("No identity is registered for that name.");
      } catch (err) {
        if (recipientRequestId.current !== requestId) return;
        setResolveError(errorMessage(err));
      } finally {
        if (recipientRequestId.current === requestId) setResolving(false);
      }
    },
    [sdk],
  );

  const detailIsOwner = Boolean(
    detail.record && identityId && detail.record.ownerId === identityId,
  );

  return (
    <div className="app-shell">
      <AppHeader
        view={view}
        onNavigate={setView}
        showSearch
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={handleSearchSubmit}
        identityName={identityName}
        identityId={identityId}
        balance={balance}
        network={network}
        onNetworkChange={handleNetworkChange}
        onSettingsClick={() => navigateSettings("open")}
        onIdentityClick={() =>
          identityId ? navigateSettings("toggle") : openLogin()
        }
      />

      <main style={{ flex: 1 }}>
        {view === "discover" && (
          <DiscoverView
            listings={listings}
            sales={sales}
            salesStats={salesStats.stats}
            syncPhase={phase}
            syncProgress={progress}
            lastSyncedAt={lastSyncedAt}
            stale={stale}
            searchInput={searchInput}
            onSearchInput={(value) => {
              setSearchInput(value);
              search.reset();
            }}
            onSearchSubmit={handleSearchSubmit}
            searchOutcome={search.outcome}
            onOpenListing={(l) => openDetail(l.documentId)}
            onOpenDocument={openDetail}
            onBuy={requestBuy}
            onManage={setManageTarget}
            onSeeAll={() => setView("browse")}
            onOpenMyNames={() => setView("my-names")}
            onOpenHow={() => setView("how")}
            canBuy={canOfferBuy}
            buyerIdentityId={identityId}
            loadingSales={activity.loading}
            onRefresh={refresh}
            lookupName={lookupName}
            onOpenIdentity={openIdentity}
          />
        )}

        {view === "browse" && (
          <BrowseView
            listings={listings}
            filters={filters}
            onFiltersChange={setFilters}
            syncPhase={phase}
            syncProgress={progress}
            lastSyncedAt={lastSyncedAt}
            stale={stale}
            onOpenListing={(l) => openDetail(l.documentId)}
            onBuy={requestBuy}
            onManage={setManageTarget}
            canBuy={canOfferBuy}
            buyerIdentityId={identityId}
            onRefresh={refresh}
          />
        )}

        {view === "detail" && (
          <NameDetailView
            record={detail.record}
            network={network}
            ownership={detail.ownership}
            priceHistory={detail.priceHistory}
            loading={detail.loading}
            balance={balance}
            isOwner={detailIsOwner}
            canWrite={detailIsOwner ? canWrite : canOfferBuy}
            backLabel={detailReturn.label}
            resultPosition={detailReturn.position}
            resultCount={detailReturn.total}
            onBack={() => setView(detailReturn.view)}
            onBuy={() => {
              if (!detail.record) return;
              const listing = toListing(detail.record, Date.now());
              if (listing) requestBuy(listing);
            }}
            onManage={() => detail.record && setManageTarget(detail.record)}
            onOpenIdentity={openIdentity}
          />
        )}

        {view === "identity" && identityDetailId && (
          <IdentityView
            identityId={identityDetailId}
            names={identityNames.names}
            loading={identityNames.loading}
            error={identityNames.error}
            network={network}
            onBack={() => setView(identityReturnView.current)}
            onOpenName={(record) => openDetail(record.documentId)}
            onOpenIdentity={openIdentity}
          />
        )}

        {view === "my-names" && (
          <MyNamesView
            names={myNames.names}
            loading={myNames.loading}
            identityName={identityName}
            identityId={identityId}
            balance={balance}
            canWrite={canWrite}
            onManage={setManageTarget}
            onTransfer={setTransferTarget}
            onOpen={(record) => openDetail(record.documentId)}
          />
        )}

        {view === "activity" && (
          <ActivityView
            events={activity.events}
            loading={activity.loading}
            filter={activityFilter}
            onFilterChange={setActivityFilter}
            onOpenDocument={openDetail}
            lookupName={lookupName}
            onOpenIdentity={openIdentity}
          />
        )}

        {view === "settings" && (
          <SettingsView
            network={network}
            onNetworkChange={handleNetworkChange}
            identityId={identityId}
            identityName={identityName}
            balance={balance}
            protocol={protocol}
            status={status}
            onOpenLogin={openLogin}
            onLogout={session.logout}
            onRebuildIndex={rebuild}
            indexSize={listings.length}
            persistFailed={listingsState.persistFailed}
          />
        )}

        {view === "how" && <HowItWorks />}
      </main>

      <footer className="app-footer">
        <p className="app-footer__note">
          Listings are indexed locally from DPNS price-update history and
          revalidated against Platform state before any purchase. Prices are
          shown in DASH; transactions settle in Platform credits.{" "}
          <button
            type="button"
            className="sync-chip__refresh"
            onClick={() => setView("how")}
          >
            How it works
          </button>
        </p>
        <a
          className="app-footer__source"
          href="https://github.com/dashpay/platform-tutorials/tree/main/example-apps/dashnames"
          target="_blank"
          rel="noreferrer"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          View source
        </a>
      </footer>

      <BuyModal
        listing={buyTarget}
        open={Boolean(buyTarget)}
        identityName={identityName}
        identityId={identityId}
        balance={balance}
        onClose={() => setBuyTarget(null)}
        onRevalidate={revalidate}
        onConfirm={handleConfirmPurchase}
        onViewName={(documentId) => {
          setBuyTarget(null);
          openDetail(documentId);
        }}
      />

      <LoginModal
        open={loginOpen}
        onClose={() => {
          setLoginOpen(false);
          if (!identityId) setPendingBuy(null);
        }}
        onSuccess={() => {
          setLoginOpen(false);
          if (pendingBuy) setBuyTarget(pendingBuy);
          setPendingBuy(null);
        }}
      />

      <ManageListingModal
        record={manageTarget}
        open={Boolean(manageTarget)}
        busy={writeBusy}
        error={writeError}
        onClose={() => {
          setManageTarget(null);
          setWriteError(null);
        }}
        onSetPrice={handleSetPrice}
        onRemoveListing={() => handleSetPrice(0n)}
        onTransfer={() => {
          setTransferTarget(manageTarget);
          setManageTarget(null);
        }}
      />

      <TransferModal
        record={transferTarget}
        open={Boolean(transferTarget)}
        busy={writeBusy}
        error={writeError}
        resolving={resolving}
        resolvedId={resolvedId}
        resolvedName={null}
        resolveError={resolveError}
        onClose={() => {
          recipientRequestId.current += 1;
          setTransferTarget(null);
          setWriteError(null);
          setResolvedId(null);
          setResolveError(null);
        }}
        onRecipientChange={handleRecipientChange}
        onTransfer={handleTransfer}
      />
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
