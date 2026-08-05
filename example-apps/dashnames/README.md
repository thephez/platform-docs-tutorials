# dashnames — a DPNS name marketplace

Buy and sell DPNS usernames (`alice.dash`) on Dash Platform testnet.

Dash Platform 4.1 / protocol **v13** unblocked `transfer`, `priceUpdate`, and `purchase` on DPNS `domain` documents. The DPNS contract always declared `transferable: 1` and `tradeMode: 1`, but a hardcoded reject trigger blocked those transitions until v13. Names can now be listed and sold on-chain.

## What this example demonstrates

`$price` is **not** an indexed property on `domain`, so Platform cannot answer "which names are for sale" — a `where` clause on it is rejected outright. There is no server-side listings query to call.

So this app builds the index itself, from the Document History system contract that DPNS opted into at v13:

1. Page every `priceUpdate` record for the DPNS contract (via the `byContract` index).
2. Keep every document that has **ever** had a positive price.
3. Batch-fetch those documents by `$id`, 100 at a time — the maximum.
4. Keep only the ones that still carry a positive `$price`. That set _is_ the current listings.

**History nominates candidates; the current document decides.** That one rule makes the index correct across delisting, purchase, transfer, and repricing without special-casing any of them — a sale and a transfer both clear the price without writing any price-update record at all.

The index is persisted per network and tailed incrementally on later visits.

## Quick start

```bash
nvm use          # Node 22.22.x
npm install
npm run dev
```

Browsing, search, and history need no sign-in. To list, buy, or transfer, open **Settings** (the identity chip, top right) and sign in with a testnet recovery phrase.

Requires a funded testnet identity that already owns a name — this app trades existing names and does not register them. Create one with the repo's [`1-Identities-and-Names/name-register.mjs`](../../1-Identities-and-Names/name-register.mjs) first, then list it here.

> Use a **20+ character** label. Labels matching `^[a-zA-Z01-]{3,19}$` trigger a masternode vote contest and won't be yours for weeks.

Other scripts:

```bash
npm run build          # tsc -b && vite build
npm run test           # Vitest unit + component suite
npm run test:coverage  # Vitest under v8 coverage
npm run test:e2e       # Playwright, read-only (boots Vite on :5185)
npm run test:e2e:ui    # Playwright interactive runner
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only)
npm run preview        # serve production build locally
```

## Network support

| Network | Protocol | Trading |
| - | - | - |
| testnet | v13 | ✅ works |
| mainnet | v12 | ❌ writes disabled — browsing and history still work |

The app defaults to testnet and shows an explanatory banner on any network below v13. The gate reads the network's **active platform protocol version** — `version.protocol.drive.current` from `sdk.system.status()`, which is a protocol version (13), not a Drive software release (4.1.0) — and fails closed when it can't be determined.

## Contracts

This app registers no contract of its own — it reads and writes two system contracts, both fixed constants in [`src/dash/contracts.ts`](./src/dash/contracts.ts) and identical on testnet and mainnet:

| Contract | ID | Role |
| - | - | - |
| DPNS | `GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec` | The `domain` documents that are the tradeable asset |
| Document History | `6voHRaoiPcfmMhbqCA9dixH98xcgPQ9UEcuaXjpVu3LD` | The `priceUpdate` / `purchase` / `transfer` streams the listings index is built from |

There is no contract-registration flow and no contract-ID setting — unlike the sibling example apps, which each register their own contract.

## Platform operations at a glance

Every SDK call lives under [`src/dash/`](./src/dash/), one file per concern, each with a JSDoc header naming the method it wraps.

| Operation | File | SDK method(s) |
| - | - | - |
| Connect | [`sdkCore.ts`](./src/dash/sdkCore.ts) | `EvoSDK.testnetTrusted()` / `mainnetTrusted()` + `connect()` |
| Read names / search | [`dpnsQueries.ts`](./src/dash/dpnsQueries.ts) | `sdk.documents.query`, `sdk.documents.get` |
| Read history streams | [`historyQueries.ts`](./src/dash/historyQueries.ts) | `sdk.documents.query` |
| Sales stats | [`historyAggregates.ts`](./src/dash/historyAggregates.ts) | `sdk.documents.count`, `sdk.documents.sum` |
| Build the listings index | [`listingsIndex.ts`](./src/dash/listingsIndex.ts) | the two above, composed |
| Protocol gate | [`protocolVersion.ts`](./src/dash/protocolVersion.ts) | `sdk.system.status` |
| List / reprice / delist | [`setPrice.ts`](./src/dash/setPrice.ts) | `sdk.documents.setPrice` |
| Buy | [`purchaseName.ts`](./src/dash/purchaseName.ts) | `sdk.documents.purchase` |
| Transfer | [`transferName.ts`](./src/dash/transferName.ts) | `sdk.documents.transfer` |
| Resolve a recipient | [`resolveRecipient.ts`](./src/dash/resolveRecipient.ts) | `sdk.dpns.resolveName` |

`createClient` and `IdentityKeyManager` come from the repo-root `setupDashClient-core.mjs` — the same browser-safe core the Node tutorials use — loaded lazily so the ~10 MB `@dashevo/evo-sdk` bundle stays off the boot critical path.

## Reading this codebase

1. **[`src/lib/safeDoc.ts`](./src/lib/safeDoc.ts)** — start here. Every document read goes through this one chokepoint, because `toJSON()` throws on large `u64` prices.
2. **[`src/dash/listingsIndex.ts`](./src/dash/listingsIndex.ts)** — the discovery algorithm described above: cold sync, incremental tail, and reconcile.
3. **[`src/dash/`](./src/dash/)** — the rest of the Platform calls, one file per concern.
4. **[`src/session/`](./src/session/)** — SDK connection, sign-in, protocol status, balance.
5. **[`src/hooks/`](./src/hooks/)** then **[`src/components/`](./src/components/)** — data hooks, then the props-only views.

## Tests

```bash
npm run test      # Vitest: 10 suites over the index, read layer, writes, and components
npm run test:e2e  # Playwright: read-only smoke suite against real testnet
```

The Playwright suite performs no chain writes and needs no credentials, so it always runs. The write paths (list, reprice, delist, purchase, transfer) are covered by unit tests only — see [CLAUDE.md](CLAUDE.md) for what has and hasn't been exercised live.

## Limitations

- **No fee estimates.** evo-sdk 4.1.0 exposes no fee-estimation or dry-run method, so any figure would be invented. Affordability is checked against the asking price; Platform rejects a genuinely insufficient balance.
- **No transaction IDs.** The write methods resolve `void` and expose no state-transition hash. Failures show the real protocol error instead of a fabricated ID or spend claim.
- **No registration.** That needs the preorder/commit flow plus contested-name voting — a substantial feature, not a button.
- **Desktop-only.** No mobile layout was designed, and guessing at one produces work that gets thrown away.
- **Client-side scanning doesn't scale forever.** Cold start replays all price history _and_ re-fetches every name that was ever listed. A browser pays that once per profile, but a production marketplace would use a server-side indexer.

See [CLAUDE.md](CLAUDE.md) for the full correctness rules, including why no numeric field is ever read through `toJSON()` ([dashpay/platform#3786](https://github.com/dashpay/platform/issues/3786)), and for the scope decisions behind the feature set above.

## Tech stack

- React 19
- TypeScript
- Vite 8 / Vitest 4
- Playwright
- `@dashevo/evo-sdk` 4.1.0
