# dashnames — a DPNS name marketplace

`dashnames` is a complete, browser-based example of discovering and trading DPNS usernames such as `alice.dash` on Dash Platform. Visitors can search names, browse verified listings, inspect ownership and asking-price history, and review protocol-recorded market activity without signing in. A funded identity can list, reprice, delist, purchase, or permanently transfer a name directly from the browser.

The app is both a functional testnet marketplace and a focused Platform tutorial. It shows the parts a production UI cannot safely skip: proof-backed reads, lossless `u64` handling, revision-bound writes, active-protocol gating, identity signing, stale-listing detection immediately before purchase, and recovery of current marketplace state from append-only history.

## What this example demonstrates

The central teaching problem is marketplace discovery. This app builds a local index from the Document History system contract that DPNS opted into at v13:

1. Page every `priceUpdate` record for the DPNS contract (via the `byContract` index).
2. Keep every document that has **ever** had a positive price.
3. Batch-fetch those documents by `$id`, 100 at a time — the maximum.
4. Keep only the ones that still carry a positive `$price`. That set _is_ the current listings.

**History nominates candidates; the current document decides.** That one rule makes the index correct across delisting, purchase, transfer, and repricing without special-casing any of them — a sale and a transfer both clear the price without writing any price-update record at all.

The resulting listing snapshot and its three independent history watermarks are persisted atomically per network. Later visits tail `priceUpdate`, `purchase`, and `transfer` incrementally, while every purchase still re-fetches the current domain immediately before signing. The local index is a discovery aid; current Platform state is always authoritative.

## Quick start

```bash
nvm use          # Node 22.22.x
npm ci
npm run dev
```

Browsing, search, and history need no sign-in. To list, buy, or transfer, use
the identity chip in the top-right corner and sign in with either a recovery
phrase or a HIGH/CRITICAL authentication WIF. Clicking Buy while signed out
opens the same login flow and resumes the purchase after authentication.

Requires a funded testnet identity that already owns a name — this app trades existing names and does not register them. Create one with the repo's [`1-Identities-and-Names/name-register.mjs`](../../1-Identities-and-Names/name-register.mjs) first, then list it here.

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

The app defaults to testnet and shows an explanatory banner on any network below v13. The gate reads the network's **active platform protocol version** — `version.protocol.drive.current` from `sdk.system.status()`, which is a protocol version — and fails closed when it can't be determined.

The network selector is always available in the header, including while signed
out. Switching networks immediately signs out and clears the in-memory key
manager, identity, and balance before reconnecting; credentials derived or
resolved for one network are never carried into another network session.
DashNames deliberately does not accept mnemonics or private keys on mainnet;
mainnet remains read-only until the required protocol support and production
safety review are in place.

## Contracts

This app registers no contract of its own — it reads and writes two system contracts, both fixed constants in [`src/dash/contracts.ts`](./src/dash/contracts.ts):

| Contract | ID | Role |
| - | - | - |
| DPNS | `GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec` | The `domain` documents that are the tradeable asset |
| Document History | `6voHRaoiPcfmMhbqCA9dixH98xcgPQ9UEcuaXjpVu3LD` | The `priceUpdate` / `purchase` / `transfer` streams the listings index is built from |

DPNS exists on both networks. Document History is created by the v13 upgrade, so it is **testnet-only today** — the ID is deterministic and becomes valid on mainnet once v13 activates there.

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
npm run test      # Vitest: index, read layer, writes, and component regressions
npm run test:e2e  # Playwright: read-only smoke suite against real testnet
```

The Playwright suite performs no chain writes and needs no credentials, so it always runs. The write paths (list, reprice, delist, purchase, transfer) are covered by unit tests only — see [CLAUDE.md](CLAUDE.md) for what has and hasn't been exercised live.

Pull requests and pushes affecting this app or the shared SDK core run the dedicated [`DashNames CI`](../../.github/workflows/dashnames-ci.yml) workflow, which installs from the lockfile, runs Vitest, typechecks, and builds the production bundle.

## Limitations

- **Mainnet is read-only, and has no history.** Mainnet runs protocol v12, so every write is gated off. The Document History contract is created by the v13 upgrade and does not exist there yet, so listings, activity, and sales stats are unavailable too — name search, lookup, and portfolio still work. All of it lights up on its own once mainnet activates v13; no code change needed.
- **No fee estimates.** evo-sdk 4.1.0 exposes no fee-estimation or dry-run method, so any figure would be invented. Affordability is checked against the asking price; Platform rejects a genuinely insufficient balance.
- **No transaction IDs.** The write methods resolve `void` and expose no state-transition hash. Failures show the real protocol error instead of a fabricated ID or spend claim.
- **No registration.** That needs the preorder/commit flow plus contested-name voting — a substantial feature, not a button.
- **Secrets are never persisted.** Recovery phrases and WIFs remain in
  component/key-manager memory only and are cleared when login closes,
  succeeds, is cancelled, or the network changes.
- **Desktop-only.** No mobile layout was designed, and guessing at one produces work that gets thrown away.
- **Client-side scanning doesn't scale forever.** Cold start replays all price history _and_ re-fetches every name that was ever listed. A browser pays that once per profile, but a production marketplace would use a server-side indexer.

See [CLAUDE.md](CLAUDE.md) for the full correctness rules, including why no numeric field is ever read through `toJSON()` ([dashpay/platform#3786](https://github.com/dashpay/platform/issues/3786)), and for the scope decisions behind the feature set above.

## Tech stack

- React 19
- TypeScript
- Vite 8 / Vitest 4
- Playwright
- `@dashevo/evo-sdk` 4.1.0
