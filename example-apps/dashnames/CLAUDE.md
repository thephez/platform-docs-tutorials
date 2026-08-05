# CLAUDE.md

This file provides guidance to Claude Code when working in [example-apps/dashnames/](.).

## Project Overview

React + TypeScript + Vite app for buying and selling DPNS usernames (`alice.dash`) on Dash Platform testnet. Protocol v13 unblocked `transfer`, `priceUpdate`, and `purchase` on DPNS `domain` documents — the contract always declared `transferable: 1` and `tradeMode: 1`, but a hardcoded reject trigger blocked those transitions until v13.

The app's reason to exist is the **listings index**: `$price` is not an indexed property on `domain`, so Platform cannot answer "what is for sale" — a `where` clause on it is rejected outright. The app reconstructs that answer client-side from the Document History contract's price-update stream, then confirms every candidate against its current document. See [The listings index](#the-listings-index).

The shell is a five-view app (`discover` / `browse` / `my-names` / `activity` / `settings`, plus a `how` guide). Browsing, search, and history need no sign-in; listing, buying, and transferring require a mnemonic and a network at protocol v13 or above. Trading works on testnet (v13) and is disabled on mainnet (v12). On mainnet the Document History contract does not exist yet either, so name search and lookup work but listings, activity, and sales stats are unavailable — see [rule 6b](#6b-the-history-contract-may-not-exist-on-the-network-at-all).

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — typecheck (`tsc -b`) then bundle
- `npm run lint` — ESLint
- `npm run test` — Vitest suite in [test/](test/)
- `npm run test:coverage` — Vitest under v8 coverage
- `npm run test:e2e` — Playwright suite in [test/e2e/](test/e2e/) (auto-boots Vite on :5185)
- `npm run test:e2e:ui` — Playwright with the interactive UI runner
- `npm run format` / `format:check` — Prettier
- `npm run preview` — serve production build locally

## Architecture

- **Shared SDK core** — `createClient` and `IdentityKeyManager` come from `../../../../setupDashClient-core.mjs` (the canonical browser-safe core at the host repo root — the same one the Node tutorials use), reached **only** through [sdkCore.ts](src/dash/sdkCore.ts)'s cached dynamic import. No vendoring. The `@dashevo/evo-sdk` bare specifier is aliased in [vite.config.ts](vite.config.ts) to this app's locally installed browser bundle so the shared core resolves the SDK from here.
  - [client.ts](src/dash/client.ts) and [keyManager.ts](src/dash/keyManager.ts) are **static** re-exports of that core and are currently imported by nothing. They exist for parity with the sibling apps, and the entry chunk stays clean only because nothing reaches them. Importing either from a file reachable from `App.tsx` would anchor the ~10 MB SDK to the entry graph — go through `sdkCore.ts` instead. See [Performance](#performance--load-anchor-rules).
- **[src/dash/](src/dash/)** — one file per Platform concern, each with a leading JSDoc block naming the SDK method it wraps.
  - [contracts.ts](src/dash/contracts.ts) — sync constants; see [Contracts](#contracts). No SDK imports; runs before the SDK loads.
  - [listingsIndex.ts](src/dash/listingsIndex.ts) — ★ `coldSync` / `incrementalSync` / `reconcile`. The discovery algorithm; see [The listings index](#the-listings-index).
  - [listingsStore.ts](src/dash/listingsStore.ts) — atomic localStorage snapshot (listings + all watermarks in one write). Synchronous.
  - [historyQueries.ts](src/dash/historyQueries.ts) / [dpnsQueries.ts](src/dash/dpnsQueries.ts) / [historyAggregates.ts](src/dash/historyAggregates.ts) — reads.
  - [protocolVersion.ts](src/dash/protocolVersion.ts) — the v13 gate, fail-closed.
  - [withAuthedDocument.ts](src/dash/withAuthedDocument.ts) + [setPrice.ts](src/dash/setPrice.ts) / [purchaseName.ts](src/dash/purchaseName.ts) / [transferName.ts](src/dash/transferName.ts) — the three writes.
  - [resolveRecipient.ts](src/dash/resolveRecipient.ts) / [classifyRecipientInput.ts](src/dash/classifyRecipientInput.ts) — transfer-recipient resolution; distinguishes identity IDs from DPNS names by character set.
  - [marketplaceErrors.ts](src/dash/marketplaceErrors.ts) — typed error set; classification only, no product copy.
  - [sdkModule.ts](src/dash/sdkModule.ts) / [sdkCore.ts](src/dash/sdkCore.ts) — two separate cached dynamic loaders. **Never merge them.**
- **[src/lib/](src/lib/)** — pure helpers, no SDK: [safeDoc.ts](src/lib/safeDoc.ts) (the lossless read layer — read this first), [format.ts](src/lib/format.ts) (all-bigint formatting), [filters.ts](src/lib/filters.ts), [chunk.ts](src/lib/chunk.ts), [logger.ts](src/lib/logger.ts).
- **[src/hooks/](src/hooks/)** — data hooks, each with a request-id stale guard.
- **[src/components/](src/components/)** — presentational, props-only. `DpnsName` and `Price` are the two universal primitives.
- **[src/session/](src/session/)** — SDK connection, sign-in, protocol status, balance. The context object lives in [context.ts](src/session/context.ts) so [SessionContext.tsx](src/session/SessionContext.tsx) exports only components (fast refresh).

## Contracts

This app registers **no** contract of its own — it reads and writes two system contracts. Both IDs are constants in [contracts.ts](src/dash/contracts.ts), which has no SDK imports and stays synchronous so it can run in `useState` initializers before the SDK loads.

| Constant | Value | Role |
| - | - | - |
| `DPNS_CONTRACT_ID` | `GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec` | The `domain` documents that are the tradeable asset. Same on both networks. |
| `HISTORY_CONTRACT_ID` | `6voHRaoiPcfmMhbqCA9dixH98xcgPQ9UEcuaXjpVu3LD` | Document History system contract that DPNS opted into at v13. Source of the `priceUpdate` / `purchase` / `transfer` streams. **Testnet only today** — created by the v13 upgrade, so it does not exist on mainnet (v12). Same deterministic ID once mainnet activates v13. |
| `MAX_IN_CLAUSE` | `100` | Hard cap on an `$id IN` batch — 101 is rejected. See [rule 8](#8-in-is-capped-at-exactly-100). |
| `SALES_MIN_PROTOCOL_VERSION` | `13` | The write gate. See [rule 9](#9-gate-on-the-active-protocol-version-and-know-which-field-that-is). |

There is no `DEFAULT_CONTRACT_ID` / contract-registration flow and no `localStorage` contract override, unlike the sibling apps — the contracts are fixed system contracts. The persisted `localStorage` state is the listings index snapshot (per network), not a contract ID.

## The listings index

The discovery algorithm in [listingsIndex.ts](src/dash/listingsIndex.ts) is what this app exists to demonstrate. Because `$price` is unindexed, there is no server-side listings query to call, so:

1. Page every `priceUpdate` record for the DPNS contract via the History contract's `byContract` index.
2. Keep every document that has **ever** had a positive price.
3. Batch-fetch those documents by `$id`, 100 at a time (the maximum).
4. Keep only the ones that still carry a positive `$price`. That set _is_ the current listings.

**History nominates candidates; the current document decides.** That one rule makes the index correct across delisting, purchase, transfer, and repricing without special-casing any of them — a sale and a transfer both clear the price without writing any price-update record at all. It is formalized as [rule 4](#4-history-nominates-candidates-the-current-document-decides), and the watermark discipline that lets it resume incrementally is [rule 5](#5-per-stream-watermarks--boundary-replay).

`coldSync` builds the index from nothing, `incrementalSync` tails the three streams on later visits, and `reconcile` folds new events into the persisted snapshot. [listingsStore.ts](src/dash/listingsStore.ts) writes listings and all watermarks in a single atomic `setItem`. See [Scaling ceiling](#scaling-ceiling) for what this costs as history grows.

## SDK Patterns

- **Connect**: `createClient(network)` from the shared core via [sdkCore.ts](src/dash/sdkCore.ts) — internally `EvoSDK.testnetTrusted()` / `mainnetTrusted()` + `sdk.connect()`. Network is user-selectable and persisted, defaulting to testnet.
- **Key derivation**: `IdentityKeyManager` from the shared core; `keyManager.getAuth()` returns `{ identity, identityKey, signer }` — the AUTHENTICATION key, which is what document state transitions require.
- **Read a domain** ([dpnsQueries.ts](src/dash/dpnsQueries.ts)): `sdk.documents.query` over `domain`, plus `sdk.documents.get` for a single name. Search uses the `parentNameAndLabel` index; the portfolio filters on `$ownerId`.
- **Batch-fetch by ID** ([dpnsQueries.ts](src/dash/dpnsQueries.ts)): `sdk.documents.query` with an `$id IN` clause, chunked at `MAX_IN_CLAUSE` and run **sequentially**.
- **Read history** ([historyQueries.ts](src/dash/historyQueries.ts)): `sdk.documents.query` over the History contract's `priceUpdate` / `purchase` / `transfer` types via the `byContract` index.
- **Aggregates** ([historyAggregates.ts](src/dash/historyAggregates.ts)): `sdk.documents.count` and `sdk.documents.sum` for sales stats. Both need a `$createdAt between` bound to match the index exactly — see [rule 6](#6-aggregates-two-rules-that-break-the-queries).
- **Protocol gate** ([protocolVersion.ts](src/dash/protocolVersion.ts)): `sdk.system.status()` → `version.protocol.drive.current`. Fail-closed.
- **List / reprice / delist** ([setPrice.ts](src/dash/setPrice.ts)): `sdk.documents.setPrice({ document, price: bigint, identityKey, signer })`. A price of `0n` delists.
- **Buy** ([purchaseName.ts](src/dash/purchaseName.ts)): `sdk.documents.purchase({ document, buyerId, price: bigint, identityKey, signer })`.
- **Transfer** ([transferName.ts](src/dash/transferName.ts)): `sdk.documents.transfer({ document, recipientId, identityKey, signer })`.
- **DPNS name lookup**: `sdk.dpns.username(identityId)` ([useDpnsNames.ts](src/hooks/useDpnsNames.ts), `SessionContext`) and `sdk.dpns.resolveName(fullName)` ([resolveRecipient.ts](src/dash/resolveRecipient.ts)) for transfer recipients.
- **Label normalization**: `sdk.dpns.convertToHomographSafe(label)` via `toNormalizedLabel` ([dpnsQueries.ts](src/dash/dpnsQueries.ts)) — required before any `normalizedLabel` query. See [rule 6c](#6c-query-normalizedlabel-with-the-homograph-fold-not-the-raw-label).
- **Balance**: `sdk.identities.balance(identityId)` → `bigint`, called from `SessionContext`.

All three writes flow through [withAuthedDocument.ts](src/dash/withAuthedDocument.ts), which fetches the document, bumps its revision, resolves the auth signer, and enforces the `salesEnabled` gate before any SDK call. See [The extractable seam](#the-extractable-seam).

## Correctness rules — read before touching data code

### 1. Never read a numeric field through `toJSON()`

`Document.toJSON()` cannot represent a u64 above `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 credits ≈ 90,071 DASH). It does not round — it **throws**, taking the whole document with it, so even `$id` becomes unreachable through that path:

```text
WasmDppError: Failed to convert JSON to JsValue:
  Error: 20000000000000000 can't be represented as a JavaScript number
```

Upstream: [dashpay/platform#3786](https://github.com/dashpay/platform/issues/3786), open against evo-sdk 4.1.0. The documented workaround is that per-field WASM getters bypass the broken serializer and return native types (`bigint` for u64). [src/lib/safeDoc.ts](src/lib/safeDoc.ts) is the single chokepoint that implements this — **every** document read goes through it.

Verified live against `CkAX4amndy33YxCyQ3op4QmWofsiW9TukoMh2nvHQk9B`, which holds real cards priced at 10,000,000,000,000,000 and 20,000,000,000,000,000 credits: `toJSON()` throws on both, `properties.$price` returns the exact bigint, and the `id` getter still works.

Note dashmint-lab solves the _write_ side of the same bug with an input cap (`MAX_PRICE_CREDITS = 1e15`). That is not sufficient here: dashnames **reads** names listed by anyone, so a third-party listing above the cap must still render.

Consequences applied everywhere: carry prices as `bigint`; convert to decimal **string** only at the localStorage boundary (`JSON.stringify` throws on bigint) and parse straight back; never `Number(price)` for compare or sort; format with integer math.

### 2. Identifier fields inside `properties` are raw `Uint8Array(32)`, not base58

Using them directly as `Set`/`Map` keys treats every occurrence as distinct. Observed live: **three** price events on **one** name looked like three candidates. `readId()` normalizes bytes / `Identifier` handles / strings to base58 so dedup works. `bytesToBase58` is verified against the SDK's own encoding in [test/safeDoc.test.ts](test/safeDoc.test.ts).

### 3. `$price` is conditional

Delisted → key **present**, value `0n`. Never-listed → key **absent**. Both mean "not for sale". Never write `json.$price > 0` or `json.$price ?? 0` — use `hasSalePrice()`.

### 4. History nominates candidates; the current document decides

A name keeps its candidacy forever once it has had any positive price event, and the live document is the only authority on whether it is still listed. Do **not** reduce history to "the latest event per document" with an `$id` tiebreak — `$id` order is stable but **not causal**, so a zero-price event sharing a millisecond could sort last and hide a currently-relisted name.

### 5. Per-stream watermarks + boundary replay

The app tails **three independent** streams. Purchase and transfer both clear `$price` **without** writing a zero-price `priceUpdate`, and a purchase does not also write a transfer — so `priceUpdate` alone cannot remove sold or transferred names promptly.

`$createdAt` is milliseconds, so records routinely share a timestamp and a record written later can sort _before_ the saved `$id`. `startAfter` alone would skip it permanently. The rule: re-query `$createdAt >= watermark.createdAt` **inclusively**, keep every row in the boundary bucket regardless of `$id` order, and deduplicate. Use `startAfter` only for forward pagination _within_ one run, never as a cross-run resume token.

Watermarks advance **only after** the affected documents are fetched, and persist **only** with the listings they summarize — one `setItem`, one snapshot. If the write fails the persisted copy is dropped so the next launch cold-syncs. Never retain watermarks without their listings.

### 6. Aggregates: two rules that break the queries

**The `where` clause must exactly match the index properties.** `byContract` is `[dataContractId, $createdAt]`, so filtering `dataContractId` alone is rejected ("prove count requires a `countable: true` index whose properties exactly match the where clause fields"). Every aggregate carries a `$createdAt between` bound; an all-time figure uses a wide range rather than omitting it.

**An aggregate over an empty set errors instead of returning zero.** With 0 `purchase` records, `count`/`sum` fail with a grovedb proof error (`missing lower layer` / `0 lower-layer entries`), not `0n`. Mapped to the empty state as a _rendering_ branch — there is no client-side arithmetic fallback. The match is deliberately narrow (proof shapes only) so a real query bug still surfaces. Probably a platform/grovedb bug worth reporting upstream: a proof over an empty set should be provably empty, not unprovable.

### 6b. The History contract may not exist on the network at all

Distinct from an empty result: on a pre-v13 network the contract itself is absent and **every** history query fails with `NotFound` / "Data contract not found". Mainnet is v12 today, so that is its normal state.

History reads therefore degrade to empty rather than throwing (`isMissingContractError` in [historyQueries.ts](src/dash/historyQueries.ts)), and `fetchSalesStats` sets `unavailable: true` so the UI can distinguish "not on this network" from "no sales yet" — the two must never render identically.

The rule this protects: **a failure to load history must never make a name that exists look like it doesn't.** [useNameDetail.ts](src/hooks/useNameDetail.ts) sets the record _before_ fetching the timeline for exactly this reason — the original bug was a name resolving fine on mainnet but the detail view rendering "That name could not be found", because the history throw skipped `setDetail` entirely.

### 6c. Query `normalizedLabel` with the homograph fold, not the raw label

DPNS folds visually-confusable characters before storing `normalizedLabel`: `l`/`i` → `1` and `o` → `0`. So `latte` is stored as `1atte`, `hello` as `he110`, `oreo` as `0re0`. Lowercasing alone is **not** normalization — querying `normalizedLabel == "latte"` matches nothing, which is why search appeared broken for such names while `phez` (nothing foldable) worked fine.

Use `toNormalizedLabel(sdk, input)` in [dpnsQueries.ts](src/dash/dpnsQueries.ts) for anything that queries `normalizedLabel`. It delegates to the SDK's `sdk.dpns.convertToHomographSafe` — **never reimplement the fold locally**, since a local copy would drift from consensus. It is async (WASM init), so call it inside the async path, not a `useState` initializer.

`normalizeLabelInput` only trims and strips `.dash`; it is the input to the fold, not a substitute for it. `sdk.dpns.resolveName` takes a **full** name and folds internally, so [resolveRecipient.ts](src/dash/resolveRecipient.ts) needs no extra handling.

Display always uses the record's real `label` (`latte`), never the folded form.

### 7. `orderBy` must be the serving index's trailing property

`byContract` → `$createdAt`; `parentNameAndLabel` → `normalizedLabel`. No `orderBy` on an `$id IN` query.

**`desc` is not honoured.** Verified: `asc` and `desc` return identical ordering, and `desc` with `limit: 1` returns the **oldest** record. There is no server-side "newest N" — `sortEventsDesc()` sorts client-side, and anything needing the true newest must page the whole stream rather than trusting a small `limit`.

### 8. `IN` is capped at exactly 100

101 IDs → "invalid IN clause error". Chunks run **sequentially**, not `Promise.all`: trusted nodes throttle and wide fan-out surfaces as opaque connection resets.

### 9. Gate on the ACTIVE protocol version, and know which field that is

`sdk.system.status()` reports two unrelated kinds of version, and it is easy to grab the wrong one:

```text
version.software.drive      "4.1.0"                    <- Drive the software (semver)
version.protocol.drive      {latest: 13, current: 13}  <- the PROTOCOL version  ← the gate
version.protocol.tenderdash {p2p: 10, block: 14}       <- Tenderdash's protocols
```

`version.protocol` is keyed by _which protocol_, so the platform protocol version sits under `drive` because Drive is the component that defines it. It is a protocol version (13), **not** a Drive release (4.1.0). The parsed field is named `activeProtocolVersion` precisely so this doesn't read as "Drive 13".

Read `current`, not `latest`. Verified 2026-08-05: testnet `{latest: 13, current: 13}`, mainnet `{latest: 13, current: 12}` — keying off `latest` would wrongly enable selling on mainnet. `sdk.version()` is a third, different number (12 / 11, the SDK's negotiated version) and is **not** the gate. Unknown version ⇒ writes disabled.

`sdk.system.status()` returns WASM handles whose fields are unreachable by plain property access (`status.chain` has only `__wbg_ptr`); [protocolVersion.ts](src/dash/protocolVersion.ts) falls back to `toJSON()` there. That is safe for status — block heights come back as decimal strings — unlike a document's `$price`.

### 10. Freshness means at confirm, not at open

The buy modal revalidates on open, expires its quote after ~30s, **and re-fetches again in the confirm handler** before signing. A user can leave a ready modal open indefinitely while the listing changes. Platform's server-side price check is the last safeguard, not the user-facing contract — the design promises the user is _told_ before signing, and only a confirm-time fetch delivers that.

## The extractable seam

[withAuthedDocument.ts](src/dash/withAuthedDocument.ts), [setPrice.ts](src/dash/setPrice.ts), [purchaseName.ts](src/dash/purchaseName.ts), [transferName.ts](src/dash/transferName.ts), and [marketplaceErrors.ts](src/dash/marketplaceErrors.ts) are written as if they already lived in a shared module. Rules, and the review check is literally "would this compile unchanged if I moved the file?":

- **No DPNS knowledge.** `documentTypeName` and `contractId` are parameters. No `"domain"` literal, no `.dash` logic, no import of `contracts.ts`.
- **Generic vocabulary** — `documentId`, never `nameId`.
- **Callers supply policy** — `salesEnabled` is passed in. Each write rejects **before any SDK call** when it is false; UI gating alone is not a gate.
- **Typed results and typed errors, never UI strings.** The view layer owns the wording.

Extraction to `example-apps/shared/marketplace/` is justified when a second consumer needs it — i.e. when DashMint is retargeted onto these helpers. [listingsIndex.ts](src/dash/listingsIndex.ts) is the _second_ candidate: the algorithm is generic but it is also the least proven code here.

## Design intent

[src/styles.css](src/styles.css)'s `:root` tokens are the design system: color, spacing, type scale, and the sync-chip states. The app is one committed dark theme — there is no light palette — and it is desktop-only at 1240px. Component JSDoc headers carry each view's layout constraints (grid columns, sidebar widths, modal sizing).

## Scope decisions

The original design called for several features the SDK cannot support, plus a few this app deliberately reshaped. These are decisions, not omissions — the rationale matters more than the original, so it is recorded here in full.

| Feature | What shipped | Why |
| - | - | - |
| Fee rows (Processing / Storage / Total required / Balance after) | **Dropped.** Affordability checked against the price alone. | There is no fee-estimation, dry-run, or simulation method in evo-sdk 4.1.0. The only fee-bearing types belong to `FinalizedEpochInfo` — epoch aggregates, not per-transition quotes. Any figure would be invented. A future quote API is an obvious addition here. |
| Transaction ID + "were credits spent" on failure | **Not shown.** The protocol error message _is_ shown. | The write methods resolve `void` and expose no state-transition hash. `transitionId?` is reserved in the result type and stays `undefined`. "Nothing was signed" is claimed only where provable: the confirm-time revalidation and the `salesEnabled` gate. |
| `MAINNET · BLOCK N` footer | Renders the **live** network. | Sales need v13; mainnet is v12. The app defaults to testnet with a persisted, user-selectable network. |
| "Est. 3–6 DASH · from comparable sales" | **Dropped.** | Comparable-sales valuation needs data the protocol doesn't provide. |
| Shelves (curated collections) | **Dropped.** | No protocol notion of a curated set — there is nothing on-chain to populate one from. |
| Popular chips (`pay.dash`, `bank.dash`) | Derived from the live index; row hidden when empty. | Those specific names were illustrative samples, not real listings. Deriving from the index keeps the row honest and lets it vanish when there is nothing to show. |
| "Register a name" | **Out of scope.** | Registration needs preorder/commit plus contested-name voting — a substantial feature, and already covered by the repo's `name-register.mjs`. Leaving it out keeps the v13 gate uniform across **every** write path. |
| Watch / watchlist, Top up credits | **Dropped.** | Neither has a destination in this app — the buttons would lead nowhere. |
| Nav: `Discover · My names · Sell · Activity` | `Discover · Browse · My names · Activity` — **Sell dropped, Browse added.** | Sell would have been My names filtered to listable rows — the same component sitting right beside itself with fewer rows — while the full results grid got no header entry at all, reachable only via Discover's "See all N →". Browse takes the slot instead. Listing is not lost: it starts from the per-row **List for sale** button in My names. A dedicated list-a-name picker would need a UI this app doesn't have. |
| Mobile / responsive layout | **Desktop-only at 1240px.** One Playwright project. | No mobile layout was ever designed, and inventing one produces layout that gets thrown away. |
| Deferring discovery to a server-side indexer | The client **does** scan history. | There is no indexer, and that scan is exactly the technique this app demonstrates. The UI accounts for it honestly — the sync chip and the "indexed locally" footnote — so no visual compromise. |

## Limitations

The authoritative, user-facing limitations list lives in [README.md](README.md#limitations) — keep the two in sync when scope changes. The contributor-facing reasons are in [Scope decisions](#scope-decisions) above; the one that shapes the architecture most is below.

## Scaling ceiling

Cold start has **two** monotonically growing phases, and neither shrinks:

1. **History replay** — `priceUpdate` is append-only and must be read in full. ~1000 sequential page queries at 100k lifetime events.
2. **Authoritative document fetch** — every _lifetime_ candidate is re-fetched, including names long since sold, transferred, or delisted. Worst case another ~1000 sequential `$id IN` queries at 100 IDs per batch, plus client memory for the candidate set.

Repricing makes event count grow faster than candidate count. A successfully persisted snapshot makes later loads incremental, so each browser profile normally pays this once — but cleared storage, a schema bump, a quota failure, or a new device forces it again. A server-side indexer or checkpointed snapshot is the required successor before the dataset approaches this scale.

## Verified on testnet (2026-08-05)

| Fact | Value |
| - | - |
| Active protocol | testnet **13** · mainnet **12** (`latest` 13 on both) |
| Document History contract | `6voHRaoiPcfmMhbqCA9dixH98xcgPQ9UEcuaXjpVu3LD` (testnet only — absent on mainnet until v13) |
| DPNS contract | `GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec` |
| `where` on `$price` over `domain` | **rejected** — "where clause on non indexed property error" |
| Max `IN` clause | exactly **100** (101 → "invalid IN clause error") |
| DPNS history contents | 3 `priceUpdate` (2.5 DASH → 250000000 → 0), 1 `transfer`, **0 `purchase`** |
| Delisted domain | `$price === 0n`, key present, rev `4n` |
| `orderBy` `desc` | **ignored** — `desc` + `limit: 1` returns the oldest record |
| Empty aggregate | grovedb proof error, **not** `0n` |
| `toJSON()` overflow | throws on real 1e16/2e16-credit prices; `properties` + `id` getter unaffected |

**Not yet exercised live:** the write paths (list, reprice, delist, purchase, transfer). They are covered by unit tests, but the Document History contract exposed **zero** `purchase` records as of this date, so the buy path has not run against this contract. Doing so needs two funded testnet identities and a pre-registered name — use a **20+ character** label, since labels matching `^[a-zA-Z01-]{3,19}$` trigger a masternode vote contest.

## Testing

Vitest ([test/](test/), flat directory, files named after the subject under test — **not** co-located next to source, **not** mirrored against `src/`). Default env is `node`; DOM tests opt in with a `// @vitest-environment jsdom` pragma at the top of the file. There is no global setup file, matching the sibling apps — which is why component tests need explicit `afterEach(cleanup)` (see [Gotchas](#gotchas)). Coverage: `npm run test:coverage` runs the suite under v8.

The suites, by what they protect:

- [safeDoc.test.ts](test/safeDoc.test.ts) — the lossless read layer, incl. `bytesToBase58` verified against the SDK's own encoding. Guards [rules 1–3](#1-never-read-a-numeric-field-through-tojson).
- [listingsIndex.test.ts](test/listingsIndex.test.ts) — the discovery algorithm: candidate nomination, current-document confirmation, and the boundary-replay/watermark discipline. Guards [rules 4–5](#4-history-nominates-candidates-the-current-document-decides).
- [listingsStore.test.ts](test/listingsStore.test.ts) — atomic snapshot round-trip, incl. the bigint↔string localStorage boundary and the drop-on-failed-write rule.
- [historyAggregates.test.ts](test/historyAggregates.test.ts) — the `$createdAt` bound and the empty-set proof-error branch. Guards [rule 6](#6-aggregates-two-rules-that-break-the-queries).
- [protocolVersion.test.ts](test/protocolVersion.test.ts) — `current` vs `latest`, the WASM-handle `toJSON()` fallback, and fail-closed on unknown. Guards [rule 9](#9-gate-on-the-active-protocol-version-and-know-which-field-that-is).
- [writeOps.test.ts](test/writeOps.test.ts) — the three writes: revision bump, auth-key choice, and that each rejects before any SDK call when `salesEnabled` is false.
- [BuyModal.test.tsx](test/BuyModal.test.tsx) — confirm-time revalidation and quote expiry. Guards [rule 10](#10-freshness-means-at-confirm-not-at-open).
- [NameCell.test.tsx](test/NameCell.test.tsx) — label resolution with the dimmed truncated-ID fallback. Guards the `documentId` gotcha.
- [filters.test.ts](test/filters.test.ts) / [format.test.ts](test/format.test.ts) — browse filtering/sorting and all-bigint formatting.

E2E ([test/e2e/smoke.spec.ts](test/e2e/smoke.spec.ts), Playwright, port 5185, real testnet, chromium only, serial). **Read-only — no chain writes, no credentials needed**, so it always runs. It asserts rendering and navigation, not live listing data: testnet may have zero listings at any moment, so a spec requiring a populated grid would be flaky by construction — the empty states are themselves asserted. **One Playwright project** (desktop only); there is no mobile layout to test. Write flows are covered by unit tests only — see [Verified on testnet](#verified-on-testnet-2026-08-05) for what has and hasn't run against the live contract.

## Performance — load-anchor rules

The `@dashevo/evo-sdk` browser bundle is ~10 MB and must stay off the boot critical path. **Never add a top-level value import from `@dashevo/evo-sdk`** to anything reachable from `App.tsx` (type-only is fine) — go through [sdkModule.ts](src/dash/sdkModule.ts). The shared core loads via [sdkCore.ts](src/dash/sdkCore.ts). Two distinct loaders; don't merge. The `modulePreload.resolveDependencies` filter in [vite.config.ts](vite.config.ts) strips the evo-sdk chunk so Vite doesn't inject a `<link rel="modulepreload">` that re-blocks first paint.

Regression check after `npm run build`:

```bash
grep 'from "[^"]*evo-sdk' dist/assets/index-*.js   # must return nothing
```

`contracts.ts` and `listingsStore.ts` must stay **synchronous** — they run in `useState` initializers before the SDK exists.

## Gotchas

- **History records identify a name only by `documentId`** — there is no label on a `priceUpdate` / `purchase` / `transfer` record. Rendering that ID raw is misleading: it is neither a name nor an identity, so under a column headed "Name" it reads as garbage. [useDocumentLabels.ts](src/hooks/useDocumentLabels.ts) batch-resolves IDs to labels (module-level cache, same `$id IN` path as the index) and [NameCell.tsx](src/components/NameCell.tsx) renders the result, falling back to a visibly-dimmed truncated ID until it arrives. Any new table over history events must use `NameCell`, not `shortId(event.documentId)`.
- **`shortId()` on `ownerId` / `sellerId` / `toIdentityId` is correct** — those genuinely are identities, and `XXXX…XXXX` truncation is the intended rendering for them. The bug above was only ever about _document_ IDs standing in for names.
- **Secrets** — the mnemonic is a `login()` parameter that flows into the keyManager closure and nowhere else. Never state, never a ref, never localStorage.
- **Transfer uses the AUTHENTICATION key**, not the TRANSFER-purpose key — Platform rejects TRANSFER-purpose keys for document state transitions. `getAuth()` already returns the right one.
- **All mutations bump the revision** — fetch, then `revision = BigInt(revision) + 1n`. Platform rejects mutations that don't strictly increase it.
- **Read-only mode sets `keyManager` to null** — check before any write.
- **`records.identity` is what DPNS indexes**, which finds names that _resolve_ to an identity. Ownership (`$ownerId`) is what authorizes a write, so the portfolio filters on it.
- **No `groupBy` on `price`** — grouped-count map keys are raw order-preserving index-key bytes with no decoder, and for 64-bit credits the encoding is _not_ dashrate's single sign-flipped byte.
- **Component tests need explicit `afterEach(cleanup)`** — there is no global setup file, matching the sibling apps. Without it, `render` accumulates DOM across tests and `getByRole` finds duplicates.
- **The new `react-hooks/set-state-in-effect` rule** rejects a bare `void load()` in an effect. Data hooks use dashrate's async-IIFE-plus-`cancelled`-flag shape; modal form resets derive during render instead.
- The ~10 MB WASM bundle is expected, not a build error.
