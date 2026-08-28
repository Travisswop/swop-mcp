// x402-native storefront for swop.ids.
//
// GET  /store/:handle            — product catalog (free, JSON)
// GET  /store/:handle/buy/:sku   — x402-gated purchase: humans/agents without
//                                  payment get HTTP 402 with machine-readable
//                                  USDC payment instructions; a retry carrying
//                                  a valid X-PAYMENT header is verified and
//                                  settled via the x402 facilitator, then the
//                                  purchase receipt is returned.
//
// The pay-to address is the swop.id owner's EVM address, resolved through the
// public identity API (the same layer the MCP identity tools use), so the
// storefront is native to the handle — no separate merchant onboarding.
// Until ENABLE_PUBLIC_IDENTITY_API is live in prod, STORE_PAYTO_DEFAULT (or
// STORE_PAYTO_<HANDLE>) provides the address.
//
// Network defaults to Base Sepolia (testnet USDC) with the free x402.org
// facilitator; set X402_NETWORK=base + a CDP facilitator URL for mainnet.

import type express from 'express';
import { SWOP_API_BASE } from './config.js';
import { getJson } from './http-client.js';

const NETWORK = process.env.X402_NETWORK ?? 'base-sepolia';
const FACILITATOR = process.env.X402_FACILITATOR ?? 'https://x402.org/facilitator';
const USDC_ADDRESS =
  NETWORK === 'base'
    ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    : '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

export interface Product {
  sku: string;
  name: string;
  description: string;
  priceUsd: number; // whole USD; USDC has 6 decimals
}

// Demo catalog. The production version reads the handle's real Swop products;
// this seeds the flow end-to-end while that API surface is auth-gated.
const CATALOGS: Record<string, Product[]> = {
  'travis.swop.id': [
    { sku: 'sticker-pack', name: 'Swop Sticker Pack', description: 'Holographic Swop stickers, shipped worldwide.', priceUsd: 5 },
    { sku: 'founder-chat', name: '30-min Founder Chat', description: 'Video call with Travis about Swop, agents, or crypto payments.', priceUsd: 25 },
    { sku: 'genesis-pass', name: 'Swop Genesis Pass', description: 'Early-supporter digital pass for the Swop agent economy.', priceUsd: 1 },
  ],
};

async function resolvePayTo(handle: string): Promise<string | null> {
  const envKey = `STORE_PAYTO_${handle.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
  const override = process.env[envKey] ?? null;
  try {
    const res = (await getJson(SWOP_API_BASE, '/api/v5/identity/lookup', { handle })) as {
      data?: { evmAddress?: string | null };
    };
    if (res?.data?.evmAddress) return res.data.evmAddress;
  } catch {
    // identity API not yet enabled in prod — fall through to env override
  }
  return override ?? process.env.STORE_PAYTO_DEFAULT ?? null;
}

function paymentRequirements(handle: string, product: Product, resource: string) {
  return {
    scheme: 'exact',
    network: NETWORK,
    maxAmountRequired: String(Math.round(product.priceUsd * 1_000_000)), // USDC atomic units
    resource,
    description: `${product.name} from ${handle} on Swop`,
    mimeType: 'application/json',
    payTo: '', // filled per request after identity resolution
    maxTimeoutSeconds: 300,
    asset: USDC_ADDRESS,
    extra: { name: NETWORK === 'base' ? 'USD Coin' : 'USDC', version: '2' },
  };
}

async function facilitatorCall(path: 'verify' | 'settle', paymentHeader: string, requirements: unknown) {
  const res = await fetch(`${FACILITATOR}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: 1, paymentHeader, paymentRequirements: requirements }),
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

export function mountStore(app: express.Express): void {
  app.get('/store/:handle', (req, res) => {
    const handle = req.params.handle.toLowerCase();
    const products = CATALOGS[handle];
    if (!products) {
      res.status(404).json({ error: `No storefront for ${handle}` });
      return;
    }
    res.json({
      handle,
      network: NETWORK,
      currency: 'USDC',
      products: products.map((p) => ({
        ...p,
        buyUrl: `${req.protocol}://${req.get('host')}/store/${handle}/buy/${p.sku}`,
      })),
    });
  });

  app.get('/store/:handle/buy/:sku', async (req, res) => {
    const handle = req.params.handle.toLowerCase();
    const product = CATALOGS[handle]?.find((p) => p.sku === req.params.sku);
    if (!product) {
      res.status(404).json({ error: 'Unknown product' });
      return;
    }
    const payTo = await resolvePayTo(handle);
    if (!payTo) {
      res.status(503).json({
        error: `Cannot resolve a payout address for ${handle} yet — identity API pending`,
      });
      return;
    }

    const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const requirements = { ...paymentRequirements(handle, product, resource), payTo };

    const paymentHeader = req.header('X-PAYMENT');
    if (!paymentHeader) {
      res.status(402).json({
        x402Version: 1,
        error: 'X-PAYMENT header is required',
        accepts: [requirements],
      });
      return;
    }

    const verify = await facilitatorCall('verify', paymentHeader, requirements);
    if (!verify.ok || verify.body.isValid === false) {
      res.status(402).json({
        x402Version: 1,
        error: `Payment verification failed: ${verify.body.invalidReason ?? 'unknown'}`,
        accepts: [requirements],
      });
      return;
    }

    const settle = await facilitatorCall('settle', paymentHeader, requirements);
    if (!settle.ok || settle.body.success === false) {
      res.status(402).json({
        x402Version: 1,
        error: `Payment settlement failed: ${settle.body.error ?? 'unknown'}`,
        accepts: [requirements],
      });
      return;
    }

    res.setHeader(
      'X-PAYMENT-RESPONSE',
      Buffer.from(JSON.stringify(settle.body)).toString('base64'),
    );
    res.json({
      status: 'paid',
      receipt: {
        handle,
        sku: product.sku,
        name: product.name,
        amountUsd: product.priceUsd,
        currency: 'USDC',
        network: NETWORK,
        payTo,
        transaction: settle.body.transaction ?? settle.body.txHash ?? null,
        fulfillment: `Order received — ${handle} will follow up. Keep this receipt.`,
      },
    });
  });
}

export function getCatalog(handle: string): Product[] | null {
  return CATALOGS[handle.toLowerCase()] ?? null;
}
