import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PREDICTIONS_API_BASE, SWOP_API_BASE } from './config.js';
import { getJson, postJson, UpstreamError } from './http-client.js';
import { getCatalog } from './store.js';

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://mcp.swopme.co';

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

export function buildServer(): McpServer {
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

  // ---------- x402 storefront ----------

  server.registerTool(
    'swop_get_store',
    {
      title: 'Get a swop.id storefront',
      description:
        "List the products a swop.id sells, with USDC prices and each product's x402 buyUrl. An agent with an x402-capable wallet purchases by GETting the buyUrl: the first request returns HTTP 402 with payment instructions (exact USDC amount, network, pay-to address), and retrying with a signed X-PAYMENT header completes the purchase and returns a receipt. Always show the user the product, price, and seller and get their confirmation before paying.",
      inputSchema: {
        handle: z.string().min(1).describe('The seller swop.id, e.g. "travis.swop.id"'),
      },
      annotations: readOnly,
    },
    ({ handle }) =>
      run(async () => {
        const products = getCatalog(handle);
        if (!products) throw new Error(`No storefront for ${handle}`);
        return {
          handle: handle.toLowerCase(),
          currency: 'USDC',
          products: products.map((p) => ({
            ...p,
            buyUrl: `${PUBLIC_BASE_URL}/store/${handle.toLowerCase()}/buy/${p.sku}`,
          })),
        };
      }),
  );

  return server;
}
