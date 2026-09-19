# Phase 5 M5 — Headless checkout

**Status:** design, not built. Written for review before implementation, because
this is the first merchant-facing API that can move money.

## What a merchant wants

Today a merchant embedding Swop gets one of two things:

1. **Redirect** — the buyer leaves for `swopme.app/p/<handle>/<sku>`.
2. **Framed checkout** (M3b–M3d, shipped) — Swop's checkout renders in an
   iframe on the merchant's page. The buyer stays, but the *cart and payment UI
   are Swop's*, and the merchant cannot shape them.

What merchants actually ask for is the third thing: **their storefront, their
cart, their checkout UI, with Swop as the commerce backend.** They pick which
products to show, build their own add-to-cart, and payment feels native.

This document specifies that.

## Why it cannot be done today

Two hard blockers, one of which is not obvious:

**There is no way to create a checkout from a cart.** The merchant API is
deliberately read-only (`GET /products`, `GET /orders`). Everything that takes
payment hangs off an `:intentId` that already exists, created by Swop's own
surfaces. Nothing lets a merchant say "these three SKUs, these quantities, make
me a checkout."

**Swop's cart is localStorage, scoped to `swopme.app`.** It cannot be seeded
from another origin — browsers forbid it. So even a fully configured iframe
loads an *empty* cart. A merchant's own add-to-cart can never reach it. This is
why the framed approach does not, by itself, deliver what merchants describe.

## Shape of the API

### `POST /api/v5/merchant/checkout-intents`

Scope: **`commerce.checkout`** (new — see Scopes).

```
{ "items": [ { "sku": "...", "quantity": 2, "variant": {"Color": "Black"} } ],
  "buyer":  { "email": "...", "shipping": { ... } },
  "reference": "merchant-side order id",
  "returnUrl": "https://acme.com/thanks" }
```

Returns an intent id, the server-computed totals, and which rails are available:

```
{ "intentId": "...", "currency": "USDC",
  "lineItems": [ { "sku": "...", "name": "...", "unitPrice": ..., "quantity": 2 } ],
  "subtotal": ..., "shipping": ..., "total": ...,
  "rails": ["crypto"],            // "card" only if the merchant is entitled
  "expiresAt": "..." }
```

**Prices are never accepted from the caller.** The request carries SKUs and
quantities; the server resolves price, shipping and availability from the
merchant's own catalogue. A price in the request body is the single most
likely way this endpoint gets turned into a discount generator.

### `GET /api/v5/merchant/checkout-intents/:id`

Scope `commerce.read`. Poll state. Idempotent.

### Webhooks

Merchants cannot poll forever. `checkout.paid`, `checkout.failed`,
`checkout.expired`, signed with a per-merchant secret, replay-protected with a
timestamp. Without these a merchant's backend never learns an order was paid,
and headless is not usable in practice.

### Payment UI

The "native feel" lives here, not in the API. Two options, and this is the main
open question:

- **A payment element** the merchant drops into their page (a Swop-hosted
  iframe styled by the merchant). Keeps card data entirely out of merchant
  scope, which matters for PCI.
- **Full API + merchant-rendered fields.** Maximum control, and it drags the
  merchant into PCI scope. Not recommended.

Recommendation: element. Merchants get their own cart and checkout page; only
the payment fields themselves are Swop's.

## Scopes

`commerce.checkout` is **new and separate from `commerce.write`.** A key that
can edit products has no business creating payable intents, and vice versa.

Card remains gated exactly as it is now — `commerce.card` is entitlement-gated
via `resolveMerchantPaymentRoute`, resolved per request and failing closed. A
headless merchant without a verified Stripe route gets `rails: ["crypto"]` and
no card option. That is the existing 2026-08-31 policy and this design does not
alter it.

## Threat model

This is the first merchant key that can cause money to move, so:

| risk | mitigation |
|---|---|
| Price manipulation | Server resolves all prices from the catalogue. Request carries SKU + quantity only. |
| Leaked key creates intents at scale | Per-key rate limit and a per-key daily intent cap. Alert on anomalies. |
| Leaked key harvests order/buyer PII | `GET` returns the merchant's own orders only, already scoped by `req.user._id`. No buyer PII beyond what the merchant already receives. |
| Cross-merchant access | Every query scoped by key owner, as the existing endpoints are. |
| Replayed webhooks | Signed with timestamp; receivers reject outside a window. |
| Intent created for another merchant's SKU | SKU lookup scoped to the key owner's catalogue; unknown SKU is a 404, not a silent skip. |
| Card offered to an unverified merchant | `rails` computed from live entitlement, not stored on the intent. |

**Fail closed everywhere**, matching the existing services: an entitlement
lookup that errors withholds card rather than granting it.

## What the existing code already gives us

Worth stating, because it changes the size of the job:

- **`createMarketplaceCheckoutIntent`** already does server-side pricing
  (`buildBuyerMarketplaceLineItems`), merchant resolution, fee and royalty
  calculation, and expiry. It should be reused, not reimplemented.
- **Card entitlement is already correct there.** `marketplaceCardOffer` offers
  card only when the merchant can actually take one, with the goods attestation
  derived from the products rather than the request — because the caller is the
  buyer and "a buyer must never be able to attest on a merchant's behalf". That
  reasoning applies unchanged when the caller is the merchant's own server.
- **Buyer-less checkouts already work**, per the x402 path.

What is genuinely new is therefore narrower than it first looks: merchant-key
authentication, an ownership check binding every requested product to the key
owner, and buyer details arriving in the request rather than from `req.user`.
That last one is the real work — the marketplace handler reads the buyer's
name, email and wallet off the session throughout.

## Rail invariants a new creation path must not lose

Flagged by the Stripe Connect lane, because neither is visible from outside the
rails code and both are easy to break in a fresh endpoint:

**A checkout that has published crypto payment instructions can never also be
charged by card, and vice versa.** The mutual exclusion is enforced by
`paymentRequest`, NOT by the rail lock — so an implementation that checks only
the rail field will believe the two are compatible. A headless intent that sets
a rail without honouring `paymentRequest` can end up chargeable twice.

**A card-paid marketplace order must never also fire the on-chain payout.** If
it does, the merchant is paid twice, and the second payment is real money out
of Swop. Any new path that reaches settlement has to respect whichever branch
already ran.

Both belong in tests on the creation endpoint, not only at the payment step —
by the time a payment is attempted the bad intent already exists.

## Milestones

- **M5a** — `POST /checkout-intents` + `GET /checkout-intents/:id`, crypto rail
  only, `commerce.checkout` scope, rate limits, full test coverage. Card
  deliberately excluded from the first cut.
- **M5b** — webhooks with signing and replay protection.
- **M5c** — the payment element, and card rail for entitled merchants.
- **M5d** — docs and a reference storefront.

Shipping M5a alone already lets a merchant run their own cart and hand off to a
Swop-hosted payment step — which is most of the perceived value.

## M5c / M5e — three rails in one embedded checkout

The goal a merchant actually asks for: one checkout on their own site taking
**card, crypto, or the merchant's own Geo Bucks**. Today the embedded path
takes crypto only, and the reason differs for each of the other two.

### Card (M5c) — scoped, not built

The mechanism is live on Swop-hosted checkout; the merchant-page version is
missing. One rule shapes the whole design: **Swop must never receive a card
number.** The merchant's page mounts Stripe's Payment Element against a client
secret Swop returns, so the PAN goes browser to Stripe, never through Swop's
servers or the merchant's. A raw-PAN API would put Swop AND every integrating
merchant into the heaviest PCI category — so if a merchant asks for one the
answer is no, and the reason is their exposure, not only ours.

Card stays entitlement-gated: resolveMerchantPaymentRoute is checked per
request, so an unverified merchant's embedded checkout offers crypto and simply
shows no card option.

### Geo Bucks (M5e) — not a rail at all yet

The larger gap, and easy to under-estimate because Geo Bucks look like a token
that already works. They do — for ISSUANCE and for DROP REDEMPTION. They have
never been a way to pay for a checkout:

    CheckoutIntent.rail: ['solana', 'lifi', 'evm_direct', 'stripe_connect_card']

No bucks. Adding one means:

- **A new rail value**, and a fourth branch everywhere two are reasoned about
  today. The crypto/card mutual exclusion is enforced by `paymentRequest`
  rather than the rail lock, so a third rail must be reasoned about there
  specifically, not merely added to an enum.
- **Redemption at settlement, not receipt.** Store credit is burned or
  transferred; the merchant already holds the value, so the branch that pays
  them out does not apply. Getting this wrong pays a merchant twice — the same
  failure shape as the existing card-payout invariant.
- **Merchant scoping.** Bucks are redeemable only at stores the issuer
  registered. `geoBucksIssuance.service.js` already proves provenance on-chain
  with `factory.isProgram(program)`; checkout needs the equivalent — that THIS
  buck is spendable at THIS merchant. Without it, one merchant's store credit
  spends at another's shop.
- **Partial payment.** A $40 order against a $12 balance is the obvious case,
  and it means one checkout settling across two rails. That is a materially
  harder intent model than "pick one", and M5e should decide early whether it
  supports it or refuses it.

### Settlement timing is no longer uniform (as of 491e094a, live)

This changed under this design while it was being written, and an embedded
checkout inherits it:

```
in person, any rail          -> releases at once
website + physical, crypto   -> on-chain payout at buyer confirm
website + physical, CARD     -> Stripe transfer withheld at capture,
                                sent at buyer confirm
website + digital, any rail  -> releases at once (delivered at settlement)
```

So "settled" must be answered **per rail AND per basket**, not once.

**A card website order sits at `transfer_pending` for possibly days, and that
is CORRECT, not stuck.** Anything surfacing payment state to a merchant's own
page that reads `transferred` as "done" will look broken and invite someone to
"fix" a working escrow. The buyer-facing checkout already learned this —
0786c096 stopped it polling to `transferred`.

### Partial payment across two rails: CORRECTED — it does not break the model

**This section previously recommended refusing partial payment. That was wrong,
and the Geo Bucks lane showed why.**

The objection was that `CheckoutIntent` assumes one payment with one settlement
and `executeMarketplaceRelease` picks a single payout leg, so bucks plus a
crypto remainder looked like two payments on one intent.

It is not. The burn is **not a payment leg**. It lives in its own `bucksCredit`
subdocument, and what it does to the checkout is **re-price it**: `fees` are
rewritten so `totalDueAmount` is the reduced number, with the pre-credit
schedule preserved in `bucksCredit.preCreditFees`. The intent then still has
exactly one `payment` and one `settlement`, describing one transfer for the
reduced total on whichever rail the buyer picks. Every existing reader — LiFi,
Solana Pay, the headless path here, the console normalizer — sees a smaller
checkout and nothing else.

So the settlement machinery gains a leg rather than a second payment. Travis
also asked for the split explicitly — the buyer pays the remainder with any
token in their wallet and it converts, with the merchant made whole after swap
fees and slippage — so refusing it would have contradicted a decision already
made.

Two things that ARE special, both handled:

- **Card plus bucks is refused outright**, both directions, atomically. That is
  the one combination where two rails genuinely would collide.
- **Full coverage**, not partial, is what needed new settlement code:
  `totalDueAmount` reaches 0, there is no transfer to verify, and a dedicated
  settle path completes the order the way the card path does.

The release concern above was real and is fixed: a `geo_bucks` leg that moves
nothing and records the burn, instead of an `else` that would have paid the
merchant a second time from an escrow wallet the sale never funded.

### What Geo Bucks are, stated plainly

Store credit issued by a merchant, worth $1 each, 2 decimals, redeemable only
at stores that merchant registers. `isStoreCredit: true` on the token row.

**They are not money and must never be summed into a portfolio or cash total.**
The mobile wallet already excludes them and anything new must too. A balance of
40 Geo Bucks is not $40 of assets — it is $40 of credit at one merchant, worth
nothing anywhere else.

## Open questions for review

1. **Payment element or full API?** Recommendation: element, for PCI scope.
2. **Per-key caps** — what daily intent ceiling is right before it hurts a real
   merchant?
3. ~~**Guest vs account**~~ — **resolved by reading the code.** `CheckoutIntent`
   has no required buyer field, and the x402 path already creates and settles
   purchases with no Swop buyer at all: it records `sellerUserId` and nothing
   for the buyer. So a headless buyer does not need a Swop account, and no new
   guest-buyer concept is required — the model already supports it. This was
   the largest unknown in this design and it is closed.
4. **Refunds** — out of scope here, but merchants will ask immediately. Its own
   milestone, with its own review.

## What this does not change

The M3 embed work stays as-is and remains the right answer for merchants who
want checkout without building one. Headless is additive, not a replacement.
The registered-origin gate, the scope split and the fail-closed verifier all
carry over unchanged.
