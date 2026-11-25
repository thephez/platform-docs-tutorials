# Dashnote — Dash Platform Notes

`Dashnote` is a React + TypeScript + Vite example app for personal notes on Dash Platform testnet.

The app stays close to the tutorial `note` contract shape, but extends it with an optional `title`, a required `message`, and required Platform timestamps. Notes are editable, deletable, and shown in a calm two-pane notebook UI.

## Prerequisites

- Node 22.22+
- A funded Dash Platform testnet identity for write operations. Sign in with the DashPay mobile wallet (scan a QR code or tap a link, approve on the phone), or paste either a BIP-39 mnemonic (with an optional identity index for DIP-13 derivation) or a WIF private key for an existing HIGH/CRITICAL authentication key on that identity.
- Read-only mode works without any identity — visitors can read notes for any identity ID against the bundled contract. A previously-logged-in identity can also be re-browsed without re-auth via the remembered-identity flow.

## Quick start

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build         # tsc -b && vite build
npm run test          # Vitest suite
npm run test:coverage # Vitest with v8 coverage report
npm run test:e2e      # Playwright e2e suite (auto-boots Vite on :5181)
npm run test:e2e:ui   # Playwright with the interactive UI runner
npm run lint          # ESLint
npm run format        # Prettier (write)
npm run format:check  # Prettier (check only)
npm run preview       # Serve the production build
```

## Current app behavior

- The app auto-connects in read-only mode on load against the bundled default contract.
- Creating, editing, and deleting notes requires login with a testnet identity. The login modal leads with **Sign in with DashPay** (see below) and keeps the paste form under it: a BIP-39 mnemonic or a WIF private key for a HIGH/CRITICAL authentication key on the identity. The input field auto-detects which shape was pasted and previews the resolved identity + key fitness before you submit.
- The shell is a tabbed `AppShell` with three top-level views: **Notes** (two-pane list + editor), **How it works** (an in-app reading guide), and **Settings** (identity, contract, and local-data controls). Deletes go through a confirmation modal.
- After login, the app resolves the identity's DPNS username (when one is registered) and persists `(identityId, dpnsName)` so the remembered-identity browse path can show a friendly name. DPNS bindings are permanent, so the cached pair is never revalidated.
- `title` is optional; `message` is required.
- If `title` is blank, the UI uses the first non-empty line of `message`.
- If both are blank, the note renders as `Untitled`.
- Field length is enforced in **bytes**, not characters; the editor's progress bar reflects the UTF-8 budget.

## Sign in with DashPay

Dashnote implements the app side of [App Connect](https://github.com/dashpay/dips/pull/181), the wallet sign-in protocol the DashPay mobile wallet ships on testnet (Android 11.9.2+, iOS 9.1.4+).

1. **Continue with DashPay** shows a `dash-key:` v2 request as a QR code and, on a phone, an **Open in DashPay** link. The request asks for one HIGH authentication key bound to the note contract, proposing a 0.1 DASH allowance and a 90-day expiry; the note contract is also the app id the wallet names on its approval sheet.
2. The wallet registers that key on the identity in a master-signed update and publishes the private key, encrypted to the app's one-time key, as a `loginKeyResponse` document in the App Connect system contract.
3. The tab polls that contract (every 2 s for a minute, then every 4 s, and at once when it regains focus), decrypts each answer, and checks the key on chain with proved reads: it must be live, HIGH, bound to exactly this contract, carry a budget and an expiry, and not be about to expire.
4. Anyone who saw the code can answer with their own identity, so the modal asks **Is this you?** with the DPNS name and full identity id before signing in. A renewal names the signed-in identity in the request and skips that step.
5. The key then enters the same one-key session a pasted WIF does ([`loginWithPrivateKey`](./src/dash/loginWithPrivateKey.ts) + [`keyManagerFromKey`](./src/session/keyManagerFromKey.ts)). Settings → **Wallet connection** shows the allowance left and the expiry, with **Renew in DashPay**. A write refused for the key's limits prompts a renewal; a revoked key signs the session out.
6. **Stay signed in on this device** (on by default) keeps the key across reloads: it is wrapped with AES-GCM under a non-extractable device key and stored in IndexedDB ([`src/lib/walletSessionStore.ts`](./src/lib/walletSessionStore.ts)). On the next load the app re-reads the key on chain, signs in again without the phone, or asks for a renewal when the key can no longer write. Staying signed in also remembers the identity; a kept key is restored only for the remembered identity on the current contract; and logging out, forgetting this device, pasting a mnemonic or WIF, switching contracts, or a revoked key all forget it. That protects the key at rest, not from script on the page, which is why the key's bounds and limits matter.

The wallet never sees the note contract's registration key, and the browser never sees the wallet's phrase: the session key can only sign note writes, up to its allowance, until it expires. Registering a fresh contract still needs the mnemonic or a CRITICAL key, so the paste form stays. The protocol code is vendored from [platform-auth](https://github.com/PastaPastaPasta/platform-auth) under [`src/vendor/platform-auth/`](./src/vendor/platform-auth/) (pinned in `VENDORED.json`, with its own tests and vectors); [`src/dash/appConnect.ts`](./src/dash/appConnect.ts) is the Evo SDK side.

## Contract and Settings flow

- The app ships with a bundled deployed note contract ID (`8d6heK6CoskLBi6Rs7cChRG9RuckcZqZst28BdviBe8y`) so read-only browse and verification flows work immediately on a fresh machine.
- The login modal becomes a Settings modal after authentication.
- Settings can:
  - paste and reuse an existing note contract ID
  - register a fresh Dashnote note contract on testnet
  - switch the app to that newly registered contract immediately
- Overrides persist under `localStorage['dashnote.contractId']`. Clearing storage falls back to the bundled default.

## Contract schema notes

- The schema in [`src/dash/contract.ts`](./src/dash/contract.ts) defines a single document type, `note`, with `title` (optional, max 120 chars), `message` (required, max 10000 chars), and required Platform-managed `$createdAt` / `$updatedAt`.
- Indices: `byOwnerUpdated` (`$ownerId`, `$updatedAt`) and `byOwnerCreated` (`$ownerId`, `$createdAt`) — both are how the recent-notes list paginates and sorts.
- `documentsMutable: true` and `canBeDeleted: true` — notes are editable and deletable.
- `keepsHistory` is forced to `false`. `keepsHistory: true` triggers [dashpay/platform#3165](https://github.com/dashpay/platform/issues/3165), where `sdk.contracts.fetch()` returns undefined and breaks `sdk.documents.query` with "Data contract not found". This is why v1 only shows revision metadata, not previous versions of notes.

## Platform operations at a glance

Every SDK call lives in its own file under [`src/dash/`](./src/dash/). Open the file to see the full implementation with a JSDoc header naming the SDK method it wraps.

| Operation              | File                                                                   | SDK method                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Connect to testnet     | [`src/dash/client.ts`](./src/dash/client.ts)                           | `EvoSDK.testnetTrusted({ settings })` + `sdk.connect()`                                                      |
| Derive identity keys   | [`src/dash/keyManager.ts`](./src/dash/keyManager.ts)                   | wallet/key derivation helpers (mnemonic path)                                                                |
| Login by private key   | [`src/dash/loginWithPrivateKey.ts`](./src/dash/loginWithPrivateKey.ts) | `PrivateKey.fromWIF` + `sdk.identities.fetch` / `byPublicKeyHash` / `byNonUniquePublicKeyHash`               |
| Sign in with DashPay   | [`src/dash/appConnect.ts`](./src/dash/appConnect.ts)                   | `sdk.documents.query` on the App Connect contract + `sdk.identities.fetchWithProof` / `keysRemainingBudgets` |
| Resolve DPNS name      | [`src/dash/resolveDpnsName.ts`](./src/dash/resolveDpnsName.ts)         | `sdk.dpns.username`                                                                                          |
| Register note contract | [`src/dash/contract.ts`](./src/dash/contract.ts)                       | `sdk.contracts.publish`                                                                                      |
| Create a note          | [`src/dash/createNote.ts`](./src/dash/createNote.ts)                   | `sdk.documents.create`                                                                                       |
| Update a note          | [`src/dash/updateNote.ts`](./src/dash/updateNote.ts)                   | `sdk.documents.get` + `sdk.documents.replace`                                                                |
| Delete a note          | [`src/dash/deleteNote.ts`](./src/dash/deleteNote.ts)                   | `sdk.documents.delete`                                                                                       |
| List my notes          | [`src/dash/queries.ts`](./src/dash/queries.ts)                         | `sdk.documents.query`                                                                                        |
| Get one note           | [`src/dash/queries.ts`](./src/dash/queries.ts)                         | `sdk.documents.get`                                                                                          |

Update flow always fetches the document first to read its current revision, then submits a replace with `revision = BigInt(existing.revision ?? 0) + 1n`. Replays without bumping the revision are rejected by the state transition.

Supporting files:

- **[`src/dash/types.ts`](./src/dash/types.ts)** — shared SDK types (`DashSdk`, `DashKeyManager`, query result shapes) wired through every dash helper.
- **[`src/dash/sdkModule.ts`](./src/dash/sdkModule.ts)** — cached `import("@dashevo/evo-sdk")` used by the document/contract helpers so the SDK value imports stay out of the entry chunk.
- **[`src/lib/logger.ts`](./src/lib/logger.ts)** — `Logger` function type and `errorMessage(err)` helper. Plumbed through every dash call so progress messages stream to the activity log and `level: "success" | "error"` raise sonner toasts.
- **[`src/lib/notesCache.ts`](./src/lib/notesCache.ts)** — localStorage-backed note list keyed by `identityId + contractId + network`. Powers optimistic paint on reload before background revalidation completes.
- **[`src/lib/rememberedIdentity.ts`](./src/lib/rememberedIdentity.ts)** — last-logged-in identity ID plus its DPNS name (when one was resolved) for read-only browse. Never stores the mnemonic or WIF.
- **[`src/lib/detectSecretShape.ts`](./src/lib/detectSecretShape.ts)** — cheap "mnemonic vs WIF" classifier used by `SessionContext.login` and the login modal's eager WIF preview.
- **[`src/lib/connectionId.ts`](./src/lib/connectionId.ts)** — a random 16-byte id for this browser, sent with every App Connect request so the wallet can retire the key of its previous grant to this device. It survives logout on purpose.
- **[`src/lib/walletSessionStore.ts`](./src/lib/walletSessionStore.ts)** — the kept wallet session: one IndexedDB record holding the grant's metadata and the key encrypted under a non-extractable device key, with the identity, key id and contract bound in as additional data. No SDK imports.

WIF login treats the private key as a credential, not an identity identifier. The resolver accepts ECDSA key data encoded as either a full public key or ECDSA HASH160 value (hex or base64), while rejecting other HASH160 key types. If one key is associated with multiple identities, Dashnote does not list or guess among them: the login modal requires the full intended identity ID, fetches that identity directly, and verifies that the WIF is an enabled HIGH/CRITICAL authentication key for it. The identity ID and optional DPNS label are persisted only when **Remember this identity** is checked; private keys are never persisted.

## Reading the codebase

Recommended order for understanding how the app works:

1. **[`src/dash/`](./src/dash/)** — start here. One file per Platform operation, each with a JSDoc block naming the SDK method. Read [`createNote.ts`](./src/dash/createNote.ts) first (simplest write flow), then [`updateNote.ts`](./src/dash/updateNote.ts) (the fetch → bump revision → replace pattern). [`loginWithPrivateKey.ts`](./src/dash/loginWithPrivateKey.ts) and [`resolveDpnsName.ts`](./src/dash/resolveDpnsName.ts) round out the SDK surface (WIF auth + DPNS lookup).

2. **[`src/dash/contract.ts`](./src/dash/contract.ts)** — the `note` schema, indices, and the `registerContract` / `ensureContract` helpers used by Settings.

3. **[`src/session/SessionContext.tsx`](./src/session/SessionContext.tsx)** — manages the SDK connection, identity, contract ID, DPNS name, remembered identity, wallet grant, and activity log. `login()` dispatches to either `IdentityKeyManager` (mnemonic) or [`keyManagerFromKey`](./src/session/keyManagerFromKey.ts) (WIF) via [`detectSecretShape`](./src/lib/detectSecretShape.ts); `loginWithWallet()` enters the WIF path with a key the DashPay wallet issued (see [`src/dash/appConnect.ts`](./src/dash/appConnect.ts) and [`WalletSignIn.tsx`](./src/components/WalletSignIn.tsx)). The mnemonic and WIF never enter React state; they live only inside the `keyManager` closure and are garbage-collected on logout. The consumer hook lives in [`useSession.ts`](./src/session/useSession.ts).

4. **[`src/components/`](./src/components/)** — standard React UI. [`AppShell.tsx`](./src/components/AppShell.tsx) + [`Tabs.tsx`](./src/components/Tabs.tsx) provide the three-tab chrome. [`NotesWorkspace.tsx`](./src/components/NotesWorkspace.tsx) is the two-pane list + editor with optimistic cache and background revalidation. [`NoteEditor.tsx`](./src/components/NoteEditor.tsx) is the fused title/body editor with a UTF-8 byte-budget progress bar. [`DeleteNoteModal.tsx`](./src/components/DeleteNoteModal.tsx) gates destructive deletes. [`LoginModal.tsx`](./src/components/LoginModal.tsx) leads with the DashPay card and handles mnemonic-or-WIF paste with a preview of the resolved identity; [`WalletSignIn.tsx`](./src/components/WalletSignIn.tsx) is the QR, confirm, and renew flow; [`SettingsPanel.tsx`](./src/components/SettingsPanel.tsx) handles paste-or-register-contract plus the identity card and local-data controls. [`HowItWorks.tsx`](./src/components/HowItWorks.tsx) is the in-app reading guide.

5. **[`src/hooks/`](./src/hooks/)** — [`useTheme`](./src/hooks/useTheme.ts) for dark mode, [`useMediaQuery`](./src/hooks/useMediaQuery.ts) for the mobile-vs-desktop layout switch via `window.matchMedia`, [`useContractRegistration`](./src/hooks/useContractRegistration.ts) for the Settings paste-or-register flow, [`useWifPreview`](./src/hooks/useWifPreview.ts) for the login modal's eager WIF identity preview.

6. **[`src/lib/`](./src/lib/)** — pure utilities, no SDK references: [`fieldLimits.ts`](./src/lib/fieldLimits.ts) (UTF-8 byte counters), [`format.ts`](./src/lib/format.ts), [`detectSecretShape.ts`](./src/lib/detectSecretShape.ts), plus `logger.ts` / `notesCache.ts` / `rememberedIdentity.ts` described above.

For deeper architecture and gotchas, see [`CLAUDE.md`](./CLAUDE.md).

## Tests

[`test/`](./test/) uses Vitest + Testing Library, flat-not-mirrored, named after the subject under test. The default Vitest environment is Node; component tests opt into jsdom per-file with `// @vitest-environment jsdom`. Run with `npm run test` (or `npm run test:coverage` for the v8 coverage report).

The Vitest suite covers:

- contract schema and registration config
- note query normalization and sorting
- create / update / delete mutation helpers
- WIF login (`loginWithPrivateKey`), secret-shape detection, and WIF preview hook
- wallet sign-in: the App Connect ports, request, poll loop and grant-to-session step (`appConnect`), the sign-in panel, and the session's grant state and write-error handling, plus the vendored protocol module's own tests and vectors
- the kept wallet session: the IndexedDB store (against a fake IndexedDB and Node's Web Crypto), the restore on load, and every exit path that forgets the key
- DPNS name resolution
- note-title fallback formatting
- notes cache load/save/clear and revision-equality
- remembered identity persistence
- notebook UI flows for auth gating, create, update, and delete

End-to-end specs live in [`test/e2e/`](./test/e2e/) and run against real testnet via Playwright ([`playwright.config.ts`](./playwright.config.ts)). The config auto-boots Vite on port 5181 and runs every spec against both `chromium-desktop` (Desktop Chrome) and `chromium-mobile` (Pixel 7) so the responsive layout is always exercised. Auth-gated specs skip cleanly when `PLATFORM_MNEMONIC` is unset. Run with `npm run test:e2e` or `npm run test:e2e:ui`.

[`wallet.spec.ts`](./test/e2e/wallet.spec.ts) drives the DashPay sign-in with a scripted wallet ([`walletResponder.ts`](./test/e2e/walletResponder.ts)) that answers the app's request from the `PLATFORM_MNEMONIC` identity exactly as the mobile wallet does: it registers a bounded, budgeted key in a master-signed identity update, publishes the encrypted answer, and disables the key again when the spec ends. It also covers a reload that restores the kept session without a new approval, an unchecked box keeping nothing, and "Forget this device" dropping the kept key. It writes to testnet and spends credits, like the note round-trip specs.

## Tech stack

- React 19
- TypeScript
- Vite 8
- Tailwind CSS v4
- Vitest 4 + Testing Library
- `@dashevo/evo-sdk`
- sonner (toasts)
