import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PREDICTIONS_API_BASE, SWOP_API_BASE } from './config.js';
import { getJson, postJson, UpstreamError } from './http-client.js';
import { getCatalog } from './store.js';

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://mcp.swopme.co';
// Product pages are served by the Swop app, not by this MCP server. Building
// share links off PUBLIC_BASE_URL pointed them at mcp.swopme.co/p/... which
// has never served that route, so every link this tool handed out was a 404.
const APP_BASE_URL = process.env.PUBLIC_APP_BASE_URL ?? 'https://www.swopme.app';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const msg =
    err instanceof UpstreamError
      ? `Swop API error (HTTP ${err.status}): ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: 'text', text: msg }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

// Slim a sidecar market row down to what an assistant needs to reason and
// answer — the raw rows carry image URLs and internal fields that only
// burn context.
function slimMarket(m: Record<string, unknown>): Record<string, unknown> {
  return {
    question: m.question,
    slug: m.slug,
    eventSlug: m.eventSlug ?? m.event_slug,
    conditionId: m.conditionId,
    outcomes: m.outcomes,
    outcomePrices: m.outcomePrices,
    clobTokenIds: m.clobTokenIds,
    endDate: m.endDate,
    liquidity: m.liquidity,
    volume: m.volume ?? m.volumeNum,
    live: m.eventLive ?? m.live,
    gameStartTime: m.gameStartTime,
  };
}

export function buildServer(authHeader?: string): McpServer {
  const server = new McpServer({ name: 'swop', version: '0.1.0' });

  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

  // ---------- Identity ----------

  server.registerTool(
    'swop_search_identities',
    {
      title: 'Search swop.id identities',
      description:
        'Search Swop user identities (swop.ids) by handle or display name. Returns handle, display name, avatar, and public EVM/Solana wallet addresses. Use this to find a user or resolve a name to a wallet address.',
      inputSchema: {
        query: z.string().min(2).describe('Handle or name fragment, at least 2 characters (e.g. "travis")'),
        limit: z.number().int().min(1).max(20).optional().describe('Max results, default 8'),
      },
      annotations: readOnly,
    },
    ({ query, limit }) =>
      run(() => getJson(SWOP_API_BASE, '/api/v5/identity/resolve', { q: query, limit })),
  );

  server.registerTool(
    'swop_lookup_identity',
    {
      title: 'Look up a swop.id',
      description:
        'Resolve an exact swop.id handle (e.g. "travis.swop.id") to its profile: display name, avatar, and public EVM/Solana wallet addresses. Case-insensitive exact match; use swop_search_identities for fuzzy search.',
      inputSchema: {
        handle: z.string().min(1).describe('Exact swop.id handle, e.g. "travis.swop.id"'),
      },
      annotations: readOnly,
    },
    ({ handle }) => run(() => getJson(SWOP_API_BASE, '/api/v5/identity/lookup', { handle })),
  );

  // ---------- Prediction markets ----------

  server.registerTool(
    'swop_search_markets',
    {
      title: 'Search prediction markets',
      description:
        'Search Swop prediction markets (Polymarket-backed) by topic. Supports free-text search over question/event/outcomes/tags, plus live-game and sport filters. Returns market question, slug, outcomes with current prices, CLOB token ids, liquidity, and end date. Prices are 0..1 probabilities per outcome.',
      inputSchema: {
        query: z.string().optional().describe('Free-text topic search, e.g. "bitcoin", "chiefs", "fed rates"'),
        tag_id: z.string().optional().describe('Sport/category tag id from swop_get_taxonomy'),
        live: z.boolean().optional().describe('Only markets whose event is live right now'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results, default 10'),
        offset: z.number().int().min(0).optional().describe('Pagination offset'),
      },
      annotations: readOnly,
    },
    ({ query, tag_id, live, limit, offset }) =>
      run(async () => {
        const rows = (await getJson(PREDICTIONS_API_BASE, '/api/prediction-markets/desktop/markets', {
          q: query,
          tag_id,
          live: live === undefined ? undefined : String(live),
          limit: limit ?? 10,
          offset,
        })) as Array<Record<string, unknown>>;
        return Array.isArray(rows) ? rows.map(slimMarket) : rows;
      }),
  );

  server.registerTool(
    'swop_get_event_markets',
    {
      title: 'Get all markets for an event',
      description:
        'Fetch every market for a single event by event slug — moneyline plus alternate spread/total lines and player props for sports, or all outcomes for multi-outcome events. Use after swop_search_markets when the user wants full detail on one game/event.',
      inputSchema: {
        slug: z.string().min(1).describe('Event slug from a market result (eventSlug field)'),
      },
      annotations: readOnly,
    },
    ({ slug }) =>
      run(() => getJson(PREDICTIONS_API_BASE, '/api/prediction-markets/events/markets', { slug })),
  );

  server.registerTool(
    'swop_get_event_live_status',
    {
      title: 'Get live status of an event',
      description:
        'Check whether an event (e.g. a game) is live, its current period and elapsed time, and whether it has closed. Never infer live status from the clock — use this.',
      inputSchema: {
        slug: z.string().min(1).describe('Event slug'),
      },
      annotations: readOnly,
    },
    ({ slug }) =>
      run(() => getJson(PREDICTIONS_API_BASE, '/api/prediction-markets/events/live', { slug })),
  );

  server.registerTool(
    'swop_get_orderbook',
    {
      title: 'Get market orderbook',
      description:
        'Fetch the live CLOB orderbook (bids/asks) for one outcome token of a prediction market. Token ids come from the clobTokenIds field of market results.',
      inputSchema: {
        tokenId: z.string().min(1).describe('CLOB token id for one outcome'),
      },
      annotations: readOnly,
    },
    ({ tokenId }) =>
      run(() => getJson(PREDICTIONS_API_BASE, '/api/prediction-markets/orderbook', { tokenId })),
  );

  server.registerTool(
    'swop_get_prices',
    {
      title: 'Get live prices for outcome tokens',
      description:
        'Batch-fetch current best prices for up to 50 outcome token ids. Returns live book-derived prices (0..1 probabilities). Prefer this over the outcomePrices field on market rows when freshness matters — cached market rows can lag the book.',
      inputSchema: {
        tokenIds: z.array(z.string().min(1)).min(1).max(50).describe('CLOB token ids'),
      },
      annotations: readOnly,
    },
    ({ tokenIds }) =>
      run(() => postJson(PREDICTIONS_API_BASE, '/api/prediction-markets/prices', { tokenIds })),
  );

  server.registerTool(
    'swop_get_price_history',
    {
      title: 'Get price history for an outcome token',
      description:
        'Historical price series for one outcome token. Interval controls the window (e.g. "1d", "1w", "1m", "max"); fidelity is the candle resolution in minutes.',
      inputSchema: {
        tokenId: z.string().min(1).describe('CLOB token id'),
        interval: z.string().optional().describe('Window: 1h, 6h, 1d, 1w, 1m, max (default max)'),
        fidelity: z.number().int().min(1).optional().describe('Candle resolution in minutes, default 30'),
      },
      annotations: readOnly,
    },
    ({ tokenId, interval, fidelity }) =>
      run(() =>
        getJson(PREDICTIONS_API_BASE, '/api/prediction-markets/prices-history', {
          tokenId,
          interval,
          fidelity,
        }),
      ),
  );

  server.registerTool(
    'swop_get_taxonomy',
    {
      title: 'Get sports/category taxonomy',
      description:
        'Canonical mapping of sports and categories to tag ids, for use as tag_id in swop_search_markets. Also see swop_get_taxonomy_stats for open volume and live-game counts per sport.',
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => getJson(PREDICTIONS_API_BASE, '/api/prediction-markets/taxonomy')),
  );

  server.registerTool(
    'swop_get_taxonomy_stats',
    {
      title: 'Get per-sport market stats',
      description: 'Open volume and live-event counts per sport/category — useful for "what is popular right now".',
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => getJson(PREDICTIONS_API_BASE, '/api/prediction-markets/taxonomy/stats')),
  );

  server.registerTool(
    'swop_check_predictions_access',
    {
      title: 'Check prediction-market availability',
      description:
        'Check whether prediction-market trading is available (geo-restrictions apply in some regions). Call before suggesting trading actions; market DATA tools work everywhere.',
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => getJson(PREDICTIONS_API_BASE, '/api/prediction-markets/geoblock')),
  );

  // ---------- authed tools (Swop account linking) ----------
  // Available once the user connects their Swop account (OAuth). Without a
  // token the tools return a clear link-your-account error, which MCP clients
  // surface alongside the /.well-known/oauth-protected-resource discovery.

  const authedCall = async (method: string, path: string, body?: unknown) => {
    if (!authHeader) {
      throw new Error(
        'Not linked to a Swop account. Connect the Swop connector with authentication (OAuth) to use this tool.',
      );
    }
    const res = await fetch(new URL(path, SWOP_API_BASE).toString(), {
      method,
      headers: {
        authorization: authHeader,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Swop API ${res.status}: ${json.message ?? 'request failed'}`);
    return json.data ?? json;
  };

  const authedRead = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    'swop_get_my_profile',
    {
      title: 'Get my Swop profile',
      description: 'The linked Swop account: name, email, and SmartSites (handle, bio). Requires connecting your Swop account.',
      inputSchema: {},
      annotations: authedRead,
    },
    () => run(() => authedCall('GET', '/api/v5/mcp/me')),
  );

  server.registerTool(
    'swop_get_my_balances',
    {
      title: 'Get my wallet balances',
      description: 'Current wallet balance snapshot for the linked Swop account (total USD and per-asset breakdown).',
      inputSchema: {},
      annotations: authedRead,
    },
    () => run(() => authedCall('GET', '/api/v5/mcp/balances')),
  );

  server.registerTool(
    'swop_get_my_orders',
    {
      title: 'Get my orders',
      description: 'Recent marketplace orders for the linked Swop account, both sides: sales of your products and your purchases. Shows payment, escrow/settlement, and fulfillment status.',
      inputSchema: {},
      annotations: authedRead,
    },
    () => run(() => authedCall('GET', '/api/v5/mcp/orders')),
  );

  server.registerTool(
    'swop_get_my_smartsite',
    {
      title: 'See my SmartSite',
      description:
        "Get the linked account's current SmartSite so you can see it BEFORE editing: name, bio, appearance (background/theme), the links already on it (icons, buttons, info bars, with their item ids for removal), product tiles, and a viewUrl to preview it. ALWAYS call this before adding or changing things so edits stay additive.",
      inputSchema: {
        smartsiteId: z.string().optional().describe('Specific SmartSite id (default: primary)'),
      },
      annotations: authedRead,
    },
    ({ smartsiteId }) =>
      run(() =>
        authedCall('GET', `/api/v5/mcp/smartsite${smartsiteId ? `?smartsiteId=${encodeURIComponent(smartsiteId)}` : ''}`),
      ),
  );

  server.registerTool(
    'swop_update_my_smartsite',
    {
      title: 'Edit my SmartSite (name, bio, background)',
      description:
        "Edit the linked account's SmartSite: display name, bio, and appearance (background color, a gradient of hex stops, a background image URL, theme/font color, font family, or header layout). Pass only what you want to change. For adding links/buttons/info bars use swop_add_link; for products use swop_create_product / swop_feature_product.",
      inputSchema: {
        name: z.string().max(80).optional().describe('New display name'),
        bio: z.string().max(500).optional().describe('New bio text'),
        backgroundColor: z.string().optional().describe('Solid background hex, e.g. "#0b0b0f"'),
        backgroundGradient: z.array(z.string()).max(8).optional().describe('Gradient hex stops, e.g. ["#5b3df5","#0b0b0f"] (clears the solid color)'),
        backgroundImg: z.string().url().optional().describe('Background/wallpaper image URL'),
        themeColor: z.string().optional().describe('Accent/theme hex color'),
        fontColor: z.string().optional().describe('Primary font hex color'),
        fontFamily: z.string().optional().describe('Font family name'),
        headerFormat: z.enum(['centered', 'left', 'cover', 'hero', 'orbit', 'card', 'bar']).optional().describe('Header layout style'),
        smartsiteId: z.string().optional().describe('Specific SmartSite id (default: primary)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args) => run(() => authedCall('PATCH', '/api/v5/mcp/smartsite', args)),
  );

  server.registerTool(
    'swop_add_link',
    {
      title: 'Add a link to my SmartSite',
      description:
        "Add a link to the linked account's SmartSite, with smart placement. TWO STEPS: (1) call with just the url — the tool detects what kind of link it is (payment like Venmo/PayPal/Cash App, social, contact, website) and returns a recommendation with a text preview of each layout: a small ICON in the icon row, a link BUTTON tile, or a full-width INFOBAR call-to-action card. Show the user the message + previews and ask which they want. (2) call again with the same url plus displayAs = 'icon' | 'button' | 'infobar' to place it. You can override title / buttonName / description / style ('solid' | 'glass') for an info bar. Returns a viewUrl to preview the result.",
      inputSchema: {
        url: z.string().describe('The link to add (any URL, or mailto:/tel:)'),
        displayAs: z.enum(['icon', 'button', 'infobar']).optional().describe("Omit first to get a placement suggestion; then set to place it"),
        title: z.string().max(120).optional().describe('Override the label/title'),
        buttonName: z.string().max(40).optional().describe('Info-bar button text (e.g. "Pay", "Book")'),
        description: z.string().max(300).optional().describe('Info-bar description line'),
        style: z.enum(['solid', 'glass']).optional().describe("Info-bar card style (default solid)"),
        smartsiteId: z.string().optional().describe('Specific SmartSite id (default: primary)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args) => run(() => authedCall('POST', '/api/v5/mcp/smartsite/link', args)),
  );

  server.registerTool(
    'swop_remove_link',
    {
      title: 'Remove a SmartSite link',
      description:
        "Remove a link/icon/info-bar/product tile from the SmartSite. Get the item's id and contentType from swop_get_my_smartsite (icons → 'socialTop', buttons → 'socialLarge', info bars → 'infoBar', product tiles → 'marketPlace'). Confirm with the user first.",
      inputSchema: {
        contentType: z.enum(['socialTop', 'socialLarge', 'infoBar', 'marketPlace']).describe('The kind of item to remove'),
        itemId: z.string().describe('The item id from swop_get_my_smartsite'),
        smartsiteId: z.string().optional().describe('Specific SmartSite id (default: primary)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    (args) => run(() => authedCall('DELETE', '/api/v5/mcp/smartsite/link', args)),
  );

  server.registerTool(
    'swop_create_product',
    {
      title: 'Create a product',
      description:
        'Create a sellable product on the linked account\'s SmartSite. It becomes instantly purchasable by humans at the SmartSite and by AI agents over x402. Confirm name and price with the user before creating.',
      inputSchema: {
        name: z.string().min(1).max(120).describe('Product name'),
        description: z.string().max(2000).optional().describe('Product description'),
        priceUsd: z.number().positive().describe('Price in USD (settles in USDC)'),
        image: z.string().url().optional().describe('Product image URL'),
        productType: z.string().optional().describe('collectible (default), phygital, membership, coupon'),
        mintLimit: z.number().int().positive().optional().describe('Inventory limit, default 1'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ name, description, priceUsd, image, productType, mintLimit }) =>
      run(() =>
        authedCall('POST', '/api/v5/mcp/products', {
          name,
          description,
          price: priceUsd,
          image,
          productType: productType ?? 'collectible',
          mintLimit: mintLimit ?? 1,
        }),
      ),
  );

  server.registerTool(
    'swop_feature_product',
    {
      title: 'Feature a product on my SmartSite',
      description:
        "Put an already-created product (from swop_create_product) onto the SmartSite as a visible product tile so visitors see and can buy it. Pass the product's templateId (returned by swop_create_product). Use swop_create_product first to make the product, then this to display it.",
      inputSchema: {
        templateId: z.string().describe('The product/template id from swop_create_product'),
        carouselTitle: z.string().max(80).optional().describe('Optional heading for the product section'),
        smartsiteId: z.string().optional().describe('Specific SmartSite id (default: primary)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args) => run(() => authedCall('POST', '/api/v5/mcp/smartsite/feature-product', args)),
  );

  server.registerTool(
    'swop_list_my_products',
    {
      title: 'List my products',
      description:
        "List the linked account's products (each with its id, name, price, inventory, and status). Use the id with swop_update_product (to edit or unlist) or swop_feature_product (to show it on the SmartSite).",
      inputSchema: {},
      annotations: authedRead,
    },
    () => run(() => authedCall('GET', '/api/v5/mcp/products')),
  );

  server.registerTool(
    'swop_update_product',
    {
      title: 'Edit or unlist a product',
      description:
        "Edit one of the linked account's products, or unlist it. Pass its productId (from swop_list_my_products) plus only the fields to change: name, description, priceUsd, image, mintLimit. To unlist/remove it from sale, set status to 'archived'. Confirm price and name changes with the user first.",
      inputSchema: {
        productId: z.string().describe('The product id from swop_list_my_products'),
        name: z.string().max(120).optional().describe('New product name'),
        description: z.string().max(2000).optional().describe('New description'),
        priceUsd: z.number().positive().optional().describe('New price in USD (settles in USDC)'),
        image: z.string().url().optional().describe('New product image URL'),
        mintLimit: z.number().int().positive().optional().describe('New inventory limit'),
        status: z.enum(['active', 'archived']).optional().describe("Set 'archived' to unlist the product"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    ({ productId, name, description, priceUsd, image, mintLimit, status }) =>
      run(() =>
        authedCall('PATCH', `/api/v5/mcp/products/${encodeURIComponent(productId)}`, {
          title: name,
          description,
          ...(priceUsd !== undefined ? { price: priceUsd } : {}),
          image,
          ...(mintLimit !== undefined ? { mintLimit } : {}),
          status,
        }),
      ),
  );

  server.registerTool(
    'swop_get_spending_delegation',
    {
      title: 'Get my AI spending settings',
      description:
        "The linked account's transaction delegation for AI assistants: whether it's active, per-transaction and daily caps, and how much of today's cap is already spent. Check before attempting a send.",
      inputSchema: {},
      annotations: authedRead,
    },
    () => run(() => authedCall('GET', '/api/v5/mcp/delegation')),
  );

  server.registerTool(
    'swop_send',
    {
      title: 'Send USDC from my Swop wallet',
      description:
        'Send USDC (on Base) from the linked Swop wallet to a swop.id handle or 0x address, within the caps the user set in the Swop app. TWO-STEP: call WITHOUT confirm first to get a preview (resolved recipient, amount, caps); show that summary to the user and get their explicit yes; then call again with the returned previewId and confirm: true. Over-cap or confirm-only settings return a Swop-app approval link instead of executing. Never call with confirm before the user has seen the preview.',
      inputSchema: {
        to: z.string().min(1).describe('Recipient: swop.id handle (e.g. "alice.swop.id") or 0x address'),
        amountUsd: z.number().positive().max(1000).describe('Amount in USD (sent as USDC)'),
        previewId: z.string().optional().describe('From the preview step'),
        confirm: z.boolean().optional().describe('true ONLY after the user explicitly confirmed the preview'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    ({ to, amountUsd, previewId, confirm }) =>
      run(() =>
        confirm && previewId
          ? authedCall('POST', '/api/v5/mcp/send', { previewId, confirm: true })
          : authedCall('POST', '/api/v5/mcp/send/preview', { to, amountUsd }),
      ),
  );

  server.registerTool(
    'swop_pay_x402_link',
    {
      title: 'Pay an x402 payment link',
      description:
        "Pay an external x402 payment link (any https URL that returns an HTTP 402 USDC challenge) from the linked user's Swop wallet, within their caps. TWO-STEP like swop_send: call WITHOUT confirm to preview (amount, payee, host, caps), show it to the user and get their explicit yes, then call again with the returned previewId and confirm: true. Over-cap or no delegation returns a Swop-app approval link. Base USDC only.",
      inputSchema: {
        url: z.string().url().describe('The x402 payment link (https)'),
        previewId: z.string().optional().describe('From the preview step'),
        confirm: z.boolean().optional().describe('true ONLY after the user confirmed the preview'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ url, previewId, confirm }) =>
      run(() =>
        confirm && previewId
          ? authedCall('POST', '/api/v5/mcp/pay-x402', { previewId, confirm: true })
          : authedCall('POST', '/api/v5/mcp/pay-x402/preview', { url }),
      ),
  );

  server.registerTool(
    'swop_get_swap_quote',
    {
      title: 'Get a token swap quote',
      description:
        "Get a swap quote for the linked user — EVM (via LiFi) or Solana (via Jupiter). Read-only: returns the estimated output and directs the user to complete the swap in the Swop app. For EVM, pass chain plus token ADDRESSES; for Solana, omit chain and pass token MINTS. Amounts are in the input token's base units.",
      inputSchema: {
        inputMint: z.string().describe('Input token: EVM contract address, or Solana mint'),
        outputMint: z.string().optional().describe('Output token: EVM address, or Solana mint (default USDC)'),
        amount: z.string().describe('Input amount in base units (wei / lamports / token decimals)'),
        chain: z
          .string()
          .optional()
          .describe('EVM chain for a LiFi quote: base, ethereum, polygon, arbitrum, optimism, or a numeric chain id. Omit for a Solana (Jupiter) quote.'),
      },
      annotations: authedRead,
    },
    ({ inputMint, outputMint, amount, chain }) =>
      run(() => authedCall('POST', '/api/v5/mcp/swap/quote', { inputMint, outputMint, amount, chain })),
  );

  server.registerTool(
    'swop_swap',
    {
      title: 'Execute a token swap (EVM)',
      description:
        "Execute an on-chain token swap from the linked user's Swop wallet, within their delegation caps. EVM only (via LiFi); Solana swaps still complete in the app. TWO-STEP like swop_send: call WITHOUT confirm to preview (estimated output, min received, USD value, caps); show the user the estimated output and get their explicit yes; then call again with the returned previewId and confirm: true. Gas is sponsored, and any needed token approval is handled automatically. Over-cap or no delegation returns a Swop-app approval link. Pass chain plus token ADDRESSES; amount is in the input token's base units.",
      inputSchema: {
        inputMint: z.string().describe('Input token EVM contract address'),
        outputMint: z.string().describe('Output token EVM contract address'),
        amount: z.string().describe('Input amount in base units (wei / token decimals)'),
        chain: z
          .string()
          .describe('EVM chain: base, ethereum, polygon, arbitrum, or a numeric chain id'),
        previewId: z.string().optional().describe('From the preview step'),
        confirm: z.boolean().optional().describe('true ONLY after the user confirmed the preview (output shown)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ inputMint, outputMint, amount, chain, previewId, confirm }) =>
      run(() =>
        confirm && previewId
          ? authedCall('POST', '/api/v5/mcp/swap', { previewId, confirm: true })
          : authedCall('POST', '/api/v5/mcp/swap/preview', { inputMint, outputMint, amount, chain }),
      ),
  );

  server.registerTool(
    'swop_perps_order',
    {
      title: 'Open or close a perps position',
      description:
        "Open or close a Hyperliquid perpetual position for the linked user, within their margin and leverage caps set in the Swop app. The cap is MARGIN per position (e.g. $25) with a leverage ceiling (e.g. 5x) — so $25 at 5x controls ~$125 of exposure. TWO-STEP like swop_send: call WITHOUT confirm to preview (coin, direction, margin, leverage, resulting exposure, mark price); ALWAYS show the user the leverage and exposure and get explicit confirmation; then call again with previewId and confirm: true. reduceOnly:true closes/reduces an existing position. Over-cap or no delegation returns a Swop-app approval link. Perps are leveraged and can be liquidated — make the risk clear to the user.",
      inputSchema: {
        coin: z.string().min(1).describe('Perp market symbol, e.g. "BTC", "ETH", "SOL"'),
        direction: z.enum(['long', 'short']).describe('long = buy/up, short = sell/down'),
        marginUsd: z.number().positive().max(500).describe('Margin (collateral) in USD to commit'),
        leverage: z.number().min(1).max(20).describe('Leverage multiplier (capped by the user\'s setting and the market max)'),
        reduceOnly: z.boolean().optional().describe('true to close/reduce an existing position instead of opening'),
        previewId: z.string().optional().describe('From the preview step'),
        confirm: z.boolean().optional().describe('true ONLY after the user confirmed the preview (with leverage + exposure shown)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    ({ coin, direction, marginUsd, leverage, reduceOnly, previewId, confirm }) =>
      run(() =>
        confirm && previewId
          ? authedCall('POST', '/api/v5/mcp/perps', { previewId, confirm: true })
          : authedCall('POST', '/api/v5/mcp/perps/preview', { coin, direction, marginUsd, leverage, reduceOnly }),
      ),
  );

  server.registerTool(
    'swop_get_product_link',
    {
      title: 'Get a shareable product link',
      description:
        "Get one shareable link for a product that works for everyone: a person opening it sees a product page with a Buy button; an AI agent hitting it is sent the x402 payment challenge. Use this to share a product in chat, a post, or a message.",
      inputSchema: {
        handle: z.string().min(1).describe('Seller swop.id, e.g. "travis.swop.id"'),
        sku: z.string().min(1).describe('Product sku/id from swop_get_store'),
      },
      annotations: readOnly,
    },
    ({ handle, sku }) =>
      run(async () => ({
        shareUrl: `${APP_BASE_URL}/p/${handle.toLowerCase()}/${sku}`,
        note: 'Humans see a product page; AI agents are redirected to the x402 pay endpoint.',
      })),
  );

  // ---------- x402 storefront ----------

  server.registerTool(
    'swop_get_store',
    {
      title: 'Get a swop.id storefront',
      description:
        "List the real products a swop.id sells on their SmartSite, with USDC prices and each product's x402 buyUrl. An agent with an x402-capable wallet purchases by GETting the buyUrl: the first request returns HTTP 402 with payment instructions (exact USDC amount, network, pay-to address), and retrying with a signed X-PAYMENT header completes the purchase and returns a receipt. Always show the user the product, price, and seller and get their confirmation before paying.",
      inputSchema: {
        handle: z.string().min(1).describe('The seller swop.id, e.g. "travis.swop.id"'),
      },
      annotations: readOnly,
    },
    ({ handle }) =>
      run(() => getJson(SWOP_API_BASE, `/api/v5/x402/store/${handle.toLowerCase()}`)),
  );

  return server;
}
