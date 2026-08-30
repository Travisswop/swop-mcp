# Phase 3 — Delegated Transactions for AI Assistants

Status: approved to build (Travis, 2026-08-30). First slice: delegation grant +
`swop_send` with caps. Builds directly on Phase 2 OAuth (DESIGN-phase2-oauth.md).

## Principle

An AI assistant may move a user's money only inside a **delegation** the user
granted in the Swop app: explicit action types, hard USD caps, revocable, every
action tagged and notified. Anything outside the delegation degrades to a
confirm-in-app deep link — never a hard failure, never a silent execution.

## New OAuth scopes

- `wallet.send` — transfer tokens to a resolved recipient
- `wallet.trade` — swaps (later slice)
- `predictions.trade` — bets/sells (later slice)
- `payments.x402` — pay external x402 links from the Swop wallet (later slice)

Scopes gate the *API*; the delegation gates the *money*. Both must pass.

## TransactionDelegation (new model)

One active doc per user:

```
userId, status: active|revoked
signing: { mode: 'privy-session-signer' | 'confirm-only', walletId, chain }
actions: ['send', ...]                  // subset the user enabled
caps: {
  perTxUsd: number,                     // default $25
  dailyUsd: number,                     // default $100, rolling 24h
}
recipientPolicy: 'anyone' | 'allowlist', allowlist: [addresses/handles]
grantedAt, lastUsedAt, revokedAt
```

Rolling daily spend computed from a `DelegatedAction` ledger (one row per
executed action: userId, clientId, action, amountUsd, txHash, createdAt) —
the ledger is also the audit trail and the "via AI assistant" activity source.

## Signing

Two modes, chosen by what Privy wiring supports (see exploration notes):

- **privy-session-signer**: user consents in-app (Privy session signer /
  delegated actions on their embedded wallet); backend then signs via
  walletApi with the authorization key, per action, after the policy check.
- **confirm-only** (always available, ships first): backend never signs;
  every action returns a deep link `swopme.app/confirm-tx/<actionId>` that the
  app opens to a pre-filled, user-signed send. This mode needs NO new Privy
  surface and works today — so slice 1 ships confirm-only as the floor, with
  session-signer layered in behind the same interface once verified.

`delegatedSigner` service interface (so modes swap without touching callers):
`canAutoExecute(user, delegation, action) -> bool`,
`execute(user, delegation, preparedAction) -> { txHash }`.

## Policy check (every action, server-side, before any signing)

1. OAuth token has the scope; grant not revoked.
2. Delegation active, action type enabled.
3. amountUsd ≤ caps.perTxUsd.
4. ledger sum (last 24h) + amountUsd ≤ caps.dailyUsd.
5. Recipient passes recipientPolicy.
6. Action-specific: geo check for predictions; token allowlist for sends
   (slice 1: USDC only).
Deny → 409 with `{ reason, confirmUrl }` so the tool degrades gracefully.

## API (flag ENABLE_MCP_DELEGATION, default off)

```
GET  /api/v5/mcp/delegation                    verifyMcp(any tx scope) — status+caps
POST /api/v5/mcp/send/preview                  verifyMcp('wallet.send')
     { to: handle|address, amountUsd }         -> resolved recipient, fees, capsCheck
POST /api/v5/mcp/send                          verifyMcp('wallet.send')
     { previewId, confirm: true }              -> executes (or { confirmUrl })
In-app (verifyApp):
POST /api/v5/delegation                        create/update grant (caps, actions)
DELETE /api/v5/delegation                      revoke
GET  /api/v5/delegation/actions                ledger for the settings screen
```

Preview→execute is two calls with a short-lived `previewId` binding the exact
amount+recipient, so the calling model must surface the preview to the user
before the execute call — the confirmation lives in the protocol, not in
model goodwill.

## MCP tool (swop-mcp)

`swop_send(to, amountUsd, confirm?)` — without `confirm:true` returns the
preview (recipient name+handle+address, amount, caps remaining) and
instructions to confirm with the user; with it, executes and returns the tx
hash or the confirm-in-app link. Annotations: not read-only, destructive=false
but description states money movement + confirmation requirement.

## Mobile (pairs with the approve screen)

- Delegation screen: enable actions, set caps (sliders with sane maximums),
  Face-ID-gated; entry from "Connected AI assistants".
- `swopme.app/confirm-tx/<actionId>` route → pre-filled send sheet (confirm-only
  mode + over-cap overflow).
- Every delegated action → push notification ("Claude sent $20 to alice.swop.id").

## Safety invariants

- Ledger row + activity tag + push for EVERY delegated action, no exceptions.
- Revocation is instant (checked per action, no caching).
- Caps are enforced server-side only; nothing client-supplied.
- Slice 1 sends USDC only; no arbitrary calldata, ever, on this path.
- Panic switch: revoking the OAuth grant also suspends the delegation.

## Slices

1. **Now**: models + policy service + preview/send endpoints (confirm-only
   floor) + `swop_send` tool + in-app delegation CRUD endpoints.
2. Privy session-signer auto-execution behind `delegatedSigner`.
3. Mobile screens (delegation + confirm-tx) and OTA.
4. `swop_swap`, then `predictions.trade`, then `payments.x402` — each reusing
   preview→policy→execute.

- Future option (decided 2026-08-30): an opt-in dedicated "AI spending wallet"
  sub-wallet whose balance IS the cap — high-security mode for larger
  allowances. Default stays the main wallet + caps. Goldman vault wallets are
  permanently out of scope for MCP delegation (separate custody + policy).
