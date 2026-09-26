# Add Swop to your AI

Swop works inside any AI assistant that supports MCP connectors. One URL:

```
https://mcp.swopme.co/mcp
```

## Claude
Settings → Customize → Connectors → **Add custom connector** → name it "Swop",
paste the URL. Public tools work immediately; connect your Swop account when
prompted to manage your SmartSite, balances, and products from chat.

## ChatGPT
Settings → Apps & Connectors → enable **Developer mode** (Security settings) →
Plugins → **+** → name "Swop", server URL above, Authentication: OAuth (or No
Auth for public tools only).

## Grok
grok.com/connectors → **New Connector** → **Custom** → paste the URL.

## If something goes wrong

- **Asked to sign in?** Complete the Swop account-linking prompt. Never paste
  passwords, private keys, or recovery phrases into chat.
- **A tool is missing?** Start a fresh conversation with the Swop connector
  enabled so your assistant can load the current tool list.
- **A money action timed out or lost its connection?** Its outcome may be
  unknown. Check your Swop activity and the relevant order or checkout status
  before repeating the action. If you cannot confirm the outcome, stop and ask
  for help instead of submitting it again.

## What your AI can do with Swop
- Look up any swop.id and its wallet addresses
- Live prediction-market odds, orderbooks, and price history
- Browse any Swop store and **buy products with USDC** (x402) — digital delivers
  instantly; physical items collect your shipping address and hold payment in
  escrow until delivery
- With your account linked: check balances and orders, edit your SmartSite,
  create products that are instantly sellable to humans and agents alike

*Selling* requires nothing extra: if you have a SmartSite with products, AI
agents can already buy from you.
