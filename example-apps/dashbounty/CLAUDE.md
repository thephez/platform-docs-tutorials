# CLAUDE.md

This file provides guidance to Claude Code when working in [example-apps/dashbounty/](.).

## Project Overview

Sift is a React + TypeScript + Vite app for a token-gated review queue on Dash Platform testnet. A submitter spends 1 Sift token to create a public submission, which raises the cost of low-effort or AI-generated spam without making the app primarily about payment.

The app demonstrates two Platform primitives that are still uncommon in the tutorials:

- `AuthorizedActionTakers.Group(...)` / `sdk.group.*`
- `sdk.tokens.freeze`, `sdk.tokens.unfreeze`, and `sdk.tokens.destroyFrozen`

Sift uses two fixed groups for clearer governance:

- Access panel: group position `0`, 2-of-3, can suspend and restore write access by freezing/unfreezing Sift tokens.
- Revocation panel: group position `1`, 3-of-3, can permanently revoke already-suspended Sift tokens with `destroyFrozen`.

Revoked tokens are burned, not paid to reviewers. That keeps enforcement separate from reviewer compensation.

## Commands

- `npm run dev` - start Vite dev server
- `npm run build` - typecheck (`tsc -b`) then bundle
- `npm run lint` - ESLint
- `npm run test` - Vitest suite in [test/](test/)
- `npm run test:coverage` - Vitest with v8 coverage
- `npm run test:e2e` - Playwright suite in [test/e2e/](test/e2e/) (auto-boots Vite on :5183)
- `npm run test:e2e:ui` - Playwright with the interactive UI runner
- `npm run bootstrap:identities` - one-time setup: registers 4 identities from `PLATFORM_MNEMONIC`
- `npm run format` / `format:check` - Prettier
- `npm run preview` - serve production build locally

## Architecture

- [src/dash/](src/dash/) - one file per Platform SDK operation.
  - `contract.ts` defines the `submission` document schema, Sift token configuration, and both fixed groups.
  - `siftToken.ts` contains token constants, payment info, ID calculation, and balance fetches.
  - `submitSubmission.ts` / `updateSubmission.ts` create and edit submissions.
  - `queries.ts` lists and normalizes submissions.
  - `freezeCredit.ts`, `unfreezeCredit.ts`, and `destroyFrozenCredit.ts` wrap group-authorized token actions. The filenames still say `Credit` because they are thin wrappers around token balance controls; UI language presents them as access suspension/restoration/revocation.
  - `groupActions.ts` lists pending actions and signer progress.
  - `panel.ts` resolves panel metadata for the access and revocation groups.
  - `frozenStatus.ts` checks whether an identity's Sift token balance is frozen.
- [src/session/](src/session/) - session state, read-only boot, identity login, and contract ID selection.
- [src/components/](src/components/) - submit form, queue views, panel workflow, account view, and navigation.
- [public/sift-lite.html](public/sift-lite.html) - single-file read-only companion for browsing submissions and panel state.
- [scripts/bootstrap-identities.mjs](scripts/bootstrap-identities.mjs) - registers identity index 0 for a submitter and indices 1-3 for panelists.

## Contract

The schema lives in [src/dash/contract.ts](src/dash/contract.ts) as `SUBMISSION_SCHEMAS`. One document type, `submission`:

- Required fields: `title`, `severity`, `component`, `description`
- Optional field: `pocHash`, base64 SHA-256 of a locally hashed supporting file
- `tokenCost.create`: 1 Sift token, `effect: 0` (`TransferTokenToContractOwner`)
- `documentsMutable: true`, `documentsKeepHistory: true`, `canBeDeleted: false`
- Indices: `byOwner`, `bySeverity`, `byComponent`

`DEFAULT_CONTRACT_ID` in [src/dash/contractStorage.ts](src/dash/contractStorage.ts) starts as `null` for this PoC. Set it after publishing a stable testnet contract.

## Groups

The contract creates two immutable groups at registration time:

- `ACCESS_GROUP_POSITION = 0`, `ACCESS_GROUP_REQUIRED_POWER = 2`
- `REVOCATION_GROUP_POSITION = 1`, `REVOCATION_GROUP_REQUIRED_POWER = 3`

Both groups currently use the same three panelist identities with power `1`. This is intentional PoC scope: different thresholds make suspension fast enough for spam control while making permanent revocation harder.

Token rules are explicit:

- `freezeRules` and `unfreezeRules` use `AuthorizedActionTakers.Group(0)`.
- `destroyFrozenFundsRules` uses `AuthorizedActionTakers.Group(1)`.
- `mainControlGroupCanBeModified` is locked to `NoOne`, because this version does not support roster rotation.

Group actions use `GroupStateTransitionInfoStatus.proposer(groupPosition)` for the first signer and `.otherSigner(groupPosition, actionId)` for later signatures.

## Identity Bootstrapping

`scripts/bootstrap-identities.mjs` registers four identities from one `PLATFORM_MNEMONIC`:

- identity index `0`: submitter / contract owner in demos
- identity indices `1`, `2`, `3`: panelists

The script writes panelist IDs to the local `.env` as `VITE_PANELIST_1_ID`, `VITE_PANELIST_2_ID`, and `VITE_PANELIST_3_ID`.

## Testing

Vitest mocks `@dashevo/evo-sdk` and checks:

- contract schema and group configuration
- Sift token payment info
- submit/update/query helpers
- group action proposal vs co-sign status
- panel metadata for both fixed groups

Playwright specs cover browsing, submitting, and the panel suspend/restore flow. Permanent revocation is intentionally not automated because it is irreversible.

## Gotchas

- Existing Platform groups are immutable after contract registration. This app intentionally avoids roster rotation for the PoC.
- A 2-of-3 action needs a genuinely different signing identity for the second signature.
- Co-signers manually confirm the target identity ID. The SDK's pending action payload shape is not typed enough to trust for automatic extraction in this UI.
- `TokenFreezeResult` / `TokenUnfreezeResult` / `TokenDestroyFrozenResult` signal pending vs executed via field presence: `groupPower` while pending, `document` once executed.
- The Evo SDK WASM bundle is large; that is expected.
