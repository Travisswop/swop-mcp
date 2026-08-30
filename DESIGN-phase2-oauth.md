# Phase 2 — Swop Account Linking for AI Assistants (OAuth 2.1 + Swop-app QR pairing)

Status: approved direction (Travis, 2026-08-29). This doc is the build spec.

## Goal

A Swop user connects their account inside Claude / ChatGPT / any MCP client and
gets authed tools: read balances, positions, orders; edit their SmartSite;
create products. No passwords in the browser, no signing keys anywhere near
the MCP server. Approval happens in the Swop app (mobile-first).

## Why this shape

- MCP clients (Claude, ChatGPT) mandate OAuth 2.1 with PKCE + dynamic client
  registration for authenticated remote servers. OAuth is the required shell.
- Inside our authorize page, authentication is ours. We use **Swop-app QR
  pairing** (WhatsApp-Web style) instead of WalletConnect: no Reown dependency
  (two projects already blocked on that queue), and Swop wallets are Privy
  embedded wallets that live in the app — the app IS the trusted device.
- Fallback for desktop-only users: Privy email/social login embedded on the
  authorize page.
- SIWE-over-WalletConnect: optional third method, later, after Reown unblocks.

## Components

### 1. OAuth 2.1 authorization server (swop-app-backend, new `/oauth` surface)

Endpoints (all new, mounted like the identity router — public, route-scoped CORS):

- `GET /.well-known/oauth-authorization-server` — metadata (RFC 8414).
- `POST /oauth/register` — dynamic client registration (RFC 7591). Store
  client_id/redirect_uris in a new `OAuthClient` collection. Claude and ChatGPT
  register themselves on first connect.
- `GET /oauth/authorize` — serves the authorize page (QR + scopes + fallback
  login). Params: client_id, redirect_uri, scope, state, code_challenge (PKCE
  S256 required).
- `POST /oauth/token` — exchanges auth code (with code_verifier) for tokens;
  also refresh_token grant.
- `POST /oauth/revoke` — token revocation (also called when user unlinks in-app).

Token model:
- **Access token**: JWT, 1h, distinct signing key/claims namespace from the app
  session JWT (`aud: "mcp"`), carrying `sub` (userId), `scope`, `client_id`.
  NEVER interchangeable with the mobile/desktop session token.
- **Refresh token**: opaque, hashed at rest in `OAuthGrant`, 90d rolling,
  revocable per grant. One grant row per (user, client) with scope set —
  re-linking updates it.
- verifyApp gets a sibling `verifyMcp(scopes...)` middleware: validates the MCP
  JWT + required scope, loads req.user, and tags requestContext so audit logs
  show `via=mcp client=<name>`.

Scopes (v1):
- `profile.read` — smartsite + profile data
- `wallet.read` — balances, transactions, positions, orders
- `smartsite.write` — edit sections (read-merge-write per section; never the
  wholesale tab overwrite)
- `commerce.write` — create/update products, payment links
  (No on-chain scopes in Phase 2 — signing stays in the app.)

### 2. QR pairing flow

1. Authorize page creates a **link session**: `POST /oauth/link-session`
   → `{ sessionId, nonce, expiresAt }` (2 min TTL, single-use, stored in Mongo
   with the pending OAuth params + scopes).
2. Page renders QR: `swopme.app/link/<sessionId>#<nonce>` (universal link —
   opens the app if installed, App Store otherwise). Same-device mobile flow:
   the QR is also a tappable button with the same link.
3. Swop app (authed) opens approve screen: client name ("Claude"), scope
   descriptions, Approve / Deny. On approve:
   `POST /oauth/link-session/:id/approve` with the app's session auth +
   the nonce from the fragment. Backend binds userId to the session.
   (Nonce travels in the URL fragment so it never hits server logs from the QR
   URL itself; the approve call carries it explicitly.)
4. Authorize page polls `GET /oauth/link-session/:id/status` (or SSE); on
   approved, backend mints the auth code and the page redirects to
   `redirect_uri?code=...&state=...`.
5. Fallback path: "Sign in with email" renders Privy login on the page; on
   success the same session-approve endpoint is called server-side.

Security notes:
- PKCE S256 mandatory; exact-match redirect URIs; `state` echoed untouched.
- Link sessions single-use, 2-min TTL, IP+UA recorded, and the approve screen
  shows a device/location hint ("Chrome on Mac, Charlotte NC") to resist
  QR-phishing (attacker shows victim a QR → victim would see the attacker's
  device hint).
- Rate-limit link-session creation per IP.
- In-app management screen lists active grants (client, scopes, last used)
  with revoke — backed by `GET/DELETE /oauth/grants` (verifyApp).

### 3. MCP server changes (swop-mcp)

- Declare OAuth in the MCP server metadata (`.well-known/oauth-protected-resource`
  pointing at the backend authorization server) so Claude/ChatGPT auto-discover.
- New authed tools, each forwarding the caller's access token to the backend:
  - `swop_get_my_profile`, `swop_get_my_balances`, `swop_get_my_positions`,
    `swop_get_my_orders` (read scopes)
  - `swop_update_smartsite_section` (smartsite.write)
  - `swop_create_product`, `swop_create_payment_link` (commerce.write)
- Existing public tools stay tokenless. Connector auth mode in Claude flips
  from "None" to "Required when the server asks" so public tools keep working
  unauthenticated.

### 4. Mobile app (handoff to mobile pipeline)

One new screen + one route:
- Universal-link route `swopme.app/link/<sessionId>` → Approve screen.
- Approve screen: client icon/name, scope list (plain-language strings served
  by `GET /oauth/link-session/:id` so copy is server-controlled), Approve/Deny,
  device hint. Calls the approve endpoint with existing session auth.
- Settings → "Connected AI assistants" list with revoke (reads /oauth/grants).

## Build order

1. Backend: OAuthClient/OAuthGrant/LinkSession models + token endpoints +
   verifyMcp (flag-gated `ENABLE_MCP_OAUTH`, default off — same posture as
   identity/x402).
2. Authorize page (served by backend or desktop-app route — backend-served
   keeps it origin-clean).
3. swop-mcp authed tools + protected-resource metadata.
4. Mobile approve screen (parallel; email fallback makes 1–3 shippable and
   testable before 4 lands).
5. E2E: link a real Claude connector, exercise every scope, revoke, re-link.

## Out of scope (Phase 3)

On-chain actions (send/swap/bets/pay-x402-links) via delegated signing with
per-tx + daily caps; every delegated action tagged in activity. Separate
design.
