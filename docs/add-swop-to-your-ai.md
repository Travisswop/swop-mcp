# Add Swop to your AI

Swop lets your AI assistant sell for you, to people and to other AI agents,
paid in USDC. It works inside any assistant that supports MCP connectors. One URL:

```
https://mcp.swopme.co/mcp/commerce
```

## Claude
Settings → Customize → Connectors → **Add custom connector** → name it "Swop",
paste the URL. Public tools work immediately; connect your Swop account when
prompted to create products, edit your SmartSite, and see your orders from chat.

Claude Code:

```
claude mcp add --transport http swop https://mcp.swopme.co/mcp/commerce
```

## ChatGPT
Settings → Apps & Connectors → enable **Developer mode** (Security settings) →
Plugins → **+** → name "Swop", server URL above, Authentication: OAuth (or No
Auth for public tools only).

## Cursor
Add to `~/.cursor/mcp.json` (or your project's `.cursor/mcp.json`):

```json
{ "mcpServers": { "swop": { "url": "https://mcp.swopme.co/mcp/commerce" } } }
```

## Grok
grok.com/connectors → **New Connector** → **Custom** → paste the URL.

## What your AI can do with Swop
- **Sell anything from chat.** "Sell my ebook for $15" creates the product and
  hands back one link: people see a Buy page, and AI agents get an x402 USDC
  payment challenge they can pay automatically. Digital items settle instantly;
  physical items collect shipping and hold payment in escrow until delivery.
- **Turn your SmartSite into a storefront.** Feature products, add links, edit
  your bio, and post to your feed.
- **Take checkout payments on your own website**, with signed webhooks
  (`checkout.paid`, `payout.released`) and the sites you allow to embed checkout.
- **Browse any Swop seller's store** and look up any swop.id.
- **See your orders and balances** once your account is linked.

You're paid in USDC as soon as you add a product, with no store setup or
verification step.

Already connected to `https://mcp.swopme.co/mcp`? It keeps working, with the
same account link. It is the full Swop toolset for existing users; the commerce
URL above is the recommended one for new setups.
