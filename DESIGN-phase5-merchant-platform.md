# Phase 5 — Merchant platform (API key, embeds, drops, own Bucks)

Status: **roadmap drafted 2026-09-16. NOT started. Rail decision ANSWERED; lane ownership still open.**

Travis's framing: a verified merchant gets an API key, connects their swop.id,
embeds Swop checkout on their own site, plugs into the drops map, issues their
own Geo Bucks — all working standalone for them, while the activity streams back
into the Swop network.

## The good news: the primitives already exist

This is an EXPOSURE problem, not a build-from-scratch one.

| Capability | Today | Gap |
|---|---|---|
| Products / checkout | `POST /api/v5/mcp/products`, x402 `buyUrl` | no key auth, no embed |
| Merchant locations | `MerchantLocation` model + routes | not externally reachable |
| Geo drops | `GeoDrop`, `GeoDropClaim` models | not externally reachable |
| Drops map | `GET /api/v5/geo-bucks/map-offers` | single consumer, no key |
| Merchant's own Bucks | `MerchantBucksFactory.launch()` on Base | client-side only, no server path |
| NFC terminals | `CheckoutNfcTerminal` | in-app only |
| Agent access | OAuth (MCP) | user-present only — wrong shape for server-to-server |
| **Merchant API key** | **nothing** | no `x-api-key` model in the backend at all |
| **Embeddable checkout** | **nothing** | no embed surface, no `CHECKOUT_BASE_URL` in backend config |

So the work is a key-authenticated external API over primitives that already
run, plus an embed surface, plus the stream back.

## DECISIONS

### 1. Which rail does the key gate? — ANSWERED 2026-09-16 (Travis)

Travis's standing policy, `CLAUDE.md`, 2026-08-31:

> crypto/x402 commerce is NEVER KYC-gated. A seller is agent-payable in USDC the
> moment they add products. Keep `X402_MERCHANT_IDENTITY_MODE=disabled` on the
> crypto path permanently.

Confirmed still live — the config default is `'disabled'`.

"After the merchant is verified they can use an API key" gates commerce on
verification. On the CARD rail that is consistent (Stripe Connect already
requires it). On the CRYPTO rail it contradicts the policy, and would break the
x402 storefront, where an agent pays any seller's `buyUrl` with no key at all.

**Travis, 2026-09-16: "The merchant needs verified for the card portion."**

So verification is a **per-capability gate, not a key-issuance gate**. This
distinction is the whole design and must not be collapsed:

| | verification required? |
|---|---|
| Issuing a merchant API key | **NO** |
| Crypto / x402 checkout + embeds | **NO** — ungated, per the 2026-08-31 policy |
| Drops, locations, map, own Bucks | **NO** |
| **Card settlement (Stripe Connect)** | **YES** |

An unverified merchant gets a key and can embed crypto checkout, run drops and
issue Bucks on day one. The card scope is the only thing their key cannot
exercise until Stripe Connect onboarding completes.

**Implementation trap to avoid:** gating key ISSUANCE on verification would
satisfy the sentence above while quietly re-introducing the conflict — an
unverified merchant could then not embed crypto checkout either, which is
exactly what the standing policy forbids. Gate the SCOPE, never the key.
`X402_MERCHANT_IDENTITY_MODE` stays `disabled`; enforce merchant identity only
inside the Stripe onboarding/payout path, as it already is.

### 2. Which lane owns this?

`CLAUDE.md` puts merchant verification in `swop-commerce-platform` +
`swop-identity-service` + `wt/kyc-x402-*`, and says explicitly that it is a
SEPARATE agent's lane which the MCP/agent-platform lane does not touch. An API
key gated on verification sits on that boundary. Agree ownership first — on
2026-09-16 two lanes touching the same release branch nearly reverted shipped
fixes twice.

## Milestones

### M1 — Key issuance (no money, no external surface)
Merchant API keys: issue, scope, rotate, revoke, last-used, audit. Keys are
hashed at rest like the OAuth refresh tokens already are. Scopes mirror the
existing OAuth scopes so there is ONE permission vocabulary, not two.
Exit: a key can authenticate a read, and revocation takes effect immediately.

### M2 — External read API
Key-authenticated reads over existing primitives: products, orders, locations,
drops, map offers. Read-only, so a leaked key cannot move money or change state.
Exit: a merchant can render their own storefront and drops map from their server.

### M3 — Embeddable checkout
Ships the card/crypto split above: the embed offers whichever rails the
merchant's key is scoped for, and an unverified merchant simply gets a
crypto-only embed rather than an error or a locked-out page.
A drop-in checkout for the merchant's own domain. Must carry its own CSP story —
see `checkout-strict-csp-nonce`, where a nonce + strict-dynamic setup already
bit once. Buyer picks the rail; card settlement suppresses the on-chain payout
(see `cart-card-rail`).
Exit: a real purchase completes from a non-Swop domain on both rails.

### M4 — Merchant writes: drops and their own Bucks
Create/manage drops and locations by key, and launch a Bucks program.
**Launching is a contract deployment** — same risk class as phase 4 M3, so it is
preview/confirm or explicitly-granted, never an ambient key permission.
Exit: gated behind phase 4's provenance gate having a proven ACCEPT path.

### M5 — Stream back to the network
The differentiator: merchant-site activity (claims, purchases, drops going live)
surfacing in the Swop feed and map. Design carefully — this is the one milestone
where merchant-controlled input reaches Swop users' surfaces, so treat every
field as untrusted and attacker-chosen.
Exit: no merchant-supplied string renders anywhere without escaping and rate
limits; a hostile merchant cannot spam or spoof another merchant's identity.

## Standing rules

1. One permission vocabulary — key scopes mirror OAuth scopes.
2. A leaked key must not be able to move money. Money movement stays on the
   delegation path with caps and confirmation.
3. Anything irreversible is preview/confirm, independent of caps.
4. M5 input is hostile by default.
