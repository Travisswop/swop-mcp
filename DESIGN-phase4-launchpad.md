# Phase 4 — Launchpad over MCP

Status: **roadmap agreed 2026-09-16 (Travis). M1 in progress.**
Scope agreed: all four tiers, shipped milestone by milestone, each independently
safe to stop at.

## The constraint that shapes everything

**There is no Launchpad backend.** The mobile Launchpad talks directly to Base
contracts from the user's wallet:

| `Expo-Moon-App/src/lib/launchpad/` | backend calls | direct chain calls |
|---|---|---|
| `protocol.ts` | 0 | 8 |
| `wallet.ts` | 0 | 11 |
| `liquidity.ts` | 0 | 14 |
| `sponsorship.ts` | 0 | 1 |

swop-app-backend's only involvement is gas policy — `launchpadGasPolicy.js`,
`launchpadLiquidityGasPolicy.js`, `launchpadSetupPolicy.json` — which recognise
the `launch(bytes32,string,string,bytes32,string,uint256)` selector and pool
creation and set gas ceilings (7M for pool creation, 4M for verified setup).

So this is NOT the shape of the product-schema fix, where the backend already
accepted everything and only the MCP tool was narrow (see
`feat(products)` / `01f3405`). Every tier here needs backend endpoints built
first. **Check this assumption before starting any milestone** — if someone has
since added a Launchpad API, prefer it over building a parallel one.

## Milestones

Each milestone ships and is useful alone. Do not start the next until the
previous one's exit criteria hold in production.

### M1 — Read-only (no signing, no money)

Backend: read Base via RPC and expose the user's Launchpad state.
MCP tools: `swop_list_my_tokens`, `swop_get_token`, `swop_get_token_holders`,
`swop_get_token_liquidity`.
Scope: new read scope (e.g. `launchpad.read`); MUST NOT reuse `wallet.send`.

Exit criteria:
- Tools return live mainnet data for an account that has launched a token.
- Zero write paths introduced. No delegated signer touched.
- `verifyMcp('launchpad.read')` on every route; owner-read also works from the
  app (see the `GET /delegation` guard bug — in-app reads got a flat 401 because
  the route was `verifyMcp`-only; use the `verifyAppOrMcp` pattern).

### M2 — Buy / sell launched tokens

Reuses the existing delegated-signing path (`swop_swap` / `swop_send` shape):
preview -> caps check -> confirm. No new trust model.

Exit criteria:
- Bounded by the user's existing caps; refuses above them with a clear reason.
- A `needs_app_confirmation` path returns a `www.swopme.app/confirm-tx/...` link
  (www, NOT apex — apex deep links open Safari; see `dd92dffa`).
- Dry-run proven on Base Sepolia before mainnet.

### M3 — Launch a token  (HIGH RISK — deploys a permanent contract)

Irreversible. Deploys a real token from the user's wallet and must satisfy the
gas policy's code-hash and selector checks.

Exit criteria:
- **Preview-only by default.** The agent prepares; the user confirms in the app.
  Fully autonomous launch stays behind an explicit, separately-granted setting.
- Name/symbol/supply echoed back and confirmed before any submission.
- Testnet launch proven end to end first.

### M4 — Liquidity  (HIGH RISK — moves real capital)

Pool creation and position management. Impermanent loss is a real user
outcome, not an error case.

Exit criteria:
- Preview-only by default, same as M3.
- Position size bounded by caps; the preview states the IL exposure plainly.
- Never auto-remove liquidity on an agent's own initiative.

## Standing rules for this phase

1. **Money tiers ride the existing delegation machinery.** Do not invent a second
   authorisation path. Caps, the audit log and the app-side toggle already exist.
2. **`productType`-style schema lies are the enemy.** Advertise the real domain of
   every field; if the backend requires it, mark it required. An assistant can
   only be as careful as the schema lets it be.
3. **Preview -> confirm for anything irreversible**, independent of caps. Caps
   bound size, not regret.
4. Each milestone lands on `main` AND the current mobile release line if it
   touches the app — see `Expo-Moon-App/AGENTS.md` "Release lines fork".
