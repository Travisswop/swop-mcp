# Directory submission kit — Swop MCP

Live server: https://swop-mcp.vercel.app/mcp (canonical once DNS lands: https://mcp.swopme.co/mcp)
All tools are read-only public data; no auth in v0.1 (account linking arrives with the OAuth phase).

## Copy

**Name:** Swop
**Tagline (≤55 chars):** `Swop profiles, wallets & live prediction markets` (48)
**Short description:**
Swop connects your assistant to the Swop platform: look up any swop.id profile
and its public wallet addresses, and explore live prediction markets — search by
topic or sport, get real-time prices and orderbooks, alternate lines and player
props for games, price history, and live game status.

**Example prompts (for screenshots — take 3–5 in Claude with the connector on):**
1. "What are the odds the Fed cuts rates in September?"
2. "Show me live NFL games with betting lines right now"
3. "Look up travis.swop.id and give me the Solana address" *(needs backend prod deploy first)*
4. "Chart how the odds on the Bitcoin $45k market moved this month"
5. "Which sports have the most open prediction volume today?"

**Links:**
- Privacy policy: https://swopme.co/privacy.html
- Terms: https://swopme.co/terms.html
- Support: support@swopme.co (confirm this inbox exists; otherwise use the contact page)
- Docs/homepage: https://swopme.co

**Data handling (reviewer question):** the server is a stateless read-only proxy
over Swop's public APIs; it stores nothing, has no accounts, and handles no
personal data beyond publicly published swop.id profiles.

**Reviewer test account:** not required in v0.1 (no auth). Note geo: prediction
market DATA is available everywhere; trading (not in this version) is geo-gated.

## Where to submit

1. **Anthropic connector directory** — Claude.ai → org settings → connector
   submission portal (docs: claude.com/docs/connectors/building/submission).
   Manual review; dashboard tracks status; escalation mcp-review@anthropic.com.
2. **OpenAI App Directory** — OpenAI Developer Platform → app submission
   (MCP connectivity details + directory metadata + country availability).
   Recommend country-limiting per Polymarket geo rules at the listing level.
3. **MCP Registry** (registry.modelcontextprotocol.io) — `server.json` in this
   repo. Publish with `npx @modelcontextprotocol/publisher` after either
   (a) pushing this repo to github.com/Travisswop/swop-mcp (namespace
   io.github.Travisswop), or (b) DNS-verifying co.swopme for the name above.
4. **Grok** — no public submission process; users add it at grok.com/connectors →
   New Connector → Custom → paste the /mcp URL. Publish those instructions on
   swopme.co; catalog tile requires xAI outreach.

## Remaining prerequisites

- [ ] DNS: at Namecheap, add CNAME `mcp` → `cname.vercel-dns.com` on swopme.co
      (domain is already attached to the Vercel project; it goes live on the record).
- [ ] Backend prod deploy (deploy-prod.sh) so /api/v5/identity goes live —
      identity tools 404 until then.
- [ ] Push this folder to github.com/Travisswop/swop-mcp (registry + reviewer trust).
- [ ] Screenshots (prompts above) once connected in Claude.
