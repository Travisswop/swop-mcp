# Directory submission kit — Swop MCP

**Submit this endpoint to directories:** https://mcp.swopme.co/mcp/commerce
(commerce-only: 26 tools, no money-moving, trading, or prediction-market tools).

The full endpoint, https://mcp.swopme.co/mcp (41 tools, includes sends, swaps,
perps and prediction markets), stays live for existing users but is NOT the
listing URL. swop-mcp.vercel.app is the same deployment under another hostname.

Both endpoints: public tools need no auth; account tools use OAuth 2.1 account
linking (apps.apiswop.co/oauth, QR approval in the Swop app or email magic
link). Auth mode for listings: "Required when the server asks." Each endpoint
publishes its own RFC 9728 metadata (`/.well-known/oauth-protected-resource/mcp/commerce`
for the listing URL). The commerce document advertises only
`profile.read wallet.read smartsite.write commerce.write` in `scopes_supported`,
so a commerce link never asks for send/trade/x402/perps consent.

Commerce is real: every Swop seller's products are purchasable by agents in
mainnet USDC over x402 (digital = instant settlement to the seller; physical =
shipping capture + escrow, released on wallet-signed receipt confirmation).
Sellers are agent-payable in USDC as soon as they add a product, with no KYC.

## Copy

**Name:** Swop
**Registry description (≤100 chars):** `Sell to people and AI agents: create products, a storefront, and USDC payment links from chat.` (94)
**Tagline (≤55 chars):** `Sell anything to people and agents, paid in USDC` (48)
**Short description (Smithery / Glama / PulseMCP / mcp.so):**
Swop turns a chat into a storefront. Tell your assistant "sell my ebook for $15"
and it creates the product, puts it on your Swop SmartSite, and hands back one
link: people see a Buy page, and AI agents get an x402 USDC payment challenge
they can pay automatically. You can also browse any Swop seller's store and buy
in USDC, take checkout payments on your own site with signed webhooks, and look
up any swop.id. Public tools need no account. Selling links your Swop account
over OAuth.

**Categories / tags:** commerce, payments, x402, USDC, storefront, creator tools.
Do NOT tag trading, perps, prediction markets, or DeFi.

**Example prompts (for screenshots — take 3–5 in Claude with the commerce connector on):**
1. "Make me a store and sell a 30-minute consulting call for $50."
2. "Put that on my SmartSite and give me a link I can post on X."
3. "What does travis.swop.id sell?"
4. "Set up checkout on my website for my hoodie, and ping my server when someone pays."
5. "Show me my orders from this week."

Keep `swop_send`, `swop_pay_x402_link`, `swop_swap` and `swop_perps_order` out of
all demos, screenshots and listing copy (they are not on the commerce endpoint).

**Links:**
- Privacy policy: https://swopme.co/privacy.html
- Terms: https://swopme.co/terms.html
- Support: support@swopme.co (confirm this inbox exists; otherwise use the contact page)
- Docs/homepage: https://swopme.co
- Setup guide: https://github.com/Travisswop/swop-mcp/blob/main/docs/add-swop-to-your-ai.md

**Data handling (reviewer question):** the server is a stateless proxy over
Swop's APIs; it stores nothing itself. Public tools read publicly published
swop.id profiles and stores. Account tools act on the signed-in user's own Swop
account (products, SmartSite, orders, checkouts, webhooks) through an OAuth
access token the user granted; the server keeps no copy of it between requests.

**Reviewer test account:** provide a Swop test account for the OAuth-linked
tools; public tools need none.

## Where to submit

1. **Anthropic connector directory** — needs a Claude **Team or Enterprise org**
   (submission portal is under org settings; docs:
   claude.com/docs/connectors/building/submission). Manual review; escalation
   mcp-review@anthropic.com. Submit the /mcp/commerce URL.
2. **OpenAI App Directory** — OpenAI Developer Platform → app submission
   (MCP connectivity details + directory metadata + country availability).
   Submit the /mcp/commerce URL.
3. **MCP Registry** (registry.modelcontextprotocol.io) — published as
   `io.github.Travisswop/swop` from `server.json`. **Decided (Travis, Oct 1):
   the registry lists the commerce endpoint only.** v0.2.1 has a single remote,
   https://mcp.swopme.co/mcp/commerce, so every aggregator that ingests the
   registry (PulseMCP, Glama) picks up the right URL. /mcp keeps working for
   existing users; it is just not advertised. Publish with
   `mcp-publisher login github` then `mcp-publisher publish`.
4. **Smithery, Glama, PulseMCP, mcp.so** — use the copy above and the
   /mcp/commerce URL.
5. **x402 Bazaar** — list product links from `swop_get_product_link`.
6. **Grok** — no public submission process; users add it at grok.com/connectors →
   New Connector → Custom → paste the URL.

## Prerequisites

- [x] DNS: `mcp.swopme.co` CNAME → Vercel (live).
- [x] Backend identity routes live (`swop_lookup_identity` returns data).
- [x] Repo public at github.com/Travisswop/swop-mcp.
- [x] Registry namespace `io.github.Travisswop/swop` published (v0.2.1, commerce remote only).
- [x] `glama.json` at the repo root (maintainers: Travisswop) for the Glama repo listing claim.
- [ ] Claude Team/Enterprise org for the Anthropic directory.
- [ ] Screenshots (prompts above) once connected in Claude.
