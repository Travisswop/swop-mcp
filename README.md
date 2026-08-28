# swop-mcp

Remote MCP server exposing Swop to AI assistants (Claude, ChatGPT, Grok, Cursor —
anything that speaks MCP). One server, registered per platform.

**Phase 1 (this code): public read-only tools, no auth.**
Phase 2 adds an OAuth 2.1 facade + authed reads and non-signing writes
(profile/SmartSite/products). Phase 3 adds on-chain writes (swap/send/bets/DeFi)
via Privy delegated signing with caps + in-app confirm-link fallback.

## Tools

Identity (swop-app-backend `/api/v5/identity`, public CORS-open router):
- `swop_search_identities` / `swop_lookup_identity` — handle → profile + wallet addresses.
  ⚠️ On the `production` branch but NOT yet live on apps.apiswop.co (404) — needs a
  backend prod deploy via deploy-prod.sh before these tools return data.

Predictions (polymarket.apiswop.co, all public):
- `swop_search_markets` (free-text via /desktop/markets), `swop_get_event_markets`,
  `swop_get_event_live_status`, `swop_get_orderbook`, `swop_get_prices` (live book,
  preferred over cached outcomePrices), `swop_get_price_history`,
  `swop_get_taxonomy`, `swop_get_taxonomy_stats`, `swop_check_predictions_access` (geoblock).

## Run

```
npm install
npm run dev          # Streamable HTTP on :8788 (POST /mcp), stateless JSON mode
npm run dev:stdio    # stdio transport for local clients
npm run build && npm start
```

Env: `SWOP_API_BASE` (default https://apps.apiswop.co), `PREDICTIONS_API_BASE`
(default https://polymarket.apiswop.co), `PORT` (default 8788).

Local test with Claude Code:

```
claude mcp add swop --transport http http://localhost:8788/mcp
```

## Deploy

Stateless — any host works (Vercel functions, or a small box alongside the
sidecar). Suggested prod URL: `mcp.swopme.app` (never swop.tech). Give it its
own upstream rate-limit identity before public listing.
